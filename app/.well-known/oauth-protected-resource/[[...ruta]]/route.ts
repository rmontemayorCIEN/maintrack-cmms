/**
 * Metadatos del recurso protegido (RFC 9728).
 *
 * Se atiende en la raiz y con la ruta del recurso como sufijo
 * (/.well-known/oauth-protected-resource/api/mcp): los clientes prueban una u
 * otra segun la version de la especificacion que sigan.
 */
import { metadatosDelRecurso, preflight } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return metadatosDelRecurso(request);
}

export function OPTIONS() {
  return preflight();
}
