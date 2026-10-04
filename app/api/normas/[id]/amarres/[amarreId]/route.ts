import { fail, ok, withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { desamarrar } from "@/lib/normas";
import { revisarContrato } from "../../../contrato";

/** Quita un respaldo de una obligación. La pieza no se toca: sigue viva en su módulo. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; amarreId: string }> }) {
  const { id, amarreId } = await params;
  return withAuth("settings:write", async ({ orgId, user }) => {
    const sinContrato = revisarContrato(user.organization);
    if (sinContrato) return sinContrato;

    const suyo = await prisma.amarreDeCumplimiento.findFirst({
      where: { id: amarreId, organizationId: orgId, obligacion: { normaId: id } }, select: { id: true },
    });
    if (!suyo) return fail("Ese respaldo no es de esta norma", 404);

    const r = await desamarrar(orgId, amarreId, user.id);
    return r.ok ? ok({ quitado: true }) : fail(r.motivos.join(" "), 422, r.motivos);
  });
}
