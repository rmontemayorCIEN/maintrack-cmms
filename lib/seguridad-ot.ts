/**
 * La confirmacion de que se leyo el procedimiento y la seguridad de una orden.
 *
 * ── Por que existe ──
 *
 * Lo que dice esa seccion es bloqueo LOTO, verificar ausencia de tension,
 * despresurizar antes de aflojar bridas, no quitar la guarda con el motor
 * energizado. No es informacion de referencia: es lo que separa un trabajo de
 * un accidente. Que alguien confirme haberlo leido antes de abrir el equipo es
 * un registro con valor propio, y el unico que sirve si despues hay que
 * explicar que paso.
 *
 * ── Por que NO es obligatorio para iniciar ──
 *
 * Obligar a marcarlo invita a marcarlo sin leer, con tal de quitarse el
 * estorbo. Un registro que dice «leido» cuando nadie leyo es peor que no
 * tenerlo, porque da tranquilidad falsa. Se registra y se muestra; no se
 * impone.
 *
 * ── La huella, que es lo que hace que el registro valga ──
 *
 * Se guarda una huella del TEXTO que se leyo. Si despues alguien edita el
 * procedimiento o las indicaciones, lo confirmado ya no corresponde a lo que
 * la orden dice hoy: la pantalla avisa y pide confirmar de nuevo. Sin esto
 * bastaria confirmar un texto y cambiarlo luego para que el registro siguiera
 * diciendo «leido», y un registro que no aguanta esa pregunta no sirve.
 */
import { createHash } from "node:crypto";

/** El texto de seguridad de una orden, tal como se le muestra a la persona. */
export type TextoDeSeguridad = { procedure?: string | null; safetyNotes?: string | null };

/** Si esta orden tiene algo que leer. Sin texto no hay nada que confirmar. */
export function tieneSeguridad(wo: TextoDeSeguridad): boolean {
  return Boolean(wo.procedure?.trim() || wo.safetyNotes?.trim());
}

/**
 * La huella del texto. Se normalizan los espacios para que un salto de linea
 * de mas no cuente como un cambio de contenido.
 */
export function huellaDeSeguridad(wo: TextoDeSeguridad): string {
  /*
   * Cada parte se normaliza POR SEPARADO y luego se unen. Normalizar la
   * cadena ya unida dejaba vivos los espacios pegados al separador, asi que
   * un salto de linea de mas al principio de las indicaciones contaba como
   * texto distinto y pedia reconfirmar por nada. Un aviso que salta sin causa
   * se aprende a ignorar, y entonces no avisa el dia que si cambio algo.
   */
  const limpia = (t?: string | null) => (t ?? "").replace(/\s+/g, " ").trim();
  const texto = `${limpia(wo.procedure)}\u0000${limpia(wo.safetyNotes)}`;
  return createHash("sha256").update(texto).digest("hex").slice(0, 32);
}

export type EstadoSeguridad =
  /** No hay procedimiento ni indicaciones: no hay nada que confirmar. */
  | { estado: "SIN_TEXTO" }
  /** Hay texto y nadie ha confirmado haberlo leido. */
  | { estado: "SIN_CONFIRMAR" }
  /** Confirmado, y el texto sigue siendo el mismo. */
  | { estado: "CONFIRMADO"; porQuien: string | null; cuando: Date }
  /** Se confirmo, pero el texto cambio despues: lo leido era otra cosa. */
  | { estado: "CAMBIO_DESPUES"; porQuien: string | null; cuando: Date };

export function estadoDeSeguridad(
  wo: TextoDeSeguridad & {
    seguridadLeidaEl?: Date | null;
    seguridadLeidaHuella?: string | null;
    seguridadLeidaPor?: { name: string } | null;
  },
): EstadoSeguridad {
  if (!tieneSeguridad(wo)) return { estado: "SIN_TEXTO" };
  if (!wo.seguridadLeidaEl) return { estado: "SIN_CONFIRMAR" };
  const porQuien = wo.seguridadLeidaPor?.name ?? null;
  return wo.seguridadLeidaHuella === huellaDeSeguridad(wo)
    ? { estado: "CONFIRMADO", porQuien, cuando: wo.seguridadLeidaEl }
    : { estado: "CAMBIO_DESPUES", porQuien, cuando: wo.seguridadLeidaEl };
}
