import { prisma } from "@/lib/db";
import { ok, withAuth } from "@/lib/api";
import { urlEnmascarada } from "@/lib/integraciones/destino";

/**
 * Historial técnico de entregas de la empresa de la sesión. Solo
 * administradores: aquí se ven destinos y errores. Sin contenido de avisos.
 */
export async function GET(request: Request) {
  return withAuth("settings:write", async ({ orgId }) => {
    const url = new URL(request.url);
    const estado = url.searchParams.get("estado");
    const canal = url.searchParams.get("canal");
    const entregas = await prisma.entregaAviso.findMany({
      where: {
        organizationId: orgId,
        ...(estado ? { estado } : {}),
        // La campana entregada es rutina (siempre llega): se oculta. Lo que la
        // campana NO pudo —sin destinatario, omitido por preferencia— sí se ve.
        ...(canal ? { canal } : { NOT: { canal: "CAMPANA", estado: "ENTREGADA" } }),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true, tipo: true, eventoId: true, canal: true, estado: true, programadaPara: true, intentadaEl: true, intentos: true,
        proveedor: true, errorCategoria: true, errorDetalle: true, proximoIntento: true, entregadaEl: true, resumen: true, createdAt: true,
        userId: true, webhook: { select: { nombre: true, url: true } },
      },
    });
    const usuarios = await prisma.user.findMany({
      where: { organizationId: orgId, id: { in: entregas.map((e) => e.userId).filter((x): x is string => Boolean(x)) } },
      select: { id: true, name: true },
    });
    const nombre = new Map(usuarios.map((u) => [u.id, u.name]));
    const [porEstado] = await Promise.all([
      prisma.entregaAviso.groupBy({ by: ["estado"], where: { organizationId: orgId, canal: { not: "CAMPANA" }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: true }),
    ]);
    return ok({
      entregas: entregas.map((e) => ({
        ...e,
        destinatario: e.userId ? nombre.get(e.userId) ?? "(persona)" : e.webhook ? `${e.webhook.nombre} · ${urlEnmascarada(e.webhook.url)}` : "—",
        webhook: undefined,
      })),
      ultimos7Dias: Object.fromEntries(porEstado.map((g) => [g.estado, g._count])),
    });
  }, { esLectura: true });
}
