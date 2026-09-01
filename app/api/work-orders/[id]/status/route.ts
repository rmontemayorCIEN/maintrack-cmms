import { z } from "zod";
import { ok, withAuth } from "@/lib/api";
import { transitionWorkOrder } from "@/lib/workorders";

const schema = z.object({
  status: z.enum(["DRAFT", "OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED", "CANCELLED"]),
  resolution: z.string().optional(),
  rootCauseId: z.string().nullable().optional(),
  failureCodeId: z.string().nullable().optional(),
  downtimeMinutes: z.coerce.number().min(0).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const workOrder = await transitionWorkOrder({
      workOrderId: id,
      to: input.status,
      userId: user.id,
      organizationId: orgId,
      resolution: input.resolution,
      rootCauseId: input.rootCauseId,
      failureCodeId: input.failureCodeId,
      downtimeMinutes: input.downtimeMinutes,
    });
    return ok({ workOrder });
  });
}
