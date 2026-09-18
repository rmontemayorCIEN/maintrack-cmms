import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeLote, diagnosticarReversion } from "@/lib/lotes";

type Params = { params: Promise<{ id: string }> };

/**
 * Qué pasaría si se revierte: qué se borra, qué se queda y por qué. No escribe.
 * El lote se busca dentro de la empresa de la sesión: el de otra da 404.
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("settings:write", async ({ orgId }) => {
    try {
      return ok(await diagnosticarReversion(orgId, id));
    } catch (e) {
      if (e instanceof ErrorDeLote) return fail(e.message, e.codigo);
      throw e;
    }
  }, { esLectura: true });
}
