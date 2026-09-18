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
import { emitirAviso } from "./avisos/emitir";
import { aplicarMovimiento } from "./almacen";
import { recalcularEn } from "./medidores";
import { ESTADOS_CON_REGISTROS, type EstadoLote } from "./estados-lote";
import { REFERENCIA_EXISTENCIA_INICIAL } from "./importacion";

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

/** Con qué referencia queda en el kardex la salida que compensa una existencia importada. */
export const REFERENCIA_REVERSION = "Reversión de importación de existencias";

/** Con qué motivo se anula una lectura importada al revertir. Una lectura nunca se borra. */
export const MOTIVO_REVERSION_LECTURA = "Reversión de la importación que la registró";

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
  User: [
    { modelo: "workOrder", campo: "assignedToId", que: "órdenes asignadas" },
    { modelo: "workOrderLabor", campo: "userId", que: "horas registradas" },
    { modelo: "workOrderComment", campo: "userId", que: "comentarios" },
    { modelo: "workRequest", campo: "requestedById", que: "solicitudes" },
    { modelo: "maintenancePlan", campo: "assignedToId", que: "planes asignados" },
    { modelo: "stockMovement", campo: "userId", que: "movimientos de almacén" },
    { modelo: "meterReading", campo: "userId", que: "lecturas" },
    { modelo: "materialRequest", campo: "solicitanteId", que: "requisiciones" },
    { modelo: "purchaseRequest", campo: "solicitanteId", que: "compras" },
    { modelo: "warehouse", campo: "responsableId", que: "almacenes a su cargo" },
    { modelo: "teamMember", campo: "userId", que: "equipos de trabajo" },
    { modelo: "passwordReset", campo: "userId", que: "enlaces de acceso generados" },
    { modelo: "auditLog", campo: "userId", que: "acciones en la bitácora" },
  ],
  Warehouse: [
    { modelo: "partStock", campo: "warehouseId", que: "existencias" },
    { modelo: "stockMovement", campo: "warehouseId", que: "movimientos" },
    { modelo: "materialRequest", campo: "warehouseId", que: "requisiciones" },
    { modelo: "purchaseRequest", campo: "warehouseId", que: "compras" },
    { modelo: "purchaseOrder", campo: "warehouseId", que: "órdenes de compra" },
    { modelo: "goodsReceipt", campo: "warehouseId", que: "recepciones" },
    { modelo: "inventoryCount", campo: "warehouseId", que: "conteos" },
    { modelo: "stockTransfer", campo: "origenId", que: "traspasos de salida" },
    { modelo: "stockTransfer", campo: "destinoId", que: "traspasos de entrada" },
  ],
  Meter: [
    { modelo: "planAsset", campo: "meterId", que: "planes por uso" },
    { modelo: "maintenancePlan", campo: "meterId", que: "planes por uso" },
  ],
  // Lecturas y existencias no se borran: se anulan o se compensan. Lo que las
  // bloquea no es una referencia sino lo que pasó después (ver abajo).
  MeterReading: [],
  StockMovement: [],
};

/** Entidad → modelo de Prisma. */
const MODELO: Record<string, string> = {
  Site: "site", Location: "location", Asset: "asset", Part: "part", Supplier: "supplier",
  MaintenancePlan: "maintenancePlan", AssetCategory: "assetCategory", PartCategory: "partCategory",
  PartUnit: "partUnit", FailureCode: "failureCode", RootCause: "rootCause", Specialty: "specialty",
  ExternalService: "externalService", Warehouse: "warehouse", User: "user", Meter: "meter",
  MeterReading: "meterReading", StockMovement: "stockMovement",
};

/**
 * En qué orden se borra: primero lo que depende, al final aquello de lo que se
 * depende. Un plan antes que su equipo, un equipo antes que su ubicación.
 */
const ORDEN_DE_BORRADO = [
  "StockMovement", "MeterReading", "MaintenancePlan", "Meter", "Part", "ExternalService", "Supplier", "Asset", "Location",
  "Warehouse", "User", "Site", "AssetCategory", "PartCategory", "PartUnit", "FailureCode", "RootCause", "Specialty",
];

type Delegado = {
  count: (a: unknown) => Promise<number>;
  findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
  deleteMany: (a: unknown) => Promise<unknown>;
};
const delegado = (db: Db | typeof prisma, modelo: string) => (db as unknown as Record<string, Delegado>)[modelo];

export type Bloqueado = { entidad: string; id: string; nombre: string; motivos: string[] };

