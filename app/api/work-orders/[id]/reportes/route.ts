import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { nextRequestNumber } from "@/lib/numbering";
import { tipoDeTrabajo } from "@/lib/tipos-solicitud";
import { logAudit } from "@/lib/audit";

const schema = z.discriminatedUnion("modo", [
  /** Sumar un reporte que ya existe y esta esperando. */
  z.object({ modo: z.literal("EXISTENTE"), requestId: z.string() }),
  /**
   * Levantar uno nuevo desde adentro de la orden.
   *
   * Es el caso real: el tecnico abrio la maquina por el preventivo y encontro
   * algo mas. Obligarlo a salirse, levantar el reporte en otra pantalla y
   * volver es como se pierden los hallazgos.
   */
  z.object({
    modo: z.literal("NUEVO"),
    title: z.string().trim().min(4).max(200),
    description: z.string().trim().max(1000).optional().nullable(),
    tipo: z.enum(["FALLA", "MEJORA", "APOYO", "OTRO"]).default("FALLA"),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  }),
]);

/** Suma un reporte a una orden que ya existe, o levanta uno y lo suma. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    const orden = await prisma.workOrder.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, number: true, status: true, assetId: true, siteId: true, locationId: true },
    });
    if (!orden) return fail("Orden de trabajo no encontrada", 404);
    if (["COMPLETED", "CLOSED", "CANCELLED"].includes(orden.status)) {
      return fail("Esa orden ya esta cerrada. Levante el reporte por separado.", 409);
    }

    let solicitud: { id: string; number: string; title: string; description: string | null; tipo: string | null };

    if (input.modo === "EXISTENTE") {
      const s = await prisma.workRequest.findFirst({
        where: { id: input.requestId, organizationId: orgId, status: "PENDING" },
        select: { id: true, number: true, title: true, description: true, tipo: true, assetId: true },
      });
      if (!s) return fail("El reporte no existe o ya fue atendido", 404);
      // Sumarlo a la orden de otro equipo mezclaria el historial de dos activos.
      if (s.assetId && orden.assetId && s.assetId !== orden.assetId) {
        return fail("Ese reporte es de otro equipo.", 409);
      }
      // Se aparta antes de crear la actividad: un doble clic, o dos personas a
      // la vez, no pueden sumar el mismo reporte dos veces.
      const apartado = await prisma.workRequest.updateMany({
        where: { id: s.id, organizationId: orgId, status: "PENDING" },
        data: { status: "CONVERTED", workOrderId: orden.id, reviewedById: user.id, reviewedAt: new Date() },
      });
      if (apartado.count === 0) return fail("El reporte ya fue atendido", 409);
      solicitud = s;
    } else {
      /**
       * Se crea la solicitud aunque nazca aqui adentro.
       *
       * Podria crearse solo la actividad, pero entonces el hallazgo no
       * existiria como reporte: no tendria folio, no aparecerian en el listado
       * de solicitudes, y el historial del equipo no diria que alguien lo
       * reporto. El reporte es el registro; la actividad es como se atiende.
       */
      const numero = await nextRequestNumber(orgId);
      solicitud = await prisma.workRequest.create({
        data: {
          organizationId: orgId,
          number: numero,
          title: input.title,
          description: input.description || null,
          tipo: input.tipo,
          priority: input.priority,
          assetId: orden.assetId,
          siteId: orden.siteId,
          locationId: orden.locationId,
          requestedById: user.id,
          // Nace ya atendida: la levanto quien la va a resolver, en la orden
          // donde se va a resolver. Pasarla por revision seria papeleo vacio.
          status: "CONVERTED",
          workOrderId: orden.id,
          reviewedById: user.id,
          reviewedAt: new Date(),
        },
        select: { id: true, number: true, title: true, description: true, tipo: true },
      });
    }

    const ultima = await prisma.workOrderTask.aggregate({
      where: { workOrderId: orden.id },
      _max: { position: true },
    });
    await prisma.workOrderTask.create({
      data: {
        workOrderId: orden.id,
        position: (ultima._max.position ?? -1) + 1,
        origen: "SOLICITUD",
        origenRequestId: solicitud.id,
        maintenanceType: tipoDeTrabajo(solicitud.tipo),
        title: solicitud.title,
        description: solicitud.description,
        taskType: "CHECK",
        required: true,
      },
    });

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "WorkOrder",
      entityId: orden.id,
      action: "UPDATED",
      summary: `${orden.number}: se sumo el reporte ${solicitud.number}`,
    });

    return ok({ solicitud: { id: solicitud.id, number: solicitud.number } }, 201);
  });
}
