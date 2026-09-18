import { prisma } from "@/lib/db";
import { fail, ok, withAuth, withVista } from "@/lib/api";

/** Propuestas de un levantamiento, para la pantalla de revision. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withVista("/assets/levantamiento", async ({ orgId }) => {
    const intake = await prisma.assetIntake.findFirst({
      where: { id, organizationId: orgId },
      select: {
        notaIa: true,
        propuestas: {
          where: { estado: { not: "APLICADO" } },
          select: {
            id: true, sistema: true, nombre: true, categoria: true,
            criticidad: true, ubicacion: true, cantidad: true, porQue: true,
          },
        },
      },
    });
    if (!intake) return fail("Levantamiento no encontrado", 404);
    return ok({ propuestas: intake.propuestas, nota: intake.notaIa });
  });
}
