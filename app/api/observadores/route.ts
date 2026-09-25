import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { alternarObservador, cuantosObservan, observa } from "@/lib/observadores";
import { registroComentable } from "@/lib/comentarios";
import { ANCLAS, type Ancla } from "@/lib/comentarios-tipos";

/**
 * «Aviseme lo que pase con esto»: encender y apagar.
 *
 * La entidad que se guarda es la que usa `emitirAviso` —WorkOrder, Asset...—,
 * no el ancla de los comentarios: son dos vocabularios y el que manda aqui es
 * el del emisor, porque es ahi donde se resuelve a quien se avisa.
 */
const ENTIDAD_DE: Record<Ancla, string> = {
  workOrder: "WorkOrder",
  asset: "Asset",
  workRequest: "WorkRequest",
  materialRequest: "MaterialRequest",
};

const schema = z.object({
  ancla: z.enum(ANCLAS as unknown as [Ancla, ...Ancla[]]),
  anclaId: z.string().trim().min(1).max(60),
});

export async function GET(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const url = new URL(request.url);
    const d = schema.safeParse({ ancla: url.searchParams.get("ancla"), anclaId: url.searchParams.get("anclaId") });
    if (!d.success) return fail("Falta decir de qué registro", 422);
    const permiso = await registroComentable(orgId, user.role, d.data.ancla, d.data.anclaId, {
      esSuperAdmin: user.isSuperAdmin, esDemo: user.organization.esDemo,
    });
    if (!permiso.ok) return fail(permiso.motivo, 403);
    const entidad = ENTIDAD_DE[d.data.ancla];
    const [mio, total] = await Promise.all([
      observa(orgId, user.id, entidad, d.data.anclaId),
      cuantosObservan(orgId, entidad, d.data.anclaId),
    ]);
    return ok({ observa: mio, total });
  });
}

export async function POST(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const d = schema.parse(await request.json());
    const permiso = await registroComentable(orgId, user.role, d.ancla, d.anclaId, {
      esSuperAdmin: user.isSuperAdmin, esDemo: user.organization.esDemo,
    });
    if (!permiso.ok) return fail(permiso.motivo, 403);
    const entidad = ENTIDAD_DE[d.ancla];
    const r = await alternarObservador(orgId, user.id, entidad, d.anclaId);
    return ok({ ...r, total: await cuantosObservan(orgId, entidad, d.anclaId) });
  });
}
