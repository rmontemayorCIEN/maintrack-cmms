import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";

const schema = z.object({
  meterId: z.string(),
  value: z.coerce.number().min(0),
  readingAt: z.string().optional(),
  note: z.string().optional(),
});

/**
 * Registro de lectura de medidor. Recalcula el promedio diario de uso, que
 * el programador utiliza para proyectar el vencimiento de los planes por
 * medidor (horas, kilometros o ciclos).
 */
export async function POST(request: Request) {
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const meter = await prisma.meter.findFirst({
      where: { id: input.meterId, organizationId: orgId },
    });
    if (!meter) return fail("Medidor no encontrado", 404);
    if (input.value < meter.currentValue) {
      return fail(`La lectura no puede ser menor a la actual (${meter.currentValue} ${meter.unit})`, 422);
    }

    const readingAt = input.readingAt ? new Date(input.readingAt) : new Date();
    const delta = input.value - meter.currentValue;

    await prisma.meterReading.create({
      data: {
        organizationId: orgId,
        meterId: meter.id,
        userId: user.id,
        value: input.value,
        delta,
        readingAt,
        note: input.note,
      },
    });

    const elapsedDays = meter.lastReadingAt
      ? Math.max(1, (readingAt.getTime() - meter.lastReadingAt.getTime()) / 86_400_000)
      : 1;
    const instantRate = delta / elapsedDays;
    // Media movil exponencial para suavizar el consumo diario.
    const dailyAverage = meter.dailyAverage > 0 ? meter.dailyAverage * 0.7 + instantRate * 0.3 : instantRate;

    const updated = await prisma.meter.update({
      where: { id: meter.id },
      data: { currentValue: input.value, lastReadingAt: readingAt, dailyAverage },
    });

    return ok({ meter: updated }, 201);
  });
}
