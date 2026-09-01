import { z } from "zod";
import { prisma } from "./db";

/**
 * Registro de catalogos maestros.
 *
 * Un catalogo es una lista guardada en base de datos que alimenta los campos de
 * seleccion de las pantallas de captura. No confundir con las listas fijas de
 * lib/constants.ts (criticidad, estados, prioridades): esas sostienen logica de
 * negocio —indicadores, transiciones, escalamiento de alertas— y no son
 * editables por el usuario.
 *
 * Cada entrada define como listar, crear, editar y borrar, y sobre todo que
 * impide borrar: nunca se elimina algo que ya este en uso.
 */

export type ClaveCatalogo =
  | "sites"
  | "locations"
  | "warehouses"
  | "categories"
  | "failure-codes"
  | "root-causes"
  | "suppliers"
  | "teams"
  | "part-categories"
  | "part-units"
  | "specialties"
  | "external-services";

const texto = (min = 1, max = 120) => z.string().trim().min(min).max(max);

export type DefinicionCatalogo = {
  titulo: string;
  /**
   * No se muestra como pestaña en Catalogos.
   *
   * Proveedores tiene pantalla propia —ahi se le ve lo que surte, lo que
   * representa en piso y lo que se le ha pagado— pero su definicion sigue
   * viva aqui porque otros catalogos toman de ella las opciones de sus
   * selects. Se oculta, no se borra.
   */
  oculto?: boolean;
  singular: string;
  descripcion: string;
  /** Campos que la interfaz debe pedir, en orden. */
  campos: Array<{
    nombre: string;
    etiqueta: string;
    tipo: "texto" | "numero" | "select" | "textarea" | "coordenadas";
    requerido?: boolean;
    ayuda?: string;
    /** Para tipo "select": de que catalogo salen las opciones. */
    opcionesDe?: ClaveCatalogo;
    opciones?: Array<{ valor: string; etiqueta: string }>;
  }>;
  crear: z.ZodTypeAny;
  editar: z.ZodTypeAny;
  listar: (orgId: string) => Promise<Array<Record<string, unknown>>>;
  insertar: (orgId: string, datos: Record<string, unknown>) => Promise<{ id: string }>;
  actualizar: (orgId: string, id: string, datos: Record<string, unknown>) => Promise<unknown>;
  /** Devuelve un motivo si el registro no se puede borrar, o null si si. */
  bloqueoDeBorrado: (orgId: string, id: string) => Promise<string | null>;
  borrar: (orgId: string, id: string) => Promise<unknown>;
};

function plural(n: number, singular: string, plural: string) {
  return `${n} ${n === 1 ? singular : plural}`;
}

