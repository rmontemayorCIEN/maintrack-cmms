import { fail, ok, withAuth } from "@/lib/api";
import { actualizarTabla } from "@/lib/registros";
import { revisarContrato } from "../contrato";

/** Renombra, reexplica, cambia quien la ve o la apaga. La clave no se toca. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("settings:write", async ({ orgId, user }) => {
    const sinContrato = revisarContrato(user.organization);
    if (sinContrato) return sinContrato;

    const cuerpo = (await req.json().catch(() => null)) as
      | { nombre?: string; descripcion?: string; permiso?: string; rolesVer?: string[]; icono?: string | null; orden?: number; activa?: boolean }
      | null;
    if (!cuerpo) return fail("No llegó nada que cambiar");

    const r = await actualizarTabla(orgId, id, cuerpo, user.id);
    return r.ok ? ok({ tabla: r.dato }) : fail(r.motivos.join(" "), 422, r.motivos);
  });
}
