import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeDemo, restaurarDemo, vistaPreviaRestauracion } from "@/lib/demo-comercial";

/**
 * Restaurar la empresa demostrativa. Solo dentro de ella, solo la
 * administración (settings:write) y con la palabra de confirmación: borra lo
 * capturado durante las demostraciones.
 */
export async function GET() {
  return withAuth("settings:write", async ({ user, orgId }) => {
    if (!user.organization.esDemo) return fail("Solo la empresa demostrativa se puede restaurar.", 403);
    return ok(await vistaPreviaRestauracion(orgId));
  }, { esLectura: true });
}

const esquema = z.object({ confirmacion: z.literal("RESTAURAR", { errorMap: () => ({ message: "Escriba RESTAURAR para confirmar." }) }) });

export async function POST(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    if (!user.organization.esDemo) return fail("Solo la empresa demostrativa se puede restaurar.", 403);
    esquema.parse(await request.json().catch(() => ({})));
    try {
      return ok({ restaurada: true, resumen: await restaurarDemo({ orgId, userId: user.id }) });
    } catch (e) {
      if (e instanceof ErrorDeDemo) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
