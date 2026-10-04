import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { terminarRondin } from "@/lib/rondin";

/** Cerrar el recorrido, y verlo con sus paradas. */
const alCerrar = z.object({ nota: z.string().trim().max(2000).optional().nullable() });

export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ orgId }) => {
    const rondin = await prisma.rondin.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true, numero: true, estado: true, iniciadoEn: true, terminadoEn: true, nota: true,
        location: { select: { id: true, name: true } },
        site: { select: { name: true } },
        iniciadoPor: { select: { name: true } },
        paradas: {
          orderBy: { orden: "asc" },
          select: {
            id: true, orden: true, comoSeIdentifico: true, observacion: true, createdAt: true,
            asset: { select: { id: true, code: true, name: true } },
            location: { select: { name: true } },
            reportPoint: { select: { nombre: true } },
            adjuntos: { select: { id: true, name: true, kind: true } },
          },
        },
      },
    });
    if (!rondin) return fail("El recorrido no existe", 404);
    return ok({ rondin });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ orgId }) => {
    const input = alCerrar.parse(await request.json().catch(() => ({})));
    const r = await terminarRondin(orgId, id, input.nota);
    if (!r.ok) return fail(r.motivo, 409);
    return ok({ paradas: r.paradas, vacio: r.vacio });
  });
}
