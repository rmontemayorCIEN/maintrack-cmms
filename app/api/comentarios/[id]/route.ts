import { fail, ok, withAuth } from "@/lib/api";
import { eliminarComentario } from "@/lib/comentarios";

/**
 * Borrar un comentario propio.
 *
 * Se marca como eliminado y se conserva: una conversacion con huecos no se
 * entiende, y el hueco tapa justo lo que alguien quiso tapar. Quien lo escribio
 * y nadie mas —que un supervisor pueda borrar lo que dijo otro convierte la
 * bitacora en algo que no se puede citar—.
 */
export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(null, async ({ user, orgId }) => {
    const { id } = await ctx.params;
    const r = await eliminarComentario(orgId, id, user.id);
    if (!r.ok) return fail(r.motivo ?? "No se pudo borrar", 403);
    return ok({ success: true });
  });
}
