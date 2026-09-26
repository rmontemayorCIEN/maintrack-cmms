import { z } from "zod";

export const maxDuration = 300;
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { IaNoConfigurada, iaConfigurada, motivoLegible } from "@/lib/ia/cliente";
import { aterrizarPropuesta, proponerRecursosDePlan } from "@/lib/ia/recursos-plan";
import { agregarRefaccionesAActividades } from "@/lib/plan-tasks";

const pedir = z.object({ planId: z.string().min(1) });

/**
 * Propone que consume cada actividad de un plan que ya existe.
 *
 * Solo propone: lo que se guarda pasa por el PUT, con lo que la persona acepto.
 */
export async function POST(request: Request) {
  return withAuth("plan:write", async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("La función de inteligencia artificial no está configurada en este servidor.", 503);
    }
    const { planId } = pedir.parse(await request.json());

    let r;
    try {
      r = await proponerRecursosDePlan(
        { id: orgId, plan: user.organization.plan, iaComplemento: user.organization.iaComplemento, iaExtra: user.organization.iaExtra },
        { planId, userId: user.id },
      );
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(motivoLegible(error), 502);
    }
    // El motivo ya viene redactado para la persona: se muestra tal cual.
    if (!r.ok) return fail(r.motivo, 422);

    const catalogo = await prisma.part.findMany({
      where: { organizationId: orgId, active: true },
      select: { id: true, code: true, name: true, unit: true },
    });
    const aterrizada = aterrizarPropuesta(r.propuesta, r.actividades, catalogo);
    return ok({ ...aterrizada, costoUsd: r.costoUsd });
  });
}

const guardar = z.object({
  planId: z.string().min(1),
  lineas: z.array(z.object({
    taskId: z.string().min(1),
    refacciones: z.array(z.object({
      partId: z.string().min(1),
      // Limite duro AL ESCRIBIR, no al leer del modelo: recortar aqui no tira
      // trabajo ya pagado.
      cantidad: z.coerce.number().positive().max(500),
    })),
  })),
});

/** Guarda lo que la persona aceptó. Agrega; nunca pisa lo ya capturado. */
export async function PUT(request: Request) {
  return withAuth("plan:write", async ({ user, orgId }) => {
    const d = guardar.parse(await request.json());
    const plan = await prisma.maintenancePlan.findFirst({
      where: { id: d.planId, organizationId: orgId }, select: { id: true, name: true },
    });
    if (!plan) return fail("Ese plan no existe en esta empresa", 404);

    const r = await agregarRefaccionesAActividades(orgId, plan.id, d.lineas);
    if (r.refacciones) {
      await logAudit({
        organizationId: orgId, userId: user.id, entity: "MaintenancePlan", entityId: plan.id,
        action: "UPDATED",
        summary: `${plan.name}: se cargó el consumo de ${r.actividades} actividad(es)`,
        changes: { refaccionesAgregadas: r.refacciones, origen: "propuesta de IA aceptada" },
      });
    }
    return ok(r);
  });
}
