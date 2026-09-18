/**
 * Revertir una importación —o quitar los datos de demostración— sin romper nada.
 *
 * La regla es una: **se borra solo lo que el lote creó y nadie usó después.**
 *
 * «Usado» quiere decir que algo más lo referencia: una orden de trabajo sobre el
 * equipo, un movimiento de almacén de la refacción, un plan que ya generó
 * órdenes, un activo en esa ubicación que no venía en el mismo lote. También
 * cuenta haberlo editado después de importarlo: alguien ya trabajó sobre ese
 * registro. Nada de eso se borra en automático; se lista, con el motivo, para
 * que una persona decida.
 *
 * Los registros que el lote ACTUALIZÓ no se regresan a como estaban: después de
 * importar pudieron cambiar por otras razones, y pisar esos cambios con los
 * valores viejos sería peor que dejarlos. Se listan con su valor anterior para
 * revisarlos a mano.
 *
 * Nunca cruza de empresa: el lote se busca dentro de la organización de quien
 * pide, y cada borrado lleva su `organizationId`.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { logAudit } from "./audit";

type Db = Prisma.TransactionClient;

export class ErrorDeLote extends Error {
  constructor(message: string, readonly codigo = 422) {
    super(message);
  }
}

/**
 * Las referencias con que un lote asienta la existencia inicial de sus
 * refacciones. Esos movimientos son del lote, no uso real: se borran con él.
 */
export const REFERENCIAS_PROPIAS = ["Importación inicial", "Datos de demostración"];

/** Quién puede estar apuntando a un registro de cada tipo. Sale del esquema. */
const REFERENCIAS: Record<string, Array<{ modelo: string; campo: string; que: string }>> = {
  Site: [
    { modelo: "location", campo: "siteId", que: "ubicaciones" },
    { modelo: "asset", campo: "siteId", que: "activos" },
    { modelo: "warehouse", campo: "siteId", que: "almacenes" },
    { modelo: "workOrder", campo: "siteId", que: "órdenes de trabajo" },
    { modelo: "workRequest", campo: "siteId", que: "solicitudes" },
  ],
  Location: [
    { modelo: "location", campo: "parentId", que: "ubicaciones hijas" },
    { modelo: "asset", campo: "locationId", que: "activos" },
    { modelo: "workOrder", campo: "locationId", que: "órdenes de trabajo" },
    { modelo: "workRequest", campo: "locationId", que: "solicitudes" },
  ],
  Asset: [
    { modelo: "asset", campo: "parentId", que: "componentes" },
    { modelo: "workOrder", campo: "assetId", que: "órdenes de trabajo" },
    { modelo: "workRequest", campo: "assetId", que: "solicitudes" },
    { modelo: "downtimeEvent", campo: "assetId", que: "paros registrados" },
    { modelo: "meter", campo: "assetId", que: "medidores" },
    { modelo: "attachment", campo: "assetId", que: "archivos" },
    { modelo: "materialRequest", campo: "assetId", que: "requisiciones" },
    { modelo: "referenceLink", campo: "assetId", que: "ligas de referencia" },
    { modelo: "sensor", campo: "assetId", que: "sensores" },
    { modelo: "predictiveAlert", campo: "assetId", que: "alertas" },
    { modelo: "planAsset", campo: "assetId", que: "planes asignados" },
    { modelo: "conjuntoAsset", campo: "assetId", que: "conjuntos" },
    { modelo: "maintenancePlan", campo: "assetId", que: "planes" },
  ],
  Part: [
    { modelo: "workOrderPart", campo: "partId", que: "consumos en órdenes" },
    { modelo: "purchaseRequestLine", campo: "partId", que: "compras" },
    { modelo: "goodsReceiptLine", campo: "partId", que: "recepciones" },
    { modelo: "quoteLine", campo: "partId", que: "cotizaciones" },
    { modelo: "inventoryCountLine", campo: "partId", que: "conteos" },
    { modelo: "materialRequestLine", campo: "partId", que: "requisiciones" },
    { modelo: "stockTransferLine", campo: "partId", que: "traspasos" },
    { modelo: "planTaskPart", campo: "partId", que: "planes que la usan" },
    { modelo: "attachment", campo: "partId", que: "archivos" },
    { modelo: "referenceLink", campo: "partId", que: "ligas de referencia" },
    { modelo: "workOrderTask", campo: "bloqueadaPorPartId", que: "actividades en espera de ella" },
  ],
  Supplier: [
    { modelo: "part", campo: "supplierId", que: "refacciones" },
    { modelo: "workOrderService", campo: "supplierId", que: "servicios en órdenes" },
    { modelo: "purchaseRequest", campo: "proveedorSugeridoId", que: "compras" },
    { modelo: "goodsReceipt", campo: "supplierId", que: "recepciones" },
    { modelo: "quote", campo: "supplierId", que: "cotizaciones" },
    { modelo: "purchaseOrder", campo: "supplierId", que: "órdenes de compra" },
    { modelo: "externalService", campo: "supplierId", que: "servicios externos" },
  ],
  MaintenancePlan: [
    { modelo: "workOrder", campo: "planId", que: "órdenes generadas" },
    { modelo: "referenceLink", campo: "planId", que: "ligas de referencia" },
  ],
  AssetCategory: [
    { modelo: "asset", campo: "categoryId", que: "activos" },
    { modelo: "maintenancePlan", campo: "categoryId", que: "planes" },
  ],
  FailureCode: [
    { modelo: "workOrder", campo: "failureCodeId", que: "órdenes" },
    { modelo: "workOrderTask", campo: "failureCodeId", que: "actividades" },
  ],
  RootCause: [
    { modelo: "workOrder", campo: "rootCauseId", que: "órdenes" },
    { modelo: "workOrderTask", campo: "rootCauseId", que: "actividades" },
  ],
  Specialty: [{ modelo: "planTaskLabor", campo: "specialtyId", que: "planes" }],
  ExternalService: [
    { modelo: "workOrderService", campo: "serviceId", que: "órdenes" },
    { modelo: "planTaskService", campo: "serviceId", que: "planes" },
  ],
  PartCategory: [],
  PartUnit: [],
};

