import { prisma } from "./db";
import { ErrorDeAlmacen, almacenPorOmision, aplicarMovimiento } from "./almacen";
import { STATUS_TRANSITIONS } from "./constants";
import { rollForwardPlan } from "./scheduler";
import { logAudit, notify } from "./audit";

/**
 * Recalcula horas y costos de una OT.
 *
 * El costo de un trabajo tiene cuatro componentes: la mano de obra propia, las
 * refacciones del almacen, los servicios que se subcontrataron a proveedores y
 * un "otros" que se captura a mano (fletes, viaticos, consumibles menores).
 */
export async function recalcWorkOrder(workOrderId: string) {
  const [labor, parts, services, wo] = await Promise.all([
    prisma.workOrderLabor.findMany({ where: { workOrderId } }),
    prisma.workOrderPart.findMany({ where: { workOrderId } }),
    prisma.workOrderService.findMany({ where: { workOrderId } }),
    prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { otherCost: true } }),
  ]);

  const actualHours = labor.reduce((s, l) => s + l.hours, 0);
  const laborCost = labor.reduce((s, l) => s + l.cost, 0);
  const partsCost = parts.reduce((s, p) => s + p.cost, 0);
  const serviceCost = services.reduce((s, x) => s + x.cost, 0);
  const otherCost = wo?.otherCost ?? 0;

  return prisma.workOrder.update({
    where: { id: workOrderId },
    data: {
      actualHours,
      laborCost,
      partsCost,
      serviceCost,
      totalCost: laborCost + partsCost + serviceCost + otherCost,
    },
  });
}

