import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, parseDate, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { avisarCambiosDeOrden } from "@/lib/avisos/ordenes";
import { recalcWorkOrder } from "@/lib/workorders";
import { esReprogramacion, revisarProgramacion, validarDatosDeProgramacion } from "@/lib/programacion";
import { OPEN_STATUSES } from "@/lib/constants";
import { motivoValido } from "@/lib/reglas-ot";

const patchSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().nullable().optional(),
  maintenanceType: z.enum(["PREVENTIVE", "CORRECTIVE", "PREDICTIVE", "INSPECTION", "SAFETY", "IMPROVEMENT"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  assetId: z.string().nullable().optional(),
  requiresShutdown: z.boolean().optional(),
  procedure: z.string().nullable().optional(),
  safetyNotes: z.string().nullable().optional(),
  assignedToId: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  scheduledStart: z.string().nullable().optional(),
  estimatedHours: z.coerce.number().min(0).optional(),
  otherCost: z.coerce.number().min(0).optional(),
  rootCauseId: z.string().nullable().optional(),
  resolution: z.string().nullable().optional(),
  failureCodeId: z.string().nullable().optional(),
  downtimeMinutes: z.coerce.number().min(0).optional(),
  meterValue: z.coerce.number().nullable().optional(),
  /** Por que cambia la fecha compromiso de una orden que ya estaba programada. */
  motivoReprogramacion: z.string().trim().max(500).nullable().optional(),
  /** Quien programa acepta programar en dia no laborable o sobre la capacidad. */
  aceptarAdvertencias: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth(null, async ({ orgId }) => {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id, organizationId: orgId },
      include: {
        asset: true,
        assignedTo: true,
        tasks: { orderBy: { position: "asc" } },
        labor: { include: { user: true } },
        partsUsed: { include: { part: true } },
        servicesUsed: { include: { service: true, supplier: true } },
        comments: { include: { user: true }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!workOrder) return fail("Orden de trabajo no encontrada", 404);
    return ok({ workOrder });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("workorder:write", async ({ user, orgId }) => {
    const existing = await prisma.workOrder.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return fail("Orden de trabajo no encontrada", 404);

    const input = patchSchema.parse(await request.json());
    if (["CLOSED", "CANCELLED"].includes(existing.status)) {
      return fail("Una orden cerrada o cancelada ya no se edita. Su historial es el respaldo de lo que costo.", 409);
    }

    const { motivoReprogramacion, aceptarAdvertencias, ...campos } = input;
    const data: Record<string, unknown> = { ...campos };

    // Cambiar de activo arrastra su sitio y su ubicacion: son del equipo, no de
    // la orden, y dejarlos desalineados haria que el trabajo apareciera en un
    // lugar donde el equipo no esta.
    if (input.assetId !== undefined) {
      if (input.assetId) {
        const activo = await prisma.asset.findFirst({
          where: { id: input.assetId, organizationId: orgId },
          select: { id: true, siteId: true, locationId: true },
        });
        if (!activo) return fail("Activo no encontrado", 404);
        data.assetId = activo.id;
        data.siteId = activo.siteId;
        data.locationId = activo.locationId;
      } else {
        data.assetId = null;
      }
    }

    // El responsable y la cuadrilla se validan contra la organizacion.
    if (input.assignedToId) {
      const responsable = await prisma.user.findFirst({
        // Responsable = quien ejecuta: un solicitante o una cuenta de consulta no pueden iniciarla.
        where: { id: input.assignedToId, organizationId: orgId, active: true, role: { in: ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN"] } },
        select: { id: true },
      });
      if (!responsable) return fail("El responsable indicado no existe, está inactivo o su rol no ejecuta órdenes", 404);
    }
    if (input.teamId) {
      const cuadrilla = await prisma.team.findFirst({
        where: { id: input.teamId, organizationId: orgId },
        select: { id: true },
      });
      if (!cuadrilla) return fail("La cuadrilla indicada no existe", 404);
    }
    if (input.dueDate !== undefined) data.dueDate = parseDate(input.dueDate);
    if (input.scheduledStart !== undefined) data.scheduledStart = parseDate(input.scheduledStart);
    if (input.assignedToId !== undefined) {
      data.assignedToId = input.assignedToId || null;
      // El estado sigue al responsable: «asignada» sin nadie, o «abierta» con
      // alguien, eran estados que se contradecian con la pantalla.
      if (input.assignedToId && existing.status === "OPEN") data.status = "ASSIGNED";
      if (!input.assignedToId && existing.status === "ASSIGNED") data.status = "OPEN";
    }

    // ── Programacion ────────────────────────────────────────────────────
    const dueDate = data.dueDate !== undefined ? (data.dueDate as Date | null) : existing.dueDate;
    const scheduledStart = data.scheduledStart !== undefined ? (data.scheduledStart as Date | null) : existing.scheduledStart;
    const horas = input.estimatedHours ?? existing.estimatedHours;
    const responsableId = input.assignedToId !== undefined ? input.assignedToId || null : existing.assignedToId;
    validarDatosDeProgramacion({
      estimatedHours: input.estimatedHours !== undefined ? input.estimatedHours : undefined,
      dueDate, scheduledStart,
    });

    const abierta = OPEN_STATUSES.includes(existing.status);
    const reprograma = input.dueDate !== undefined &&
      esReprogramacion({ status: existing.status, fechaAnterior: existing.dueDate, fechaNueva: dueDate });
    if (reprograma && !motivoValido(motivoReprogramacion)) {
      return fail("Indique el motivo de la reprogramación.", 422, { pideMotivoReprogramacion: true });
    }

    const tocaCarga = input.dueDate !== undefined || input.assignedToId !== undefined || input.estimatedHours !== undefined;
    if (abierta && tocaCarga && !aceptarAdvertencias) {
      const revision = await revisarProgramacion({ organizationId: orgId, fecha: dueDate, responsableId, horas, ordenId: id });
      if (revision.advertencias.length) {
        return fail(revision.advertencias.join(" "), 409, { programacion: revision });
      }
    }

    await prisma.workOrder.update({ where: { id }, data });
    const workOrder = await recalcWorkOrder(id);
    // Cambió el responsable o la prioridad: se avisa a quien corresponde.
    await avisarCambiosDeOrden(orgId, existing);

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "WorkOrder",
      entityId: id,
      action: "UPDATED",
      summary: `${existing.number} actualizada${aceptarAdvertencias ? " (con advertencias de programación aceptadas)" : ""}`,
      changes: campos,
    });
    if (reprograma) {
      const texto = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "sin fecha");
      await logAudit({
        organizationId: orgId,
        userId: user.id,
        entity: "WorkOrder",
        entityId: id,
        action: "RESCHEDULED",
        summary: `${existing.number}: ${texto(existing.dueDate)} → ${texto(dueDate)} — ${motivoReprogramacion!.trim()}`,
        changes: { antes: existing.dueDate, despues: dueDate, motivo: motivoReprogramacion!.trim() },
      });
    }

    return ok({ workOrder });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("workorder:close", async ({ user, orgId }) => {
    const existing = await prisma.workOrder.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return fail("Orden de trabajo no encontrada", 404);
    if (["COMPLETED", "CLOSED"].includes(existing.status)) {
      return fail("No se puede eliminar una OT completada; use cancelar", 409);
    }
    /**
     * Antes de borrar, liberar las solicitudes que atendia.
     *
     * La relacion no cascadea: al borrar la orden, workOrderId queda apuntando
     * a algo que ya no existe y la solicitud se vuelve inatendible. Mismo caso
     * que al cancelar.
     */
    await prisma.workRequest.updateMany({
      where: { workOrderId: id },
      data: { status: "PENDING", workOrderId: null, reviewedAt: null, reviewedById: null },
    });
    await prisma.workOrder.delete({ where: { id } });
    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "WorkOrder",
      entityId: id,
      action: "DELETED",
      summary: `${existing.number} eliminada`,
    });
    return ok({ success: true });
  });
}
