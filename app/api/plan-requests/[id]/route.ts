import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/superadmin";
import { COMPLEMENTO_IA, nombreSolicitado, planDe } from "@/lib/planes";
import { logAudit, notify } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/** El cliente puede cancelar su propia solicitud mientras siga pendiente. */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("billing:manage", async ({ user, orgId }) => {
    const s = await prisma.planRequest.findFirst({
      where: { id, organizationId: orgId, status: "PENDING" },
      select: { id: true },
    });
    if (!s) return fail("Solicitud no encontrada o ya resuelta", 404);

    await prisma.planRequest.update({
      where: { id },
      data: { status: "DISMISSED", resolvedAt: new Date() },
    });
    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "PlanRequest", entityId: id,
      action: "CANCELLED", summary: "El cliente cancelo su solicitud de cambio de plan",
    });
    return ok({ success: true });
  });
}

const resolver = z.object({ accion: z.enum(["APLICAR", "DESCARTAR"]) });

/** El operador de la plataforma aplica o descarta la solicitud. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const { error, user } = await requireSuperAdmin();
  if (error) return error;

  const solicitud = await prisma.planRequest.findUnique({
    where: { id },
    include: { organization: { select: { id: true, name: true } } },
  });
  if (!solicitud) return fail("Solicitud no encontrada", 404);
  if (solicitud.status !== "PENDING") return fail("La solicitud ya fue resuelta", 409);

  const { accion } = resolver.parse(await request.json());

  const esComplemento = solicitud.planSolicitado === COMPLEMENTO_IA.clave;

  if (accion === "APLICAR") {
    await prisma.organization.update({
      where: { id: solicitud.organizationId },
      // El complemento se suma al plan; no lo reemplaza. Un cambio de plan, en
      // cambio, activa la cuenta y termina la prueba.
      data: esComplemento
        ? { iaComplemento: true }
        : { plan: solicitud.planSolicitado, status: "ACTIVE", trialEndsAt: null },
    });
  }

  await prisma.planRequest.update({
    where: { id },
    data: { status: accion === "APLICAR" ? "APPLIED" : "DISMISSED", resolvedAt: new Date() },
  });

  if (solicitud.requestedById) {
    await notify({
      organizationId: solicitud.organizationId,
      userId: solicitud.requestedById,
      title: accion === "APLICAR"
        ? esComplemento
          ? `${COMPLEMENTO_IA.nombre} ya esta activo`
          : `Su plan cambio a ${planDe(solicitud.planSolicitado).nombre}`
        : "Su solicitud no procedio",
      body: accion === "APLICAR"
        ? esComplemento
          ? `Tiene ${COMPLEMENTO_IA.operaciones} operaciones de IA al mes y todas las funciones disponibles.`
          : "Los nuevos limites ya estan activos."
        : "Contacte a su proveedor del servicio para mas detalles.",
      link: esComplemento ? "/diagnostico" : "/settings?s=suscripcion",
      kind: accion === "APLICAR" ? "SUCCESS" : "WARNING",
    });
  }

  await logAudit({
    organizationId: user.organizacionPropia.id,
    userId: user.id,
    entity: "PlanRequest",
    entityId: id,
    action: accion === "APLICAR" ? "APPLIED" : "DISMISSED",
    summary: `${solicitud.organization.name}: ${planDe(solicitud.planActual).nombre} → ${nombreSolicitado(solicitud.planSolicitado)}`,
  });

  return ok({ success: true });
}
