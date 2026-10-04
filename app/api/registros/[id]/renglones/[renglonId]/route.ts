import { fail, ok, withAuth } from "@/lib/api";
import { actualizarRenglon, apagarRenglon, revisarCaptura, tablaPorId } from "@/lib/registros";
import { revisarContrato } from "../../../contrato";

/** El mismo guardian que al capturar: ver la tabla y escribir en ella son dos permisos. */
async function conPermisoDeCaptura(
  tablaId: string,
  accion: (ctx: { orgId: string; userId: string }) => Promise<Response>,
) {
  return withAuth(null, async ({ orgId, user }) => {
    const sinContrato = revisarContrato(user.organization);
    if (sinContrato) return sinContrato;
    const tabla = await tablaPorId(orgId, tablaId);
    if (!tabla) return fail("Esa tabla no existe", 404);
    const permitido = revisarCaptura(user, tabla);
    if (!permitido.ok) return fail(permitido.motivo, permitido.estado);
    return accion({ orgId, userId: user.id });
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; renglonId: string }> }) {
  const { id, renglonId } = await params;
  const cuerpo = (await req.json().catch(() => null)) as { valores?: Record<string, unknown> } | null;
  return conPermisoDeCaptura(id, async ({ orgId, userId }) => {
    if (!cuerpo?.valores) return fail("No llegó nada que cambiar");
    const r = await actualizarRenglon(orgId, renglonId, cuerpo.valores, userId, id);
    return r.ok ? ok({ renglon: r.dato }) : fail(r.motivos.join(" "), 422, r.motivos);
  });
}

/** Apaga el renglon. No se borra: lo capturado es historia de la planta. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; renglonId: string }> }) {
  const { id, renglonId } = await params;
  return conPermisoDeCaptura(id, async ({ orgId, userId }) => {
    const r = await apagarRenglon(orgId, renglonId, userId, id);
    return r.ok ? ok({ apagado: true }) : fail(r.motivos.join(" "), 422, r.motivos);
  });
}