/**
 * Qué se hace con cada registro que sí se puede revertir. Casi todo se borra;
 * una lectura se anula —nunca se borra una lectura— y una existencia se
 * compensa con una salida: el kardex no se reescribe.
 */
export type AccionReversion = "ELIMINAR" | "ANULAR" | "COMPENSAR";

export type DiagnosticoReversion = {
  aBorrar: Array<{ entidad: string; id: string; nombre: string; accion: AccionReversion }>;
  bloqueados: Bloqueado[];
  actualizados: Array<{ entidad: string; id: string; nombre: string; antes: Record<string, unknown> }>;
  /** En qué estado quedaría el lote y, en palabras, qué va a pasar. */
  estadoEsperado: EstadoLote;
  resultado: string;
};

const nombreDe = (r: Record<string, unknown> | null) =>
  String(r?.code ?? r?.name ?? r?.email ?? r?.description ?? r?.id ?? "—") +
  (r?.code && r?.name ? ` · ${r.name}` : "");

/** El registro con los datos que hacen falta para nombrarlo y revisarlo. */
async function buscar(entidad: string, id: string): Promise<Record<string, unknown> | null> {
  if (entidad === "StockMovement") {
    const m = await prisma.stockMovement.findUnique({
      where: { id },
      include: { part: { select: { code: true } }, warehouse: { select: { code: true } } },
    });
    if (m) return { ...m, name: `${m.part.code} en ${m.warehouse?.code ?? "—"}: ${m.quantity}` };
    // Un lote que AJUSTÓ una existencia apunta a la existencia, no a un movimiento.
    const e = await prisma.partStock.findUnique({
      where: { id },
      include: { part: { select: { code: true } }, warehouse: { select: { code: true } } },
    });
    return e ? { ...e, name: `${e.part.code} en ${e.warehouse.code}` } : null;
  }
  if (entidad === "MeterReading") {
    const l = await prisma.meterReading.findUnique({ where: { id }, include: { meter: { select: { name: true, asset: { select: { code: true } } } } } });
    return l ? { ...l, name: `${l.meter.asset.code} · ${l.meter.name}: ${l.value}` } : null;
  }
  const d = MODELO[entidad] ? delegado(prisma, MODELO[entidad]) : null;
  return d ? d.findUnique({ where: { id } }) : null;
}

/** Un registro que ya no está vivo no tiene nada que revertir. */
function vivo(entidad: string, r: Record<string, unknown> | null) {
  if (!r) return false;
  if (entidad === "MeterReading") return r.estado !== "ANULADA";
  return true;
}

const ACCION_DE: Record<string, AccionReversion> = { MeterReading: "ANULAR", StockMovement: "COMPENSAR" };

