import { fail, ok, withAuth } from "@/lib/api";
import { generarDiagnostico } from "@/lib/ia/diagnostico";
import { IaNoConfigurada, iaConfigurada } from "@/lib/ia/cliente";
import { logAudit } from "@/lib/audit";

export const maxDuration = 300;

/**
 * Generacion manual del diagnostico.
 *
 * Cuesta dinero, asi que se pide el mismo permiso que administra la cuenta:
 * quien puede cambiar el plan puede gastar una operacion de la bolsa.
 */
export async function POST() {
  return withAuth("settings:write", async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("La funcion de inteligencia artificial no esta configurada en este servidor.", 503);
    }

    try {
      const r = await generarDiagnostico(
        { id: orgId, plan: user.organization.plan, iaComplemento: user.organization.iaComplemento, iaExtra: user.organization.iaExtra },
        { userId: user.id, origen: "MANUAL" },
      );
      if (!r.ok) return fail(r.motivo, 402);

      await logAudit({
        organizationId: orgId,
        userId: user.id,
        entity: "AiReport",
        entityId: r.reporte.id,
        action: "CREATED",
        summary: "Diagnostico generado manualmente",
      });
      return ok({ id: r.reporte.id }, 201);
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      const mensaje = error instanceof Error ? error.message : "No fue posible generar el diagnostico";
      return fail(mensaje, 502);
    }
  });
}
