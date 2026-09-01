import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, parseDate, withAuth } from "@/lib/api";
import { verificarCupo } from "@/lib/planes";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  siteId: z.string(),
  locationId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  criticality: z.enum(["A", "B", "C"]).default("B"),
  status: z.enum(["OPERATIONAL", "DEGRADED", "DOWN", "STANDBY", "RETIRED"]).default("OPERATIONAL"),
  purchaseDate: z.string().optional().nullable(),
  purchaseCost: z.coerce.number().min(0).default(0),
  replacementCost: z.coerce.number().min(0).default(0),
  warrantyExpiry: z.string().optional().nullable(),
  expectedLifeYears: z.coerce.number().int().min(0).optional().nullable(),
});

export async function GET(request: Request) {
  return withAuth(null, async ({ orgId }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q");
    const assets = await prisma.asset.findMany({
      where: {
        organizationId: orgId,
        active: true,
        ...(q
          ? { OR: [{ name: { contains: q } }, { code: { contains: q } }, { serialNumber: { contains: q } }] }
          : {}),
      },
      include: {
        site: { select: { name: true } },
        location: { select: { name: true } },
        category: { select: { name: true } },
      },
      orderBy: { code: "asc" },
      take: 300,
    });
    return ok({ assets });
  });
}

export async function POST(request: Request) {
  return withAuth("asset:write", async ({ user, orgId }) => {
    const cupo = await verificarCupo(orgId, user.organization.plan, "assets");
    if (!cupo.permitido) return fail(cupo.mensaje, 402);

    const input = schema.parse(await request.json());
    const asset = await prisma.asset.create({
      data: {
        ...input,
        organizationId: orgId,
        locationId: input.locationId || null,
        categoryId: input.categoryId || null,
        parentId: input.parentId || null,
        purchaseDate: parseDate(input.purchaseDate),
        warrantyExpiry: parseDate(input.warrantyExpiry),
      },
    });
    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Asset",
      entityId: asset.id,
      action: "CREATED",
      summary: `${asset.code} — ${asset.name}`,
    });
    return ok({ asset }, 201);
  });
}
