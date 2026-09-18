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
 * por eso es donde se enchufan los canales. La campana (el centro de avisos)
 * siempre se alimenta primero; despues se encolan las entregas por los demas
 * canales —navegador, correo— segun la empresa, las preferencias de la persona
 * y el horario.
 *
 * Lo que hace, en orden, y por que:
 *
 *  1. Solo personas ACTIVAS de la misma organizacion. Un aviso a alguien de
 *     otra empresa se descarta en silencio (no es un error, es una
 *     combinacion que no debe producir aviso). A alguien desactivado no se le
 *     manda, pero queda registrado como «sin destinatario valido».
 *  2. Preferencias: un aviso configurable que la persona apago queda como
 *     «omitido por preferencia». Los obligatorios no se pueden apagar.
 *  3. Deduplicacion: con `claveDedup`, el mismo problema para la misma
 *     persona es UNA notificacion. Se actualiza en vez de repetirse; solo se
 *     vuelve a entregar si es un recordatorio o si el problema regreso
 *     despues de atenderse.
 *  4. El registro va primero y el canal despues: si el envio falla, la
 *     notificacion ya quedo guardada. El canal nunca tumba la operacion.
 *
 * El dia que se sume WhatsApp, se suma en `lib/avisos/canales.ts` y lo ganan
 * todos los lugares que ya notifican, sin volver a abrirlos.
 */
export type ResultadoAviso = {
  notificationId: string | null;
  estado: "CREADA" | "ACTUALIZADA" | "SIN_CAMBIO" | "OMITIDA" | "SIN_DESTINATARIO" | "DESCARTADA";
};

export async function notify(params: {
  organizationId: string;
  userId: string;
  title: string;
  body?: string;
  link?: string;
  /** Forma vieja de la prioridad: INFO | WARNING | CRITICAL | SUCCESS. */
  kind?: string;
  /**
   * Agrupa los avisos del mismo asunto en el celular: normalmente el folio.
   * Sin esto, tres cambios en la misma orden dejan tres avisos apilados.
   */
  tag?: string;
  /** Tipo del catalogo (lib/avisos/catalogo.ts). Sin el, es un aviso general. */
  tipo?: string;
  prioridad?: string;
  modulo?: string;
  entidad?: string;
  entidadId?: string;
  requiereAccion?: boolean;
  porQue?: string;
  accion?: string;
  claveDedup?: string;
  eventoId?: string;
  /** No se puede apagar por preferencia (responsable directo, unico autorizador). */
  obligatorio?: boolean;
  /** Es un recordatorio: si ya existe y sigue sin atender, se vuelve a entregar. */
  recordar?: boolean;
}): Promise<ResultadoAviso> {
  const descartada: ResultadoAviso = { notificationId: null, estado: "DESCARTADA" };
  try {
    const { registrarAviso } = await import("./avisos/entrega");
    return await registrarAviso(params);
  } catch {
    // El canal nunca tumba la operacion de negocio.
    return descartada;
  }
}
