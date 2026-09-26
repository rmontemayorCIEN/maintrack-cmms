import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { aplicarMovimiento } from "./almacen";
import type { Recurso } from "./planes";
import { asignarPlan } from "./asignaciones";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { referenciaInicial, registrarLectura, tipoPorUnidad, validarLectura } from "./medidores";
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
  | "especialidades" | "servicios-externos"
  | "usuarios" | "almacenes" | "medidores" | "lecturas" | "existencias"
  | "centros-de-costo";

export type Columna = {
  nombre: string;
  requerido?: boolean;
  ayuda?: string;
  ejemplo: string;
};

/**
 * Un problema de un renglón: dónde está, qué valor traía, qué pasa y cómo se
 * corrige. Las cuatro cosas: quien arregla el archivo necesita saber qué
 * escribir, no solo que algo está mal.
 */
export type Falla = { columna?: string; motivo: string; valor?: string; solucion?: string };

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
  insertar: (db: Db, orgId: string, datos: Record<string, unknown>, extra: { userId: string | null }) => Promise<{ id: string }>;
  /**
   * Actualiza el existente con lo del renglón. Devuelve cómo estaba, para que
   * el lote pueda mostrarlo. Sin esta función, un duplicado exacto solo se
   * omite.
   */
  actualizar?: (db: Db, orgId: string, id: string, datos: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /**
   * Revisiones que necesitan la base y no caben en `convertir`, que es
   * síncrona: por ejemplo, que un correo no esté ya registrado en OTRA empresa.
   * Devuelve la falla de cada fila que no pase. Solo lee.
   */
  revisionGlobal?: (orgId: string, filas: Array<{ fila: number; datos: Record<string, unknown> }>) => Promise<Map<number, Falla>>;
  /** Columnas que NO se deben traer y cómo se avisa si vienen (contraseñas). */
  columnasProhibidas?: Record<string, string>;
  /** Lo que la persona tiene que hacer después de importar, si algo. */
  despues?: string;
};

/** La referencia con la que entra al kardex una existencia importada. */
export const REFERENCIA_EXISTENCIA_INICIAL = "Existencia inicial importada";

// ───────────────────────────────────────────────────────── Ayudantes ───

/** Recolecta fallas de columna en vez de detenerse en la primera. */
class Renglon {
  fallas: Falla[] = [];
  advertencias: Falla[] = [];
  constructor(readonly fila: Record<string, string>) {}

