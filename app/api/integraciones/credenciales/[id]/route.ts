import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeCredencial, revocarCredencial, rotarCredencial } from "@/lib/integraciones/credenciales";

type Params = { params: Promise<{ id: string }> };
const schema = z.object({ accion: z.enum(["revocar", "rotar"]) });

/** Revocar (efecto inmediato) o rotar. Solo credenciales de la empresa de la sesión: otra da 404. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("settings:write", async ({ user, orgId }) => {
    const { accion } = schema.parse(await request.json());
    try {
      if (accion === "revocar") {
        await revocarCredencial({ organizationId: orgId, userId: user.id, id });
        return ok({ ok: true });
      }
      return ok(await rotarCredencial({ organizationId: orgId, userId: user.id, id }));
    } catch (e) {
      if (e instanceof ErrorDeCredencial) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
