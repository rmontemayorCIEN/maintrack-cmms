import { NextResponse } from "next/server";
import { fail, withAuth } from "@/lib/api";
import { guardarLocal, leerLocal, usaGCS } from "@/lib/almacenamiento";

/**
 * Respaldo de desarrollo: escribe y sirve desde disco.
 *
 * En produccion no se usa —el navegador habla directo con GCS— y por eso el
 * endpoint se niega a operar si hay bucket configurado.
 */
type Params = { params: Promise<{ ruta: string[] }> };

/**
 * Una ruta con «..» pasa el `startsWith` y sale del prefijo de la organizacion:
 * `org-A/../org-B/foto.jpg` empieza con `org-A/` y termina leyendo la carpeta
 * de B. Se rechaza antes de tocar el disco.
 */
function rutaSegura(ruta: string, orgId: string) {
  return ruta.startsWith(`org-${orgId}/`) && !ruta.split("/").includes("..");
}

export async function PUT(request: Request, { params }: Params) {
  if (usaGCS) return fail("No disponible: la instancia usa almacenamiento en la nube", 404);
  const { ruta } = await params;
  return withAuth(null, async ({ orgId }) => {
    const destino = decodeURIComponent(ruta.join("/"));
    if (!rutaSegura(destino, orgId)) return fail("Ruta invalida", 403);
    const datos = Buffer.from(await request.arrayBuffer());
    await guardarLocal(destino, datos);
    return NextResponse.json({ ok: true }, { status: 200 });
  });
}

export async function GET(_request: Request, { params }: Params) {
  if (usaGCS) return fail("No disponible", 404);
  const { ruta } = await params;
  return withAuth(null, async ({ orgId }) => {
    const origen = decodeURIComponent(ruta.join("/"));
    if (!rutaSegura(origen, orgId)) return fail("Ruta invalida", 403);
    try {
      const datos = await leerLocal(origen);
      return new NextResponse(new Uint8Array(datos), {
        headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=300" },
      });
    } catch {
      return fail("Archivo no encontrado", 404);
    }
  });
}
