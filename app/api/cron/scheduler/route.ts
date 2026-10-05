import { prisma } from "@/lib/db";
import { ejecutarProgramador } from "@/lib/avisos/proceso";
import { tomarFotoDeConstruccion } from "@/lib/constructor-historia";
import { corridaDeCron } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Endpoint de tarea programada (Cloud Scheduler / cron).
 * Recorre todas las organizaciones activas y genera las OT preventivas
 * cuya ventana de anticipacion ya se cumplio.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://APP/api/cron/scheduler
 *
 * De paso toma la foto semanal de la construccion de planes. Va aqui y no en
 * una tarea nueva a proposito: el avance del constructor se deriva, asi que la
 * curva historica solo existe si alguien la guarda, y una tarea programada mas
 * que alguien tiene que crear en la nube es una curva que puede no empezar
 * nunca. La foto es idempotente por semana: pasar a diario deja una sola.
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
    let fotos = 0;
    for (const org of organizations) {
      const result = await ejecutarProgramador(org.id);
      if (!result.ok) fallas += 1;
      summary.push(result.ok
        ? { organization: org.name, generated: result.generadas, skipped: result.omitidas, sinProgramacion: result.sinProgramacion }
        : { organization: org.name, error: result.error });

      // La foto nunca puede tumbar la generación de órdenes: es historia, no
      // operación. Si falla, se reporta y se sigue.
      try {
        const { nueva } = await tomarFotoDeConstruccion(org.id);
        if (nueva) fotos += 1;
      } catch (error) {
        console.error("[cron/scheduler] foto de construcción", org.name, error instanceof Error ? error.message : error);
      }
    }

    return { fallas, fotosNuevas: fotos, organizations: summary };
  });
}
