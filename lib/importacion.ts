import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { aplicarMovimiento } from "./almacen";
import type { Recurso } from "./planes";
import { asignarPlan } from "./asignaciones";
import { medianocheEnZona } from "./periodos";
import * as N from "./normalizar";

/**
 * Qué se puede importar desde CSV y cómo se convierte cada renglón.
 *
 * Cada tipo declara sus columnas y sabe cuatro cosas: convertir un renglón en
 * datos —o decir, por columna, por qué no—, reconocer lo que ya existe, crear
 * lo nuevo y, cuando tiene sentido, actualizar lo existente. El recorrido
 * completo —validar, clasificar duplicados, guardar todo o nada, dejar el lote
 * trazable— vive en `lib/importacion-motor.ts`, y lo usan igual la pantalla y
 * las pruebas.
 *
 * Las referencias se resuelven por CÓDIGO, no por identificador interno: quien
 * exporta desde Excel conoce «BOM-101», no un cuid.
 *
 * El orden de la lista es el orden en que conviene importar: un activo
 * necesita su sitio, una refacción su unidad, un plan su activo.
 */

export type ClaveImportacion =
  | "sitios" | "ubicaciones" | "categorias-activo" | "activos"
  | "proveedores" | "familias-refaccion" | "unidades" | "refacciones"
  | "planes" | "codigos-falla" | "causas-raiz"
  | "especialidades" | "servicios-externos";

export type Columna = {
  nombre: string;
  requerido?: boolean;
  ayuda?: string;
  ejemplo: string;
};

/** Un problema de un renglón, con la columna donde está. */
export type Falla = { columna?: string; motivo: string };

/**
 * Lo que sirve para darse cuenta de que dos registros son el mismo aunque el
 * código difiera. Cada campo se compara ya normalizado —sin acentos ni
 * mayúsculas—; nunca se guarda.
 */
export type Comparable = {
  /** Nombre comparable. Junto con `ambito`: mismo nombre en el mismo lugar. */
  nombre?: string;
  ambito?: string;
  serie?: string;
  rfc?: string;
  correo?: string;
  /** Firma libre: en planes, «activo|frecuencia». */
  firma?: string;
};

export type ResultadoFila =
  | {
      ok: true;
      clave: string;
      resumen: string;
      datos: Record<string, unknown>;
      comparar: Comparable;
      advertencias: Falla[];
    }
  | { ok: false; resumen: string; fallas: Falla[] };

export type Existente = { id: string; clave: string; resumen: string; comparar: Comparable };

export type Contexto = {
  /** Zona de la empresa: a qué hora empieza un día de una fecha importada. */
  zona: string;
  mapas: Record<string, Map<string, string>>;
};

export type Db = Prisma.TransactionClient;

