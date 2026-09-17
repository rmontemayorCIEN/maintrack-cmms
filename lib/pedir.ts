/**
 * Una peticion desde el navegador que SIEMPRE termina.
 *
 * `fetch` puede lanzar (se cae la red, cambia el wifi) o quedarse esperando
 * sin limite. Un boton que pone «Revisando…» antes del `await` y lo quita
 * despues se queda trabado para siempre en cualquiera de los dos casos: la
 * linea que lo destraba nunca corre. Paso con «Revisar la semana».
 *
 * Aqui no se lanza nada: se devuelve un resultado que dice que paso, con un
 * mensaje listo para la persona, y hay tiempo limite.
 */
export type Respuesta<T> =
  | { ok: true; status: number; cuerpo: T }
  | { ok: false; status: number | null; motivo: "HTTP" | "TIEMPO" | "RED"; error: string };

export async function pedirJson<T = unknown>(
  url: string,
  init: RequestInit & { limiteMs?: number } = {},
): Promise<Respuesta<T>> {
  const { limiteMs = 60_000, ...opciones } = init;
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), limiteMs);
  try {
    const res = await fetch(url, { ...opciones, signal: control.signal });
    const cuerpo = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false, status: res.status, motivo: "HTTP",
        error: (cuerpo as { error?: string } | null)?.error ?? `El servidor respondió ${res.status}.`,
      };
    }
    return { ok: true, status: res.status, cuerpo: cuerpo as T };
  } catch (e) {
    const tiempo = control.signal.aborted || (e instanceof Error && e.name === "AbortError");
    return {
      ok: false, status: null, motivo: tiempo ? "TIEMPO" : "RED",
      error: tiempo
        ? `No hubo respuesta en ${Math.round(limiteMs / 1000)} s y se canceló. Intente de nuevo.`
        : "Se perdió la conexión con el servidor. Revise su red e intente de nuevo.",
    };
  } finally {
    clearTimeout(reloj);
  }
}
