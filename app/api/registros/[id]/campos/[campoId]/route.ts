import { fail, ok, withAuth } from "@/lib/api";
import { actualizarCampo } from "@/lib/registros";
import { revisarContrato } from "../../../contrato";

/**
 * Cambia una columna: su nombre, si es obligatoria, sus opciones, su orden, o
 * la apaga. El TIPO no se cambia nunca, y la razon esta en `lib/registros.ts`:
 * los valores viven en la columna del tipo, asi que cambiarlo dejaria invisible
 * todo lo ya capturado sin un solo mensaje de error.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; campoId: string }> }) {
  const { id, campoId } = await params;
  return withAuth("settings:write", async ({ orgId, user }) => {
    const sinContrato = revisarContrato(user.organization);
    if (sinContrato) return sinContrato;

    const cuerpo = (await req.json().catch(() => null)) as
      | { etiqueta?: string; descripcion?: string | null; requerido?: boolean; opciones?: string[]; enLista?: boolean; orden?: number; activo?: boolean }
      | null;
    if (!cuerpo) return fail("No llegó nada que cambiar");

    const r = await actualizarCampo(orgId, campoId, cuerpo, user.id, id);
    return r.ok ? ok({ campo: r.dato }) : fail(r.motivos.join(" "), 422, r.motivos);
  });
}
