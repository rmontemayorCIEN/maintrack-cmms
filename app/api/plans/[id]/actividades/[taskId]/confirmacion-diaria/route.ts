import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { esFrecuenciaDiaria } from "@/lib/plan-tasks";

const schema = z.object({
  accion: z.enum(["CONFIRMAR", "RETIRAR"]),
  motivo: z.string().trim().min(3, "Indique el motivo"),
});

type Params = { params: Promise<{ id: string; taskId: string }> };

/**
 * Confirma o retira la confirmacion de una rutina diaria, con motivo y rastro.
 * Retirarla no cambia la frecuencia: la actividad vuelve a verse como
 * advertencia de calidad hasta que alguien la confirme o la corrija.
 */
export async function POST(request: Request, { params }: Params) {
  const { id, taskId } = await params;
  return withAuth("plan:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const tarea = await prisma.planTask.findFirst({
      where: { id: taskId, planId: id, plan: { organizationId: orgId } },
      include: { plan: { select: { intervalDays: true, triggerType: true, name: true } } },
    });
    if (!tarea) return fail("Actividad no encontrada", 404);

    if (input.accion === "CONFIRMAR") {
      if (tarea.plan.triggerType !== "CALENDAR" || !esFrecuenciaDiaria(tarea, tarea.plan.intervalDays)) {
        return fail("La actividad no es diaria: no hay nada que confirmar", 422);
      }
      if (tarea.diariaConfirmadaEl) return ok({ tarea });
    } else if (!tarea.diariaConfirmadaEl) {
      return fail("La actividad no tiene confirmación que retirar", 422);
    }

    const actualizada = await prisma.planTask.update({
      where: { id: taskId },
      data: input.accion === "CONFIRMAR"
        ? { diariaConfirmadaPorId: user.id, diariaConfirmadaEl: new Date() }
        : { diariaConfirmadaPorId: null, diariaConfirmadaEl: null },
    });
    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "PlanTask",
      entityId: taskId,
      action: input.accion === "CONFIRMAR" ? "CONFIRMACION_DIARIA" : "CONFIRMACION_DIARIA_RETIRADA",
      summary: `${tarea.plan.name} · ${tarea.title}: ${input.accion === "CONFIRMAR" ? "rutina diaria confirmada" : "confirmación retirada"}. ${input.motivo}`,
      changes: {
        antes: { confirmadaPorId: tarea.diariaConfirmadaPorId, confirmadaEl: tarea.diariaConfirmadaEl?.toISOString() ?? null },
        motivo: input.motivo,
      },
    });
    return ok({ tarea: actualizada });
  });
}
