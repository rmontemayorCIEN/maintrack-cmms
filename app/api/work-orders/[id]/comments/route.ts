import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { emitirAviso } from "@/lib/avisos/emitir";

const schema = z.object({
  body: z.string().trim().min(1).max(4000),
  /** «Pedir apoyo»: la nota además avisa a supervisión (por notify, como todo aviso). */
  pedirApoyo: z.boolean().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const wo = await prisma.workOrder.findFirst({ where: { id, organizationId: orgId } });
    if (!wo) return fail("Orden de trabajo no encontrada", 404);
    const input = schema.parse(await request.json());
    const comment = await prisma.workOrderComment.create({
      data: { workOrderId: id, userId: user.id, body: input.pedirApoyo ? `Pide apoyo: ${input.body}` : input.body },
      include: { user: { select: { name: true, color: true } } },
    });
    if (input.pedirApoyo) {
      // La nota ya quedó: el aviso va después y, si falla, no tumba la nota.
      await emitirAviso({
        organizationId: orgId, tipo: "OT_APOYO_SOLICITADO", entidad: "WorkOrder", entidadId: wo.id, version: comment.id,
        titulo: `${user.name} pide apoyo en ${wo.number}`, cuerpo: input.body.slice(0, 300), enlace: `/work-orders/${wo.id}#bitacora`,
        porQue: "Quien está en campo necesita algo para poder seguir.", accion: "Responda en la bitácora de la orden o comuníquese con quien la ejecuta.",
        contexto: { siteId: wo.siteId, excluir: [user.id] }, tag: wo.number,
      });
    }
    return ok({ comment }, 201);
  });
}