export type DefinicionImportacion = {
  titulo: string;
  descripcion: string;
  /** Qué debe existir antes de importar esto. */
  requisitos?: string;
  /** Errores comunes, para la ayuda de la pantalla. */
  erroresComunes?: string[];
  columnas: Columna[];
  /** Recurso del plan que consume, si aplica. */
  recurso?: Recurso;
  /** Modelo de Prisma que se crea, para el lote y la reversión. */
  entidad: string;
  contexto: (orgId: string) => Promise<Record<string, Map<string, string>>>;
  convertir: (fila: Record<string, string>, ctx: Contexto) => ResultadoFila;
  existentes: (orgId: string) => Promise<Existente[]>;
  insertar: (db: Db, orgId: string, datos: Record<string, unknown>) => Promise<{ id: string }>;
  /**
   * Actualiza el existente con lo del renglón. Devuelve cómo estaba, para que
   * el lote pueda mostrarlo. Sin esta función, un duplicado exacto solo se
   * omite.
   */
  actualizar?: (db: Db, orgId: string, id: string, datos: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

// ───────────────────────────────────────────────────────── Ayudantes ───

/** Recolecta fallas de columna en vez de detenerse en la primera. */
class Renglon {
  fallas: Falla[] = [];
  advertencias: Falla[] = [];
  constructor(readonly fila: Record<string, string>) {}

  /** Texto obligatorio: si falta, se anota y se regresa vacío. */
  requerido(columna: string, limite = 200, etiqueta?: string) {
    const v = N.texto(this.fila[columna], limite);
    if (!v) this.fallas.push({ columna, motivo: `Falta ${etiqueta ?? `«${columna}»`}` });
    return v;
  }
  opcional(columna: string, limite = 500) {
    return N.texto(this.fila[columna], limite) || null;
  }
  /** Veredicto de un normalizador: si falla, se anota en la columna. */
  valor<T>(columna: string, v: N.Veredicto<T>, respaldo: T): T {
    if (v.ok) return v.valor;
    this.fallas.push({ columna, motivo: v.motivo });
    return respaldo;
  }
  /** Igual, pero si falla solo avisa: el dato era opcional y se omite. */
  valorOpcional<T>(columna: string, v: N.Veredicto<T | null>): T | null {
    if (v.ok) return v.valor;
    this.advertencias.push({ columna, motivo: `${v.motivo}. Se deja vacío.` });
    return null;
  }
  referencia(columna: string, mapa: Map<string, string> | undefined, que: string, obligatoria: boolean) {
    const v = N.codigo(this.fila[columna]);
    if (!v) {
      if (obligatoria) this.fallas.push({ columna, motivo: `Falta ${que}` });
      return null;
    }
    const id = mapa?.get(v) ?? null;
    if (!id) this.fallas.push({ columna, motivo: `No existe ${que} «${v}». Impórtelo o dé de alta primero.` });
    return id;
  }
  resultado(clave: string, resumen: string, datos: Record<string, unknown>, comparar: Comparable): ResultadoFila {
    if (this.fallas.length) return { ok: false, resumen, fallas: this.fallas };
    return { ok: true, clave, resumen, datos, comparar, advertencias: this.advertencias };
  }
}

const porCodigo = (filas: Array<{ id: string; code: string }>) =>
  new Map(filas.map((f) => [N.codigo(f.code), f.id]));

const fechaEnZona = (d: N.DiaCalendario | null, zona: string) =>
  d ? medianocheEnZona(d.anio, d.mes, d.dia, zona) : null;

/** Lo que había antes de actualizar, solo con los campos que se tocaron. */
function antesDe(registro: Record<string, unknown>, datos: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(datos).map((k) => [k, registro[k] ?? null]));
}

/** Catálogo simple de código y nombre: se repite en seis tipos, se escribe una vez. */
function catalogoSimple(p: {
  titulo: string;
  descripcion: string;
  entidad: string;
  ejemplo: [string, string];
  campoNombre: "name" | "description";
  conFamilia?: boolean;
  conTarifa?: boolean;
  delegado: (db: Db) => {
    findMany: (a: unknown) => Promise<Array<Record<string, unknown>>>;
    create: (a: unknown) => Promise<{ id: string }>;
    update: (a: unknown) => Promise<unknown>;
    findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
  };
  /** Si el código conserva mayúsculas y minúsculas (unidades: «pza», no «PZA»). */
  respetaCaso?: boolean;
}): DefinicionImportacion {
  const etiqueta = p.campoNombre === "name" ? "nombre" : "descripcion";
  return {
    titulo: p.titulo,
    descripcion: p.descripcion,
    entidad: p.entidad,
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: p.ejemplo[0] },
      { nombre: etiqueta, requerido: true, ejemplo: p.ejemplo[1] },
      ...(p.conFamilia ? [{ nombre: "familia", ejemplo: "MECANICO" }] : []),
      ...(p.conTarifa ? [{ nombre: "tarifa_hora", ayuda: "Costo interno de la hora-hombre", ejemplo: "180" }] : []),
    ],
    contexto: async () => ({}),
    convertir: (f) => {
      const r = new Renglon(f);
      const bruto = r.requerido("codigo", 60, "el código");
      const code = p.respetaCaso ? N.texto(bruto, 60) : N.codigo(bruto);
      const nombre = r.requerido(etiqueta, 200, `el ${etiqueta}`);
      const datos: Record<string, unknown> = { code, [p.campoNombre]: nombre };
      if (p.conFamilia) datos.category = r.opcional("familia", 60);
      if (p.conTarifa) datos.hourlyRate = r.valor("tarifa_hora", N.numero(f.tarifa_hora, { minimo: 0, campo: "La tarifa" }), 0) ?? 0;
      return r.resultado(N.codigo(code), nombre || code, datos, { nombre: N.claveComparable(nombre) });
    },
    existentes: async (orgId) =>
      (await p.delegado(prisma as unknown as Db).findMany({ where: { organizationId: orgId } })).map((x) => ({
        id: String(x.id),
        clave: N.codigo(String(x.code)),
        resumen: String(x[p.campoNombre] ?? x.code),
        comparar: { nombre: N.claveComparable(String(x[p.campoNombre] ?? "")) },
      })),
    insertar: (db, orgId, d) => p.delegado(db).create({ data: { ...d, organizationId: orgId }, select: { id: true } }),
    actualizar: async (db, _orgId, id, d) => {
      const { code: _codigo, ...cambios } = d;
      void _codigo;
      const antes = await p.delegado(db).findUnique({ where: { id } });
      await p.delegado(db).update({ where: { id }, data: cambios });
      return antesDe(antes ?? {}, cambios);
    },
  };
}

// ────────────────────────────────────────────────────── Definiciones ───