export function canTransition(from: string, to: string) {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Cambia el estado de una OT aplicando los efectos colaterales del flujo:
 * marcas de tiempo, registro de paro del activo, cierre del plan preventivo,
 * resolucion de alertas predictivas y notificaciones.
 */
export async function transitionWorkOrder(params: {
  workOrderId: string;
  to: string;
  userId: string;
  organizationId: string;
  resolution?: string;
  rootCauseId?: string | null;
  failureCodeId?: string | null;
  downtimeMinutes?: number;
}) {
  const wo = await prisma.workOrder.findFirst({
    where: { id: params.workOrderId, organizationId: params.organizationId },
    include: { tasks: true },
  });
  if (!wo) throw new Error("Orden de trabajo no encontrada");
  if (wo.status === params.to) return wo;
  if (!canTransition(wo.status, params.to)) {
    throw new Error(`Transicion no permitida: ${wo.status} → ${params.to}`);
  }

  if (params.to === "COMPLETED") {
    // Una OT completa no deja actividades en el aire. Cada una tiene que estar
    // hecha o liberada con motivo; la liberada se va al backlog y se retoma
    // despues. Antes solo se revisaban las obligatorias, asi que una actividad
    // opcional sin capturar se quedaba en `done: false` para siempre dentro de
    // una orden cerrada: ni hecha, ni pendiente para nadie, ni visible.
    const abiertas = wo.tasks.filter((t) => !t.done && !t.liberadaAt);
    if (abiertas.length) {
      throw new Error(
        `Quedan ${abiertas.length} actividad(es) sin resolver. ` +
          `Marque cada una como hecha, o liberela indicando por que no se pudo hacer.`,
      );
    }
  }

  const now = new Date();
  const data: Record<string, unknown> = { status: params.to };

  if (params.to === "IN_PROGRESS" && !wo.startedAt) {
    data.startedAt = now;
    data.responseMinutes = Math.round((now.getTime() - wo.createdAt.getTime()) / 60000);
  }
  if (params.to === "COMPLETED") {
    data.completedAt = now;
    if (params.resolution) data.resolution = params.resolution;
    if (params.rootCauseId !== undefined) data.rootCauseId = params.rootCauseId;
    if (params.failureCodeId !== undefined) data.failureCodeId = params.failureCodeId;
    if (params.downtimeMinutes !== undefined) data.downtimeMinutes = params.downtimeMinutes;
  }
  if (params.to === "CLOSED") data.closedAt = now;

  const updated = await prisma.workOrder.update({ where: { id: wo.id }, data });

  if (params.to === "COMPLETED") {
    if (wo.assetId) {
      const minutes = params.downtimeMinutes ?? wo.downtimeMinutes;
      if (minutes > 0) {
        await prisma.downtimeEvent.create({
          data: {
            assetId: wo.assetId,
            workOrderId: wo.id,
            startedAt: wo.startedAt ?? wo.createdAt,
            endedAt: now,
            minutes,
            planned: wo.maintenanceType === "PREVENTIVE" || wo.maintenanceType === "INSPECTION",
            reason: wo.title,
          },
        });
      }
      await prisma.asset.update({
        where: { id: wo.assetId },
        data: { status: "OPERATIONAL" },
      });
    }
    // Se le pasa el activo: el plan puede servir a varios y solo avanza el de este.
    // Recalcular al completar, aunque las rutas ya lo hagan al capturar.
    //
    // Aqui el costo deja de ser un dato en movimiento y se vuelve historia del
    // equipo: es lo que despues decide si se repara otra vez o se reemplaza.
    // Si algun camino escribiera horas o refacciones sin recalcular, el numero
    // quedaria mal para siempre y nadie se enteraria.
    await recalcWorkOrder(wo.id);

    if (wo.planId) await rollForwardPlan(wo.planId, now, wo.meterValue, wo.assetId);

    await prisma.predictiveAlert.updateMany({
      where: { workOrderId: wo.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      data: { status: "RESOLVED" },
    });

    if (wo.createdById && wo.createdById !== params.userId) {
      await notify({
        organizationId: params.organizationId,
        userId: wo.createdById,
        title: `${wo.number} completada`,
        body: wo.title,
        link: `/work-orders/${wo.id}`,
        kind: "SUCCESS",
      });
    }
  }

  if (params.to === "IN_PROGRESS" && wo.assetId && wo.requiresShutdown) {
    await prisma.asset.update({ where: { id: wo.assetId }, data: { status: "DOWN" } });
  }

  await logAudit({
    organizationId: params.organizationId,
    userId: params.userId,
    entity: "WorkOrder",
    entityId: wo.id,
    action: "STATUS_CHANGED",
    summary: `${wo.number}: ${wo.status} → ${params.to}`,
    changes: { from: wo.status, to: params.to },
  });

  return updated;
}

/** Consume refacciones del almacen y las carga a la OT. */
export async function consumePart(params: {
  organizationId: string;
  workOrderId: string;
  partId: string;
  quantity: number;
  userId: string;
  /** De que almacen sale. Sin indicar, el general de la cuenta. */
  warehouseId?: string | null;
}) {
  const part = await prisma.part.findFirst({
    where: { id: params.partId, organizationId: params.organizationId },
  });
  if (!part) throw new Error("Refaccion no encontrada");
  if (part.quantityOnHand < params.quantity) {
    throw new Error(`Existencia insuficiente: ${part.quantityOnHand} ${part.unit} disponibles`);
  }

  const cost = params.quantity * part.unitCost;

  // El almacen del que sale: el que se indique, o el de la cuenta. El descuento
  // del saldo y el kardex los hace aplicarMovimiento, que es el unico lugar que
  // sabe hacerlo bien.
  const almacen = params.warehouseId ?? (await almacenPorOmision(params.organizationId))?.id;
  if (!almacen) throw new ErrorDeAlmacen("La cuenta no tiene ningun almacen activo");

  const balance = await prisma.$transaction(async (tx) => {
    await tx.workOrderPart.create({
      data: {
        workOrderId: params.workOrderId,
        partId: part.id,
        quantity: params.quantity,
        unitCost: part.unitCost,
        cost,
      },
    });
    return aplicarMovimiento(
      {
        organizationId: params.organizationId,
        partId: part.id,
        warehouseId: almacen,
        tipo: "OUT",
        cantidad: params.quantity,
        workOrderId: params.workOrderId,
        userId: params.userId,
        referencia: "Consumo en OT",
      },
      tx,
    );
  });

  if (balance <= part.minQuantity) {
    const buyers = await prisma.user.findMany({
      where: { organizationId: params.organizationId, role: { in: ["OWNER", "ADMIN", "SUPERVISOR"] }, active: true },
      select: { id: true },
    });
    await Promise.all(
      buyers.map((b) =>
        notify({
          organizationId: params.organizationId,
          userId: b.id,
          title: `Stock minimo: ${part.name}`,
          body: `Quedan ${balance} ${part.unit} (minimo ${part.minQuantity}).`,
          link: "/inventory",
          kind: "WARNING",
        }),
      ),
    );
  }

  return recalcWorkOrder(params.workOrderId);
}
