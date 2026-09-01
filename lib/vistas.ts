import type { Vista } from "@/components/tabla-configurable";

/**
 * Lee la vista guardada de una tabla.
 *
 * Una preferencia corrupta —de una version anterior, o editada a mano— no debe
 * tumbar la pantalla completa: se cae a la vista de fabrica, que siempre
 * funciona.
 */
export function vistaGuardada(vistasTabla: string | null | undefined, clave: string): Vista {
  try {
    const todas = JSON.parse(vistasTabla || "{}");
    if (!todas || typeof todas !== "object") return {};
    const vista = (todas as Record<string, unknown>)[clave];
    if (!vista || typeof vista !== "object") return {};
    return vista as Vista;
  } catch {
    return {};
  }
}