export const IMPORTACIONES: Record<ClaveImportacion, DefinicionImportacion> = {
  // ─────────────────────────────────────────────────────────── Sitios
  sitios: {
    titulo: "Sitios",
    descripcion: "Plantas, edificios, sucursales o centros de trabajo. Impórtelos primero: los activos y las ubicaciones dependen de ellos.",
    erroresComunes: ["Dos sitios con el mismo código", "Usar el nombre en lugar del código en los archivos que siguen"],
    recurso: "sites",
    entidad: "Site",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "P01", ayuda: "Corto y único" },
      { nombre: "nombre", requerido: true, ejemplo: "Planta Apodaca" },
      { nombre: "ciudad", ejemplo: "Apodaca" },
      { nombre: "direccion", ejemplo: "Parque Industrial Milenium" },
    ],
    contexto: async () => ({}),
    convertir: (f) => {
      const r = new Renglon(f);
      const code = N.codigo(r.requerido("codigo", 30, "el código"));
      const nombre = r.requerido("nombre", 120, "el nombre");
      return r.resultado(code, nombre || code,
        { code, name: nombre, city: r.opcional("ciudad", 80), address: r.opcional("direccion", 200) },
        { nombre: N.claveComparable(nombre) });
    },
    existentes: async (orgId) =>
      (await prisma.site.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, name: true } }))
        .map((x) => ({ id: x.id, clave: N.codigo(x.code), resumen: x.name, comparar: { nombre: N.claveComparable(x.name) } })),
    insertar: (db, orgId, d) => db.site.create({ data: { ...(d as { code: string; name: string }), organizationId: orgId }, select: { id: true } }),
    actualizar: async (db, _o, id, d) => {
      const { code: _c, ...cambios } = d; void _c;
      const antes = await db.site.findUniqueOrThrow({ where: { id } });
      await db.site.update({ where: { id }, data: cambios });
      return antesDe(antes, cambios);
    },
  },

  // ────────────────────────────────────────────────────── Ubicaciones
  ubicaciones: {
    titulo: "Ubicaciones",
    descripcion: "Áreas, líneas, cuartos o niveles dentro de un sitio.",
    requisitos: "Los sitios deben existir.",
    erroresComunes: ["Poner el nombre del sitio en vez de su código", "Repetir el mismo nombre de ubicación con otro código"],
    entidad: "Location",
    columnas: [
      { nombre: "sitio", requerido: true, ejemplo: "P01", ayuda: "Código del sitio" },
      { nombre: "codigo", requerido: true, ejemplo: "LIN-A" },
      { nombre: "nombre", requerido: true, ejemplo: "Línea de producción A" },
      { nombre: "descripcion", ejemplo: "Nave norte" },
    ],
    contexto: async (orgId) => ({
      sitios: porCodigo(await prisma.site.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } })),
    }),
    convertir: (f, ctx) => {
      const r = new Renglon(f);
      const siteId = r.referencia("sitio", ctx.mapas.sitios, "el sitio", true);
      const code = N.codigo(r.requerido("codigo", 30, "el código"));
      const nombre = r.requerido("nombre", 120, "el nombre");
      return r.resultado(`${N.codigo(f.sitio)}|${code}`, nombre || code,
        { code, name: nombre, description: r.opcional("descripcion", 300), siteId },
        { nombre: N.claveComparable(nombre), ambito: siteId ?? "" });
    },
    existentes: async (orgId) =>
      (await prisma.location.findMany({
        where: { organizationId: orgId },
        select: { id: true, code: true, name: true, siteId: true, site: { select: { code: true } } },
      })).map((x) => ({
        id: x.id, clave: `${N.codigo(x.site.code)}|${N.codigo(x.code)}`, resumen: x.name,
        comparar: { nombre: N.claveComparable(x.name), ambito: x.siteId },
      })),
    insertar: (db, orgId, d) => db.location.create({ data: { ...(d as { code: string; name: string; siteId: string }), organizationId: orgId }, select: { id: true } }),
    actualizar: async (db, _o, id, d) => {
      const { code: _c, siteId: _s, ...cambios } = d; void _c; void _s;
      const antes = await db.location.findUniqueOrThrow({ where: { id } });
      await db.location.update({ where: { id }, data: cambios });
      return antesDe(antes, cambios);
    },
  },

  // ────────────────────────────────────────── Categorías de activo
  "categorias-activo": catalogoSimple({
    titulo: "Categorías de activo",
    descripcion: "Familias de equipo para agrupar y filtrar.",
    entidad: "AssetCategory",
    ejemplo: ["BOMB", "Bombas centrífugas"],
    campoNombre: "name",
    delegado: (db) => db.assetCategory as never,
  }),

  // ────────────────────────────────────────────────────────── Activos
  activos: {
    titulo: "Activos",
    descripcion: "El catálogo de equipos. Es la importación más importante y la que más tiempo ahorra.",
    requisitos: "Los sitios deben existir. Ubicaciones y categorías son opcionales, pero si se indican deben existir.",
    erroresComunes: [
      "Fechas en formato mes/día: se leen como día/mes (15/09/2026)",
      "El mismo equipo con dos TAG distintos: se detecta como posible duplicado por nombre y ubicación, o por número de serie",
      "Poner el nombre de la ubicación en vez de su código",
    ],
    recurso: "assets",
    entidad: "Asset",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "BOM-101", ayuda: "TAG del equipo, no se puede repetir" },
      { nombre: "nombre", requerido: true, ejemplo: "Bomba centrífuga de alimentación" },
      { nombre: "sitio", requerido: true, ejemplo: "P01", ayuda: "Código del sitio" },
      { nombre: "ubicacion", ejemplo: "LIN-A", ayuda: "Código de la ubicación" },
      { nombre: "categoria", ejemplo: "BOMB", ayuda: "Código de la categoría" },
      { nombre: "criticidad", ejemplo: "A", ayuda: "A, B o C. Si se omite queda en B" },
      { nombre: "estado", ejemplo: "OPERATIONAL", ayuda: "OPERATIONAL, DEGRADED, DOWN, STANDBY o RETIRED" },
      { nombre: "fabricante", ejemplo: "Grundfos" },
      { nombre: "modelo", ejemplo: "CR-15" },
      { nombre: "numero_serie", ejemplo: "SN-2019-1370" },
      { nombre: "descripcion", ejemplo: "Bomba de alimentación a caldera" },
      { nombre: "fecha_compra", ejemplo: "12/10/2023", ayuda: "dd/mm/aaaa" },
      { nombre: "costo_adquisicion", ejemplo: "95000" },
      { nombre: "costo_reposicion", ejemplo: "130000" },
      { nombre: "fin_garantia", ejemplo: "29/04/2026", ayuda: "dd/mm/aaaa" },
    ],
    contexto: async (orgId) => {
      const ubicaciones = await prisma.location.findMany({
        where: { organizationId: orgId }, select: { id: true, code: true, siteId: true },
      });
      return {
        sitios: porCodigo(await prisma.site.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } })),
        ubicaciones: porCodigo(ubicaciones),
        // De que sitio es cada ubicacion: un equipo no puede estar en el sitio A
        // y en una ubicacion del sitio B.
        sitioDeUbicacion: new Map(ubicaciones.map((u) => [u.id, u.siteId])),
        categorias: porCodigo(await prisma.assetCategory.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } })),
      };
    },
    convertir: (f, ctx) => {
      const r = new Renglon(f);
      const code = N.codigo(r.requerido("codigo", 40, "el código (TAG)"));
      const nombre = r.requerido("nombre", 160, "el nombre");
      const siteId = r.referencia("sitio", ctx.mapas.sitios, "el sitio", true);
      const locationId = r.referencia("ubicacion", ctx.mapas.ubicaciones, "la ubicación", false);
      if (locationId && siteId && ctx.mapas.sitioDeUbicacion.get(locationId) !== siteId) {
        r.fallas.push({ columna: "ubicacion", motivo: `La ubicación «${N.codigo(f.ubicacion)}» es de otro sitio` });
      }
      const categoryId = r.referencia("categoria", ctx.mapas.categorias, "la categoría", false);

      const criticidad = (N.texto(f.criticidad, 2) || "B").toUpperCase();
      if (!["A", "B", "C"].includes(criticidad)) r.fallas.push({ columna: "criticidad", motivo: `Criticidad «${f.criticidad}» inválida: use A, B o C` });
      const estado = (N.texto(f.estado, 20) || "OPERATIONAL").toUpperCase();
      if (!["OPERATIONAL", "DEGRADED", "DOWN", "STANDBY", "RETIRED"].includes(estado)) {
        r.fallas.push({ columna: "estado", motivo: `Estado «${f.estado}» inválido: use OPERATIONAL, DEGRADED, DOWN, STANDBY o RETIRED` });
      }
      if (!locationId) r.advertencias.push({ columna: "ubicacion", motivo: "Sin ubicación: el técnico no sabrá dónde encontrarlo, y la puesta en marcha lo marcará incompleto" });

      const serieNum = N.serie(f.numero_serie) || null;
      return r.resultado(code, nombre || code, {
        code, name: nombre, siteId, locationId, categoryId,
        criticality: criticidad, status: estado,
        manufacturer: r.opcional("fabricante", 80),
        model: r.opcional("modelo", 80),
        serialNumber: serieNum,
        description: r.opcional("descripcion", 500),
        purchaseDate: fechaEnZona(r.valorOpcional("fecha_compra", N.fecha(f.fecha_compra, "La fecha de compra")), ctx.zona),
        purchaseCost: r.valor("costo_adquisicion", N.numero(f.costo_adquisicion, { minimo: 0, campo: "El costo" }), 0) ?? 0,
        replacementCost: r.valor("costo_reposicion", N.numero(f.costo_reposicion, { minimo: 0, campo: "El costo" }), 0) ?? 0,
        warrantyExpiry: fechaEnZona(r.valorOpcional("fin_garantia", N.fecha(f.fin_garantia, "El fin de garantía")), ctx.zona),
      }, { nombre: N.claveComparable(nombre), ambito: locationId ?? siteId ?? "", serie: serieNum ? N.serieComparable(serieNum) : undefined });
    },
    existentes: async (orgId) =>
      (await prisma.asset.findMany({
        where: { organizationId: orgId },
        select: { id: true, code: true, name: true, siteId: true, locationId: true, serialNumber: true },
      })).map((x) => ({
        id: x.id, clave: N.codigo(x.code), resumen: x.name,
        comparar: { nombre: N.claveComparable(x.name), ambito: x.locationId ?? x.siteId, serie: x.serialNumber ? N.serieComparable(x.serialNumber) : undefined },
      })),
    insertar: (db, orgId, d) => db.asset.create({ data: { ...(d as { code: string; name: string; siteId: string }), organizationId: orgId }, select: { id: true } }),
    actualizar: async (db, _o, id, d) => {
      const { code: _c, ...cambios } = d; void _c;
      const antes = await db.asset.findUniqueOrThrow({ where: { id } });
      await db.asset.update({ where: { id }, data: cambios });
      return antesDe(antes, cambios);
    },
  },

  // ──────────────────────────────────────────────────────── Proveedores
  proveedores: {
    titulo: "Proveedores",
    descripcion: "Quién surte las refacciones y los servicios.",
    erroresComunes: ["El mismo proveedor con razón social y nombre comercial: el RFC lo delata", "Teléfonos con letras o extensiones pegadas"],
    entidad: "Supplier",
    columnas: [
      { nombre: "nombre", requerido: true, ejemplo: "Refacciones Industriales del Norte" },
      { nombre: "rfc", ejemplo: "RIN850101AB3", ayuda: "Opcional; si lo tiene, evita duplicados" },
      { nombre: "contacto", ejemplo: "Ing. Patricia Luna" },
      { nombre: "correo", ejemplo: "ventas@refaccionesnorte.mx" },
      { nombre: "telefono", ejemplo: "81 8100 2200" },
      { nombre: "dias_entrega", ejemplo: "5" },
    ],
    contexto: async () => ({}),
    convertir: (f) => {
      const r = new Renglon(f);
      const nombre = r.requerido("nombre", 160, "el nombre");
      const rfc = r.valor("rfc", N.rfc(f.rfc), null);
      const correo = r.valor("correo", N.correo(f.correo), null);
      const telefono = r.valorOpcional("telefono", N.telefono(f.telefono));
      return r.resultado(N.claveComparable(nombre), nombre, {
        name: nombre, rfc, contactName: r.opcional("contacto", 120),
        email: correo, phone: telefono,
        leadTimeDays: r.valor("dias_entrega", N.numero(f.dias_entrega, { minimo: 0, entero: true, campo: "Los días de entrega" }), 7) ?? 7,
      }, { nombre: N.claveComparable(nombre), rfc: rfc ?? undefined });
    },
    existentes: async (orgId) =>
      (await prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, rfc: true } }))
        .map((x) => ({ id: x.id, clave: N.claveComparable(x.name), resumen: x.name, comparar: { nombre: N.claveComparable(x.name), rfc: x.rfc ?? undefined } })),
    insertar: (db, orgId, d) => db.supplier.create({ data: { ...(d as { name: string }), organizationId: orgId }, select: { id: true } }),
    actualizar: async (db, _o, id, d) => {
      const { name: _n, ...cambios } = d; void _n;
      const antes = await db.supplier.findUniqueOrThrow({ where: { id } });
      await db.supplier.update({ where: { id }, data: cambios });
      return antesDe(antes, cambios);
    },
  },

  // ──────────────────────────────────── Familias de refacción
  "familias-refaccion": catalogoSimple({
    titulo: "Familias de refacción",
    descripcion: "Clasificación de las refacciones del almacén.",
    entidad: "PartCategory",
    ejemplo: ["RODAMIENTOS", "Rodamientos y baleros"],
    campoNombre: "name",
    delegado: (db) => db.partCategory as never,
  }),

  // ──────────────────────────────────────────── Unidades de medida
  unidades: catalogoSimple({
    titulo: "Unidades de medida",
    descripcion: "Cómo se cuenta cada refacción.",
    entidad: "PartUnit",
    ejemplo: ["pza", "Pieza"],
    campoNombre: "name",
    respetaCaso: true,
    delegado: (db) => db.partUnit as never,
  }),

  // ────────────────────────────────────────────────────── Refacciones
  refacciones: {
    titulo: "Refacciones",
    descripcion: "El catálogo del almacén con sus existencias iniciales.",
    requisitos: "Las familias y unidades deben existir, y la cuenta debe tener un almacén si trae existencias. El proveedor es opcional.",
    erroresComunes: [
      "Unidades escritas de muchas formas: «Pieza», «pz» y «PZA» se reconocen como la misma",
      "Existencia con decimales en una unidad que no los admite",
      "Mínimo mayor que máximo",
    ],
    entidad: "Part",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "ROD-6205" },
      { nombre: "nombre", requerido: true, ejemplo: "Rodamiento 6205-2RS" },
      { nombre: "unidad", requerido: true, ejemplo: "pza", ayuda: "Código de la unidad" },
      { nombre: "familia", ejemplo: "RODAMIENTOS", ayuda: "Código de la familia" },
      { nombre: "proveedor", ejemplo: "Refacciones Industriales del Norte", ayuda: "Nombre del proveedor" },
      { nombre: "descripcion", ejemplo: "Rodamiento rígido de bolas" },
      { nombre: "costo_unitario", ejemplo: "320" },
      { nombre: "existencia", ejemplo: "12", ayuda: "Cantidad inicial en el almacén general" },
      { nombre: "minimo", ejemplo: "4" },
      { nombre: "maximo", ejemplo: "20" },
      { nombre: "ubicacion_almacen", ejemplo: "A-03-2" },
    ],
    contexto: async (orgId) => {
      const [familias, unidades, proveedores, almacen] = await Promise.all([
        prisma.partCategory.findMany({ where: { organizationId: orgId }, select: { code: true } }),
        prisma.partUnit.findMany({ where: { organizationId: orgId }, select: { code: true } }),
        prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
        prisma.warehouse.findFirst({
          where: { organizationId: orgId, active: true },
          orderBy: [{ esGeneral: "desc" }, { code: "asc" }],
          select: { id: true },
        }),
      ]);
      return {
        // Se guarda el código tal cual está en el catálogo, respetando mayúsculas.
        unidades: new Map(unidades.map((u) => [N.unidad(u.code), u.code])),
        familias: new Map(familias.map((c) => [N.codigo(c.code), c.code])),
        proveedores: new Map(proveedores.map((s) => [N.claveComparable(s.name), s.id])),
        almacen: new Map(almacen ? [["general", almacen.id]] : []),
      };
    },
    convertir: (f, ctx) => {
      const r = new Renglon(f);
      const code = N.codigo(r.requerido("codigo", 40, "el código"));
      const nombre = r.requerido("nombre", 160, "el nombre");

      let unidad: string | null = null;
      if (N.texto(f.unidad)) {
        unidad = ctx.mapas.unidades.get(N.unidad(f.unidad)) ?? null;
        if (!unidad) r.fallas.push({ columna: "unidad", motivo: `La unidad «${f.unidad}» no está en el catálogo` });
      } else r.fallas.push({ columna: "unidad", motivo: "Falta la unidad" });

      let familia: string | null = null;
      if (N.texto(f.familia)) {
        familia = ctx.mapas.familias.get(N.codigo(f.familia)) ?? null;
        if (!familia) r.fallas.push({ columna: "familia", motivo: `La familia «${f.familia}» no está en el catálogo` });
      }
      let supplierId: string | null = null;
      if (N.texto(f.proveedor)) {
        supplierId = ctx.mapas.proveedores.get(N.claveComparable(f.proveedor)) ?? null;
        if (!supplierId) r.fallas.push({ columna: "proveedor", motivo: `El proveedor «${f.proveedor}» no existe` });
      }

      const existencia = r.valor("existencia", N.numero(f.existencia, { minimo: 0, campo: "La existencia" }), 0) ?? 0;
      const minimo = r.valor("minimo", N.numero(f.minimo, { minimo: 0, campo: "El mínimo" }), 0) ?? 0;
      const maximo = r.valor("maximo", N.numero(f.maximo, { minimo: 0, campo: "El máximo" }), 0) ?? 0;
      if (maximo > 0 && minimo > maximo) r.fallas.push({ columna: "minimo", motivo: `El mínimo (${minimo}) es mayor que el máximo (${maximo})` });
      if (existencia > 0 && !ctx.mapas.almacen.get("general")) {
        r.fallas.push({ columna: "existencia", motivo: "La cuenta no tiene almacén: dé de alta uno antes de importar existencias" });
      }
      const costo = r.valor("costo_unitario", N.numero(f.costo_unitario, { minimo: 0, campo: "El costo" }), 0) ?? 0;
      if (existencia > 0 && costo === 0) {
        r.advertencias.push({ columna: "costo_unitario", motivo: "Existencia sin costo: el inventario valdrá $0 y el consumo no cargará costo a las órdenes" });
      }

      return r.resultado(code, nombre || code, {
        code, name: nombre, unit: unidad, category: familia, supplierId,
        description: r.opcional("descripcion", 500),
        unitCost: costo, quantityOnHand: existencia, minQuantity: minimo, maxQuantity: maximo,
        bin: r.opcional("ubicacion_almacen", 40),
        almacenId: ctx.mapas.almacen.get("general") ?? null,
      }, { nombre: N.claveComparable(nombre) });
    },
    existentes: async (orgId) =>
      (await prisma.part.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, name: true } }))
        .map((x) => ({ id: x.id, clave: N.codigo(x.code), resumen: x.name, comparar: { nombre: N.claveComparable(x.name) } })),
    /**
     * La existencia inicial entra como MOVIMIENTO, dentro de la misma
     * transacción: el kardex cuadra desde el primer día y queda asentada en un
     * almacén. Si el movimiento falla, la refacción tampoco se crea.
     */
    insertar: async (db, orgId, d) => {
      const { quantityOnHand, almacenId, ...datos } = d as { quantityOnHand: number; almacenId: string | null; unitCost: number } & Record<string, unknown>;
      const part = await db.part.create({
        data: { ...(datos as unknown as { code: string; name: string; unit: string }), quantityOnHand: 0, organizationId: orgId },
        select: { id: true },
      });
      if (quantityOnHand > 0 && almacenId) {
        await aplicarMovimiento({
          organizationId: orgId, partId: part.id, warehouseId: almacenId,
          tipo: "IN", cantidad: quantityOnHand, costoUnitario: datos.unitCost as number,
          referencia: "Importación inicial",
        }, db);
      }
      return part;
    },
    /**
     * Actualizar NO toca la existencia: mover stock solo pasa por
     * `aplicarMovimiento`, y una importación no es un conteo. Si cambió, se
     * ajusta desde el almacén, con su motivo.
     */
    actualizar: async (db, _o, id, d) => {
      const { code: _c, quantityOnHand: _q, almacenId: _a, ...cambios } = d; void _c; void _q; void _a;
      const antes = await db.part.findUniqueOrThrow({ where: { id } });
      await db.part.update({ where: { id }, data: cambios });
      return antesDe(antes, cambios);
    },
  },

  // ──────────────────────────────────────────────────────────── Planes
  planes: {
    titulo: "Planes de mantenimiento",
    descripcion: "Los planes preventivos por calendario, cada uno ya aplicado a su equipo. Para que generen órdenes les faltan sus actividades: se agregan después, abriendo cada plan.",
    requisitos: "Los activos deben existir.",
    erroresComunes: [
      "Frecuencia en texto («mensual»): se escribe en días (30)",
      "Dos planes del mismo equipo con la misma frecuencia: se marcan como posible duplicado",
    ],
    entidad: "MaintenancePlan",
    columnas: [
      { nombre: "nombre", requerido: true, ejemplo: "Lubricación mensual de bomba" },
      { nombre: "activo", requerido: true, ejemplo: "BOM-101", ayuda: "Código (TAG) del activo" },
      { nombre: "cada_dias", requerido: true, ejemplo: "30", ayuda: "Frecuencia en días" },
      { nombre: "prioridad", ejemplo: "MEDIUM", ayuda: "LOW, MEDIUM, HIGH o CRITICAL" },
      { nombre: "horas_estimadas", ejemplo: "2" },
      { nombre: "anticipacion_dias", ejemplo: "3" },
      { nombre: "descripcion", ejemplo: "Ruta de lubricación según manual" },
      { nombre: "requiere_paro", ejemplo: "NO", ayuda: "SI o NO" },
      { nombre: "primer_vencimiento", ejemplo: "15/09/2026", ayuda: "dd/mm/aaaa. Si se omite, se calcula" },
    ],
    contexto: async (orgId) => ({
      activos: porCodigo(await prisma.asset.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } })),
    }),
    convertir: (f, ctx) => {
      const r = new Renglon(f);
      const nombre = r.requerido("nombre", 160, "el nombre del plan");
      const assetId = r.referencia("activo", ctx.mapas.activos, "el activo", true);
      const dias = r.valor("cada_dias", N.numero(f.cada_dias, { minimo: 1, entero: true, campo: "La frecuencia" }), null);
      if (dias === null && N.texto(f.cada_dias) === "") r.fallas.push({ columna: "cada_dias", motivo: "Falta la frecuencia en días" });

      const prioridad = (N.texto(f.prioridad, 10) || "MEDIUM").toUpperCase();
      if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(prioridad)) {
        r.fallas.push({ columna: "prioridad", motivo: `Prioridad «${f.prioridad}» inválida: use LOW, MEDIUM, HIGH o CRITICAL` });
      }
      const primer = r.valor("primer_vencimiento", N.fecha(f.primer_vencimiento, "El primer vencimiento"), null);
      const proximo = primer
        ? fechaEnZona(primer, ctx.zona)
        : dias ? new Date(Date.now() + dias * 86_400_000) : null;

      r.advertencias.push({ motivo: "El plan se importa sin actividades: agréguelas abriendo el plan, o no generará órdenes" });
      return r.resultado(`${N.codigo(f.activo)}|${N.claveComparable(nombre)}`, nombre, {
        name: nombre, assetId, intervalDays: dias,
        maintenanceType: "PREVENTIVE", triggerType: "CALENDAR",
        priority: prioridad,
        estimatedHours: r.valor("horas_estimadas", N.numero(f.horas_estimadas, { minimo: 0, campo: "Las horas" }), 1) ?? 1,
        leadTimeDays: r.valor("anticipacion_dias", N.numero(f.anticipacion_dias, { minimo: 0, entero: true, campo: "La anticipación" }), 3) ?? 3,
        description: r.opcional("descripcion", 500),
        requiresShutdown: N.siNo(f.requiere_paro),
        nextDueDate: proximo,
      }, { nombre: N.claveComparable(nombre), firma: assetId && dias ? `${assetId}|${dias}` : undefined });
    },
    existentes: async (orgId) =>
      (await prisma.maintenancePlan.findMany({
        where: { organizationId: orgId },
        select: {
          id: true, name: true, assetId: true, intervalDays: true,
          asset: { select: { code: true } },
          asignaciones: { select: { assetId: true, asset: { select: { code: true } } } },
        },
      })).flatMap((p) => {
        // Un plan puede estar en varios equipos: cuenta como existente en cada
        // uno. Las asignaciones mandan; el equipo del encabezado es el respaldo
        // de los planes viejos.
        const equipos = new Map<string, string>();
        for (const a of p.asignaciones) equipos.set(a.assetId, a.asset.code);
        if (p.assetId && !equipos.has(p.assetId)) equipos.set(p.assetId, p.asset?.code ?? "");
        return [...equipos].map(([assetId, code]) => ({
          id: p.id,
          clave: `${N.codigo(code)}|${N.claveComparable(p.name)}`,
          resumen: p.name,
          comparar: { nombre: N.claveComparable(p.name), firma: p.intervalDays ? `${assetId}|${p.intervalDays}` : undefined },
        }));
      }),
    /**
     * El plan Y su asignación al equipo, en la misma transacción.
     *
     * El programador no lee el encabezado: itera asignaciones. Un plan sin
     * asignación se ve perfecto en la lista y no genera una sola orden nunca.
     * La fecha del renglón es un VENCIMIENTO, así que se asigna como «arranca
     * ese día».
     */
    insertar: async (db, orgId, d) => {
      const { nextDueDate, ...datosPlan } = d as { nextDueDate: Date; assetId: string; name: string } & Record<string, unknown>;
      const plan = await db.maintenancePlan.create({
        data: { ...(datosPlan as { name: string }), nextDueDate, organizationId: orgId },
        select: { id: true },
      });
      await asignarPlan({
        organizationId: orgId,
        planId: plan.id,
        equipos: [{ assetId: datosPlan.assetId, desde: nextDueDate, desdeEsUltima: false }],
        db,
      });
      return plan;
    },
  },

  // ────────────────────────────────────────────── Códigos de falla
  "codigos-falla": catalogoSimple({
    titulo: "Códigos de falla",
    descripcion: "Qué falló. Se usa al cerrar una orden correctiva.",
    entidad: "FailureCode",
    ejemplo: ["MEC-01", "Desgaste de rodamiento"],
    campoNombre: "description",
    conFamilia: true,
    delegado: (db) => db.failureCode as never,
  }),

  // ────────────────────────────────────────────────── Causas raíz
  "causas-raiz": catalogoSimple({
    titulo: "Causas raíz",
    descripcion: "Por qué falló. Alimenta el análisis de fallas repetidas.",
    entidad: "RootCause",
    ejemplo: ["LUB-NO-EJECUTADA", "Ruta de lubricación no ejecutada"],
    campoNombre: "description",
    conFamilia: true,
    delegado: (db) => db.rootCause as never,
  }),

  // ─────────────────────────────────────────────── Especialidades
  especialidades: catalogoSimple({
    titulo: "Especialidades",
    descripcion: "Los oficios del personal y su tarifa por hora, para estimar la mano de obra de los planes.",
    entidad: "Specialty",
    ejemplo: ["MEC", "Mecánico"],
    campoNombre: "name",
    conTarifa: true,
    delegado: (db) => db.specialty as never,
  }),

  // ──────────────────────────────────────────── Servicios externos
  "servicios-externos": {
    titulo: "Servicios externos",
    descripcion: "Los trabajos que se subcontratan a proveedores. Son el tercer costo de una orden, junto a mano de obra y refacciones.",
    requisitos: "Los proveedores, si va a indicar el habitual de cada servicio.",
    entidad: "ExternalService",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "SRV-REB" },
      { nombre: "nombre", requerido: true, ejemplo: "Rebobinado de motor eléctrico" },
      { nombre: "proveedor", ayuda: "Nombre tal como está dado de alta", ejemplo: "Servicios Electromecánicos del Bajío" },
      { nombre: "unidad", ejemplo: "servicio" },
      { nombre: "costo_unitario", ejemplo: "14500" },
      { nombre: "descripcion", ejemplo: "Incluye desmontaje, barnizado y prueba" },
    ],
    contexto: async (orgId) => ({
      proveedores: new Map(
        (await prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }))
          .map((p) => [N.claveComparable(p.name), p.id]),
      ),
    }),
    convertir: (f, ctx) => {
      const r = new Renglon(f);
      const code = N.codigo(r.requerido("codigo", 40, "el código"));
      const nombre = r.requerido("nombre", 160, "el nombre");
      let supplierId: string | null = null;
      if (N.texto(f.proveedor)) {
        supplierId = ctx.mapas.proveedores.get(N.claveComparable(f.proveedor)) ?? null;
        if (!supplierId) r.fallas.push({ columna: "proveedor", motivo: `No existe el proveedor «${f.proveedor}»` });
      }
      return r.resultado(code, nombre || code, {
        code, name: nombre, supplierId,
        unit: r.opcional("unidad", 30) || "servicio",
        unitCost: r.valor("costo_unitario", N.numero(f.costo_unitario, { minimo: 0, campo: "El costo" }), 0) ?? 0,
        description: r.opcional("descripcion", 500),
      }, { nombre: N.claveComparable(nombre) });
    },
    existentes: async (orgId) =>
      (await prisma.externalService.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, name: true } }))
        .map((x) => ({ id: x.id, clave: N.codigo(x.code), resumen: x.name, comparar: { nombre: N.claveComparable(x.name) } })),
    insertar: (db, orgId, d) => db.externalService.create({ data: { ...(d as { code: string; name: string }), organizationId: orgId }, select: { id: true } }),
    actualizar: async (db, _o, id, d) => {
      const { code: _c, ...cambios } = d; void _c;
      const antes = await db.externalService.findUniqueOrThrow({ where: { id } });
      await db.externalService.update({ where: { id }, data: cambios });
      return antesDe(antes, cambios);
    },
  },
};

export const ORDEN_IMPORTACION: ClaveImportacion[] = [
  "sitios", "ubicaciones", "categorias-activo", "activos",
  "proveedores", "familias-refaccion", "unidades", "refacciones",
  "especialidades", "servicios-externos",
  "planes", "codigos-falla", "causas-raiz",
];

export function esImportacionValida(k: string): k is ClaveImportacion {
  return k in IMPORTACIONES;
}
