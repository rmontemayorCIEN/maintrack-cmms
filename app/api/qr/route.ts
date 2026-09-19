import { ok, withAuth } from "@/lib/api";
import { resolverCodigo } from "@/lib/qr";

/** GET /api/qr?codigo=… → { destino, que } o { error } (lib/qr.ts). */
export async function GET(request: Request) {
  return withAuth(null, async ({ user }) => {
    const url = new URL(request.url);
    const origen = request.headers.get("x-forwarded-host")
      ? `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("x-forwarded-host")}`
      : url.origin;
    const r = await resolverCodigo(user, url.searchParams.get("codigo") ?? "", origen);
    // Un código que no lleva a nada es un resultado, no una falla: se responde 200 con el porqué.
    return ok(r);
  });
}
