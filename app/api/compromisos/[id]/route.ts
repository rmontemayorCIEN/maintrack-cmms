import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { ESTADOS_COMPROMISO, cambiarEstadoCompromiso, type EstadoCompromiso } from "@/lib/compromisos";

const schema = z.object({
  estado: z.enum(ESTADOS_COMPROMISO as unknown as [EstadoCompromiso, ...EstadoCompromiso[]]),
});

/** Marcarlo hecho, cancelarlo o reabrirlo. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(null, async ({ user, orgId }) => {
    const { id } = await ctx.params;
    const { estado } = schema.parse(await request.json());
    const r = await cambiarEstadoCompromiso(orgId, id, user.id, estado);
    if (!r.ok) return fail(r.motivo ?? "No se pudo cambiar", 403);
    return ok({ success: true });
  });
}
