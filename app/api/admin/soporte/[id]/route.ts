import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/superadmin";
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
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos", 422);
  const r = await responderSoporte({ id: (await params).id, operadorId: user.id, ...parsed.data });
  return r ? ok({ solicitud: { id: r.id, estado: r.estado } }) : fail("Solicitud no encontrada", 404);
}
