/**
 * Las situaciones que el sistema vigila, cada una definida UNA vez.
 *
 * Las lee el detector (para avisar), la reconciliación (para saber si ya se
 * resolvió) y los resúmenes (para listarlas). Si cada uno tuviera su propia
 * consulta, el aviso diría «agotada» mientras la reconciliación ya la da por
 * repuesta.
 */
import { prisma } from "../db";

export const OT_ACTIVAS = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"];
const HORA = 3_600_000;

/**
 * Refacción crítica: la usa un plan de un equipo de criticidad A, o detiene
 * una actividad de una orden abierta. Agotada: existencia en cero o menos.
 * Regla fija, sin marca manual: no depende de que alguien se acuerde de marcarla.
 */
export async function refaccionesCriticasAgotadas(organizationId: string) {
  const agotadas = await prisma.part.findMany({
    where: { organizationId, active: true, quantityOnHand: { lte: 0 } },
    select: { id: true, code: true, name: true },
    take: 2000,
  });
  if (!agotadas.length) return [];
  const ids = agotadas.map((p) => p.id);
  const [enPlanesA, bloqueando] = await Promise.all([
    prisma.planTaskPart.findMany({
      where: { partId: { in: ids }, task: { plan: { active: true, organizationId, OR: [{ asset: { criticality: "A" } }, { asignaciones: { some: { active: true, asset: { criticality: "A" } } } }] } } },
      select: { partId: true },
    }),
    prisma.workOrderTask.findMany({
      where: { bloqueadaPorPartId: { in: ids }, workOrder: { organizationId, status: { in: OT_ACTIVAS } } },
      select: { bloqueadaPorPartId: true },
    }),
  ]);
  const deA = new Set(enPlanesA.map((x) => x.partId));
  const detienen = new Map<string, number>();
  for (const b of bloqueando) detienen.set(b.bloqueadaPorPartId!, (detienen.get(b.bloqueadaPorPartId!) ?? 0) + 1);
  return agotadas
    .filter((p) => deA.has(p.id) || detienen.has(p.id))
    .map((p) => ({
      ...p,
      detieneTrabajo: detienen.has(p.id),
      motivo: detienen.has(p.id)
        ? `Detiene ${detienen.get(p.id)} actividad(es) de órdenes abiertas.`
        : "La usa el preventivo de un equipo crítico.",
    }));
}

/** Refacciones activas con mínimo, en o bajo él. */
export async function refaccionesBajoMinimo(organizationId: string) {
  // La comparacion entre las dos columnas la hace la base. Antes se traian
  // cinco mil refacciones para filtrarlas en memoria, en cada carga del
  // inicio de la direccion, de administracion y de compras: la que estaba
  // bajo minimo en el lugar 5001 ademas no salia nunca.
  return prisma.part.findMany({
    where: {
      organizationId, active: true, minQuantity: { gt: 0 },
      quantityOnHand: { lte: prisma.part.fields.minQuantity },
    },
    select: { id: true, code: true, name: true, quantityOnHand: true, minQuantity: true, unit: true },
    orderBy: { code: "asc" },
    take: 200,
  });
}

/** Equipos de criticidad A, en servicio, sin ningún plan preventivo activo. */
export function criticosSinPlan(organizationId: string) {
  return prisma.asset.findMany({
    where: { organizationId, criticality: "A", status: { not: "RETIRED" }, planesAsignados: { none: { active: true } } },
    select: { code: true, name: true },
    orderBy: { code: "asc" },
    take: 200,
  });
}

/** Medidores que alimentan planes por uso y no tienen lectura en 7 días. */
export function medidoresSinLectura(organizationId: string, ahora: Date) {
  const sieteDias = new Date(ahora.getTime() - 7 * 24 * HORA);
  return prisma.meter.findMany({
    where: {
      organizationId,
      asignaciones: { some: { active: true, plan: { active: true, triggerType: "METER" } } },
      OR: [{ lastReadingAt: null }, { lastReadingAt: { lt: sieteDias } }],
    },
    select: { name: true, lastReadingAt: true, asset: { select: { code: true } } },
    take: 200,
  });
}

/**
 * Órdenes de compra que siguen esperando mercancía, con fecha prometida.
 *
 * La recepción actualiza la requisición (RECIBIDA_PARCIAL, RECIBIDA), no la
 * orden de compra: una orden «ABIERTA» cuya requisición ya se recibió
 * completa NO sigue esperando nada. Por eso se mira también la requisición.
 */
const COMPRA_TERMINADA = ["RECIBIDA", "CERRADA", "CANCELADA", "RECHAZADA"];
export function ordenesCompraEnEspera(organizationId: string) {
  return prisma.purchaseOrder.findMany({
    where: {
      organizationId, estado: { in: ["ABIERTA", "RECIBIDA_PARCIAL"] }, fechaPrometida: { not: null },
      purchaseRequest: { estado: { notIn: COMPRA_TERMINADA } },
    },
    select: {
      id: true, folio: true, estado: true, fechaPrometida: true, warehouseId: true, purchaseRequestId: true,
      supplier: { select: { name: true } }, purchaseRequest: { select: { estado: true } },
    },
    take: 1000,
  });
}
export const compraTerminada = (estadoRequisicion: string) => COMPRA_TERMINADA.includes(estadoRequisicion);
