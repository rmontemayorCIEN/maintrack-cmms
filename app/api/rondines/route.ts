import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { iniciarRondin, rondinEnCurso } from "@/lib/rondin";

/**
 * El recorrido por la planta: empezarlo y saber si hay uno a medias.
 *
 * `workorder:execute` y no un permiso de supervision: el rondin lo hace quien
 * camina la planta, y muchas veces es el tecnico. Cerrarlo a supervision
 * dejaria fuera a quien mas pasa por ahi.
 */
const alEmpezar = z.object({
  siteId: z.string().optional().nullable(),
  /** El área que se va a recorrer. Acota de qué equipos se puede tratar. */
  locationId: z.string().optional().nullable(),
});

export async function GET() {
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const abierto = await rondinEnCurso(orgId, user.id);
    return ok({ rondin: abierto });
  });
}

export async function POST(request: Request) {
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const input = alEmpezar.parse(await request.json().catch(() => ({})));

    // El área tiene que ser de esta empresa: de ella sale con qué equipos se
    // compara después lo que se dicta.
    if (input.locationId) {
      const { prisma } = await import("@/lib/db");
      const existe = await prisma.location.count({ where: { id: input.locationId, organizationId: orgId } });
      if (!existe) return fail("Esa área no existe en su empresa", 404);
    }

    const { rondin, reanudado } = await iniciarRondin(orgId, user.id, input);
    // 200 y no 201 cuando se reanuda: no se creó nada, y la pantalla tiene que
    // poder decir «va en la parada 4» en vez de estrenar uno vacío.
    return ok({ rondin, reanudado }, reanudado ? 200 : 201);
  });
}
