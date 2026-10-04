import { z } from "zod";
import { fail, ok, parseDate, withAuth } from "@/lib/api";
import { ErrorDeVigencia, cambiarActivaVigencia, guardarVigencia } from "@/lib/vigencias";

const esquema = z.object({
  tipo: z.string().min(1).optional(),
  titulo: z.string().min(1).optional(),
  folio: z.string().nullable().optional(),
  desde: z.string().nullable().optional(),
  hasta: z.string().nullable().optional(),
  avisarDias: z.number().int().nullable().optional(),
  cubre: z.string().nullable().optional(),
  nota: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  /** Cancelar o reactivar. No hay borrado: ver `cambiarActivaVigencia`. */
  activa: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAuth("vigencia:write", async ({ user, orgId }) => {
    const { id } = await params;
    const d = esquema.parse(await request.json());
    try {
      if (d.activa !== undefined && Object.keys(d).length === 1) {
        return ok({ vigencia: await cambiarActivaVigencia({ organizationId: orgId, userId: user.id, id, activa: d.activa }) });
      }
      if (!d.tipo || !d.titulo) return fail("Falta el tipo o el nombre de la vigencia", 422);
      const v = await guardarVigencia({
        organizationId: orgId, userId: user.id, id,
        tipo: d.tipo, titulo: d.titulo, folio: d.folio, avisarDias: d.avisarDias,
        cubre: d.cubre, nota: d.nota, supplierId: d.supplierId,
        desde: parseDate(d.desde ?? null), hasta: parseDate(d.hasta ?? null),
      });
      return ok({ vigencia: v });
    } catch (e) {
      if (e instanceof ErrorDeVigencia) return fail(e.message, 422);
      throw e;
    }
  });
}
