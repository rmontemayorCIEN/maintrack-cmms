import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, parseDate, withAuth } from "@/lib/api";
import { ErrorDeVigencia, guardarVigencia, listarVigencias, vigenciasDe } from "@/lib/vigencias";
import { ANCLAJES } from "@/lib/vigencias-tipos";

const esquema = z.object({
  tipo: z.string().min(1),
  titulo: z.string().min(1),
  folio: z.string().nullable().optional(),
  desde: z.string().nullable().optional(),
  hasta: z.string().nullable().optional(),
  avisarDias: z.number().int().nullable().optional(),
  cubre: z.string().nullable().optional(),
  nota: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  assetId: z.string().nullable().optional(),
  partId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
});

/**
 * GET /api/vigencias — todas, o las de un registro con ?assetId=…
 *
 * Devuelve tambien los proveedores, como hace `/api/compromisos` con la
 * gente: la pantalla los necesita para decir a quien se le reclama, y abrir
 * una ruta mas solo para eso es superficie de mas.
 */
export async function GET(request: Request) {
  return withAuth("workorder:execute", async ({ orgId }) => {
    const url = new URL(request.url);
    const proveedores = await prisma.supplier.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true }, orderBy: { name: "asc" },
    });
    const campo = ANCLAJES.find((a) => url.searchParams.get(a));
    if (campo) {
      return ok({ vigencias: await vigenciasDe(orgId, { [campo]: url.searchParams.get(campo)! }), proveedores });
    }
    return ok({
      vigencias: await listarVigencias(orgId, {
        tipo: url.searchParams.get("tipo") ?? undefined,
        soloActivas: url.searchParams.get("activas") === "1",
      }),
      proveedores,
    });
  });
}

export async function POST(request: Request) {
  return withAuth("vigencia:write", async ({ user, orgId }) => {
    const d = esquema.parse(await request.json());
    try {
      const v = await guardarVigencia({
        organizationId: orgId, userId: user.id,
        tipo: d.tipo, titulo: d.titulo, folio: d.folio, avisarDias: d.avisarDias,
        cubre: d.cubre, nota: d.nota, supplierId: d.supplierId,
        desde: parseDate(d.desde ?? null), hasta: parseDate(d.hasta ?? null),
        // De que cuelga va aparte: `userId` del cuerpo es la persona que cubre,
        // no quien captura. Ver el comentario de `guardarVigencia`.
        cuelgaDe: { assetId: d.assetId, partId: d.partId, userId: d.userId, serviceId: d.serviceId },
      });
      return ok({ vigencia: v }, 201);
    } catch (e) {
      if (e instanceof ErrorDeVigencia) return fail(e.message, 422);
      throw e;
    }
  });
}