function describir(aBorrar: DiagnosticoReversion["aBorrar"], bloqueados: number, actualizados: number) {
  const n = (a: AccionReversion) => aBorrar.filter((x) => x.accion === a).length;
  const partes = [
    n("ELIMINAR") && `se eliminarán ${n("ELIMINAR")} registro(s)`,
    n("ANULAR") && `se anularán ${n("ANULAR")} lectura(s), que quedan en el historial del medidor`,
    n("COMPENSAR") && `se registrarán ${n("COMPENSAR")} salida(s) de almacén que regresan la existencia a como estaba`,
    bloqueados && `${bloqueados} se quedan porque ya se usaron`,
    actualizados && `${actualizados} actualizado(s) no se regresan: revíselos a mano`,
  ].filter(Boolean);
  if (!aBorrar.length) return `No se puede revertir nada: ${partes.join("; ") || "no queda ningún registro del lote"}.`;
  const t = partes.join("; ");
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}

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
  if (lote.estado === "REVERTIDA") throw new ErrorDeLote("Esta importación ya se revirtió");
  if (lote.estado === "FALLIDA") throw new ErrorDeLote("Esta importación falló y no creó nada: no hay qué revertir");
  if (lote.estado === "VALIDADA" || lote.estado === "CONFIRMADA") {
    throw new ErrorDeLote("Este archivo solo se validó: no creó nada, no hay qué revertir");
  }
  if (!(ESTADOS_CON_REGISTROS as string[]).includes(lote.estado)) {
    throw new ErrorDeLote("Esta importación no se puede revertir en su estado actual");
  }

  const creados = lote.registros.filter((r) => r.accion === "CREATED");
  const registro = new Map<string, Record<string, unknown> | null>();
  for (const c of creados) registro.set(c.entityId, await buscar(c.entity, c.entityId));

  // Lo que ya no existe —se borró o se anuló a mano, o una reversión parcial
  // anterior ya lo quitó— no se cuenta: ahí no hay nada que revertir.
  const vivos = creados.filter((c) => vivo(c.entity, registro.get(c.entityId) ?? null));
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
        // movimiento es uso real. Una existencia importada y ya compensada por
        // su reversión tampoco es uso, si la refacción quedó en cero.
        const propias = [...REFERENCIAS_PROPIAS];
        if (Number(reg.quantityOnHand ?? 0) === 0) propias.push(REFERENCIA_EXISTENCIA_INICIAL, REFERENCIA_REVERSION);
        const otros = await prisma.stockMovement.count({
          where: { partId: c.entityId, NOT: { reference: { in: propias } } },
        });
        if (otros > 0) lista.push(`${otros} movimientos de almacén`);
        else if (Number(reg.quantityOnHand ?? 0) !== 0 && await prisma.stockMovement.count({ where: { partId: c.entityId, reference: REFERENCIA_EXISTENCIA_INICIAL } })) {
          lista.push("tiene existencia importada: revierta primero esa importación de existencias");
        }
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
      if (c.entity === "User") {
        if (reg.lastLoginAt) lista.push("ya entró al sistema");
      }
      if (c.entity === "Meter") {
        // La lectura inicial va en el propio medidor; cualquier lectura
        // vigente es de alguien más.
        const lecturas = await prisma.meterReading.count({ where: { meterId: c.entityId, estado: { not: "ANULADA" } } });
        if (lecturas > 0) lista.push(`${lecturas} lecturas registradas`);
      }
      if (c.entity === "MeterReading") {
        // Anular una lectura con otras posteriores cambia los incrementos de
        // esas: ya no es deshacer la importación, es reescribir la historia.
        const despues = await prisma.meterReading.count({
          where: {
            meterId: String(reg.meterId), estado: { not: "ANULADA" }, readingAt: { gt: reg.readingAt as Date },
            id: { notIn: vivos.filter((v) => v.entity === "MeterReading" && candidatos.has(v.entityId)).map((v) => v.entityId) },
          },
        });
        if (despues > 0) lista.push(`${despues} lecturas posteriores en el mismo medidor`);
        if (reg.estado === "CORREGIDA") lista.push("se corrigió después de importarse");
      }
      if (c.entity === "StockMovement") {
        // La existencia importada ya se movió: una salida, un traspaso, un
        // conteo. Compensarla ahora dejaría el saldo mal.
        const despues = await prisma.stockMovement.count({
          where: {
            organizationId, partId: String(reg.partId), warehouseId: reg.warehouseId as string | null,
            createdAt: { gt: reg.createdAt as Date }, NOT: { id: c.entityId },
          },
        });
        if (despues > 0) lista.push(`${despues} movimientos posteriores de esa refacción en ese almacén`);
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
      nombre: nombreDe(await buscar(r.entity, r.entityId)),
      antes: JSON.parse(r.antes ?? "{}") as Record<string, unknown>,
    })),
  );

  const aBorrar = vivos.filter((c) => candidatos.has(c.entityId)).map((c) => ({
    entidad: c.entity, id: c.entityId, nombre: nombreDe(registro.get(c.entityId) ?? null),
    accion: ACCION_DE[c.entity] ?? ("ELIMINAR" as AccionReversion),
  }));
  const bloqueados = vivos.filter((c) => !candidatos.has(c.entityId))
    .map((c) => ({ entidad: c.entity, id: c.entityId, nombre: nombreDe(registro.get(c.entityId) ?? null), motivos: motivos.get(c.entityId) ?? [] }));

  const estadoEsperado: EstadoLote = !aBorrar.length
    ? (lote.estado === "REVERSION_PARCIAL" ? "REVERSION_PARCIAL" : "REVERSION_BLOQUEADA")
    : bloqueados.length ? "REVERSION_PARCIAL" : "REVERTIDA";

  return {
    aBorrar, bloqueados, actualizados, estadoEsperado,
    resultado: describir(aBorrar, bloqueados.length, actualizados.length),
  };
}

