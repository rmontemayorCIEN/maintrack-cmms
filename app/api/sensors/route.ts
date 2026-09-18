import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth, withVista } from "@/lib/api";
import { verificarCupo } from "@/lib/planes";

const schema = z.object({
  assetId: z.string(),
  name: z.string().min(1),
  sensorType: z.enum(["VIBRATION", "TEMPERATURE", "PRESSURE", "CURRENT", "OIL", "ULTRASOUND", "FLOW", "RPM"]),
  unit: z.string().min(1),
  warningThreshold: z.coerce.number().optional().nullable(),
  criticalThreshold: z.coerce.number().optional().nullable(),
  direction: z.enum(["ABOVE", "BELOW"]).default("ABOVE"),
  samplingHours: z.coerce.number().int().positive().default(24),
});

export async function GET() {
  return withVista("/predictive", async ({ orgId }) => {
    const sensors = await prisma.sensor.findMany({
      where: { organizationId: orgId, active: true },
      include: { asset: { select: { code: true, name: true, criticality: true } } },
      orderBy: [{ lastStatus: "desc" }, { name: "asc" }],
    });
    return ok({ sensors });
  });
}

export async function POST(request: Request) {
  return withAuth("predictive:write", async ({ user, orgId }) => {
    const cupo = await verificarCupo(orgId, user.organization.plan, "sensors");
    if (!cupo.permitido) return fail(cupo.mensaje, 402);

    const input = schema.parse(await request.json());
    const asset = await prisma.asset.findFirst({ where: { id: input.assetId, organizationId: orgId } });
    if (!asset) return fail("Activo no encontrado", 404);
    const sensor = await prisma.sensor.create({ data: { ...input, organizationId: orgId } });
    return ok({ sensor }, 201);
  });
}
