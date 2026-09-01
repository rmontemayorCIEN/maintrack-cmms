import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateScheduledWorkOrders } from "@/lib/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Endpoint de tarea programada (Cloud Scheduler / cron).
 * Recorre todas las organizaciones activas y genera las OT preventivas
 * cuya ventana de anticipacion ya se cumplio.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://APP/api/cron/scheduler
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const organizations = await prisma.organization.findMany({
    where: { status: { in: ["ACTIVE", "TRIAL"] } },
    select: { id: true, name: true },
  });

  const summary = [];
  for (const org of organizations) {
    const result = await generateScheduledWorkOrders(org.id, { horizonDays: 0 });
    summary.push({ organization: org.name, generated: result.generated, skipped: result.skipped });
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), organizations: summary });
}
