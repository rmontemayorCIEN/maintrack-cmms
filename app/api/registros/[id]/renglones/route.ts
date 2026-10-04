import { fail, ok, withAuth } from "@/lib/api";
import { guardarRenglon, revisarCaptura, tablaPorId } from "@/lib/registros";
import { revisarContrato } from "../../contrato";

/**
 * Captura un renglon.
 *
 * `withAuth` recibe `null` porque el permiso de esta tabla es un DATO, no una
 * constante del codigo: lo declara la tabla y lo revisa `revisarCaptura()`, que
 * de paso repite el control comercial que `withAuth` hace cuando el permiso no
 * es nulo. Sin esa llamada, una cuenta suspendida podria seguir capturando por
 * esta puerta mientras el resto del sistema esta en solo lectura.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(null, async ({ orgId, user }) => {
    const sinContrato = revisarContrato(user.organization);
    if (sinContrato) return sinContrato;

    const tabla = await tablaPorId(orgId, id);
    if (!tabla) return fail("Esa tabla no existe", 404);

    const permitido = revisarCaptura(user, tabla);
    if (!permitido.ok) return fail(permitido.motivo, permitido.estado);

    const cuerpo = (await req.json().catch(() => null)) as { valores?: Record<string, unknown> } | null;
    if (!cuerpo?.valores) return fail("No llegó nada que guardar");

    const r = await guardarRenglon(orgId, tabla.id, cuerpo.valores, user.id);
    return r.ok ? ok({ renglon: r.dato }, 201) : fail(r.motivos.join(" "), 422, r.motivos);
  });
}
