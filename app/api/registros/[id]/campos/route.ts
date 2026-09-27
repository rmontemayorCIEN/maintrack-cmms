import { fail, ok, withAuth } from "@/lib/api";
import { agregarCampo } from "@/lib/registros";
import { revisarContrato } from "../../contrato";

/** Agrega una columna a una tabla que ya tiene datos. Lo capturado no se toca. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("settings:write", async ({ orgId, user }) => {
    const sinContrato = revisarContrato(user.organization);
    if (sinContrato) return sinContrato;

    const cuerpo = (await req.json().catch(() => null)) as
      | { etiqueta?: string; tipo?: string; descripcion?: string; requerido?: boolean; opciones?: string[]; enLista?: boolean }
      | null;
    if (!cuerpo?.etiqueta || !cuerpo?.tipo) return fail("Falta el nombre o el tipo del campo");

    const r = await agregarCampo(orgId, id, {
      etiqueta: cuerpo.etiqueta, tipo: cuerpo.tipo, descripcion: cuerpo.descripcion,
      requerido: cuerpo.requerido, opciones: cuerpo.opciones, enLista: cuerpo.enLista,
    }, user.id);
    return r.ok ? ok({ campo: r.dato }, 201) : fail(r.motivos.join(" "), 422, r.motivos);
  });
}
