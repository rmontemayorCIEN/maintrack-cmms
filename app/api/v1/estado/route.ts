import { prisma } from "@/lib/db";
import { conCredencial } from "@/lib/integraciones/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/estado — conteos de pendientes, para tableros externos. Alcance estado:leer. */
export async function GET(request: Request) {
  return conCredencial(request, { alcance: "estado:leer", ruta: "estado" }, async (quien) => {
    const org = quien.organizationId;
    const ahora = new Date();
    const abiertas = { organizationId: org, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] } };
    const [ordenes, criticas, vencidas, solicitudes, alertas, detenidos] = await Promise.all([
      prisma.workOrder.count({ where: abiertas }),
      prisma.workOrder.count({ where: { ...abiertas, priority: "CRITICAL" } }),
      prisma.workOrder.count({ where: { ...abiertas, dueDate: { lt: ahora } } }),
      prisma.workRequest.count({ where: { organizationId: org, status: "PENDING" } }),
      prisma.predictiveAlert.count({ where: { organizationId: org, status: "OPEN" } }),
      prisma.asset.count({ where: { organizationId: org, status: "DOWN" } }),
    ]);
    return {
      estado: 200,
      cuerpo: { generado: ahora.toISOString(), ordenesAbiertas: ordenes, ordenesCriticas: criticas, ordenesVencidas: vencidas, solicitudesPendientes: solicitudes, alertasAbiertas: alertas, equiposDetenidos: detenidos },
    };
  });
}
