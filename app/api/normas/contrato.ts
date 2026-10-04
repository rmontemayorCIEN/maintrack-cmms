/**
 * El contrato de «Cumplimiento normativo», en un solo lugar.
 *
 * Mismo criterio que `app/api/registros/contrato.ts`: se cobra aparte, asi que
 * cada ruta del modulo lo revisa, y vive aqui para que una ruta a la que se le
 * olvide no regale la funcion sin que nadie lo note.
 */
import { fail } from "@/lib/api";

export const SIN_CONTRATO =
  "«Cumplimiento normativo» se contrata aparte. Escríbanos desde Soporte y lo activamos en su cuenta.";

export function revisarContrato(org: { cumplimientoNormas?: boolean }) {
  return org.cumplimientoNormas ? null : fail(SIN_CONTRATO, 402);
}
