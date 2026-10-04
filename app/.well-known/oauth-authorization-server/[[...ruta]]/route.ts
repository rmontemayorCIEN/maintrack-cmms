/**
 * Metadatos del servidor de autorizacion (RFC 8414): donde se registra el
 * cliente, donde se autoriza y donde se canjea el codigo.
 */
import { json, preflight } from "@/lib/mcp/http";
import { metadatosServidor, origenPublico } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return json(metadatosServidor(origenPublico(request)));
}

export function OPTIONS() {
  return preflight();
}
