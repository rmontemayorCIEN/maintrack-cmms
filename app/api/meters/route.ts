import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { tipoPorUnidad } from "@/lib/medidores";

const createSchema = z.object({
  assetId: z.string(),
  name: z.string().min(1),
  unit: z.string().default("h"),
  currentValue: z.coerce.number().min(0).default(0),
  maxIncrementoDiario: z.coerce.number().positive().nullable().optional(),
});

export async function GET() {
  return withAuth(null, async ({ orgId }) => {
    const meters = await prisma.meter.findMany({
      where: { organizationId: orgId },
      include: { asset: { select: { code: true, name: true } } },
      orderBy: { lastReadingAt: "desc" },
    });
    return ok({ meters });
  });
}

export async function POST(request: Request) {
  return withAuth("asset:write", async ({ orgId }) => {
    const input = createSchema.parse(await request.json());
    const asset = await prisma.asset.findFirst({ where: { id: input.assetId, organizationId: orgId } });
    if (!asset) return fail("Activo no encontrado", 404);
    // El tipo sale de la unidad: decide que lecturas son imposibles.
    const meter = await prisma.meter.create({ data: { ...input, tipo: tipoPorUnidad(input.unit), organizationId: orgId } });
    return ok({ meter }, 201);
  });
}
