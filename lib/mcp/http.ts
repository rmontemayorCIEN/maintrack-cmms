/**
 * Lo que comparten las rutas HTTP del servidor MCP y de OAuth.
 *
 * ── CORS abierto, y por que no es un riesgo aqui ──
 *
 * Estas rutas no leen la cookie de sesion: se autentican con un token en la
 * cabecera Authorization, que un navegador nunca manda solo. Abrir CORS no le
 * da a una pagina ajena nada que no tenga ya, y permite probar el servidor con
 * el inspector de MCP desde el navegador. La pantalla de autorizacion, que SI
 * usa la sesion, no esta aqui: es una pagina, con las cabeceras de siempre.
 */
import { NextResponse } from "next/server";
import { metadatosRecurso, origenPublico } from "./oauth";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

/** Nada de esto se guarda en caches intermedios. */
const SIN_CACHE = { "Cache-Control": "no-store" };

export function json(datos: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(datos, { status, headers: { ...CORS, ...SIN_CACHE, ...extra } });
}

export function vacio(status: number, extra: Record<string, string> = {}) {
  return new NextResponse(null, { status, headers: { ...CORS, ...SIN_CACHE, ...extra } });
}

export function preflight() {
  return vacio(204);
}

/** Donde se publican los metadatos del recurso (RFC 9728, con la ruta del recurso como sufijo). */
export function urlMetadatosRecurso(origen: string) {
  return `${origen}/.well-known/oauth-protected-resource/api/mcp`;
}

/**
 * El 401 que le dice al cliente donde ir a autorizarse.
 *
 * Es lo primero que ve claude.ai al conectar: de la cabecera saca la
 * direccion de los metadatos, y de ahi todo lo demas.
 */
export function noAutorizado(request: Request, motivo: string, conToken: boolean) {
  const origen = origenPublico(request);
  const partes = [`resource_metadata="${urlMetadatosRecurso(origen)}"`];
  if (conToken) partes.push(`error="invalid_token"`, `error_description="${motivo.replace(/"/g, "'")}"`);
  return json(
    { error: conToken ? "invalid_token" : "unauthorized", error_description: motivo },
    401,
    { "WWW-Authenticate": `Bearer ${partes.join(", ")}` },
  );
}

export function metadatosDelRecurso(request: Request) {
  return json(metadatosRecurso(origenPublico(request)));
}
