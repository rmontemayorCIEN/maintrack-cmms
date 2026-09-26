import { z } from "zod";

export const maxDuration = 300;
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { IaNoConfigurada, iaConfigurada, motivoLegible } from "@/lib/ia/cliente";
import { aterrizarPropuesta, proponerRecursosDePlan } from "@/lib/ia/recursos-plan";
import { agregarRefaccionesAActividades } from "@/lib/plan-tasks";
import { can } from "@/lib/rbac";

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
  /**
   * Refacciones que hay que DAR DE ALTA y colgar de su actividad.
   *
   * Van en la misma peticion que lo demas a proposito: dar de alta la pieza y
   * olvidarse de colgarla deja el catalogo mas grande y el plan igual de
   * mudo, que es la mitad del trabajo y ninguno del beneficio.
   */
  altas: z.array(z.object({
    taskId: z.string().min(1),
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(2).max(160),
    unit: z.string().trim().min(1).max(20),
    cantidad: z.coerce.number().positive().max(500),
  })).optional(),
});

/** Guarda lo que la persona aceptó. Agrega; nunca pisa lo ya capturado. */
export async function PUT(request: Request) {
  return withAuth("plan:write", async ({ user, orgId }) => {
    const d = guardar.parse(await request.json());
    const plan = await prisma.maintenancePlan.findFirst({
      where: { id: d.planId, organizationId: orgId }, select: { id: true, name: true },
    });
    if (!plan) return fail("Ese plan no existe en esta empresa", 404);

    /**
     * Primero el alta, luego el colgado: la refaccion tiene que existir antes
     * de poder referirla. Se exige ademas `inventory:write` —dar de alta en el
     * almacen no es lo mismo que editar un plan— y un codigo repetido se
     * rechaza con su nombre, no con un error de indice unico.
     */
    const creadas: Array<{ taskId: string; partId: string; cantidad: number }> = [];
    const ocupados: string[] = [];
    if (d.altas?.length) {
      if (!can(user.role, "inventory:write")) {
        return fail("Para dar de alta refacciones hace falta permiso de almacén. Pida que las capture quien lo tenga, o guarde solo lo demás.", 403);
      }
      const tareas = new Set(
        (await prisma.planTask.findMany({ where: { planId: plan.id, id: { in: d.altas.map((a) => a.taskId) } }, select: { id: true } })).map((t) => t.id),
      );
      for (const a of d.altas) {
        if (!tareas.has(a.taskId)) continue;
        const code = a.code.toUpperCase();
        const ya = await prisma.part.findFirst({ where: { organizationId: orgId, code }, select: { id: true } });
        if (ya) { ocupados.push(code); continue; }
        const nueva = await prisma.part.create({
          data: { organizationId: orgId, code, name: a.name, unit: a.unit, active: true },
          select: { id: true },
        });
        await logAudit({
          organizationId: orgId, userId: user.id, entity: "Part", entityId: nueva.id, action: "CREATED",
          summary: `${code} — ${a.name}`,
          changes: { origen: `alta desde el plan «${plan.name}»`, unidad: a.unit },
        });
        creadas.push({ taskId: a.taskId, partId: nueva.id, cantidad: a.cantidad });
      }
    }

    const todas = [
      ...d.lineas,
      ...creadas.map((c) => ({ taskId: c.taskId, refacciones: [{ partId: c.partId, cantidad: c.cantidad }] })),
    ];
    const r = await agregarRefaccionesAActividades(orgId, plan.id, todas);
    if (r.refacciones) {
      await logAudit({
        organizationId: orgId, userId: user.id, entity: "MaintenancePlan", entityId: plan.id,
        action: "UPDATED",
        summary: `${plan.name}: se cargó el consumo de ${r.actividades} actividad(es)`,
        changes: { refaccionesAgregadas: r.refacciones, origen: "propuesta de IA aceptada" },
      });
    }
    return ok({ ...r, creadas: creadas.length, ocupados });
  });
}
