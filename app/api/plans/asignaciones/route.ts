import { z } from "zod";
import { diaLocal } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeAsignacion, asignarPlan, quitarAsignacion } from "@/lib/asignaciones";
import { logAudit } from "@/lib/audit";

/** Los equipos a los que se aplica un plan, con la fecha de cada uno. */
export async function GET(request: Request) {
  return withAuth(null, async ({ orgId }) => {
    const planId = new URL(request.url).searchParams.get("planId");
    if (!planId) return fail("Falta el plan", 400);
    const asignaciones = await prisma.planAsset.findMany({
      where: { organizationId: orgId, planId },
      orderBy: { nextDueDate: "asc" },
      select: {
        id: true, nextDueDate: true, lastCompletedAt: true, active: true, meterId: true,
        asset: { select: { id: true, code: true, name: true, criticality: true } },
      },
    });
    // Las actividades del plan, para dar una fecha distinta a cada una al asignar.
    const plan = await prisma.maintenancePlan.findFirst({
      where: { id: planId, organizationId: orgId },
      select: { tasks: { orderBy: { position: "asc" }, select: { id: true, title: true } } },
    });
    return ok({ asignaciones, actividades: plan?.tasks ?? [] });
  });
}

const crear = z.object({
  planId: z.string().min(1),
  assetIds: z.array(z.string().min(1)).min(1),
  /// Cada equipo arranca por separado: es lo que pasa en la realidad. Con
  /// `escalonar` el sistema reparte las fechas para no parar todo el mismo dia.
  escalonar: z.boolean().default(true),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Si `desde` es la ultima ejecucion (y no el arranque). */
  desdeEsUltima: z.boolean().optional(),
  /**
   * Fechas distintas para actividades puntuales. Las que no vengan usan la
   * fecha comun. Se aplican igual a todos los equipos elegidos.
   */
  porActividad: z
    .array(z.object({
      planTaskId: z.string().min(1),
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      esUltima: z.boolean(),
    }))
    .default([]),
});

export async function POST(request: Request) {
  return withAuth("plan:write", async ({ user, orgId }) => {
    const input = crear.parse(await request.json());
    const desde = input.desde ? diaLocal(input.desde)! : null;
    try {
      const r = await asignarPlan({
        organizationId: orgId,
        planId: input.planId,
        equipos: input.assetIds.map((assetId) => ({
          assetId, desde, desdeEsUltima: input.desdeEsUltima ?? false,
          porActividad: input.porActividad.map((x) => ({
            planTaskId: x.planTaskId,
            fecha: diaLocal(x.fecha)!,
            esUltima: x.esUltima,
          })),
        })),
        escalonarAuto: input.escalonar && !desde,
        userId: user.id,
      });
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "MaintenancePlan", entityId: input.planId, action: "UPDATED",
        summary: `Plan aplicado a ${r.creadas.length} equipo(s): ${r.creadas.join(", ")}`.slice(0, 300),
      });
      return ok(r, 201);
    } catch (e) {
      if (e instanceof ErrorDeAsignacion) return fail(e.message, e.codigo);
      throw e;
    }
  });
}

export async function DELETE(request: Request) {
  return withAuth("plan:write", async ({ user, orgId }) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(await request.json());
    try {
      await quitarAsignacion(orgId, id);
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "PlanAsset", entityId: id, action: "DELETED",
        summary: "Equipo quitado del plan",
      });
      return ok({ success: true });
    } catch (e) {
      if (e instanceof ErrorDeAsignacion) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
