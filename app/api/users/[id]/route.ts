import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";

const schema = z.object({
  role: z.enum(["ADMIN", "SUPERVISOR", "TECHNICIAN", "REQUESTER", "VIEWER"]).optional(),
  active: z.boolean().optional(),
  hourlyRate: z.coerce.number().min(0).optional(),
  jobTitle: z.string().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("user:manage", async ({ orgId, user }) => {
    const target = await prisma.user.findFirst({ where: { id, organizationId: orgId } });
    if (!target) return fail("Usuario no encontrado", 404);
    if (target.role === "OWNER") return fail("No se puede modificar al propietario", 403);
    if (target.id === user.id) return fail("No puede modificar su propio rol", 403);

    const input = schema.parse(await request.json());
    const updated = await prisma.user.update({
      where: { id },
      data: input,
      select: { id: true, name: true, role: true, active: true },
    });
    return ok({ user: updated });
  });
}
