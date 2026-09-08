import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { COMPLEMENTO_IA, PLANES, nombreSolicitado, planDe, type ClavePlan, ORDEN_PLANES } from "@/lib/planes";
import { logAudit, notify } from "@/lib/audit";

const schema = z.object({
  /// Un plan, o el complemento de IA, que sigue el mismo camino de aprobacion.
  plan: z.enum(["PROFESSIONAL", "ENTERPRISE", "IA_AVANZADA"]),
  nota: z.string().trim().max(400).optional().nullable(),
});

/**
 * El cliente pide un cambio de plan.
 *
 * No se aplica solo: queda en cola para el operador de la plataforma, que lo
 * activa cuando el cobro esta acordado. Se avisa a los operadores para que no
 * dependa de que alguien entre a mirar el panel.
 */
export async function POST(request: Request) {
  return withAuth("billing:manage", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const actual = user.organization.plan;
    const esComplemento = input.plan === COMPLEMENTO_IA.clave;

    if (!esComplemento && input.plan === actual) {
      return fail("Ya tiene contratado ese plan", 409);
    }
    if (esComplemento) {
      if (user.organization.iaComplemento) return fail("Ya tiene contratado el complemento IA Avanzada", 409);
      if (planDe(actual).precioMensual === 0) {
        return fail("El complemento IA Avanzada se contrata sobre un plan de pago. Suba de plan primero.", 409);
      }
    }

    const pendiente = await prisma.planRequest.findFirst({
      where: { organizationId: orgId, status: "PENDING" },
      select: { id: true, planSolicitado: true },
    });
    if (pendiente) {
      return fail(
        `Ya hay una solicitud en curso para ${nombreSolicitado(pendiente.planSolicitado)}. Cancelela antes de pedir otra.`,
        409,
      );
    }

    const solicitud = await prisma.planRequest.create({
      data: {
        organizationId: orgId,
        requestedById: user.id,
        planActual: actual,
        planSolicitado: input.plan,
        nota: input.nota ?? null,
      },
      select: { id: true, planSolicitado: true, createdAt: true },
    });

    // Los operadores de la plataforma se enteran sin tener que revisar el panel.
    const operadores = await prisma.user.findMany({
      where: { isSuperAdmin: true, active: true },
      select: { id: true, organizationId: true },
    });
    const orden = ORDEN_PLANES;
    const sube = esComplemento || orden.indexOf(input.plan as ClavePlan) > orden.indexOf(actual as ClavePlan);

    await Promise.all(
      operadores.map((o) =>
        notify({
          organizationId: o.organizationId,
          userId: o.id,
          title: esComplemento
            ? `${user.organization.name} quiere contratar ${COMPLEMENTO_IA.nombre}`
            : `${user.organization.name} pide ${sube ? "subir" : "cambiar"} a ${PLANES[input.plan as ClavePlan].nombre}`,
          body: `Plan actual: ${planDe(actual).nombre}. ${input.nota ?? ""}`.trim(),
          link: "/clients",
          kind: sube ? "SUCCESS" : "INFO",
        }),
      ),
    );

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "PlanRequest",
      entityId: solicitud.id,
      action: "REQUESTED",
      summary: `Solicitud: ${planDe(actual).nombre} → ${nombreSolicitado(input.plan)}`,
    });

    return ok({ solicitud }, 201);
  });
}
