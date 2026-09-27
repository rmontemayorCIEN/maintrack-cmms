import { fail, ok, withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { amarrar } from "@/lib/normas";
import type { PiezaDeCumplimiento } from "@/lib/normas-tipos";
import { revisarContrato } from "../../contrato";

const PIEZAS = ["plan", "vigencia", "tabla", "rondin", "orden"] as const;

/** Amarra una pieza del sistema a una obligación: con esto se cumple. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("settings:write", async ({ orgId, user }) => {
    const sinContrato = revisarContrato(user.organization);
    if (sinContrato) return sinContrato;

    const cuerpo = (await req.json().catch(() => null)) as { obligacionId?: string; pieza?: string; piezaId?: string } | null;
    if (!cuerpo?.obligacionId || !cuerpo?.pieza || !cuerpo?.piezaId) return fail("Falta qué amarrar");
    if (!PIEZAS.includes(cuerpo.pieza as never)) return fail("Eso no se puede amarrar");

    const suya = await prisma.obligacionAdoptada.findFirst({
      where: { id: cuerpo.obligacionId, normaId: id, norma: { organizationId: orgId } }, select: { id: true },
    });
    if (!suya) return fail("Esa obligación no es de esta norma", 404);

    const r = await amarrar(orgId, cuerpo.obligacionId, cuerpo.pieza as PiezaDeCumplimiento, cuerpo.piezaId, user.id);
    return r.ok ? ok({ amarre: r.dato }, 201) : fail(r.motivos.join(" "), 422, r.motivos);
  });
}
