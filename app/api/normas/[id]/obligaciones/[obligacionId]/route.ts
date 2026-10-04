import { fail, ok, withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { marcarNoAplica, marcarQueAplica } from "@/lib/normas";
import { revisarContrato } from "../../../contrato";

/** Marca una obligación como que no aplica (con su razón) o vuelve a considerarla. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; obligacionId: string }> }) {
  const { id, obligacionId } = await params;
  return withAuth("settings:write", async ({ orgId, user }) => {
    const sinContrato = revisarContrato(user.organization);
    if (sinContrato) return sinContrato;

    // La obligación tiene que ser DE ESA norma, no de otra: el permiso se
    // revisó con la norma de la dirección. Mismo criterio que los renglones
    // de los registros propios.
    const suya = await prisma.obligacionAdoptada.findFirst({
      where: { id: obligacionId, normaId: id, norma: { organizationId: orgId } }, select: { id: true },
    });
    if (!suya) return fail("Esa obligación no es de esta norma", 404);

    const cuerpo = (await req.json().catch(() => null)) as { aplica?: boolean; razon?: string } | null;
    if (!cuerpo) return fail("No llegó nada que cambiar");

    const r = cuerpo.aplica === false
      ? await marcarNoAplica(orgId, obligacionId, cuerpo.razon ?? "", user.id)
      : await marcarQueAplica(orgId, obligacionId, user.id);
    return r.ok ? ok({ actualizada: true }) : fail(r.motivos.join(" "), 422, r.motivos);
  });
}
