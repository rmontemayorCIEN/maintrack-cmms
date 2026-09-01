import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";

const schema = z.object({ body: z.string().min(1).max(4000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const wo = await prisma.workOrder.findFirst({ where: { id, organizationId: orgId } });
    if (!wo) return fail("Orden de trabajo no encontrada", 404);
    const input = schema.parse(await request.json());
    const comment = await prisma.workOrderComment.create({
      data: { workOrderId: id, userId: user.id, body: input.body },
      include: { user: { select: { name: true, color: true } } },
    });
    return ok({ comment }, 201);
  });
}
