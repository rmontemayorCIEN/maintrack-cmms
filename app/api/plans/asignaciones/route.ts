import { z } from "zod";
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
        id: true, nextDueDate: true, lastCompletedAt: true, active: true,
        asset: { select: { id: true, code: true, name: true, criticality: true } },
      },
    });
    return ok({ asignaciones });
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
});

export async function POST(request: Request) {
  return withAuth("plan:write", async ({ user, orgId }) => {
    const input = crear.parse(await request.json());
    const desde = input.desde ? new Date(`${input.desde}T00:00:00`) : null;
    try {
      const r = await asignarPlan({
        organizationId: orgId,
        planId: input.planId,
        equipos: input.assetIds.map((assetId) => ({
          assetId, desde, desdeEsUltima: input.desdeEsUltima ?? false,
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
