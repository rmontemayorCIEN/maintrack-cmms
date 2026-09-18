import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeLote, revertirLote } from "@/lib/lotes";

type Params = { params: Promise<{ id: string }> };

/** Revierte la importación: borra solo lo que creó y nadie usó después. */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("settings:write", async ({ user, orgId }) => {
    try {
      return ok(await revertirLote({ organizationId: orgId, loteId: id, userId: user.id }));
    } catch (e) {
      if (e instanceof ErrorDeLote) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