  /** El valor tal como venía en el archivo, para mostrarlo junto al error. */
  crudo(columna: string) {
    return (this.fila[columna] ?? "").slice(0, 120);
  }
  /** Un error de la fila, con su valor y cómo corregirlo. */
  falla(columna: string | undefined, motivo: string, solucion?: string) {
    this.fallas.push({ columna, motivo, valor: columna ? this.crudo(columna) : undefined, solucion });
  }
  aviso(columna: string | undefined, motivo: string, solucion?: string) {
    this.advertencias.push({ columna, motivo, valor: columna ? this.crudo(columna) : undefined, solucion });
  }
  /** Texto obligatorio: si falta, se anota y se regresa vacío. */
  requerido(columna: string, limite = 200, etiqueta?: string) {
    const v = N.texto(this.fila[columna], limite);
    if (!v) this.falla(columna, `Falta ${etiqueta ?? `«${columna}»`}`, `Escriba ${etiqueta ?? "el dato"} en la columna «${columna}»`);
    return v;
  }
  opcional(columna: string, limite = 500) {
    return N.texto(this.fila[columna], limite) || null;
  }
  /** Veredicto de un normalizador: si falla, se anota en la columna. */
  valor<T>(columna: string, v: N.Veredicto<T>, respaldo: T): T {
    if (v.ok) return v.valor;
    this.falla(columna, v.motivo, v.solucion);
    return respaldo;
  }
  /** Igual, pero si falla solo avisa: el dato era opcional y se omite. */
  valorOpcional<T>(columna: string, v: N.Veredicto<T | null>): T | null {
    if (v.ok) return v.valor;
    this.aviso(columna, `${v.motivo}. Se deja vacío.`, v.solucion);
    return null;
  }
  referencia(columna: string, mapa: Map<string, string> | undefined, que: string, obligatoria: boolean) {
    const v = N.codigo(this.fila[columna]);
    if (!v) {
      if (obligatoria) this.falla(columna, `Falta ${que}`, `Escriba el código de ${que}`);
      return null;
    }
    const id = mapa?.get(v) ?? null;
    if (!id) this.falla(columna, `No existe ${que} «${v}»`, `Use el código tal como está dado de alta en esta empresa, o impórtelo primero`);
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
      { nombre: "centro_de_costo", ejemplo: "5010-PROD", ayuda: "Clave del centro de costo. Sus órdenes la heredan" },
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
        centrosDeCosto: porCodigo(await prisma.centroDeCosto.findMany({ where: { organizationId: orgId, active: true }, select: { id: true, code: true } })),
      };
    },
    convertir: (f, ctx) => {
      const r = new Renglon(f);
      const code = N.codigo(r.requerido("codigo", 40, "el código (TAG)"));
      const nombre = r.requerido("nombre", 160, "el nombre");
      const siteId = r.referencia("sitio", ctx.mapas.sitios, "el sitio", true);
      const locationId = r.referencia("ubicacion", ctx.mapas.ubicaciones, "la ubicación", false);
      if (locationId && siteId && ctx.mapas.sitioDeUbicacion.get(locationId) !== siteId) {
        r.falla("ubicacion", `La ubicación «${N.codigo(f.ubicacion)}» es de otro sitio`, "Use una ubicación del mismo sitio que el activo");
      }
      const categoryId = r.referencia("categoria", ctx.mapas.categorias, "la categoría", false);
      const centroDeCostoId = r.referencia("centro_de_costo", ctx.mapas.centrosDeCosto, "el centro de costo", false);

      const criticidad = (N.texto(f.criticidad, 2) || "B").toUpperCase();
      if (!["A", "B", "C"].includes(criticidad)) r.falla("criticidad", `Criticidad «${f.criticidad}» inválida`, "Use A, B o C");
      const estado = (N.texto(f.estado, 20) || "OPERATIONAL").toUpperCase();
      if (!["OPERATIONAL", "DEGRADED", "DOWN", "STANDBY", "RETIRED"].includes(estado)) {
        r.falla("estado", `Estado «${f.estado}» inválido`, "Use OPERATIONAL, DEGRADED, DOWN, STANDBY o RETIRED");
      }
      if (!locationId) r.aviso("ubicacion", "Sin ubicación: el técnico no sabrá dónde encontrarlo, y la puesta en marcha lo marcará incompleto", "Agregue la columna «ubicacion» con el código del área");

      const serieNum = N.serie(f.numero_serie) || null;
      return r.resultado(code, nombre || code, {
        code, name: nombre, siteId, locationId, categoryId, centroDeCostoId,
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
        if (!unidad) r.falla("unidad", `La unidad «${f.unidad}» no está en el catálogo`, "Use una unidad del catálogo (pza, lt, kg…) o impórtela primero en «Unidades de medida»");
      } else r.falla("unidad", "Falta la unidad", "Escriba la unidad: pza, lt, kg…");

      let familia: string | null = null;
      if (N.texto(f.familia)) {
        familia = ctx.mapas.familias.get(N.codigo(f.familia)) ?? null;
        if (!familia) r.falla("familia", `La familia «${f.familia}» no está en el catálogo`, "Use un código de familia existente o impórtela primero");
      }
      let supplierId: string | null = null;
      if (N.texto(f.proveedor)) {
        supplierId = ctx.mapas.proveedores.get(N.claveComparable(f.proveedor)) ?? null;
        if (!supplierId) r.falla("proveedor", `El proveedor «${f.proveedor}» no existe`, "Escriba el nombre como está dado de alta, o importe primero el proveedor");
      }

      const existencia = r.valor("existencia", N.numero(f.existencia, { minimo: 0, campo: "La existencia" }), 0) ?? 0;
      const minimo = r.valor("minimo", N.numero(f.minimo, { minimo: 0, campo: "El mínimo" }), 0) ?? 0;
      const maximo = r.valor("maximo", N.numero(f.maximo, { minimo: 0, campo: "El máximo" }), 0) ?? 0;
      if (maximo > 0 && minimo > maximo) r.falla("minimo", `El mínimo (${minimo}) es mayor que el máximo (${maximo})`, "El mínimo debe ser menor o igual al máximo");
      if (existencia > 0 && !ctx.mapas.almacen.get("general")) {
        r.falla("existencia", "La cuenta no tiene almacén", "Dé de alta un almacén —o impórtelo— antes de traer existencias");
      }
      const costo = r.valor("costo_unitario", N.numero(f.costo_unitario, { minimo: 0, campo: "El costo" }), 0) ?? 0;
      if (existencia > 0 && costo === 0) {
        r.aviso("costo_unitario", "Existencia sin costo: el inventario valdrá $0 y el consumo no cargará costo a las órdenes", "Capture el costo unitario");
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
      { nombre: "tipo", ejemplo: "PREVENTIVE", ayuda: "PREVENTIVE, INSPECTION o PREDICTIVE. Si se omite, PREVENTIVE" },
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
      if (dias === null && N.texto(f.cada_dias) === "") r.falla("cada_dias", "Falta la frecuencia en días", "Escriba cada cuántos días: 30 para mensual");

      const prioridad = (N.texto(f.prioridad, 10) || "MEDIUM").toUpperCase();
      if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(prioridad)) {
        r.falla("prioridad", `Prioridad «${f.prioridad}» inválida`, "Use LOW, MEDIUM, HIGH o CRITICAL");
      }
      const tipoPlan = (N.texto(f.tipo, 20) || "PREVENTIVE").toUpperCase();
      if (!["PREVENTIVE", "INSPECTION", "PREDICTIVE"].includes(tipoPlan)) {
        r.falla("tipo", `Tipo «${f.tipo}» inválido`, "Use PREVENTIVE, INSPECTION o PREDICTIVE");
      }
      const primer = r.valor("primer_vencimiento", N.fecha(f.primer_vencimiento, "El primer vencimiento"), null);
      const proximo = primer
        ? fechaEnZona(primer, ctx.zona)
        : dias ? new Date(Date.now() + dias * 86_400_000) : null;

      r.aviso(undefined, "El plan se importa sin actividades: agréguelas abriendo el plan, o no generará órdenes", "Abra el plan después de importarlo y agregue sus actividades");
      return r.resultado(`${N.codigo(f.activo)}|${N.claveComparable(nombre)}`, nombre, {
        name: nombre, assetId, intervalDays: dias,
        maintenanceType: tipoPlan, triggerType: "CALENDAR",
        priority: prioridad,
        estimatedHours: r.valor("horas_estimadas", N.numero(f.horas_estimadas, { minimo: 0, campo: "Las horas" }), 1) ?? 1,
        leadTimeDays: r.valor("anticipacion_dias", N.numero(f.anticipacion_dias, { minimo: 0, entero: true, campo: "La anticipación" }), 3) ?? 3,
        description: r.opcional("descripcion", 500),
        requiresShutdown: N.siNo(f.requiere_paro),
        nextDueDate: proximo,
      }, { nombre: N.claveComparable(nombre), firma: assetId && dias ? `${assetId}|${tipoPlan}|${dias}` : undefined });
    },
    existentes: async (orgId) =>
      (await prisma.maintenancePlan.findMany({
        where: { organizationId: orgId },
        select: {
          id: true, name: true, assetId: true, intervalDays: true, maintenanceType: true,
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
          comparar: { nombre: N.claveComparable(p.name), firma: p.intervalDays ? `${assetId}|${p.maintenanceType}|${p.intervalDays}` : undefined },
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
  "centros-de-costo": catalogoSimple({
    titulo: "Centros de costo",
    descripcion:
      "El eje contable: la clave con la que su empresa lleva el gasto. Tráigalos de su ERP tal como están allá —la clave "
      + "es lo que permite conciliar—. Después se le asigna uno a cada equipo, y sus órdenes lo heredan.",
    entidad: "CentroDeCosto",
    ejemplo: ["5010-PROD", "Producción"],
    campoNombre: "name",
    // La clave contable respeta mayúsculas y minúsculas: «5010-Prod» y
    // «5010-PROD» pueden ser la misma en el ERP o no, y no nos toca decidirlo.
    respetaCaso: true,
    delegado: (db) => db.centroDeCosto as never,
  }),

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
        if (!supplierId) r.falla("proveedor", `No existe el proveedor «${f.proveedor}»`, "Escriba el nombre como está dado de alta, o importe primero el proveedor");
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
  // ────────────────────────────────────────── Usuarios y responsables
  usuarios: {
    titulo: "Usuarios y responsables",
    descripcion: "Su equipo de trabajo con su rol, puesto y tarifa. No se importan contraseñas: cada persona elige la suya con una liga de un solo uso que se genera en Usuarios.",
    requisitos: "Al actualizar a alguien que ya existe cambian su nombre, puesto, tarifa y teléfono. El rol y el estado se cambian en Configuración → Usuarios, donde quedan en la bitácora y cierran sus sesiones.",
    erroresComunes: [
      "Incluir una columna de contraseña: se ignora y se avisa, nunca se guarda",
      "Un correo que ya usa otra empresa: cada correo entra a una sola cuenta",
      "Roles escritos a mano: se aceptan técnico, supervisor, administrador, solicitante, compras y consulta",
    ],
    recurso: "users",
    entidad: "User",
    columnas: [
      { nombre: "nombre", requerido: true, ejemplo: "Laura Cisneros" },
      { nombre: "correo", requerido: true, ejemplo: "laura.cisneros@empresa.mx", ayuda: "Con él entra al sistema" },
      { nombre: "rol", requerido: true, ejemplo: "técnico", ayuda: "técnico, supervisor, administrador, solicitante, compras o consulta" },
      { nombre: "puesto", ejemplo: "Técnica electromecánica" },
      { nombre: "tarifa_hora", ejemplo: "180", ayuda: "Costo interno de su hora de trabajo" },
      { nombre: "telefono", ejemplo: "81 1234 5678" },
      { nombre: "estado", ejemplo: "activo", ayuda: "activo o inactivo. Si se omite, activo" },
    ],
    columnasProhibidas: {
      contrasena: "Las contraseñas no se importan",
      "contraseña": "Las contraseñas no se importan",
      password: "Las contraseñas no se importan",
      clave: "Las contraseñas no se importan",
    },
    despues: "Nadie tiene contraseña todavía: genere la liga de acceso de cada persona en Configuración → Usuarios. Vence en una hora y sirve una sola vez.",
    contexto: async () => ({}),
    convertir: (f) => {
      const r = new Renglon(f);
      const nombre = r.requerido("nombre", 120, "el nombre");
      const correo = N.texto(f.correo) ? r.valor("correo", N.correo(f.correo), null) : (r.requerido("correo", 160, "el correo"), null);
      const rolTexto = N.claveComparable(f.rol);
      const ROLES: Record<string, string> = {
        tecnico: "TECHNICIAN", technician: "TECHNICIAN", supervisor: "SUPERVISOR",
        administrador: "ADMIN", admin: "ADMIN", solicitante: "REQUESTER", requester: "REQUESTER",
        consulta: "VIEWER", viewer: "VIEWER", compras: "COMPRAS",
      };
      const rol = ROLES[rolTexto] ?? null;
      if (!rolTexto) r.falla("rol", "Falta el rol", "Escriba técnico, supervisor, administrador, solicitante, compras o consulta");
      else if (["propietario", "owner"].includes(rolTexto)) r.falla("rol", "El propietario no se importa", "Cada empresa tiene un solo propietario; use administrador");
      else if (!rol) r.falla("rol", `Rol «${f.rol}» no reconocido`, "Use técnico, supervisor, administrador, solicitante, compras o consulta");
      const estado = N.claveComparable(f.estado) || "activo";
      if (!["activo", "inactivo"].includes(estado)) r.falla("estado", `Estado «${f.estado}» inválido`, "Use activo o inactivo");
      return r.resultado(correo ?? "", nombre, {
        name: nombre, email: correo, role: rol,
        jobTitle: r.opcional("puesto", 120),
        hourlyRate: r.valor("tarifa_hora", N.numero(f.tarifa_hora, { minimo: 0, campo: "La tarifa" }), 0) ?? 0,
        phone: r.valorOpcional("telefono", N.telefono(f.telefono)),
        active: estado !== "inactivo",
      }, { correo: correo ?? undefined });
    },
    existentes: async (orgId) =>
      (await prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, email: true, name: true } }))
        .map((u) => ({ id: u.id, clave: u.email.toLowerCase(), resumen: u.name, comparar: { correo: u.email.toLowerCase() } })),
    /**
     * Un correo entra a UNA sola empresa. Si ya lo usa otra, se rechaza sin
     * decir cuál: el mensaje no puede servir para averiguar qué correos tienen
     * cuenta en otras empresas.
     */
    revisionGlobal: async (orgId, filas) => {
      const correos = filas.map((f) => String(f.datos.email ?? "")).filter(Boolean);
      const ajenos = new Set((await prisma.user.findMany({
        where: { email: { in: correos }, organizationId: { not: orgId } },
        select: { email: true },
      })).map((u) => u.email.toLowerCase()));
      return new Map(filas.filter((f) => ajenos.has(String(f.datos.email).toLowerCase())).map((f) => [f.fila, {
        columna: "correo", valor: String(f.datos.email), motivo: "Ese correo ya está registrado en el sistema",
        solucion: "Use otro correo: cada correo entra a una sola empresa",
      }]));
    },
    /**
     * Sin contraseña: se guarda el hash de un valor aleatorio que nadie conoce.
     * La persona entra solo cuando usa su liga de restablecimiento.
     */
    insertar: async (db, orgId, d) =>
      db.user.create({
        data: {
          ...(d as { name: string; email: string; role: string }),
          organizationId: orgId,
          passwordHash: await bcrypt.hash(randomBytes(32).toString("base64url"), 10),
        },
        select: { id: true },
      }),
    actualizar: async (db, _o, id, d) => {
      const { name, jobTitle, hourlyRate, phone } = d as Record<string, unknown>;
      const cambios = { name, jobTitle, hourlyRate, phone };
      const antes = await db.user.findUniqueOrThrow({ where: { id } });
      await db.user.update({ where: { id }, data: cambios as never });
      return antesDe(antes as unknown as Record<string, unknown>, cambios);
    },
  },

  // ─────────────────────────────────────────────────────────── Almacenes
  almacenes: {
    titulo: "Almacenes",
    descripcion: "Los almacenes o bodegas de refacciones, con su sitio y su responsable.",
    requisitos: "Si indica sitio o responsable, deben existir: el responsable se busca por su correo.",
    erroresComunes: ["Marcar dos almacenes como general: solo puede haber uno", "Poner el nombre del sitio en lugar de su código"],
    entidad: "Warehouse",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "ALM-01", ayuda: "Corto y único" },
      { nombre: "nombre", requerido: true, ejemplo: "Almacén general" },
      { nombre: "sitio", ejemplo: "P01", ayuda: "Código del sitio" },
      { nombre: "responsable", ejemplo: "almacen@empresa.mx", ayuda: "Correo de un usuario de la empresa" },
      { nombre: "estado", ejemplo: "activo", ayuda: "activo o inactivo" },
      { nombre: "general", ejemplo: "SI", ayuda: "SI si es el almacén general de la cuenta" },
    ],
    contexto: async (orgId) => ({
      sitios: porCodigo(await prisma.site.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } })),
      usuarios: new Map((await prisma.user.findMany({ where: { organizationId: orgId, active: true }, select: { id: true, email: true } }))
        .map((u) => [u.email.toLowerCase(), u.id])),
    }),
    convertir: (f, ctx) => {
      const r = new Renglon(f);
      const code = N.codigo(r.requerido("codigo", 30, "el código"));
      const nombre = r.requerido("nombre", 120, "el nombre");
      const siteId = r.referencia("sitio", ctx.mapas.sitios, "el sitio", false);
      let responsableId: string | null = null;
      if (N.texto(f.responsable)) {
        responsableId = ctx.mapas.usuarios.get(N.texto(f.responsable).toLowerCase()) ?? null;
        if (!responsableId) r.falla("responsable", `No hay un usuario activo con el correo «${f.responsable}»`, "Use el correo de un usuario de la empresa, o impórtelo primero en «Usuarios»");
      }
      const estado = N.claveComparable(f.estado) || "activo";
      if (!["activo", "inactivo"].includes(estado)) r.falla("estado", `Estado «${f.estado}» inválido`, "Use activo o inactivo");
      return r.resultado(code, nombre, {
        code, name: nombre, siteId, responsableId, active: estado !== "inactivo", esGeneral: N.siNo(f.general),
      }, { nombre: N.claveComparable(nombre) });
    },
    existentes: async (orgId) =>
      (await prisma.warehouse.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, name: true } }))
        .map((w) => ({ id: w.id, clave: N.codigo(w.code), resumen: w.name, comparar: { nombre: N.claveComparable(w.name) } })),
    /** Solo puede haber un almacén general: en la base y dentro del archivo. */
    revisionGlobal: async (orgId, filas) => {
      const yaHayGeneral = (await prisma.warehouse.count({ where: { organizationId: orgId, esGeneral: true } })) > 0;
      const salida = new Map<number, Falla>();
      let visto = false;
      for (const f of filas.filter((x) => x.datos.esGeneral)) {
        if (yaHayGeneral || visto) {
          salida.set(f.fila, { columna: "general", valor: "SI", motivo: "Ya hay un almacén general", solucion: "Marque solo uno como general, o deje esta columna vacía" });
        }
        visto = true;
      }
      return salida;
    },
    insertar: (db, orgId, d) => db.warehouse.create({ data: { ...(d as { code: string; name: string }), organizationId: orgId }, select: { id: true } }),
    actualizar: async (db, _o, id, d) => {
      const { code: _c, esGeneral: _g, ...cambios } = d; void _c; void _g;
      const antes = await db.warehouse.findUniqueOrThrow({ where: { id } });
      await db.warehouse.update({ where: { id }, data: cambios });
      return antesDe(antes as unknown as Record<string, unknown>, cambios);
    },
  },

  // ─────────────────────────────────────────────────────────── Medidores
  medidores: {
    titulo: "Medidores",
    descripcion: "Horómetros, odómetros y contadores de cada equipo, con su lectura inicial.",
    requisitos: "Los activos deben existir.",
    erroresComunes: ["Una lectura inicial negativa", "Una fecha de lectura en el futuro", "Dos medidores del mismo tipo en el mismo equipo: se marca como posible duplicado"],
    entidad: "Meter",
    columnas: [
      { nombre: "activo", requerido: true, ejemplo: "CMP-301", ayuda: "Código (TAG) del activo" },
      { nombre: "nombre", requerido: true, ejemplo: "Horómetro principal" },
      { nombre: "unidad", requerido: true, ejemplo: "h", ayuda: "h, km, ciclos…" },
      { nombre: "tipo", ejemplo: "HOROMETRO", ayuda: "HOROMETRO, ODOMETRO, CICLOS u OTRO. Si se omite, sale de la unidad" },
      { nombre: "lectura_inicial", ejemplo: "12500", ayuda: "Lo que marca hoy" },
      { nombre: "fecha_lectura", ejemplo: "15/09/2026", ayuda: "dd/mm/aaaa. Si se omite, hoy" },
      { nombre: "max_por_dia", ejemplo: "24", ayuda: "Lo más que puede avanzar en un día" },
    ],
    contexto: async (orgId) => ({
      activos: porCodigo(await prisma.asset.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } })),
    }),
    convertir: (f, ctx) => {
      const r = new Renglon(f);
      const assetId = r.referencia("activo", ctx.mapas.activos, "el activo", true);
      const nombre = r.requerido("nombre", 80, "el nombre del medidor");
      const unidad = r.requerido("unidad", 20, "la unidad");
      const tipoTexto = N.texto(f.tipo, 20).toUpperCase().replace("Ó", "O");
      const tipo = tipoTexto || tipoPorUnidad(unidad);
      if (!["HOROMETRO", "ODOMETRO", "CICLOS", "OTRO"].includes(tipo)) r.falla("tipo", `Tipo «${f.tipo}» inválido`, "Use HOROMETRO, ODOMETRO, CICLOS u OTRO");
      const lectura = r.valor("lectura_inicial", N.numero(f.lectura_inicial, { minimo: 0, campo: "La lectura inicial" }), null);
      const dia = r.valor("fecha_lectura", N.fecha(f.fecha_lectura, "La fecha de la lectura"), null);
      const fecha = fechaEnZona(dia, ctx.zona);
      if (fecha && fecha.getTime() > Date.now()) r.falla("fecha_lectura", "La fecha de la lectura está en el futuro", "Use la fecha en que se tomó la lectura, hoy o antes");
      const max = r.valor("max_por_dia", N.numero(f.max_por_dia, { minimo: 0, campo: "El máximo por día" }), null);
      if (tipo === "HOROMETRO" && max !== null && max > 24) r.falla("max_por_dia", "Un horómetro no puede avanzar más de 24 horas en un día", "Escriba 24 o menos");
      return r.resultado(`${N.codigo(f.activo)}|${N.claveComparable(nombre)}`, `${N.codigo(f.activo)} · ${nombre}`, {
        assetId, name: nombre, unit: unidad, tipo,
        currentValue: lectura ?? 0, valorInicial: lectura ?? 0, valorInicialEl: fecha ?? new Date(),
        maxIncrementoDiario: max && max > 0 ? max : null,
      }, { firma: assetId ? `${assetId}|${tipo}` : undefined, nombre: N.claveComparable(nombre), ambito: assetId ?? "" });
    },
    existentes: async (orgId) =>
      (await prisma.meter.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, tipo: true, assetId: true, asset: { select: { code: true } } } }))
        .map((m) => ({
          id: m.id, clave: `${N.codigo(m.asset.code)}|${N.claveComparable(m.name)}`, resumen: `${m.asset.code} · ${m.name}`,
          comparar: { firma: `${m.assetId}|${m.tipo}`, nombre: N.claveComparable(m.name), ambito: m.assetId },
        })),
    // Igual que el alta a mano (app/api/meters): el valor de alta queda como
    // valor inicial FORMAL, que es lo único que vale si algún día se anulan
    // todas las lecturas.
    insertar: (db, orgId, d) => db.meter.create({ data: { ...(d as { assetId: string; name: string }), organizationId: orgId }, select: { id: true } }),
  },

  // ──────────────────────────────────────── Lecturas iniciales de medidor
  lecturas: {
    titulo: "Lecturas de medidores",
    descripcion: "Lecturas de los medidores que ya existen. Pasan por las mismas reglas que una lectura capturada a mano: no negativas, no hacia atrás, no en el futuro, y un horómetro no avanza más horas de las que pasaron.",
    requisitos: "Los medidores deben existir: se buscan por el código del activo y el nombre del medidor.",
    erroresComunes: ["Una lectura menor que la anterior: si el medidor se reinició, regístrelo como reinicio desde la pantalla del medidor", "Fechas en el futuro"],
    entidad: "MeterReading",
    columnas: [
      { nombre: "activo", requerido: true, ejemplo: "CMP-301", ayuda: "Código (TAG) del activo" },
      { nombre: "medidor", requerido: true, ejemplo: "Horómetro principal", ayuda: "Nombre del medidor" },
      { nombre: "valor", requerido: true, ejemplo: "12640" },
      { nombre: "fecha", requerido: true, ejemplo: "16/09/2026", ayuda: "dd/mm/aaaa" },
      { nombre: "nota", ejemplo: "Lectura de arranque" },
    ],
    contexto: async (orgId) => ({
      medidores: new Map((await prisma.meter.findMany({
        where: { organizationId: orgId }, select: { id: true, name: true, asset: { select: { code: true } } },
      })).map((m) => [`${N.codigo(m.asset.code)}|${N.claveComparable(m.name)}`, m.id])),
    }),
    convertir: (f, ctx) => {
      const r = new Renglon(f);
      const clave = `${N.codigo(f.activo)}|${N.claveComparable(f.medidor)}`;
      const meterId = ctx.mapas.medidores.get(clave) ?? null;
      if (!N.texto(f.activo) || !N.texto(f.medidor)) r.falla(N.texto(f.activo) ? "medidor" : "activo", "Falta el activo o el medidor", "Escriba el código del activo y el nombre del medidor");
      else if (!meterId) r.falla("medidor", `El activo «${N.codigo(f.activo)}» no tiene un medidor llamado «${f.medidor}»`, "Use el nombre como está dado de alta, o importe primero el medidor");
      const valor = N.texto(f.valor) ? r.valor("valor", N.numero(f.valor, { minimo: 0, campo: "La lectura" }), null) : (r.requerido("valor", 40, "el valor"), null);
      const dia = N.texto(f.fecha) ? r.valor("fecha", N.fecha(f.fecha), null) : (r.requerido("fecha", 20, "la fecha"), null);
      const fecha = fechaEnZona(dia, ctx.zona);
      return r.resultado(`${meterId ?? clave}|${fecha?.toISOString() ?? ""}`, `${N.codigo(f.activo)} · ${f.medidor}: ${valor ?? "—"}`, {
        meterId, value: valor, readingAt: fecha, note: r.opcional("nota", 200),
      }, {});
    },
    existentes: async (orgId) =>
      (await prisma.meterReading.findMany({
        where: { organizationId: orgId, estado: { not: "ANULADA" } },
        select: { id: true, meterId: true, readingAt: true, value: true },
      })).map((l) => ({ id: l.id, clave: `${l.meterId}|${l.readingAt.toISOString()}`, resumen: `lectura de ${l.value}`, comparar: {} })),
    /**
     * La misma validación que una lectura a mano (`validarLectura`), pero ANTES
     * de guardar: contra lo que ya hay en la base y contra las lecturas previas
     * del mismo archivo, en orden de fecha. Así la vista previa dice lo que el
     * registro rechazaría.
     */
    revisionGlobal: async (orgId, filas) => {
      const ids = [...new Set(filas.map((f) => f.datos.meterId as string).filter(Boolean))];
      const [medidores, lecturas] = await Promise.all([
        prisma.meter.findMany({ where: { id: { in: ids }, organizationId: orgId } }),
        prisma.meterReading.findMany({
          where: { meterId: { in: ids }, estado: { not: "ANULADA" } },
          select: { meterId: true, value: true, readingAt: true, tipo: true },
        }),
      ]);
      const salida = new Map<number, Falla>();
      for (const m of medidores) {
        const puntos = lecturas.filter((l) => l.meterId === m.id).map((l) => ({ value: l.value, readingAt: l.readingAt, tipo: l.tipo }));
        const propias = filas.filter((f) => f.datos.meterId === m.id && f.datos.readingAt)
          .sort((a, b) => (a.datos.readingAt as Date).getTime() - (b.datos.readingAt as Date).getTime());
        for (const f of propias) {
          const cuando = f.datos.readingAt as Date;
          const antes = puntos.filter((p) => p.readingAt.getTime() <= cuando.getTime()).sort((a, b) => b.readingAt.getTime() - a.readingAt.getTime())[0] ?? null;
          const despues = puntos.filter((p) => p.readingAt.getTime() > cuando.getTime()).sort((a, b) => a.readingAt.getTime() - b.readingAt.getTime())[0] ?? null;
          const v = validarLectura({
            medidor: m, anterior: antes ?? referenciaInicial(m), siguiente: despues,
            nueva: { value: f.datos.value as number, readingAt: cuando, tipo: "LECTURA" },
          });
          if (v.nivel === "ERROR") {
            salida.set(f.fila, { columna: "valor", valor: String(f.datos.value), motivo: v.mensaje, solucion: "Revise el valor y la fecha contra la lectura anterior del medidor" });
          } else {
            puntos.push({ value: f.datos.value as number, readingAt: cuando, tipo: "LECTURA" });
          }
        }
      }
      return salida;
    },
    /** Por `registrarLectura`, la misma función que la pantalla del medidor, dentro de la transacción. */
    insertar: async (db, orgId, d, extra) => {
      const r = await registrarLectura({
        organizationId: orgId, meterId: d.meterId as string, userId: extra.userId,
        value: d.value as number, readingAt: d.readingAt as Date, note: (d.note as string | null) ?? null,
        source: "IMPORTACION", confirmar: true, justificacion: "Lectura importada al poner en marcha el sistema",
        db,
      });
      if (!r.ok) throw new Error("La lectura requiere confirmación y no se pudo registrar");
      return { id: r.lecturaId };
    },
  },

  // ─────────────────────────────────────── Existencias iniciales por almacén
  existencias: {
    titulo: "Existencias iniciales",
    descripcion: "Cuánto hay de cada refacción en cada almacén. Cada renglón entra como un movimiento de entrada en el kardex, con su costo: la existencia nunca aparece sin origen.",
    requisitos: "Las refacciones y los almacenes deben existir. Si una refacción ya tiene existencia en ese almacén, puede omitirse o ajustarse a la cantidad del archivo (queda como ajuste en el kardex).",
    erroresComunes: ["Una unidad distinta a la de la refacción: se rechaza en lugar de convertir", "La misma refacción y almacén en dos renglones", "Existencia sin costo: el inventario valdrá $0"],
    entidad: "StockMovement",
    columnas: [
      { nombre: "refaccion", requerido: true, ejemplo: "ROD-6205", ayuda: "Código de la refacción" },
      { nombre: "almacen", requerido: true, ejemplo: "ALM-01", ayuda: "Código del almacén" },
      { nombre: "cantidad", requerido: true, ejemplo: "12" },
      { nombre: "costo_unitario", ejemplo: "320", ayuda: "Si se omite, el costo actual de la refacción" },
      { nombre: "unidad", ejemplo: "pza", ayuda: "Opcional: si viene, debe coincidir con la de la refacción" },
    ],
    contexto: async (orgId) => {
      const [partes, almacenes] = await Promise.all([
        prisma.part.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, unit: true, unitCost: true } }),
        prisma.warehouse.findMany({ where: { organizationId: orgId, active: true }, select: { id: true, code: true } }),
      ]);
      return {
        partes: porCodigo(partes),
        unidadDe: new Map(partes.map((p) => [p.id, p.unit])),
        costoDe: new Map(partes.map((p) => [p.id, String(p.unitCost)])),
        almacenes: porCodigo(almacenes),
      };
    },
    convertir: (f, ctx) => {
      const r = new Renglon(f);
      const partId = r.referencia("refaccion", ctx.mapas.partes, "la refacción", true);
      const warehouseId = r.referencia("almacen", ctx.mapas.almacenes, "el almacén activo", true);
      const cantidad = N.texto(f.cantidad) ? r.valor("cantidad", N.numero(f.cantidad, { minimo: 0, campo: "La cantidad" }), null) : (r.requerido("cantidad", 30, "la cantidad"), null);
      if (cantidad === 0) r.falla("cantidad", "La cantidad es cero", "Escriba una cantidad mayor que cero, u omita el renglón");
      const costoArchivo = r.valor("costo_unitario", N.numero(f.costo_unitario, { minimo: 0, campo: "El costo" }), null);
      const costo = costoArchivo ?? (partId ? Number(ctx.mapas.costoDe.get(partId) ?? 0) : 0);
      if (partId && N.texto(f.unidad) && N.unidad(f.unidad) !== N.unidad(ctx.mapas.unidadDe.get(partId))) {
        r.falla("unidad", `La refacción se maneja en «${ctx.mapas.unidadDe.get(partId)}», no en «${f.unidad}»`, "Convierta la cantidad a la unidad de la refacción, o deje la columna vacía");
      }
      if (costo === 0 && cantidad) r.aviso("costo_unitario", "Existencia sin costo: el inventario valdrá $0", "Capture el costo unitario");
      return r.resultado(`${N.codigo(f.refaccion)}|${N.codigo(f.almacen)}`, `${N.codigo(f.refaccion)} en ${N.codigo(f.almacen)}: ${cantidad ?? "—"}`, {
        partId, warehouseId, cantidad, costoUnitario: costo,
      }, {});
    },
    existentes: async (orgId) =>
      (await prisma.partStock.findMany({
        where: { organizationId: orgId, quantity: { not: 0 } },
        select: { id: true, quantity: true, part: { select: { code: true } }, warehouse: { select: { code: true } } },
      })).map((e) => ({
        id: e.id, clave: `${N.codigo(e.part.code)}|${N.codigo(e.warehouse.code)}`,
        resumen: `ya tiene ${e.quantity} en ese almacén`, comparar: {},
      })),
    /** Por `aplicarMovimiento`, el único lugar por donde se mueve la existencia. */
    insertar: async (db, orgId, d, extra) => {
      await aplicarMovimiento({
        organizationId: orgId, partId: d.partId as string, warehouseId: d.warehouseId as string,
        tipo: "IN", cantidad: d.cantidad as number, costoUnitario: d.costoUnitario as number,
        referencia: REFERENCIA_EXISTENCIA_INICIAL, userId: extra.userId,
      }, db);
      const mov = await db.stockMovement.findFirstOrThrow({
        where: { organizationId: orgId, partId: d.partId as string, warehouseId: d.warehouseId as string, reference: REFERENCIA_EXISTENCIA_INICIAL },
        orderBy: { createdAt: "desc" }, select: { id: true },
      });
      return mov;
    },
    /** Actualizar = ajustar a la cantidad del archivo. Queda como AJUSTE en el kardex. */
    actualizar: async (db, orgId, id, d) => {
      const antes = await db.partStock.findUniqueOrThrow({ where: { id } });
      await aplicarMovimiento({
        organizationId: orgId, partId: antes.partId, warehouseId: antes.warehouseId,
        tipo: "ADJUST", cantidad: d.cantidad as number, costoUnitario: d.costoUnitario as number,
        referencia: "Ajuste por importación de existencias",
      }, db);
      return { cantidad: antes.quantity };
    },
  },
};

export const ORDEN_IMPORTACION: ClaveImportacion[] = [
  "sitios", "ubicaciones", "usuarios", "almacenes",
  "categorias-activo", "centros-de-costo", "activos", "medidores", "lecturas",
  "proveedores", "familias-refaccion", "unidades", "refacciones", "existencias",
  "especialidades", "servicios-externos",
  "planes", "codigos-falla", "causas-raiz",
];


export function esImportacionValida(k: string): k is ClaveImportacion {
  return k in IMPORTACIONES;
}
