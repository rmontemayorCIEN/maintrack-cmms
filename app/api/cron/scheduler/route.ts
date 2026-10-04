import { prisma } from "@/lib/db";
import { ejecutarProgramador } from "@/lib/avisos/proceso";
import { corridaDeCron } from "@/lib/cron";

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
  return corridaDeCron(request, "scheduler", async () => {
    const organizations = await prisma.organization.findMany({
      where: { status: { in: ["ACTIVE", "TRIAL"] } },
      select: { id: true, name: true },
    });

    // Cada empresa por separado: si una falla, se avisa a esa empresa y las
    // demás siguen. Antes una excepción cortaba la corrida de todas, en silencio.
    const summary = [];
    let fallas = 0;
    for (const org of organizations) {
      const result = await ejecutarProgramador(org.id);
      if (!result.ok) fallas += 1;
      summary.push(result.ok
        ? { organization: org.name, generated: result.generadas, skipped: result.omitidas, sinProgramacion: result.sinProgramacion }
        : { organization: org.name, error: result.error });
    }

    return { fallas, organizations: summary };
  });
}
