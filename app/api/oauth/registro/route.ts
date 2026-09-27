/**
 * Registro dinamico de clientes (RFC 7591).
 *
 * Es publico por diseño: claude.ai se registra solo antes de mandar al
 * operador a autorizar. Lo que lo hace seguro esta en lib/mcp/oauth.ts: solo
 * se aceptan direcciones de regreso de Claude y hay un tope por hora.
 */
import { json, preflight } from "@/lib/mcp/http";
import { ErrorOAuth, registrarCliente, type PeticionRegistro } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cuerpo = (await request.json().catch(() => null)) as PeticionRegistro | null;
  if (!cuerpo || typeof cuerpo !== "object") {
    return json({ error: "invalid_client_metadata", error_description: "Se espera un JSON." }, 400);
  }
  try {
    return json(await registrarCliente(cuerpo), 201);
  } catch (e) {
    if (e instanceof ErrorOAuth) return json({ error: e.error, error_description: e.message }, e.status);
    throw e;
  }
}

export function OPTIONS() {
  return preflight();
}
