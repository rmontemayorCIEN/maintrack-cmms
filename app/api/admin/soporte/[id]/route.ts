import { z } from "../../../../../lib/zod";
import { fail, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/superadmin";
import { logAudit } from "@/lib/audit";
import { responderSoporte, ESTADOS_SOPORTE } from "@/lib/soporte";

const esquema = z.object({
  estado: z.enum(Object.keys(ESTADOS_SOPORTE) as [keyof typeof ESTADOS_SOPORTE, ...Array<keyof typeof ESTADOS_SOPORTE>]),
  respuesta: z.string().trim().max(4000).optional().nullable(),
});

/** El operador responde: estado y, si hace falta, el texto para el cliente. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireSuperAdmin();
  if (error) return error;
  const parsed = esquema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos", 422);
  const r = await responderSoporte({ id: (await params).id, operadorId: user.id, ...parsed.data });
  // Lo que el operador contesta a un cliente queda en su bitacora (ISO 27001, 8.15).
  if (r) await logAudit({ organizationId: user.organizacionPropia.id, userId: user.id, entity: "SolicitudSoporte", entityId: r.id, action: "SUPPORT_REPLIED", summary: `Respondió una solicitud de soporte (estado: ${r.estado})` });
  return r ? ok({ solicitud: { id: r.id, estado: r.estado } }) : fail("Solicitud no encontrada", 404);
}
