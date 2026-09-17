import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeAcceso, emitirRestablecimiento } from "@/lib/acceso";

type Params = { params: Promise<{ id: string }> };

/**
 * Emite una liga de restablecimiento para alguien de MI empresa.
 *
 * La liga se entrega en la respuesta una sola vez: no se guarda en claro y no
 * se puede volver a consultar. Quien la pide necesita permiso de administrar
 * usuarios, y solo puede pedirla para su propia organizacion.
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("user:manage", async ({ user, orgId }) => {
    try {
      const r = await emitirRestablecimiento({ organizationId: orgId, userId: id, emitidoPorId: user.id });
      return ok(r, 201);
    } catch (e) {
      if (e instanceof ErrorDeAcceso) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