/** Entidad → modelo de Prisma. */
const MODELO: Record<string, string> = {
  Site: "site", Location: "location", Asset: "asset", Part: "part", Supplier: "supplier",
  MaintenancePlan: "maintenancePlan", AssetCategory: "assetCategory", PartCategory: "partCategory",
  PartUnit: "partUnit", FailureCode: "failureCode", RootCause: "rootCause", Specialty: "specialty",
  ExternalService: "externalService", Warehouse: "warehouse",
};

/**
 * En qué orden se borra: primero lo que depende, al final aquello de lo que se
 * depende. Un plan antes que su equipo, un equipo antes que su ubicación.
 */
const ORDEN_DE_BORRADO = [
  "MaintenancePlan", "Part", "ExternalService", "Supplier", "Asset", "Location",
  "Warehouse", "Site", "AssetCategory", "PartCategory", "PartUnit", "FailureCode", "RootCause", "Specialty",
];

type Delegado = {
  count: (a: unknown) => Promise<number>;
  findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
  deleteMany: (a: unknown) => Promise<unknown>;
};
const delegado = (db: Db | typeof prisma, modelo: string) => (db as unknown as Record<string, Delegado>)[modelo];

export type Bloqueado = { entidad: string; id: string; nombre: string; motivos: string[] };

export type DiagnosticoReversion = {
  aBorrar: Array<{ entidad: string; id: string; nombre: string }>;
  bloqueados: Bloqueado[];
  actualizados: Array<{ entidad: string; id: string; nombre: string; antes: Record<string, unknown> }>;
};

const nombreDe = (r: Record<string, unknown> | null) =>
  String(r?.code ?? r?.name ?? r?.description ?? r?.id ?? "—") +
  (r?.code && r?.name ? ` · ${r.name}` : "");

/**
 * Qué pasaría si se revierte el lote. No escribe nada: es lo que se muestra
 * antes de pedir confirmación.
 */
