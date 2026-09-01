import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const crearProveedor = z.object({
  name: z.string().trim().min(2).max(140),
  contactName: z.string().trim().max(120).optional().nullable(),
  email: z.union([z.string().trim().email(), z.literal("")]).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  leadTimeDays: z.coerce.number().int().min(0).max(365).default(7),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function POST(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const datos = crearProveedor.parse(await request.json());

    const proveedor = await prisma.supplier.create({
      data: { ...datos, email: datos.email || null, organizationId: orgId },
      select: { id: true, name: true },
    });

    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Supplier", entityId: proveedor.id, action: "CREATED",
      summary: `Proveedor dado de alta: ${proveedor.name}`,
    });

    return ok({ id: proveedor.id }, 201);
  });
}
