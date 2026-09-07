import { prisma } from "./db";
import { almacenPorOmision, aplicarMovimiento } from "./almacen";
import type { Recurso } from "./planes";

/**
 * Importacion desde CSV.
 *
 * Cada tipo declara sus columnas y como convertir un renglon de texto en un
 * registro. Las referencias se resuelven por CODIGO, no por identificador
 * interno: quien exporta desde Excel conoce "BOM-101", no un cuid.
 *
 * El orden de la lista es el orden en que conviene importar: un activo
 * necesita su sitio, una refaccion su unidad, un plan su activo.
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

export type ResultadoFila =
  | { ok: true; datos: Record<string, unknown>; clave: string }
  | { ok: false; motivo: string };

export type DefinicionImportacion = {
  titulo: string;
  descripcion: string;
  /** Que debe existir antes de importar esto. */
  requisitos?: string;
  columnas: Columna[];
  /** Recurso del plan que consume, si aplica. */
  recurso?: Recurso;
  /** Datos que se cargan una vez y sirven para resolver referencias. */
  contexto: (orgId: string) => Promise<Record<string, Map<string, string>>>;
  /** Convierte un renglon en datos listos para insertar, o explica por que no. */
  convertir: (
    fila: Record<string, string>,
    ctx: Record<string, Map<string, string>>,
    orgId: string,
  ) => ResultadoFila;
  insertar: (orgId: string, datos: Record<string, unknown>) => Promise<unknown>;
  /** Claves ya existentes, para omitir duplicados en vez de fallar. */
  existentes: (orgId: string) => Promise<Set<string>>;
};

