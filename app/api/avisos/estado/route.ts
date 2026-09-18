import { prisma } from "@/lib/db";
import { ok, withAuth } from "@/lib/api";
import { proveedorDeCorreo } from "@/lib/avisos/canales";
import { pushConfigurado } from "@/lib/push";

/**
 * Estado técnico de avisos e integraciones de la empresa: qué canal está
 * disponible, cuánto falla, qué integración tiene problemas.
 */
export async function GET() {
  return withAuth("settings:write", async ({ orgId }) => {
    const hace24 = new Date(Date.now() - 86_400_000);
    const [org, fallidas24, pendientes, sinDestinatario, webhooks, credenciales, rechazos24] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId }, select: { avisosPush: true } }),
      prisma.entregaAviso.count({ where: { organizationId: orgId, estado: "FALLIDA", updatedAt: { gte: hace24 } } }),
      prisma.entregaAviso.count({ where: { organizationId: orgId, estado: { in: ["PENDIENTE", "EN_REINTENTO"] } } }),
      prisma.entregaAviso.count({ where: { organizationId: orgId, estado: "SIN_DESTINATARIO", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
      prisma.webhook.groupBy({ by: ["estado"], where: { organizationId: orgId }, _count: true }),
      prisma.credencialApi.groupBy({ by: ["estado"], where: { organizationId: orgId }, _count: true }),
      prisma.usoApi.count({ where: { organizationId: orgId, resultado: { in: ["RECHAZADA", "LIMITE", "ERROR"] }, createdAt: { gte: hace24 } } }),
    ]);
    return ok({
      canales: {
        centro: { disponible: true },
        navegador: { disponible: pushConfigurado() && Boolean(org?.avisosPush), motivo: !pushConfigurado() ? "sin llaves VAPID" : org?.avisosPush ? null : "apagado en la empresa" },
        correo: { disponible: Boolean(proveedorDeCorreo()), proveedor: proveedorDeCorreo(), motivo: proveedorDeCorreo() ? null : "sin proveedor de correo configurado" },
      },
      entregas: { fallidas24h: fallidas24, enCola: pendientes, sinDestinatario7d: sinDestinatario },
      webhooks: Object.fromEntries(webhooks.map((w) => [w.estado, w._count])),
      credenciales: Object.fromEntries(credenciales.map((c) => [c.estado, c._count])),
      api: { rechazos24h: rechazos24 },
    });
  }, { esLectura: true });
}
