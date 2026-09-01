import { z } from "zod";
import { ok, withAuth } from "@/lib/api";
import { ingestSensorReading } from "@/lib/predictive";

const schema = z.object({
  sensorId: z.string(),
  value: z.coerce.number(),
  readingAt: z.string().optional(),
  source: z.string().optional(),
});

const bulkSchema = z.object({ readings: z.array(schema).min(1).max(500) });

/** Ingesta de lecturas de condicion (manual o desde pasarela IoT). */
export async function POST(request: Request) {
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const body = await request.json();
    const bulk = bulkSchema.safeParse(body);
    const items = bulk.success ? bulk.data.readings : [schema.parse(body)];

    const results = [];
    for (const item of items) {
      results.push(
        await ingestSensorReading({
          organizationId: orgId,
          sensorId: item.sensorId,
          value: item.value,
          readingAt: item.readingAt ? new Date(item.readingAt) : undefined,
          source: item.source ?? "IOT",
          userId: user.id,
        }),
      );
    }
    return ok({ processed: results.length, results }, 201);
  });
}
