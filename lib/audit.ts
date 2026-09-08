import { prisma } from "./db";

export async function logAudit(params: {
  organizationId: string;
  userId?: string | null;
  entity: string;
  entityId: string;
  action: string;
  summary?: string;
  changes?: unknown;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId ?? null,
        entity: params.entity,
        entityId: params.entityId,
        action: params.action,
        summary: params.summary,
        changes: JSON.stringify(params.changes ?? {}),
      },
    });
  } catch {
    // La bitacora nunca debe romper la operacion de negocio.
  }
}

/**
 * Le dice algo a una persona.
 *
 * Es el unico lugar por donde pasa todo lo que el sistema quiere comunicar, y
 * por eso es donde se enchufan los canales. La campana de la barra superior
 * siempre se alimenta; el aviso al celular sale ademas, si la organizacion lo
 * tiene encendido y esa persona dio de alta algun aparato.
 *
 * El dia que se sume WhatsApp, se suma aqui y lo ganan los siete lugares que
 * ya notifican, sin volver a abrirlos.
 */
export async function notify(params: {
  organizationId: string;
  userId: string;
  title: string;
  body?: string;
  link?: string;
  kind?: string;
  /**
   * Agrupa los avisos del mismo asunto en el celular: normalmente el folio.
   * Sin esto, tres cambios en la misma orden dejan tres avisos apilados.
   */
  tag?: string;
}) {
  const kind = params.kind ?? "INFO";
  try {
    await prisma.notification.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        title: params.title,
        body: params.body,
        link: params.link,
        kind,
      },
    });
  } catch {
    /* noop */
  }

  /**
   * El aviso al celular va DESPUES y por separado, a proposito.
   *
   * Si el envio falla —sin red, servicio caido, el telefono apagado— la
   * notificacion ya quedo guardada y la persona la va a ver en la campana. Al
   * reves se perderia: un canal que falla no puede llevarse el registro.
   *
   * Se importa aqui adentro y no arriba porque `web-push` es codigo de
   * servidor: una importacion en el encabezado lo arrastra a cualquier archivo
   * que use logAudit, incluidos los que Next intenta compilar para el
   * navegador.
   */
  try {
    const { enviarPush } = await import("./push");
    await enviarPush(params.userId, {
      title: params.title,
      body: params.body,
      link: params.link,
      tag: params.tag,
      // Lo critico se queda en la pantalla hasta que la persona lo toca.
      importante: kind === "CRITICAL",
    });
  } catch {
    /* El canal nunca tumba la operacion de negocio. */
  }
}
