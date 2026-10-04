/**
 * El contrato de «Registros propios», en un solo lugar.
 *
 * Se cobra aparte, asi que cada ruta del modulo lo revisa. Vive aqui y no
 * repetido en las seis rutas porque el dia que cambie la forma de venderlo hay
 * que cambiarlo una vez, y porque una ruta a la que se le olvide la revision
 * seria una funcion regalada que nadie nota.
 */
import { fail } from "@/lib/api";

export const SIN_CONTRATO =
  "«Registros propios» se contrata aparte. Escribanos desde Soporte y lo activamos en su cuenta.";

/** Devuelve la respuesta de rechazo, o null si la empresa si lo tiene. */
export function revisarContrato(org: { registrosPropios?: boolean }) {
  return org.registrosPropios ? null : fail(SIN_CONTRATO, 402);
}
