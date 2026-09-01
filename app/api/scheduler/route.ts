import { z } from "zod";
import { ok, withAuth } from "@/lib/api";
import { generateScheduledWorkOrders } from "@/lib/scheduler";

const schema = z.object({
  horizonDays: z.coerce.number().int().min(0).max(365).default(0),
  dryRun: z.boolean().default(false),
});

/** Ejecucion manual del programador desde la interfaz. */
export async function POST(request: Request) {
  return withAuth("plan:write", async ({ user, orgId }) => {
    const body = await request.json().catch(() => ({}));
    const input = schema.parse(body);
    const result = await generateScheduledWorkOrders(orgId, {
      horizonDays: input.horizonDays,
      userId: user.id,
      dryRun: input.dryRun,
    });
    return ok(result);
  });
}
