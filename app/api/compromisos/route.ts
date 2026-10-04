import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { MAXIMO_TEXTO_COMPROMISO, crearCompromiso, listarCompromisos } from "@/lib/compromisos";
import { genteMencionable } from "@/lib/comentarios";
import { ENTIDADES_ANCLABLES, registroAnclable } from "@/lib/anclas";

/**
 * Los compromisos de un registro: leerlos y anotar uno.
 *
 * La entidad se valida contra `lib/anclas.ts`, que es la lista de lo que se
 * puede anclar. Un tipo que no esté ahí se rechaza aquí, antes de tocar la
 * base: sin esa lista, `entidad` sería texto libre y cualquiera podría colgar
 * compromisos de cosas que no existen.
 */
const base = z.object({
  entidad: z.enum(ENTIDADES_ANCLABLES as unknown as [string, ...string[]]),
  entidadId: z.string().trim().min(1).max(60),
});

const escribir = base.extend({
  texto: z.string().trim().min(1).max(MAXIMO_TEXTO_COMPROMISO),
  responsableId: z.string().trim().min(1).max(60).nullable().optional(),
  /** Fecha en AAAA-MM-DD; sin hora, porque un compromiso es de un dia. */
  paraCuando: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function GET(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const url = new URL(request.url);
    const d = base.safeParse({ entidad: url.searchParams.get("entidad"), entidadId: url.searchParams.get("entidadId") });
    if (!d.success) return fail("Falta decir de qué registro", 422);
    const permiso = await registroAnclable(orgId, user.role, d.data.entidad, d.data.entidadId, {
      esSuperAdmin: user.isSuperAdmin, esDemo: user.organization.esDemo,
    });
    if (!permiso.ok) return fail(permiso.motivo, 403);
    const [compromisos, gente] = await Promise.all([
      listarCompromisos(orgId, d.data.entidad, d.data.entidadId),
      genteMencionable(orgId),
    ]);
    return ok({ compromisos, gente });
  });
}

export async function POST(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const d = escribir.parse(await request.json());
    const permiso = await registroAnclable(orgId, user.role, d.entidad, d.entidadId, {
      esSuperAdmin: user.isSuperAdmin, esDemo: user.organization.esDemo,
    });
    if (!permiso.ok) return fail(permiso.motivo, 403);

    const r = await crearCompromiso({
      organizationId: orgId, creadoPorId: user.id, creadoPorNombre: user.name,
      entidad: d.entidad, entidadId: d.entidadId, texto: d.texto,
      responsableId: d.responsableId ?? null,
      // A mediodía en UTC: así la fecha no se corre un día en ninguna zona,
      // que es el defecto clásico de guardar una fecha sin hora.
      paraCuando: d.paraCuando ? new Date(`${d.paraCuando}T12:00:00Z`) : null,
      enlace: permiso.enlace, comoSeLlama: permiso.comoSeLlama,
    });
    if (!r.ok) return fail(r.motivo, 422);
    return ok({ compromisos: await listarCompromisos(orgId, d.entidad, d.entidadId) });
  });
}
