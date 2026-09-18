import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeWebhook, modificarWebhook, probarWebhook, rotarSecretoWebhook, vistaDeWebhook } from "@/lib/integraciones/webhooks";

type Params = { params: Promise<{ id: string }> };

const cambios = z.object({
  nombre: z.string().trim().min(3).max(80).optional(),
  url: z.string().trim().min(8).max(500).optional(),
  eventos: z.array(z.string()).min(1).max(60).optional(),
  estado: z.enum(["ACTIVO", "PAUSADO"]).optional(),
});
const accion = z.object({ accion: z.enum(["probar", "rotar"]) });

async function conError(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof ErrorDeWebhook) return fail(e.message, e.codigo);
    throw e;
  }
}

/** Cambiar nombre, dirección, eventos o pausar/activar. Un webhook de otra empresa da 404. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("settings:write", async ({ user, orgId }) => {
    const input = cambios.parse(await request.json());
    return conError(async () => ({ webhook: vistaDeWebhook(await modificarWebhook({ organizationId: orgId, userId: user.id, id, cambios: input })) }));
  });
}

/** Probar la conexión (evento de prueba sin datos reales) o rotar el secreto de firma. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("settings:write", async ({ user, orgId }) => {
    const { accion: a } = accion.parse(await request.json());
    return conError(() => (a === "probar"
      ? probarWebhook({ organizationId: orgId, userId: user.id, id })
      : rotarSecretoWebhook({ organizationId: orgId, userId: user.id, id })));
  });
}