export async function diagnosticarReversion(organizationId: string, loteId: string): Promise<DiagnosticoReversion> {
  const lote = await prisma.importBatch.findFirst({
    where: { id: loteId, organizationId },
    include: { registros: true },
  });
  if (!lote) throw new ErrorDeLote("Importación no encontrada", 404);
  if (lote.estado === "REVERTIDO") throw new ErrorDeLote("Esta importación ya se revirtió");
  if (lote.estado === "FALLIDO") throw new ErrorDeLote("Esta importación falló y no creó nada: no hay qué revertir");

  const creados = lote.registros.filter((r) => r.accion === "CREATED");
  const registro = new Map<string, Record<string, unknown> | null>();
  for (const c of creados) {
    const d = delegado(prisma, MODELO[c.entity]);
    registro.set(c.entityId, d ? await d.findUnique({ where: { id: c.entityId } }) : null);
  }

  // Lo que ya no existe —se borró a mano— no se cuenta: no hay nada que revertir ahí.
  const vivos = creados.filter((c) => registro.get(c.entityId));
  const candidatos = new Set(vivos.map((c) => c.entityId));
  const motivos = new Map<string, string[]>();

  /**
   * Se itera hasta que ya no cambie: si un activo se queda porque tiene una
   * orden, la ubicación del mismo lote donde vive también tiene que quedarse,
   * aunque por sí misma no la usara nadie más.
   */
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const c of vivos) {
      if (!candidatos.has(c.entityId)) continue;
      const lista: string[] = [];
      const reg = registro.get(c.entityId)!;

      // Editado después de importarse: alguien ya trabajó sobre él.
      const actualizadoEl = reg.updatedAt instanceof Date ? reg.updatedAt : null;
      if (actualizadoEl && actualizadoEl.getTime() - lote.createdAt.getTime() > 60_000) {
        lista.push("se modificó después de importarse");
      }

      const planesQueSeVan = vivos
        .filter((v) => v.entity === "MaintenancePlan" && candidatos.has(v.entityId))
        .map((v) => v.entityId);

      for (const ref of REFERENCIAS[c.entity] ?? []) {
        // Las referencias desde registros que TAMBIEN se van a borrar no cuentan.
        const excluir = vivos
          .filter((v) => MODELO[v.entity] === ref.modelo && candidatos.has(v.entityId))
          .map((v) => v.entityId);
        // La asignacion de un plan del mismo lote no es un registro del lote,
        // pero se va con su plan: no cuenta como uso del equipo.
        const sinPlanesQueSeVan = ref.modelo === "planAsset" && planesQueSeVan.length
          ? { planId: { notIn: planesQueSeVan } }
          : {};
        const n = await delegado(prisma, ref.modelo).count({
          where: { [ref.campo]: c.entityId, ...sinPlanesQueSeVan, ...(excluir.length ? { id: { notIn: excluir } } : {}) },
        });
        if (n > 0) lista.push(`${n} ${ref.que}`);
      }

      // Casos que no son una simple referencia.
      if (c.entity === "Part") {
        // Su propia existencia inicial viene de la importación; cualquier otro
        // movimiento es uso real.
        const otros = await prisma.stockMovement.count({
          where: { partId: c.entityId, NOT: { reference: { in: REFERENCIAS_PROPIAS } } },
        });
        if (otros > 0) lista.push(`${otros} movimientos de almacén`);
      }
      if (c.entity === "MaintenancePlan") {
        const [actividades, generado] = await Promise.all([
          prisma.planTask.count({ where: { planId: c.entityId } }),
          prisma.planAsset.count({ where: { planId: c.entityId, OR: [{ lastGeneratedAt: { not: null } }, { ejecuciones: { gt: 0 } }] } }),
        ]);
        // El lote DEMO trae sus actividades; una importacion no, asi que si las
        // tiene es porque alguien se las agrego.
        if (actividades > 0 && lote.tipo !== "DEMO") lista.push(`${actividades} actividades agregadas después`);
        if (generado > 0) lista.push("ya generó órdenes");
      }
      if (c.entity === "Asset") {
        const conReportes = await prisma.reportPoint.count({ where: { assetId: c.entityId, solicitudes: { some: {} } } });
        if (conReportes > 0) lista.push("su código QR ya recibió reportes");
      }
      if (c.entity === "PartUnit" || c.entity === "PartCategory") {
        const campo = c.entity === "PartUnit" ? "unit" : "category";
        const excluir = vivos.filter((v) => v.entity === "Part" && candidatos.has(v.entityId)).map((v) => v.entityId);
        const n = await prisma.part.count({
          where: { organizationId, [campo]: String(reg.code), ...(excluir.length ? { id: { notIn: excluir } } : {}) },
        });
        if (n > 0) lista.push(`${n} refacciones`);
      }

      if (lista.length) {
        candidatos.delete(c.entityId);
        motivos.set(c.entityId, lista);
        cambio = true;
      }
    }
  }

  const actualizados = await Promise.all(
    lote.registros.filter((r) => r.accion === "UPDATED").map(async (r) => ({
      entidad: r.entity,
      id: r.entityId,
      nombre: nombreDe(await delegado(prisma, MODELO[r.entity])?.findUnique({ where: { id: r.entityId } }) ?? null),
      antes: JSON.parse(r.antes ?? "{}") as Record<string, unknown>,
    })),
  );

  return {
    aBorrar: vivos.filter((c) => candidatos.has(c.entityId))
      .map((c) => ({ entidad: c.entity, id: c.entityId, nombre: nombreDe(registro.get(c.entityId) ?? null) })),
    bloqueados: vivos.filter((c) => !candidatos.has(c.entityId))
      .map((c) => ({ entidad: c.entity, id: c.entityId, nombre: nombreDe(registro.get(c.entityId) ?? null), motivos: motivos.get(c.entityId) ?? [] })),
    actualizados,
  };
}

