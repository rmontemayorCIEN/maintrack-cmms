import { fail, ok, withAuth } from "@/lib/api";
import { reintentarEntrega } from "@/lib/avisos/entrega";

type Params = { params: Promise<{ id: string }> };

/** Reintento manual de una entrega fallida, dentro de la empresa de la sesión. */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("settings:write", async ({ user, orgId }) => {
    const r = await reintentarEntrega({ organizationId: orgId, entregaId: id, userId: user.id });
    if (!r.ok) return fail(r.error, r.codigo);
    return ok({ estado: r.estado });
  });
}