/** Deshace un registro con lo que la importación le creó alrededor. */
async function deshacer(db: Db, organizationId: string, entidad: string, id: string, userId: string) {
  if (entidad === "MeterReading") {
    const l = await db.meterReading.update({
      where: { id, organizationId },
      data: { estado: "ANULADA", correccionPorId: userId, correccionEl: new Date(), correccionMotivo: MOTIVO_REVERSION_LECTURA },
      select: { meterId: true },
    });
    await recalcularEn(db, organizationId, l.meterId);
    return;
  }
  if (entidad === "StockMovement") {
    const m = await db.stockMovement.findFirstOrThrow({ where: { id, organizationId } });
    await aplicarMovimiento({
      organizationId, partId: m.partId, warehouseId: m.warehouseId!, tipo: "OUT",
      cantidad: m.quantity, referencia: REFERENCIA_REVERSION, userId,
    }, db);
    return;
  }
  if (entidad === "Part") {
    await db.stockMovement.deleteMany({
      where: { partId: id, organizationId, reference: { in: [...REFERENCIAS_PROPIAS, REFERENCIA_EXISTENCIA_INICIAL, REFERENCIA_REVERSION] } },
    });
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
  if (entidad === "Meter") {
    // Solo pueden quedar lecturas anuladas: las vigentes lo bloquean.
    await db.meterReading.deleteMany({ where: { meterId: id, organizationId, estado: "ANULADA" } });
  }
  await delegado(db, MODELO[entidad]).deleteMany({ where: { id, organizationId } });
}

/**
 * Revierte el lote: deshace lo que se puede, deja lo que no, y dice qué quedó.
 *
 * Todo en una transacción: o se deshace el conjunto que el diagnóstico dijo, o
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
    // Queda asentado en el lote, no solo en la respuesta: el historial dice
    // que se intentó y por qué no se pudo.
    await prisma.importBatch.update({
      where: { id: p.loteId },
      data: {
        estado: diag.estadoEsperado,
        detalle: JSON.stringify({
          resultado: diag.resultado,
          bloqueados: diag.bloqueados.map((b) => ({ entidad: b.entidad, nombre: b.nombre, motivos: b.motivos })),
        }),
      },
    });
    await logAudit({
      organizationId: p.organizationId, userId: p.userId,
      entity: "ImportBatch", entityId: p.loteId, action: "IMPORT_REVERT_BLOCKED",
      summary: `No se revirtió nada: los ${diag.bloqueados.length} registros ya se usaron`,
      changes: { bloqueados: diag.bloqueados.length },
    });
    await emitirAviso({
      organizationId: p.organizationId, tipo: "IMPORTACION_TERMINADA", entidad: "ImportBatch", entidadId: p.loteId, version: "REVERSION_BLOQUEADA",
      titulo: "Reversión bloqueada", cuerpo: `Los ${diag.bloqueados.length} registros ya se usaron y se quedaron.`,
      enlace: "/import", contexto: { solicitanteId: p.userId },
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
  const aDeshacer = [...diag.aBorrar].sort((a, b) => orden(a.entidad) - orden(b.entidad));

  await prisma.$transaction(async (tx) => {
    for (const r of aDeshacer) await deshacer(tx, p.organizationId, r.entidad, r.id, p.userId);
    // Lo que se anuló o compensó sigue existiendo: se marca en el lote para
    // que una segunda reversión no lo vuelva a compensar.
    const persisten = aDeshacer.filter((r) => r.accion !== "ELIMINAR").map((r) => r.id);
    if (persisten.length) {
      await tx.importRecord.updateMany({
        where: { batchId: p.loteId, entityId: { in: persisten } },
        data: { accion: "REVERTED" },
      });
    }
    await tx.importBatch.update({
      where: { id: p.loteId },
      data: {
        estado: diag.estadoEsperado,
        revertidoAt: new Date(),
        revertidoPorId: p.userId,
        detalle: JSON.stringify({
          resultado: diag.resultado,
          borrados: aDeshacer.filter((r) => r.accion === "ELIMINAR").length,
          anuladas: aDeshacer.filter((r) => r.accion === "ANULAR").length,
          compensados: aDeshacer.filter((r) => r.accion === "COMPENSAR").length,
          bloqueados: diag.bloqueados.map((b) => ({ entidad: b.entidad, nombre: b.nombre, motivos: b.motivos })),
          actualizadosSinRevertir: diag.actualizados.length,
        }),
      },
    });
  }, { timeout: 5 * 60_000, maxWait: 20_000 });

  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "ImportBatch", entityId: p.loteId,
    action: diag.bloqueados.length ? "IMPORT_REVERT_PARTIAL" : "IMPORT_REVERTED",
    summary: `Reversión${diag.bloqueados.length ? " parcial" : ""}: ${diag.resultado}`,
    changes: { deshechos: aDeshacer.length, bloqueados: diag.bloqueados.length, actualizados: diag.actualizados.length },
  });

  return {
    borrados: aDeshacer.length, bloqueados: diag.bloqueados, actualizados: diag.actualizados,
    estado: diag.estadoEsperado, resultado: diag.resultado,
  };
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