/** Borra un registro con lo que la importación le creó alrededor. */
async function borrar(db: Db, organizationId: string, entidad: string, id: string) {
  if (entidad === "Part") {
    await db.stockMovement.deleteMany({ where: { partId: id, organizationId, reference: { in: REFERENCIAS_PROPIAS } } });
    await db.partStock.deleteMany({ where: { partId: id } });
  }
  if (entidad === "MaintenancePlan") {
    const tareas = await db.planTask.findMany({ where: { planId: id }, select: { id: true } });
    const ids = tareas.map((t) => t.id);
    if (ids.length) {
      await db.planTaskAsset.deleteMany({ where: { planTaskId: { in: ids } } });
      await db.planTaskPart.deleteMany({ where: { planTaskId: { in: ids } } });
      await db.planTaskLabor.deleteMany({ where: { planTaskId: { in: ids } } });
      await db.planTaskService.deleteMany({ where: { planTaskId: { in: ids } } });
      await db.planTask.deleteMany({ where: { planId: id } });
    }
    await db.planAsset.deleteMany({ where: { planId: id, organizationId } });
  }
  if (entidad === "Asset") {
    // El QR que se genera solo al abrir la ficha, sin reportes: nace con el equipo.
    await db.reportPoint.deleteMany({ where: { assetId: id, organizationId, solicitudes: { none: {} } } });
  }
  await delegado(db, MODELO[entidad]).deleteMany({ where: { id, organizationId } });
}

/**
 * Revierte el lote: borra lo que se puede, deja lo que no, y dice qué quedó.
 *
 * Todo en una transacción: o se borra el conjunto que el diagnóstico dijo, o
 * nada.
 */
export async function revertirLote(p: { organizationId: string; loteId: string; userId: string }) {
  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "ImportBatch", entityId: p.loteId, action: "IMPORT_REVERT_REQUESTED",
    summary: "Se pidió revertir una importación",
  });

  let diag: DiagnosticoReversion;
  try {
    diag = await diagnosticarReversion(p.organizationId, p.loteId);
  } catch (e) {
    if (e instanceof ErrorDeLote && e.codigo !== 404) {
      await logAudit({
        organizationId: p.organizationId, userId: p.userId,
        entity: "ImportBatch", entityId: p.loteId, action: "IMPORT_REVERT_REJECTED",
        summary: e.message,
      });
    }
    throw e;
  }

  if (!diag.aBorrar.length) {
    await logAudit({
      organizationId: p.organizationId, userId: p.userId,
      entity: "ImportBatch", entityId: p.loteId, action: "IMPORT_REVERT_REJECTED",
      summary: `No se revirtió nada: los ${diag.bloqueados.length} registros ya se usaron`,
      changes: { bloqueados: diag.bloqueados.length },
    });
    throw new ErrorDeLote(
      `Ninguno de los ${diag.bloqueados.length} registros se puede revertir: todos ya se usaron. Revise la lista.`,
      409,
    );
  }

  const orden = (e: string) => {
    const i = ORDEN_DE_BORRADO.indexOf(e);
    return i === -1 ? ORDEN_DE_BORRADO.length : i;
  };
  const aBorrar = [...diag.aBorrar].sort((a, b) => orden(a.entidad) - orden(b.entidad));

  await prisma.$transaction(async (tx) => {
    for (const r of aBorrar) await borrar(tx, p.organizationId, r.entidad, r.id);
    await tx.importBatch.update({
      where: { id: p.loteId },
      data: {
        estado: diag.bloqueados.length ? "REVERSION_PARCIAL" : "REVERTIDO",
        revertidoAt: new Date(),
        revertidoPorId: p.userId,
        detalle: JSON.stringify({
          borrados: aBorrar.length,
          bloqueados: diag.bloqueados.map((b) => ({ entidad: b.entidad, nombre: b.nombre, motivos: b.motivos })),
          actualizadosSinRevertir: diag.actualizados.length,
        }),
      },
    });
  }, { timeout: 5 * 60_000, maxWait: 20_000 });

  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "ImportBatch", entityId: p.loteId, action: "IMPORT_REVERTED",
    summary: `Reversión: ${aBorrar.length} registros eliminados` +
      (diag.bloqueados.length ? `, ${diag.bloqueados.length} se quedaron porque ya se usaron` : "") +
      (diag.actualizados.length ? `, ${diag.actualizados.length} actualizados sin revertir` : ""),
  });

  return { borrados: aBorrar.length, bloqueados: diag.bloqueados, actualizados: diag.actualizados };
}

/** Las importaciones de la empresa, más recientes primero. */
export async function lotesDe(organizationId: string, limite = 50) {
  return prisma.importBatch.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limite,
    select: {
      id: true, tipo: true, archivoNombre: true, estado: true, leidos: true, creados: true,
      actualizados: true, omitidos: true, rechazados: true, detalle: true, createdAt: true, revertidoAt: true,
      userId: true,
    },
  });
}
