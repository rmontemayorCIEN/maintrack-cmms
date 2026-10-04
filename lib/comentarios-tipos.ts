/**
 * Lo del comentario que NO toca la base: tipos y constantes.
 *
 * Existe aparte de `lib/comentarios.ts` porque ese importa Prisma y `notify`,
 * y el componente que dibuja la conversacion corre en el NAVEGADOR. Importar
 * de alla una sola constante arrastra el servidor entero al bundle y la
 * pantalla queda en blanco con «no encuentro fs» —sin que TypeScript diga una
 * palabra, porque compila perfecto—. En este proyecto ya paso con la pantalla
 * de hallazgos del rondin.
 */

/** Sobre que puede colgar un comentario. */
export const ANCLAS = ["workOrder", "asset", "workRequest", "materialRequest"] as const;
export type Ancla = (typeof ANCLAS)[number];

/** Cuanto puede durar un comentario. Es una nota, no un informe. */
export const MAXIMO_TEXTO = 2000;

/**
 * Lo que se enseña de cada comentario.
 *
 * El autor puede venir vacio: si la persona se va y se borra su usuario, el
 * comentario se queda —la informacion sigue valiendo— y se dice «alguien que
 * ya no esta» en vez de perder el hilo entero.
 */
export type ComentarioVisible = {
  id: string;
  texto: string;
  createdAt: Date;
  editadoEl: Date | null;
  eliminadoEl: Date | null;
  autor: { id: string; name: string; color: string | null } | null;
  menciones: Array<{ id: string; name: string }>;
};
