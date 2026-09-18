import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, withAuth } from "@/lib/api";
import { nextRequestNumber } from "@/lib/numbering";
import { avisarSolicitudNueva } from "@/lib/avisos/detectores";

const schema = z.object({
  title: z.string().min(3),
  description: z.string().optional().nullable(),
  assetId: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
});

export async function GET() {
  return withAuth(null, async ({ orgId }) => {
    const requests = await prisma.workRequest.findMany({
      where: { organizationId: orgId },
      include: {
        asset: { select: { code: true, name: true } },
        requestedBy: { select: { name: true, color: true } },
        workOrder: { select: { id: true, number: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return ok({ requests });
  });
}

export async function POST(request: Request) {
  return withAuth("request:create", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const asset = input.assetId
      ? await prisma.asset.findFirst({ where: { id: input.assetId, organizationId: orgId } })
      : null;

    const number = await nextRequestNumber(orgId);
    const workRequest = await prisma.workRequest.create({
      data: {
        organizationId: orgId,
        number,
        title: input.title,
        description: input.description,
        assetId: asset?.id ?? null,
        siteId: asset?.siteId ?? null,
        locationId: input.locationId ?? asset?.locationId ?? null,
        priority: input.priority,
        requestedById: user.id,
      },
    });

    // A quien revisa solicitudes, empezando por supervisión (no a todo rol alto).
    await avisarSolicitudNueva(orgId, workRequest, { cuerpo: input.title });

    return ok({ request: workRequest }, 201);
  });
}
