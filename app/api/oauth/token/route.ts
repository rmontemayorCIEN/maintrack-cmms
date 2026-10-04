/**
 * Endpoint de tokens: canjea el codigo de autorizacion (con PKCE) y renueva.
 * Toda la regla vive en lib/mcp/oauth.ts.
 */
import { json, preflight } from "@/lib/mcp/http";
import { autenticarCliente, canjearCodigo, ErrorOAuth, origenPublico, renovar } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const tipo = request.headers.get("content-type") ?? "";
  if (!tipo.includes("application/x-www-form-urlencoded")) {
    return json({ error: "invalid_request", error_description: "Se espera application/x-www-form-urlencoded." }, 400);
  }
  const form = new URLSearchParams(await request.text());
  const origen = origenPublico(request);
  try {
    const cliente = await autenticarCliente(form, request.headers.get("authorization"));
    const grant = form.get("grant_type");
    if (grant === "authorization_code") return json(await canjearCodigo(form, cliente, origen));
    if (grant === "refresh_token") return json(await renovar(form, cliente, origen));
    throw new ErrorOAuth("unsupported_grant_type", `grant_type no admitido: ${grant ?? "(vacío)"}`);
  } catch (e) {
    if (e instanceof ErrorOAuth) return json({ error: e.error, error_description: e.message }, e.status);
    throw e;
  }
}

export function OPTIONS() {
  return preflight();
}