export const CATALOGOS: Record<ClaveCatalogo, DefinicionCatalogo> = {
  // ------------------------------------------------------------------ Sitios
  sites: {
    titulo: "Sitios",
    singular: "sitio",
    descripcion: "Plantas, naves o centros de trabajo donde viven los activos.",
    campos: [
      { nombre: "code", etiqueta: "Codigo", tipo: "texto", requerido: true, ayuda: "Corto y unico, ej. P01" },
      { nombre: "name", etiqueta: "Nombre", tipo: "texto", requerido: true },
      { nombre: "city", etiqueta: "Ciudad", tipo: "texto", ayuda: "El sistema deduce de aqui el clima para ajustar las frecuencias de mantenimiento" },
      { nombre: "address", etiqueta: "Direccion", tipo: "texto" },
      {
        nombre: "coordenadas", etiqueta: "Coordenadas", tipo: "coordenadas",
        ayuda: "Opcional. En Google Maps: clic derecho sobre el punto y elija la primera opcion; pegue aqui los dos numeros tal como los copio",
      },
      { nombre: "notasAcceso", etiqueta: "Como se entra", tipo: "textarea", ayuda: "Caseta, horario, si pasa trailer, donde esta el anden. Lo que necesita saber quien llega por primera vez" },
    ],
    crear: z.object({
      code: texto(1, 20),
      name: texto(2),
      city: texto(0, 80).optional().nullable(),
      address: texto(0, 200).optional().nullable(),
      latitud: z.coerce.number().min(-90).max(90).optional().nullable(),
      longitud: z.coerce.number().min(-180).max(180).optional().nullable(),
      notasAcceso: texto(0, 600).optional().nullable(),
    }),
    editar: z.object({
      code: texto(1, 20).optional(),
      name: texto(2).optional(),
      city: texto(0, 80).nullable().optional(),
      address: texto(0, 200).nullable().optional(),
      latitud: z.coerce.number().min(-90).max(90).nullable().optional(),
      longitud: z.coerce.number().min(-180).max(180).nullable().optional(),
      notasAcceso: texto(0, 600).nullable().optional(),
    }),
    listar: (orgId) =>
      prisma.site.findMany({
        where: { organizationId: orgId },
        select: {
          id: true, code: true, name: true, city: true, address: true,
          latitud: true, longitud: true, notasAcceso: true,
          _count: { select: { assets: true, locations: true } },
        },
        orderBy: { code: "asc" },
      }) as Promise<Array<Record<string, unknown>>>,
    insertar: (orgId, d) =>
      prisma.site.create({ data: ({ ...d, organizationId: orgId } as never), select: { id: true } }),
    actualizar: (orgId, id, d) =>
      prisma.site.updateMany({ where: { id, organizationId: orgId }, data: d as never }),
    bloqueoDeBorrado: async (orgId, id) => {
      const [activos, ubicaciones] = await Promise.all([
        prisma.asset.count({ where: { siteId: id, organizationId: orgId } }),
        prisma.location.count({ where: { siteId: id, organizationId: orgId } }),
      ]);
      if (activos || ubicaciones) {
        const partes = [
          activos ? plural(activos, "activo", "activos") : null,
          ubicaciones ? plural(ubicaciones, "ubicacion", "ubicaciones") : null,
        ].filter(Boolean);
        return `El sitio tiene ${partes.join(" y ")}. Reasignelos antes de eliminarlo.`;
      }
      return null;
    },
    borrar: (orgId, id) => prisma.site.deleteMany({ where: { id, organizationId: orgId } }),
  },

  // ------------------------------------------------------------- Ubicaciones
  locations: {
    titulo: "Ubicaciones",
    singular: "ubicacion",
    descripcion: "Areas, lineas o cuartos dentro de un sitio.",
    campos: [
      { nombre: "siteId", etiqueta: "Sitio", tipo: "select", requerido: true, opcionesDe: "sites" },
      { nombre: "code", etiqueta: "Codigo", tipo: "texto", requerido: true },
      { nombre: "name", etiqueta: "Nombre", tipo: "texto", requerido: true },
      { nombre: "description", etiqueta: "Descripcion", tipo: "texto" },
    ],
    crear: z.object({
      siteId: z.string().min(1),
      code: texto(1, 20),
      name: texto(2),
      description: texto(0, 200).optional().nullable(),
    }),
    editar: z.object({
      code: texto(1, 20).optional(),
      name: texto(2).optional(),
      description: texto(0, 200).nullable().optional(),
    }),
    listar: (orgId) =>
      prisma.location.findMany({
        where: { organizationId: orgId },
        select: {
          id: true, code: true, name: true, description: true, siteId: true,
          site: { select: { name: true } },
          _count: { select: { assets: true } },
        },
        orderBy: [{ siteId: "asc" }, { code: "asc" }],
      }) as Promise<Array<Record<string, unknown>>>,
    insertar: async (orgId, d) => {
      const datos = d as { siteId: string };
      const sitio = await prisma.site.findFirst({
        where: { id: datos.siteId, organizationId: orgId },
        select: { id: true },
      });
      if (!sitio) throw new Error("El sitio indicado no existe");
      return prisma.location.create({
        data: ({ ...d, organizationId: orgId } as never),
        select: { id: true },
      });
    },
    actualizar: (orgId, id, d) =>
      prisma.location.updateMany({ where: { id, organizationId: orgId }, data: d as never }),
    bloqueoDeBorrado: async (orgId, id) => {
      const [activos, hijas] = await Promise.all([
        prisma.asset.count({ where: { locationId: id, organizationId: orgId } }),
        prisma.location.count({ where: { parentId: id, organizationId: orgId } }),
      ]);
      if (activos) return `La ubicacion tiene ${plural(activos, "activo", "activos")}. Reasignelos antes de eliminarla.`;
      if (hijas) return `La ubicacion tiene ${plural(hijas, "sububicacion", "sububicaciones")}.`;
      return null;
    },
    borrar: (orgId, id) => prisma.location.deleteMany({ where: { id, organizationId: orgId } }),
  },

  // -------------------------------------------------- Categorias de activo
  warehouses: {
    titulo: "Almacenes",
    singular: "almacen",
    descripcion: "Donde vive la existencia. Casi siempre uno general y subalmacenes por planta o linea.",
    campos: [
      { nombre: "code", etiqueta: "Codigo", tipo: "texto", requerido: true, ayuda: "Corto y estable: ALM-GEN, ALM-L1" },
      { nombre: "name", etiqueta: "Nombre", tipo: "texto", requerido: true },
      { nombre: "siteId", etiqueta: "Sitio", tipo: "select", opcionesDe: "sites", ayuda: "En que instalacion esta fisicamente" },
      { nombre: "notas", etiqueta: "Notas", tipo: "textarea", ayuda: "Horario, quien tiene llave, restricciones de acceso" },
    ],
    crear: z.object({
      code: texto(1, 20),
      name: texto(2),
      siteId: z.string().optional().nullable(),
      notas: texto(0, 500).optional().nullable(),
    }),
    editar: z.object({
      code: texto(1, 20).optional(),
      name: texto(2).optional(),
      siteId: z.string().nullable().optional(),
      notas: texto(0, 500).nullable().optional(),
    }),
    listar: (orgId) =>
      prisma.warehouse.findMany({
        where: { organizationId: orgId },
        select: {
          id: true, code: true, name: true, siteId: true, notas: true, esGeneral: true,
          site: { select: { name: true } },
          _count: { select: { existencias: true } },
        },
        orderBy: [{ esGeneral: "desc" }, { code: "asc" }],
      }) as Promise<Array<Record<string, unknown>>>,
    insertar: async (orgId, d) => {
      const datos = d as { siteId?: string | null };
      if (datos.siteId) {
        const sitio = await prisma.site.findFirst({
          where: { id: datos.siteId, organizationId: orgId },
          select: { id: true },
        });
        if (!sitio) throw new Error("El sitio indicado no existe");
      }
      return prisma.warehouse.create({
        data: ({ ...d, siteId: datos.siteId || null, organizationId: orgId } as never),
        select: { id: true },
      });
    },
    actualizar: (orgId, id, d) =>
      prisma.warehouse.updateMany({ where: { id, organizationId: orgId }, data: d as never }),
    bloqueoDeBorrado: async (orgId, id) => {
      const almacen = await prisma.warehouse.findFirst({
        where: { id, organizationId: orgId },
        select: { esGeneral: true },
      });
      // El general es el destino por omision de toda entrada y el que recibio
      // la existencia al migrar. Sin el, un alta de refaccion no sabria donde
      // poner lo que llega.
      if (almacen?.esGeneral) return "Es el almacen general de la cuenta y no se puede borrar.";

      const conSaldo = await prisma.partStock.count({
        where: { warehouseId: id, organizationId: orgId, quantity: { gt: 0 } },
      });
      if (conSaldo) {
        return `Todavia guarda ${plural(conSaldo, "refaccion", "refacciones")} con existencia. Traspase lo que queda antes de borrarlo.`;
      }

      const movimientos = await prisma.stockMovement.count({ where: { warehouseId: id, organizationId: orgId } });
      if (movimientos) {
        return `Tiene ${plural(movimientos, "movimiento", "movimientos")} en su historial. Desactivelo en vez de borrarlo.`;
      }
      return null;
    },
    borrar: (orgId, id) => prisma.warehouse.deleteMany({ where: { id, organizationId: orgId } }),
  },

  categories: {
    titulo: "Categorias de activo",
    singular: "categoria",
    descripcion: "Familias de equipo. Sirven para agrupar y para filtrar reportes.",
    campos: [
      { nombre: "code", etiqueta: "Codigo", tipo: "texto", requerido: true },
      { nombre: "name", etiqueta: "Nombre", tipo: "texto", requerido: true },
    ],
    crear: z.object({ code: texto(1, 20), name: texto(2) }),
    editar: z.object({ code: texto(1, 20).optional(), name: texto(2).optional() }),
    listar: (orgId) =>
      prisma.assetCategory.findMany({
        where: { organizationId: orgId },
        select: { id: true, code: true, name: true, _count: { select: { assets: true, plans: true } } },
        orderBy: { code: "asc" },
      }) as Promise<Array<Record<string, unknown>>>,
    insertar: (orgId, d) =>
      prisma.assetCategory.create({ data: ({ ...d, organizationId: orgId } as never), select: { id: true } }),
    actualizar: (orgId, id, d) =>
      prisma.assetCategory.updateMany({ where: { id, organizationId: orgId }, data: d as never }),
    bloqueoDeBorrado: async (orgId, id) => {
      const activos = await prisma.asset.count({ where: { categoryId: id, organizationId: orgId } });
      if (activos) return `La categoria esta asignada a ${plural(activos, "activo", "activos")}.`;
      return null;
    },
    borrar: (orgId, id) => prisma.assetCategory.deleteMany({ where: { id, organizationId: orgId } }),
  },

  // ----------------------------------------------------- Codigos de falla
  "failure-codes": {
    titulo: "Codigos de falla",
    singular: "codigo de falla",
    descripcion: "Clasificacion de causas al cerrar una orden correctiva. Alimenta el analisis de fallas repetidas.",
    campos: [
      { nombre: "code", etiqueta: "Codigo", tipo: "texto", requerido: true, ayuda: "ej. MEC-01" },
      { nombre: "description", etiqueta: "Descripcion", tipo: "texto", requerido: true },
      {
        nombre: "category", etiqueta: "Familia", tipo: "select",
        opciones: [
          { valor: "MECANICO", etiqueta: "Mecanico" },
          { valor: "ELECTRICO", etiqueta: "Electrico" },
          { valor: "HIDRAULICO", etiqueta: "Hidraulico" },
          { valor: "NEUMATICO", etiqueta: "Neumatico" },
          { valor: "INSTRUMENTACION", etiqueta: "Instrumentacion" },
          { valor: "OPERACION", etiqueta: "Operacion" },
          { valor: "OTRO", etiqueta: "Otro" },
        ],
      },
    ],
    crear: z.object({
      code: texto(1, 20),
      description: texto(2, 200),
      category: texto(0, 40).optional().nullable(),
    }),
    editar: z.object({
      code: texto(1, 20).optional(),
      description: texto(2, 200).optional(),
      category: texto(0, 40).nullable().optional(),
    }),
    listar: (orgId) =>
      prisma.failureCode.findMany({
        where: { organizationId: orgId },
        select: { id: true, code: true, description: true, category: true, _count: { select: { workOrders: true } } },
        orderBy: { code: "asc" },
      }) as Promise<Array<Record<string, unknown>>>,
    insertar: (orgId, d) =>
      prisma.failureCode.create({ data: ({ ...d, organizationId: orgId } as never), select: { id: true } }),
    actualizar: (orgId, id, d) =>
      prisma.failureCode.updateMany({ where: { id, organizationId: orgId }, data: d as never }),
    bloqueoDeBorrado: async (orgId, id) => {
      const ots = await prisma.workOrder.count({ where: { failureCodeId: id, organizationId: orgId } });
      if (ots) return `El codigo esta usado en ${plural(ots, "orden", "ordenes")}. Borrarlo perderia el historial de fallas.`;
      return null;
    },
    borrar: (orgId, id) => prisma.failureCode.deleteMany({ where: { id, organizationId: orgId } }),
  },

  // ---------------------------------------------------------- Proveedores

  // ------------------------------------------------------------ Cuadrillas
  suppliers: {
    titulo: "Proveedores",
    singular: "proveedor",
    descripcion: "Quien surte las refacciones del almacen.",
    oculto: true,
    campos: [
      { nombre: "name", etiqueta: "Nombre", tipo: "texto", requerido: true },
      { nombre: "contactName", etiqueta: "Contacto", tipo: "texto" },
      { nombre: "email", etiqueta: "Correo", tipo: "texto" },
      { nombre: "phone", etiqueta: "Telefono", tipo: "texto" },
      { nombre: "leadTimeDays", etiqueta: "Dias de entrega", tipo: "numero", ayuda: "Tiempo tipico de resurtido" },
    ],
    crear: z.object({
      name: texto(2),
      contactName: texto(0, 120).optional().nullable(),
      email: z.union([z.string().email(), z.literal("")]).optional().nullable(),
      phone: texto(0, 40).optional().nullable(),
      leadTimeDays: z.coerce.number().int().min(0).max(365).default(7),
    }),
    editar: z.object({
      name: texto(2).optional(),
      contactName: texto(0, 120).nullable().optional(),
      email: z.union([z.string().email(), z.literal("")]).nullable().optional(),
      phone: texto(0, 40).nullable().optional(),
      leadTimeDays: z.coerce.number().int().min(0).max(365).optional(),
    }),
    listar: (orgId) =>
      prisma.supplier.findMany({
        where: { organizationId: orgId },
        select: {
          id: true, name: true, contactName: true, email: true, phone: true, leadTimeDays: true,
          _count: { select: { parts: true } },
        },
        orderBy: { name: "asc" },
      }) as Promise<Array<Record<string, unknown>>>,
    insertar: (orgId, d) =>
      prisma.supplier.create({ data: ({ ...d, organizationId: orgId } as never), select: { id: true } }),
    actualizar: (orgId, id, d) =>
      prisma.supplier.updateMany({ where: { id, organizationId: orgId }, data: d as never }),
    bloqueoDeBorrado: async (orgId, id) => {
      const refacciones = await prisma.part.count({ where: { supplierId: id, organizationId: orgId } });
      if (refacciones) return `El proveedor surte ${plural(refacciones, "refaccion", "refacciones")}.`;
      return null;
    },
    borrar: (orgId, id) => prisma.supplier.deleteMany({ where: { id, organizationId: orgId } }),
  },
  teams: {
    titulo: "Cuadrillas",
    singular: "cuadrilla",
    descripcion: "Grupos de trabajo a los que se asignan ordenes y planes.",
    campos: [
      { nombre: "name", etiqueta: "Nombre", tipo: "texto", requerido: true },
      { nombre: "description", etiqueta: "Descripcion", tipo: "texto" },
    ],
    crear: z.object({ name: texto(2), description: texto(0, 200).optional().nullable() }),
    editar: z.object({ name: texto(2).optional(), description: texto(0, 200).nullable().optional() }),
    listar: (orgId) =>
      prisma.team.findMany({
        where: { organizationId: orgId },
        select: {
          id: true, name: true, description: true,
          _count: { select: { members: true, workOrders: true } },
        },
        orderBy: { name: "asc" },
      }) as Promise<Array<Record<string, unknown>>>,
    insertar: (orgId, d) =>
      prisma.team.create({ data: ({ ...d, organizationId: orgId } as never), select: { id: true } }),
    actualizar: (orgId, id, d) =>
      prisma.team.updateMany({ where: { id, organizationId: orgId }, data: d as never }),
    bloqueoDeBorrado: async (orgId, id) => {
      const ots = await prisma.workOrder.count({ where: { teamId: id, organizationId: orgId } });
      if (ots) return `La cuadrilla tiene ${plural(ots, "orden asignada", "ordenes asignadas")}.`;
      return null;
    },
    borrar: (orgId, id) => prisma.team.deleteMany({ where: { id, organizationId: orgId } }),
  },

  // ------------------------------------------- Categorias de refaccion
  "part-categories": {
    titulo: "Familias de refaccion",
    singular: "familia",
    descripcion: "Clasificacion de las refacciones del almacen. Evita que la misma familia se capture escrita de tres formas distintas.",
    campos: [
      { nombre: "code", etiqueta: "Codigo", tipo: "texto", requerido: true, ayuda: "Es lo que se guarda en la refaccion" },
      { nombre: "name", etiqueta: "Nombre", tipo: "texto", requerido: true },
    ],
    crear: z.object({ code: texto(1, 40), name: texto(2) }),
    editar: z.object({ code: texto(1, 40).optional(), name: texto(2).optional() }),
    listar: async (orgId) => {
      const items = await prisma.partCategory.findMany({
        where: { organizationId: orgId },
        select: { id: true, code: true, name: true },
        orderBy: { name: "asc" },
      });
      // El uso se cuenta contra el texto guardado en Part.category.
      const usos = await prisma.part.groupBy({
        by: ["category"],
        where: { organizationId: orgId, category: { not: null } },
        _count: { _all: true },
      });
      const mapa = new Map(usos.map((u) => [u.category, u._count._all]));
      return items.map((i) => ({ ...i, _count: { parts: mapa.get(i.code) ?? 0 } }));
    },
    insertar: (orgId, d) =>
      prisma.partCategory.create({ data: ({ ...d, organizationId: orgId } as never), select: { id: true } }),
    actualizar: async (orgId, id, d) => {
      const previa = await prisma.partCategory.findFirst({
        where: { id, organizationId: orgId },
        select: { code: true },
      });
      const r = await prisma.partCategory.updateMany({
        where: { id, organizationId: orgId },
        data: d as never,
      });
      // Las refacciones guardan el codigo, no el id: al renombrarlo hay que
      // arrastrar el cambio o quedarian apuntando a una familia inexistente.
      const nuevo = (d as { code?: string }).code;
      if (previa && nuevo && nuevo !== previa.code) {
        await prisma.part.updateMany({
          where: { organizationId: orgId, category: previa.code },
          data: { category: nuevo },
        });
      }
      return r;
    },
    bloqueoDeBorrado: async (orgId, id) => {
      const cat = await prisma.partCategory.findFirst({ where: { id, organizationId: orgId }, select: { code: true } });
      if (!cat) return null;
      const n = await prisma.part.count({ where: { organizationId: orgId, category: cat.code } });
      if (n) return `La familia esta asignada a ${plural(n, "refaccion", "refacciones")}.`;
      return null;
    },
    borrar: (orgId, id) => prisma.partCategory.deleteMany({ where: { id, organizationId: orgId } }),
  },

  // ----------------------------------------------- Unidades de medida
  "part-units": {
    titulo: "Unidades de medida",
    singular: "unidad",
    descripcion: "Como se cuenta cada refaccion: piezas, litros, metros. El codigo es lo que aparece en las pantallas.",
    campos: [
      { nombre: "code", etiqueta: "Codigo", tipo: "texto", requerido: true, ayuda: "Corto: pza, lt, kg" },
      { nombre: "name", etiqueta: "Nombre", tipo: "texto", requerido: true },
    ],
    crear: z.object({ code: texto(1, 12), name: texto(2) }),
    editar: z.object({ code: texto(1, 12).optional(), name: texto(2).optional() }),
    listar: async (orgId) => {
      const items = await prisma.partUnit.findMany({
        where: { organizationId: orgId },
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
      });
      const usos = await prisma.part.groupBy({
        by: ["unit"],
        where: { organizationId: orgId },
        _count: { _all: true },
      });
      const mapa = new Map(usos.map((u) => [u.unit, u._count._all]));
      return items.map((i) => ({ ...i, _count: { parts: mapa.get(i.code) ?? 0 } }));
    },
    insertar: (orgId, d) =>
      prisma.partUnit.create({ data: ({ ...d, organizationId: orgId } as never), select: { id: true } }),
    actualizar: async (orgId, id, d) => {
      const previa = await prisma.partUnit.findFirst({
        where: { id, organizationId: orgId },
        select: { code: true },
      });
      const r = await prisma.partUnit.updateMany({ where: { id, organizationId: orgId }, data: d as never });
      const nuevo = (d as { code?: string }).code;
      if (previa && nuevo && nuevo !== previa.code) {
        await prisma.part.updateMany({
          where: { organizationId: orgId, unit: previa.code },
          data: { unit: nuevo },
        });
      }
      return r;
    },
    bloqueoDeBorrado: async (orgId, id) => {
      const u = await prisma.partUnit.findFirst({ where: { id, organizationId: orgId }, select: { code: true } });
      if (!u) return null;
      const n = await prisma.part.count({ where: { organizationId: orgId, unit: u.code } });
      if (n) return `La unidad esta en uso por ${plural(n, "refaccion", "refacciones")}.`;
      return null;
    },
    borrar: (orgId, id) => prisma.partUnit.deleteMany({ where: { id, organizationId: orgId } }),
  },

  // ------------------------------------------------------ Causas raiz
  "root-causes": {
    titulo: "Causas raiz",
    singular: "causa raiz",
    descripcion: "Por que fallo, no que fallo. El codigo de falla describe el sintoma; la causa raiz, el origen. Separarlos permite atacar patrones en vez de repetir reparaciones.",
    campos: [
      { nombre: "code", etiqueta: "Codigo", tipo: "texto", requerido: true, ayuda: "ej. LUB-NO-EJECUTADA" },
      { nombre: "description", etiqueta: "Descripcion", tipo: "texto", requerido: true },
      {
        nombre: "category", etiqueta: "Familia", tipo: "select",
        opciones: [
          { valor: "MANTENIMIENTO", etiqueta: "Practica de mantenimiento" },
          { valor: "INSTALACION", etiqueta: "Instalacion o montaje" },
          { valor: "OPERACION", etiqueta: "Operacion" },
          { valor: "DESGASTE", etiqueta: "Desgaste normal" },
          { valor: "AMBIENTE", etiqueta: "Ambiente" },
          { valor: "EXTERNO", etiqueta: "Causa externa" },
          { valor: "DISENO", etiqueta: "Diseño o seleccion" },
          { valor: "OTRO", etiqueta: "Otro" },
        ],
      },
    ],
    crear: z.object({
      code: texto(1, 60),
      description: texto(2, 200),
      category: texto(0, 40).optional().nullable(),
    }),
    editar: z.object({
      code: texto(1, 60).optional(),
      description: texto(2, 200).optional(),
      category: texto(0, 40).nullable().optional(),
    }),
    listar: (orgId) =>
      prisma.rootCause.findMany({
        where: { organizationId: orgId },
        select: { id: true, code: true, description: true, category: true, _count: { select: { workOrders: true } } },
        orderBy: { code: "asc" },
      }) as Promise<Array<Record<string, unknown>>>,
    insertar: (orgId, d) =>
      prisma.rootCause.create({ data: ({ ...d, organizationId: orgId } as never), select: { id: true } }),
    actualizar: (orgId, id, d) =>
      prisma.rootCause.updateMany({ where: { id, organizationId: orgId }, data: d as never }),
    bloqueoDeBorrado: async (orgId, id) => {
      const n = await prisma.workOrder.count({ where: { rootCauseId: id, organizationId: orgId } });
      if (n) return `La causa esta registrada en ${plural(n, "orden", "ordenes")}. Borrarla perderia el analisis de fallas.`;
      return null;
    },
    borrar: (orgId, id) => prisma.rootCause.deleteMany({ where: { id, organizationId: orgId } }),
  },

  // --------------------------------------------------------- Especialidades
  specialties: {
    titulo: "Especialidades",
    singular: "especialidad",
    descripcion: "Los oficios del personal de mantenimiento y su tarifa por hora. Sirven para estimar la mano de obra de cada actividad de un plan.",
    campos: [
      { nombre: "code", etiqueta: "Codigo", tipo: "texto", requerido: true, ayuda: "Corto y unico, ej. MEC" },
      { nombre: "name", etiqueta: "Nombre", tipo: "texto", requerido: true, ayuda: "Mecanico, Electricista, Instrumentista…" },
      { nombre: "hourlyRate", etiqueta: "Tarifa por hora", tipo: "numero", ayuda: "Costo interno de la hora-hombre" },
    ],
    crear: z.object({
      code: texto(1, 20),
      name: texto(2),
      hourlyRate: z.coerce.number().min(0).default(0),
    }),
    editar: z.object({
      code: texto(1, 20).optional(),
      name: texto(2).optional(),
      hourlyRate: z.coerce.number().min(0).optional(),
    }),
    listar: (orgId) =>
      prisma.specialty.findMany({
        where: { organizationId: orgId },
        select: { id: true, code: true, name: true, hourlyRate: true, _count: { select: { planLabor: true } } },
        orderBy: { code: "asc" },
      }) as Promise<Array<Record<string, unknown>>>,
    insertar: (orgId, d) =>
      prisma.specialty.create({ data: ({ ...d, organizationId: orgId } as never), select: { id: true } }),
    actualizar: (orgId, id, d) =>
      prisma.specialty.updateMany({ where: { id, organizationId: orgId }, data: d as never }),
    bloqueoDeBorrado: async (orgId, id) => {
      const n = await prisma.planTaskLabor.count({ where: { specialtyId: id, specialty: { organizationId: orgId } } });
      if (n) return `La especialidad esta usada en ${plural(n, "actividad", "actividades")} de planes. Cambiela ahi antes de eliminarla.`;
      return null;
    },
    borrar: (orgId, id) => prisma.specialty.deleteMany({ where: { id, organizationId: orgId } }),
  },

  // ------------------------------------------------------ Servicios externos
  "external-services": {
    titulo: "Servicios externos",
    singular: "servicio externo",
    descripcion: "Trabajos que se subcontratan a un proveedor: rebobinado, balanceo, analisis de aceite, maniobras, calibracion certificada. Es el tercer costo de una orden, junto a mano de obra propia y refacciones.",
    campos: [
      { nombre: "code", etiqueta: "Codigo", tipo: "texto", requerido: true, ayuda: "Corto y unico, ej. SRV-REB" },
      { nombre: "name", etiqueta: "Nombre", tipo: "texto", requerido: true },
      { nombre: "supplierId", etiqueta: "Proveedor habitual", tipo: "select", opcionesDe: "suppliers" },
      { nombre: "unit", etiqueta: "Unidad", tipo: "texto", ayuda: "servicio, hora, jornada, m2…" },
      { nombre: "unitCost", etiqueta: "Costo unitario", tipo: "numero", ayuda: "Referencia para presupuestar el plan" },
      { nombre: "description", etiqueta: "Descripcion", tipo: "texto" },
    ],
    crear: z.object({
      code: texto(1, 30),
      name: texto(2),
      supplierId: z.string().optional().nullable(),
      unit: texto(0, 30).optional().nullable(),
      unitCost: z.coerce.number().min(0).default(0),
      description: texto(0, 300).optional().nullable(),
    }),
    editar: z.object({
      code: texto(1, 30).optional(),
      name: texto(2).optional(),
      supplierId: z.string().nullable().optional(),
      unit: texto(0, 30).nullable().optional(),
      unitCost: z.coerce.number().min(0).optional(),
      description: texto(0, 300).nullable().optional(),
    }),
    listar: (orgId) =>
      prisma.externalService.findMany({
        where: { organizationId: orgId },
        select: {
          id: true, code: true, name: true, unit: true, unitCost: true, description: true, supplierId: true,
          supplier: { select: { name: true } },
          _count: { select: { planServices: true, workOrders: true } },
        },
        orderBy: { code: "asc" },
      }) as Promise<Array<Record<string, unknown>>>,
    insertar: (orgId, d) => {
      const datos = { ...d, supplierId: d.supplierId || null, unit: d.unit || "servicio" };
      return prisma.externalService.create({ data: ({ ...datos, organizationId: orgId } as never), select: { id: true } });
    },
    actualizar: (orgId, id, d) => {
      const datos: Record<string, unknown> = { ...d };
      if ("supplierId" in datos) datos.supplierId = datos.supplierId || null;
      if ("unit" in datos) datos.unit = datos.unit || "servicio";
      return prisma.externalService.updateMany({ where: { id, organizationId: orgId }, data: datos as never });
    },
    bloqueoDeBorrado: async (orgId, id) => {
      const [planes, ordenes] = await Promise.all([
        prisma.planTaskService.count({ where: { serviceId: id, service: { organizationId: orgId } } }),
        prisma.workOrderService.count({ where: { serviceId: id, workOrder: { organizationId: orgId } } }),
      ]);
      if (ordenes) return `El servicio ya se contrato en ${plural(ordenes, "orden", "ordenes")}. Borrarlo perderia el historial de costo.`;
      if (planes) return `El servicio esta planeado en ${plural(planes, "actividad", "actividades")} de planes.`;
      return null;
    },
    borrar: (orgId, id) => prisma.externalService.deleteMany({ where: { id, organizationId: orgId } }),
  },
};
export function esCatalogoValido(clave: string): clave is ClaveCatalogo {
  return clave in CATALOGOS;
}
