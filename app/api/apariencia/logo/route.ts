import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { guardarArchivo, leerArchivo } from "@/lib/almacenamiento";
import { logAudit } from "@/lib/audit";

/** Un logotipo razonable no pasa de esto; el limite evita subir una foto. */
const MAXIMO_KB = 300;
const TIPOS = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;

const schema = z.object({
  base64: z.string().min(50).max(MAXIMO_KB * 1400),
  tipo: z.enum(TIPOS),
});

/**
 * Sube el logotipo de la empresa.
 *
 * Se guarda en el almacen y en la base solo queda la ruta: un logotipo
 * incrustado en el registro de la organizacion viajaria en cada peticion,
 * porque la sesion carga esa fila completa en cada carga de pagina.
 */
export async function POST(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const datos = Buffer.from(input.base64, "base64");
    if (datos.length > MAXIMO_KB * 1024) {
      return fail(`El logotipo pesa ${Math.round(datos.length / 1024)} KB y el maximo son ${MAXIMO_KB} KB.`, 413);
    }

    const extension = input.tipo === "image/svg+xml" ? "svg" : input.tipo.split("/")[1];
    const ruta = `${orgId}/marca/logo.${extension}`;
    await guardarArchivo(ruta, datos, input.tipo);
    await prisma.organization.update({ where: { id: orgId }, data: { logoUrl: ruta } });

    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Organization", entityId: orgId, action: "UPDATED",
      summary: "Cambio de logotipo",
    });
    return ok({ ruta }, 201);
  });
}

/** Entrega el logotipo de la organizacion de la sesion. */
export async function GET() {
  return withAuth(null, async ({ user, orgId }) => {
    const ruta = user.organization.logoUrl;
    if (!ruta) return fail("Sin logotipo", 404);

    try {
      const datos = await leerArchivo(ruta);
      const tipo = ruta.endsWith(".svg") ? "image/svg+xml"
        : ruta.endsWith(".png") ? "image/png"
        : ruta.endsWith(".webp") ? "image/webp" : "image/jpeg";
      return new Response(new Uint8Array(datos), {
        headers: { "Content-Type": tipo, "Cache-Control": "private, max-age=300" },
      });
    } catch {
      return fail("No fue posible leer el logotipo", 404);
    }
  });
}

/** Quita el logotipo. El archivo se queda; ocupa unos kilobytes. */
export async function DELETE() {
  return withAuth("settings:write", async ({ orgId }) => {
    await prisma.organization.update({ where: { id: orgId }, data: { logoUrl: null } });
    return ok({ success: true });
  });
}
