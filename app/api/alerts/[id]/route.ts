import { z } from "zod";
import { avisarNuevaOrden } from "@/lib/avisos/ordenes";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { nextWorkOrderNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import { validarNormalizacion } from "@/lib/predictive";
import { reconciliar } from "@/lib/avisos/condiciones";
import { jornada } from "@/lib/agenda";
import { siguienteHabil } from "@/lib/scheduler";

const schema = z.object({
  action: z.enum(["ACKNOWLEDGE", "DISMISS", "RESOLVE", "CREATE_WORK_ORDER", "VALIDATE_NORMALIZATION"]),
  nota: z.string().trim().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("predictive:write", async ({ user, orgId }) => {
    const alert = await prisma.predictiveAlert.findFirst({
      where: { id, organizationId: orgId },
      include: { asset: true, sensor: true },
    });
    if (!alert) return fail("Alerta no encontrada", 404);

    const input = schema.parse(await request.json());

    if (input.action === "CREATE_WORK_ORDER") {
      if (alert.workOrderId) return fail("La alerta ya tiene una OT asociada", 409);
      const number = await nextWorkOrderNumber(orgId);
      const cruce = alert.fechaCruceCritico && alert.fechaCruceCritico > new Date()
        ? alert.fechaCruceCritico
        : new Date(Date.now() + 7 * 86_400_000);
      const j = await jornada(orgId, new Date(), new Date(cruce.getTime() + 20 * 86_400_000));
      const venceEl = siguienteHabil(cruce, j) ?? cruce;
      const workOrder = await prisma.workOrder.create({
        data: {
          organizationId: orgId,
          number,
          title: `Intervencion predictiva: ${alert.asset.name}`,
          description: alert.message,
          maintenanceType: "PREDICTIVE",
          status: "OPEN",
          priority: alert.severity === "CRITICAL" ? "CRITICAL" : "HIGH",
          assetId: alert.assetId,
          siteId: alert.asset.siteId,
          locationId: alert.asset.locationId,
          // El cruce critico solo si todavia es futuro: una fecha pasada crearia
          // una orden que nace vencida por una proyeccion que ya no aplica.
          //
          // Y se recorre al siguiente dia habil, igual que hace el programador
          // de preventivos. Sin esto la orden podia nacer con vencimiento en
          // sabado: nadie la iba a hacer ese dia, el lunes ya salia en rojo, y
          // ademas el propio sistema bloqueaba su asignacion —«el sabado 10 de
          // oct no es dia laborable»— por una fecha que habia puesto el.
          dueDate: venceEl,
          estimatedHours: 3,
          createdById: user.id,
        },
      });
      await prisma.predictiveAlert.update({
        where: { id },
        data: { workOrderId: workOrder.id, status: "ACKNOWLEDGED", acknowledgedById: user.id, acknowledgedAt: new Date() },
      });
      await avisarNuevaOrden(orgId, workOrder.id);
      return ok({ workOrder }, 201);
    }

    /**
     * Validar la normalizacion: el punto regreso a normal y alguien confirma
     * que es real (no un sensor desconectado ni una lectura suelta). Solo
     * procede si el sistema detecto la normalizacion.
     */
    /**
     * «Resolver» es lo mismo que validar la normalizacion: una alerta no se
     * cierra mientras el punto siga fuera de rango. Para una falsa alarma esta
     * «Descartar», que pide nota.
     */
    if (input.action === "VALIDATE_NORMALIZATION" || input.action === "RESOLVE") {
      const r = await validarNormalizacion({ organizationId: orgId, alertId: id, userId: user.id, nota: input.nota });
      if ("error" in r) return fail(r.error, 409);
      await reconciliar({ organizationId: orgId, entidadId: id, origen: "FLUJO", actorId: user.id, evento: "Resolución de la alerta" });
      return ok({ alert: r.alerta });
    }

    if (input.action === "DISMISS") {
      if (!input.nota || input.nota.length < 3) return fail("Indique por qué se descarta la alerta", 422);
      const updated = await prisma.predictiveAlert.update({
        where: { id },
        data: { status: "DISMISSED", resueltaPorId: user.id, resueltaEl: new Date(), resolucion: input.nota },
      });
      await logAudit({
        organizationId: orgId, userId: user.id, entity: "PredictiveAlert", entityId: id,
        action: "DESCARTADA", summary: `${alert.title}: descartada. ${input.nota}`,
      });
      await reconciliar({ organizationId: orgId, entidadId: id, origen: "FLUJO", actorId: user.id, evento: "Descarte de la alerta" });
      return ok({ alert: updated });
    }

    const updated = await prisma.predictiveAlert.update({
      where: { id },
      data: { status: "ACKNOWLEDGED", acknowledgedById: user.id, acknowledgedAt: new Date() },
    });
    // Reconocerla atiende el recordatorio «sin reconocer»; el aviso de la alerta sigue hasta resolverla.
    await reconciliar({ organizationId: orgId, entidadId: id, origen: "FLUJO", actorId: user.id, evento: "Reconocimiento de la alerta" });
    return ok({ alert: updated });
  });
}
