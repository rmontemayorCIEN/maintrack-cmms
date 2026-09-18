import { SIN_RED } from "./borrador";

/**
 * Una petición desde la pantalla con los tres finales que la persona tiene que
 * distinguir: se guardó; no se guardó por una regla (el mensaje del servidor);
 * o no se guardó porque no hay red (y se puede reintentar). Sin esto, un
 * `fetch` sin señal dejaba el botón girando o el error en la consola.
 */
export async function pedir<T = Record<string, unknown>>(url: string, init: RequestInit & { json?: unknown } = {}):
  Promise<{ ok: true; datos: T } | { ok: false; error: string; status: number; sinRed: boolean; datos?: Record<string, unknown> }> {
  const { json, ...resto } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...resto,
      ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...(resto.headers ?? {}) } } : {}),
    });
  } catch {
    return { ok: false, error: SIN_RED, status: 0, sinRed: true };
  }
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = typeof datos.error === "string" ? datos.error
      : res.status >= 500 ? "Algo falló de nuestro lado y no se guardó. Intente de nuevo en un momento." : "No se pudo guardar.";
    return { ok: false, error, status: res.status, sinRed: false, datos };
  }
  return { ok: true, datos: datos as T };
}
