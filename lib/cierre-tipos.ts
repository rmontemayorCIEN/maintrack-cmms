/**
 * Los bloques del tablero de cierre y su forma, para la pantalla.
 *
 * Vive aparte de `lib/tablero-cierre.ts` a proposito, igual que
 * `estados-compra.ts`, `vigencias-tipos.ts` y `planificador-tipos.ts`: la
 * tabla es un componente de cliente y solo necesita esto. Tomarlo del modulo
 * con la logica arrastra prisma —y de ahi la bitacora y el envio de avisos—
 * al paquete del navegador, y la pagina revienta con un «no encuentro net»
 * que no dice nada de la causa real. Paso aqui, tal cual.
 */

/** Verde: ya tiene lo suyo. Ambar: detiene el cierre. Gris: no aplica o no se exige. */
export type EstadoDeBloque = "hecho" | "falta" | "neutro";

/**
 * Los bloques que se muestran, en el orden en que se trabajan.
 *
 * El indice de la ficha tiene hasta ocho, pero tres —seguridad, lecturas y
 * bitacora— no tienen nocion de «terminadas»: una orden no se queda sin
 * bitacora. En un tablero serian columnas grises en todos los renglones, que
 * nunca cambian y solo quitan ancho.
 */
export const BLOQUES = [
  { id: "actividades", texto: "Actividades" },
  { id: "tiempo", texto: "Tiempo" },
  { id: "materiales", texto: "Materiales" },
  { id: "evidencias", texto: "Evidencias" },
  { id: "resultado", texto: "Resultado" },
] as const;

export type ClaveBloque = (typeof BLOQUES)[number]["id"];

export type FilaCierre = {
  id: string;
  number: string;
  title: string;
  status: string;
  prioridad: string;
  activo: string | null;
  responsable: string | null;
  completadaEl: string | null;
  /** Dias desde que se completo: lo que lleva esperando validacion. */
  diasEsperando: number | null;
  bloques: Record<ClaveBloque, EstadoDeBloque>;
  /** Cuantos bloques la detienen. Cero significa que ya se puede cerrar. */
  faltan: number;
  /** Lo que falta, en palabras, para no tener que adivinar el ambar. */
  motivos: string[];
};
