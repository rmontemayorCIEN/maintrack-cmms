import { prisma } from "@/lib/db";
import { ok, withAuth } from "@/lib/api";
import { PRIORIDADES } from "@/lib/avisos/catalogo";

/**
 * Los avisos de quien tiene la sesión, de la empresa que está viendo. Solo
 * los suyos: el filtro por usuario no depende de ningún parámetro.
 *
 * Por qué también por empresa: el operador de la plataforma, dentro de una
 * empresa cliente, conserva sus avisos de SU empresa. Mostrárselos ahí era
 * ofrecerle ligas a órdenes que en el cliente no existen: al tocarlas, «página
 * no encontrada». Sus avisos aparecen al volver a su empresa.
 *
 * Filtros: prioridad, modulo, estado (no_leidas | pendientes | atendidas),
 * desde/hasta (ISO), y `cursor` para ver más atrás. Sin filtros devuelve los
 * últimos 20, como siempre (la campana).
 */
export async function GET(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const url = new URL(request.url);
    const prioridad = url.searchParams.get("prioridad");
    const modulo = url.searchParams.get("modulo");
    const estado = url.searchParams.get("estado");
    const desde = url.searchParams.get("desde");
    const hasta = url.searchParams.get("hasta");
    const cursor = url.searchParams.get("cursor");
    const limite = Math.min(100, Math.max(1, Number(url.searchParams.get("limite")) || 20));
    const where = {
      userId: user.id,
      organizationId: orgId,
      ...(prioridad && (PRIORIDADES as string[]).includes(prioridad) ? { prioridad } : {}),
      ...(modulo ? { modulo } : {}),
      ...(estado === "no_leidas" ? { read: false } : {}),
      ...(estado === "pendientes" ? { requiereAccion: true, atendidaEl: null } : {}),
      ...(estado === "atendidas" ? { atendidaEl: { not: null } } : {}),
      ...(desde || hasta ? { createdAt: { ...(desde ? { gte: new Date(desde) } : {}), ...(hasta ? { lte: new Date(hasta) } : {}) } } : {}),
    };
    const filas = await prisma.notification.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hay = filas.length > limite;
    const [noLeidas, pendientes] = await Promise.all([
      prisma.notification.count({ where: { userId: user.id, organizationId: orgId, read: false } }),
      prisma.notification.count({ where: { userId: user.id, organizationId: orgId, requiereAccion: true, atendidaEl: null } }),
    ]);
    return ok({
      // Dentro de una empresa cliente: dónde están sus avisos propios.
      avisosEn: user.actuandoComoCliente ? user.organizacionPropia.name : null,
      notifications: hay ? filas.slice(0, limite) : filas,
      siguienteCursor: hay ? filas[limite - 1].id : null,
      noLeidas, pendientes,
    });
  });
}

/** Marcar todas como leídas. Leer no las atiende: las pendientes siguen pendientes. */
export async function PATCH() {
  return withAuth(null, async ({ user, orgId }) => {
    await prisma.notification.updateMany({
      where: { userId: user.id, organizationId: orgId, read: false },
      data: { read: true, leidaEl: new Date() },
    });
    return ok({ success: true });
  });
}