const txt = (v?: string) => (v ?? "").trim();
const num = (v?: string) => {
  const limpio = txt(v).replace(/[$,\s]/g, "").replace(/,/g, "");
  if (limpio === "") return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
};
const fecha = (v?: string) => {
  const s = txt(v);
  if (!s) return null;
  // Se admite dd/mm/aaaa ademas de ISO: es lo que produce Excel en español.
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const d = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

async function mapaPorCodigo(
  filas: Array<{ id: string; code: string }>,
): Promise<Map<string, string>> {
  return new Map(filas.map((f) => [f.code.toUpperCase(), f.id]));
}

export const IMPORTACIONES: Record<ClaveImportacion, DefinicionImportacion> = {
  // ─────────────────────────────────────────────────────────── Sitios
  sitios: {
    titulo: "Sitios",
    descripcion: "Plantas o centros de trabajo. Importelos primero: los activos y las ubicaciones dependen de ellos.",
    recurso: "sites",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "P01", ayuda: "Corto y unico" },
      { nombre: "nombre", requerido: true, ejemplo: "Planta Apodaca" },
      { nombre: "ciudad", ejemplo: "Apodaca" },
      { nombre: "direccion", ejemplo: "Parque Industrial Milenium" },
    ],
    contexto: async () => ({}),
    convertir: (f) => {
      const code = txt(f.codigo).toUpperCase();
      if (!code) return { ok: false, motivo: "Falta el código" };
      if (!txt(f.nombre)) return { ok: false, motivo: "Falta el nombre" };
      return {
        ok: true, clave: code,
        datos: { code, name: txt(f.nombre), city: txt(f.ciudad) || null, address: txt(f.direccion) || null },
      };
    },
    insertar: (orgId, d) => prisma.site.create({ data: { ...d, organizationId: orgId } as never }),
    existentes: async (orgId) =>
      new Set((await prisma.site.findMany({ where: { organizationId: orgId }, select: { code: true } })).map((x) => x.code.toUpperCase())),
  },

  // ────────────────────────────────────────────────────── Ubicaciones
  ubicaciones: {
    titulo: "Ubicaciones",
    descripcion: "Áreas, lineas o cuartos dentro de un sitio.",
    requisitos: "Los sitios deben existir.",
    columnas: [
      { nombre: "sitio", requerido: true, ejemplo: "P01", ayuda: "Código del sitio" },
      { nombre: "codigo", requerido: true, ejemplo: "LIN-A" },
      { nombre: "nombre", requerido: true, ejemplo: "Línea de produccion A" },
      { nombre: "descripcion", ejemplo: "Nave norte" },
    ],
    contexto: async (orgId) => ({
      sitios: await mapaPorCodigo(await prisma.site.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } })),
    }),
    convertir: (f, ctx) => {
      const code = txt(f.codigo).toUpperCase();
      if (!code) return { ok: false, motivo: "Falta el código" };
      if (!txt(f.nombre)) return { ok: false, motivo: "Falta el nombre" };
      const siteId = ctx.sitios.get(txt(f.sitio).toUpperCase());
      if (!siteId) return { ok: false, motivo: `El sitio "${txt(f.sitio)}" no existe` };
      return {
        ok: true, clave: `${txt(f.sitio).toUpperCase()}|${code}`,
        datos: { code, name: txt(f.nombre), description: txt(f.descripcion) || null, siteId },
      };
    },
    insertar: (orgId, d) => prisma.location.create({ data: { ...d, organizationId: orgId } as never }),
    existentes: async (orgId) => {
      const filas = await prisma.location.findMany({
        where: { organizationId: orgId },
        select: { code: true, site: { select: { code: true } } },
      });
      return new Set(filas.map((x) => `${x.site.code.toUpperCase()}|${x.code.toUpperCase()}`));
    },
  },

  // ────────────────────────────────────────── Categorias de activo
  "categorias-activo": {
    titulo: "Categorías de activo",
    descripcion: "Familias de equipo para agrupar y filtrar.",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "BOMB" },
      { nombre: "nombre", requerido: true, ejemplo: "Bombas centrifugas" },
    ],
    contexto: async () => ({}),
    convertir: (f) => {
      const code = txt(f.codigo).toUpperCase();
      if (!code || !txt(f.nombre)) return { ok: false, motivo: "Faltan código o nombre" };
      return { ok: true, clave: code, datos: { code, name: txt(f.nombre) } };
    },
    insertar: (orgId, d) => prisma.assetCategory.create({ data: { ...d, organizationId: orgId } as never }),
    existentes: async (orgId) =>
      new Set((await prisma.assetCategory.findMany({ where: { organizationId: orgId }, select: { code: true } })).map((x) => x.code.toUpperCase())),
  },

  // ────────────────────────────────────────────────────────── Activos
  activos: {
    titulo: "Activos",
    descripcion: "El catálogo de equipos. Es la importación mas importante y la que mas tiempo ahorra.",
    requisitos: "Los sitios deben existir. Ubicaciones y categorías son opcionales, pero si se indican deben existir.",
    recurso: "assets",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "BOM-101", ayuda: "TAG del equipo, no se puede repetir" },
      { nombre: "nombre", requerido: true, ejemplo: "Bomba centrifuga de alimentacion" },
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
      { nombre: "fin_garantia", ejemplo: "29/04/2026" },
    ],
    contexto: async (orgId) => ({
      sitios: await mapaPorCodigo(await prisma.site.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } })),
      ubicaciones: await mapaPorCodigo(await prisma.location.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } })),
      categorias: await mapaPorCodigo(await prisma.assetCategory.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } })),
    }),
    convertir: (f, ctx) => {
      const code = txt(f.codigo).toUpperCase();
      if (!code) return { ok: false, motivo: "Falta el codigo (TAG)" };
      if (!txt(f.nombre)) return { ok: false, motivo: "Falta el nombre" };

      const siteId = ctx.sitios.get(txt(f.sitio).toUpperCase());
      if (!siteId) return { ok: false, motivo: `El sitio "${txt(f.sitio)}" no existe` };

      let locationId: string | null = null;
      if (txt(f.ubicacion)) {
        locationId = ctx.ubicaciones.get(txt(f.ubicacion).toUpperCase()) ?? null;
        if (!locationId) return { ok: false, motivo: `La ubicacion "${txt(f.ubicacion)}" no existe` };
      }
      let categoryId: string | null = null;
      if (txt(f.categoria)) {
        categoryId = ctx.categorias.get(txt(f.categoria).toUpperCase()) ?? null;
        if (!categoryId) return { ok: false, motivo: `La categoria "${txt(f.categoria)}" no existe` };
      }

      const criticidad = (txt(f.criticidad) || "B").toUpperCase();
      if (!["A", "B", "C"].includes(criticidad)) {
        return { ok: false, motivo: `Criticidad "${txt(f.criticidad)}" invalida: use A, B o C` };
      }
      const estado = (txt(f.estado) || "OPERATIONAL").toUpperCase();
      if (!["OPERATIONAL", "DEGRADED", "DOWN", "STANDBY", "RETIRED"].includes(estado)) {
        return { ok: false, motivo: `Estado "${txt(f.estado)}" invalido` };
      }

      return {
        ok: true, clave: code,
        datos: {
          code, name: txt(f.nombre), siteId, locationId, categoryId,
          criticality: criticidad, status: estado,
          manufacturer: txt(f.fabricante) || null,
          model: txt(f.modelo) || null,
          serialNumber: txt(f.numero_serie) || null,
          description: txt(f.descripcion) || null,
          purchaseDate: fecha(f.fecha_compra),
          purchaseCost: num(f.costo_adquisicion) ?? 0,
          replacementCost: num(f.costo_reposicion) ?? 0,
          warrantyExpiry: fecha(f.fin_garantia),
        },
      };
    },
    insertar: (orgId, d) => prisma.asset.create({ data: { ...d, organizationId: orgId } as never }),
    existentes: async (orgId) =>
      new Set((await prisma.asset.findMany({ where: { organizationId: orgId }, select: { code: true } })).map((x) => x.code.toUpperCase())),
  },

  // ──────────────────────────────────────────────────────── Proveedores
  proveedores: {
    titulo: "Proveedores",
    descripcion: "Quien surte las refacciones.",
    columnas: [
      { nombre: "nombre", requerido: true, ejemplo: "Refacciones Industriales del Norte" },
      { nombre: "contacto", ejemplo: "Ing. Patricia Luna" },
      { nombre: "correo", ejemplo: "ventas@refaccionesnorte.mx" },
      { nombre: "telefono", ejemplo: "81 8100 2200" },
      { nombre: "dias_entrega", ejemplo: "5" },
    ],
    contexto: async () => ({}),
    convertir: (f) => {
      const nombre = txt(f.nombre);
      if (!nombre) return { ok: false, motivo: "Falta el nombre" };
      const correo = txt(f.correo);
      if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
        return { ok: false, motivo: `Correo "${correo}" invalido` };
      }
      return {
        ok: true, clave: nombre.toUpperCase(),
        datos: {
          name: nombre, contactName: txt(f.contacto) || null,
          email: correo || null, phone: txt(f.telefono) || null,
          leadTimeDays: num(f.dias_entrega) ?? 7,
        },
      };
    },
    insertar: (orgId, d) => prisma.supplier.create({ data: { ...d, organizationId: orgId } as never }),
    existentes: async (orgId) =>
      new Set((await prisma.supplier.findMany({ where: { organizationId: orgId }, select: { name: true } })).map((x) => x.name.toUpperCase())),
  },

  // ──────────────────────────────────── Familias de refaccion
  "familias-refaccion": {
    titulo: "Familias de refacción",
    descripcion: "Clasificación de las refacciones del almacén.",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "RODAMIENTOS" },
      { nombre: "nombre", requerido: true, ejemplo: "Rodamientos y baleros" },
    ],
    contexto: async () => ({}),
    convertir: (f) => {
      const code = txt(f.codigo).toUpperCase();
      if (!code || !txt(f.nombre)) return { ok: false, motivo: "Faltan código o nombre" };
      return { ok: true, clave: code, datos: { code, name: txt(f.nombre) } };
    },
    insertar: (orgId, d) => prisma.partCategory.create({ data: { ...d, organizationId: orgId } as never }),
    existentes: async (orgId) =>
      new Set((await prisma.partCategory.findMany({ where: { organizationId: orgId }, select: { code: true } })).map((x) => x.code.toUpperCase())),
  },

  // ──────────────────────────────────────────── Unidades de medida
  unidades: {
    titulo: "Unidades de medida",
    descripcion: "Como se cuenta cada refacción.",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "pza" },
      { nombre: "nombre", requerido: true, ejemplo: "Pieza" },
    ],
    contexto: async () => ({}),
    convertir: (f) => {
      const code = txt(f.codigo);
      if (!code || !txt(f.nombre)) return { ok: false, motivo: "Faltan código o nombre" };
      return { ok: true, clave: code.toUpperCase(), datos: { code, name: txt(f.nombre) } };
    },
    insertar: (orgId, d) => prisma.partUnit.create({ data: { ...d, organizationId: orgId } as never }),
    existentes: async (orgId) =>
      new Set((await prisma.partUnit.findMany({ where: { organizationId: orgId }, select: { code: true } })).map((x) => x.code.toUpperCase())),
  },

  // ────────────────────────────────────────────────────── Refacciones
  refacciones: {
    titulo: "Refacciones",
    descripcion: "El catálogo del almacén con sus existencias iniciales.",
    requisitos: "Las familias y unidades deben existir. El proveedor es opcional.",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "ROD-6205" },
      { nombre: "nombre", requerido: true, ejemplo: "Rodamiento 6205-2RS" },
      { nombre: "unidad", requerido: true, ejemplo: "pza", ayuda: "Código de la unidad" },
      { nombre: "familia", ejemplo: "RODAMIENTOS", ayuda: "Código de la familia" },
      { nombre: "proveedor", ejemplo: "Refacciones Industriales del Norte", ayuda: "Nombre exacto" },
      { nombre: "descripcion", ejemplo: "Rodamiento rigido de bolas" },
      { nombre: "costo_unitario", ejemplo: "320" },
      { nombre: "existencia", ejemplo: "12", ayuda: "Cantidad inicial en almacén" },
      { nombre: "minimo", ejemplo: "4" },
      { nombre: "maximo", ejemplo: "20" },
      { nombre: "ubicacion_almacen", ejemplo: "A-03-2" },
    ],
    contexto: async (orgId) => ({
      familias: await mapaPorCodigo(await prisma.partCategory.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } })),
      unidades: await mapaPorCodigo(await prisma.partUnit.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } })),
      proveedores: new Map(
        (await prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }))
          .map((s) => [s.name.toUpperCase(), s.id]),
      ),
      // Se guarda el codigo tal cual esta en el catalogo, respetando mayusculas.
      unidadesTexto: new Map(
        (await prisma.partUnit.findMany({ where: { organizationId: orgId }, select: { code: true } }))
          .map((u) => [u.code.toUpperCase(), u.code]),
      ),
      familiasTexto: new Map(
        (await prisma.partCategory.findMany({ where: { organizationId: orgId }, select: { code: true } }))
          .map((c) => [c.code.toUpperCase(), c.code]),
      ),
    }),
    convertir: (f, ctx) => {
      const code = txt(f.codigo).toUpperCase();
      if (!code) return { ok: false, motivo: "Falta el código" };
      if (!txt(f.nombre)) return { ok: false, motivo: "Falta el nombre" };

      const unidad = ctx.unidadesTexto.get(txt(f.unidad).toUpperCase());
      if (!unidad) return { ok: false, motivo: `La unidad "${txt(f.unidad)}" no esta en el catalogo` };

      let familia: string | null = null;
      if (txt(f.familia)) {
        familia = ctx.familiasTexto.get(txt(f.familia).toUpperCase()) ?? null;
        if (!familia) return { ok: false, motivo: `La familia "${txt(f.familia)}" no esta en el catalogo` };
      }
      let supplierId: string | null = null;
      if (txt(f.proveedor)) {
        supplierId = ctx.proveedores.get(txt(f.proveedor).toUpperCase()) ?? null;
        if (!supplierId) return { ok: false, motivo: `El proveedor "${txt(f.proveedor)}" no existe` };
      }

      return {
        ok: true, clave: code,
        datos: {
          code, name: txt(f.nombre), unit: unidad, category: familia, supplierId,
          description: txt(f.descripcion) || null,
          unitCost: num(f.costo_unitario) ?? 0,
          quantityOnHand: num(f.existencia) ?? 0,
          minQuantity: num(f.minimo) ?? 0,
          maxQuantity: num(f.maximo) ?? 0,
          bin: txt(f.ubicacion_almacen) || null,
        },
      };
    },
    insertar: async (orgId, d) => {
      const datos = d as { quantityOnHand: number; unitCost: number };
      const part = await prisma.part.create({
        data: { ...d, quantityOnHand: 0, organizationId: orgId } as never,
      });
      // La existencia inicial entra como movimiento, para que el kardex cuadre
      // desde el primer dia en vez de aparecer una cantidad sin origen, y para
      // que quede asentada en un almacen concreto.
      if (datos.quantityOnHand > 0) {
        const almacen = await almacenPorOmision(orgId);
        if (!almacen) throw new Error("La cuenta no tiene ningún almacén activo");
        await aplicarMovimiento({
          organizationId: orgId,
          partId: (part as { id: string }).id,
          warehouseId: almacen.id,
          tipo: "IN",
          cantidad: datos.quantityOnHand,
          costoUnitario: datos.unitCost,
          referencia: "Importación inicial",
        });
      }
      return part;
    },
    existentes: async (orgId) =>
      new Set((await prisma.part.findMany({ where: { organizationId: orgId }, select: { code: true } })).map((x) => x.code.toUpperCase())),
  },

  // ──────────────────────────────────────────────────────────── Planes
  planes: {
    titulo: "Planes de mantenimiento",
    descripcion: "Los planes preventivos por calendario. El programador empieza a generar órdenes en cuanto se importan.",
    requisitos: "Los activos deben existir.",
    columnas: [
      { nombre: "nombre", requerido: true, ejemplo: "Lubricacion mensual de bomba" },
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
      activos: await mapaPorCodigo(await prisma.asset.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } })),
    }),
    convertir: (f, ctx) => {
      const nombre = txt(f.nombre);
      if (!nombre) return { ok: false, motivo: "Falta el nombre del plan" };
      const assetId = ctx.activos.get(txt(f.activo).toUpperCase());
      if (!assetId) return { ok: false, motivo: `El activo "${txt(f.activo)}" no existe` };

      const dias = num(f.cada_dias);
      if (!dias || dias < 1) return { ok: false, motivo: "La frecuencia en días debe ser un número mayor que cero" };

      const prioridad = (txt(f.prioridad) || "MEDIUM").toUpperCase();
      if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(prioridad)) {
        return { ok: false, motivo: `Prioridad "${txt(f.prioridad)}" invalida` };
      }

      const paro = txt(f.requiere_paro).toUpperCase();
      const proximo = fecha(f.primer_vencimiento) ?? new Date(Date.now() + dias * 86_400_000);

      return {
        ok: true, clave: `${txt(f.activo).toUpperCase()}|${nombre.toUpperCase()}`,
        datos: {
          name: nombre, assetId, intervalDays: dias,
          maintenanceType: "PREVENTIVE", triggerType: "CALENDAR",
          priority: prioridad,
          estimatedHours: num(f.horas_estimadas) ?? 1,
          leadTimeDays: num(f.anticipacion_dias) ?? 3,
          description: txt(f.descripcion) || null,
          requiresShutdown: ["SI", "SÍ", "YES", "TRUE", "1"].includes(paro),
          nextDueDate: proximo,
        },
      };
    },
    insertar: (orgId, d) => prisma.maintenancePlan.create({ data: { ...d, organizationId: orgId } as never }),
    existentes: async (orgId) => {
      const filas = await prisma.maintenancePlan.findMany({
        where: { organizationId: orgId },
        select: { name: true, asset: { select: { code: true } } },
      });
      return new Set(filas.map((p) => `${(p.asset?.code ?? "").toUpperCase()}|${p.name.toUpperCase()}`));
    },
  },

  // ────────────────────────────────────────────── Codigos de falla
  "codigos-falla": {
    titulo: "Códigos de falla",
    descripcion: "Que fallo. Se usa al cerrar una orden correctiva.",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "MEC-01" },
      { nombre: "descripcion", requerido: true, ejemplo: "Desgaste de rodamiento" },
      { nombre: "familia", ejemplo: "MECANICO" },
    ],
    contexto: async () => ({}),
    convertir: (f) => {
      const code = txt(f.codigo).toUpperCase();
      if (!code || !txt(f.descripcion)) return { ok: false, motivo: "Faltan código o descripción" };
      return { ok: true, clave: code, datos: { code, description: txt(f.descripcion), category: txt(f.familia) || null } };
    },
    insertar: (orgId, d) => prisma.failureCode.create({ data: { ...d, organizationId: orgId } as never }),
    existentes: async (orgId) =>
      new Set((await prisma.failureCode.findMany({ where: { organizationId: orgId }, select: { code: true } })).map((x) => x.code.toUpperCase())),
  },

  // ────────────────────────────────────────────────── Causas raiz
  "causas-raiz": {
    titulo: "Causas raiz",
    descripcion: "Por que fallo. Alimenta el análisis de fallas repetidas.",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "LUB-NO-EJECUTADA" },
      { nombre: "descripcion", requerido: true, ejemplo: "Ruta de lubricación no ejecutada" },
      { nombre: "familia", ejemplo: "MANTENIMIENTO" },
    ],
    contexto: async () => ({}),
    convertir: (f) => {
      const code = txt(f.codigo).toUpperCase();
      if (!code || !txt(f.descripcion)) return { ok: false, motivo: "Faltan código o descripción" };
      return { ok: true, clave: code, datos: { code, description: txt(f.descripcion), category: txt(f.familia) || null } };
    },
    insertar: (orgId, d) => prisma.rootCause.create({ data: { ...d, organizationId: orgId } as never }),
    existentes: async (orgId) =>
      new Set((await prisma.rootCause.findMany({ where: { organizationId: orgId }, select: { code: true } })).map((x) => x.code.toUpperCase())),
  },

  // ─────────────────────────────────────────────── Especialidades
  especialidades: {
    titulo: "Especialidades",
    descripcion: "Los oficios del personal y su tarifa por hora, para estimar la mano de obra de los planes.",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "MEC" },
      { nombre: "nombre", requerido: true, ejemplo: "Mecanico" },
      { nombre: "tarifa_hora", ayuda: "Costo interno de la hora-hombre", ejemplo: "180" },
    ],
    contexto: async () => ({}),
    convertir: (f) => {
      const code = txt(f.codigo).toUpperCase();
      if (!code || !txt(f.nombre)) return { ok: false, motivo: "Faltan código o nombre" };
      return {
        ok: true, clave: code,
        datos: { code, name: txt(f.nombre), hourlyRate: num(f.tarifa_hora) ?? 0 },
      };
    },
    insertar: (orgId, d) => prisma.specialty.create({ data: { ...d, organizationId: orgId } as never }),
    existentes: async (orgId) =>
      new Set((await prisma.specialty.findMany({ where: { organizationId: orgId }, select: { code: true } })).map((x) => x.code.toUpperCase())),
  },

  // ──────────────────────────────────────────── Servicios externos
  "servicios-externos": {
    titulo: "Servicios externos",
    descripcion: "Los trabajos que se subcontratan a proveedores. Son el tercer costo de una orden, junto a mano de obra y refacciones.",
    requisitos: "Los proveedores, si va a indicar el habitual de cada servicio.",
    columnas: [
      { nombre: "codigo", requerido: true, ejemplo: "SRV-REB" },
      { nombre: "nombre", requerido: true, ejemplo: "Rebobinado de motor eléctrico" },
      { nombre: "proveedor", ayuda: "Nombre tal como esta dado de alta", ejemplo: "Servicios Electromecanicos del Bajio" },
      { nombre: "unidad", ejemplo: "servicio" },
      { nombre: "costo_unitario", ejemplo: "14500" },
      { nombre: "descripcion", ejemplo: "Incluye desmontaje, barnizado y prueba" },
    ],
    contexto: async (orgId) => ({
      proveedores: new Map(
        (await prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }))
          .map((p) => [p.name.toUpperCase(), p.id]),
      ),
    }),
    convertir: (f, ctx) => {
      const code = txt(f.codigo).toUpperCase();
      if (!code || !txt(f.nombre)) return { ok: false, motivo: "Faltan código o nombre" };
      const proveedor = txt(f.proveedor);
      let supplierId: string | null = null;
      if (proveedor) {
        supplierId = ctx.proveedores?.get(proveedor.toUpperCase()) ?? null;
        if (!supplierId) return { ok: false, motivo: `No existe el proveedor "${proveedor}"` };
      }
      return {
        ok: true, clave: code,
        datos: {
          code, name: txt(f.nombre), supplierId,
          unit: txt(f.unidad) || "servicio",
          unitCost: num(f.costo_unitario) ?? 0,
          description: txt(f.descripcion) || null,
        },
      };
    },
    insertar: (orgId, d) => prisma.externalService.create({ data: { ...d, organizationId: orgId } as never }),
    existentes: async (orgId) =>
      new Set((await prisma.externalService.findMany({ where: { organizationId: orgId }, select: { code: true } })).map((x) => x.code.toUpperCase())),
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
