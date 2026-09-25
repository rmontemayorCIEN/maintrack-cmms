import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import {
  ANCLAS, MAXIMO_TEXTO, crearComentario, genteMencionable, listarComentarios, registroComentable,
  type Ancla,
} from "@/lib/comentarios";

/**
 * Comentarios de un registro: leerlos y escribir uno.
 *
 * `withAuth(null)` —pide sesion y nada mas— porque comentar no es un permiso
 * aparte: puede comentar quien puede VER el registro, y eso lo decide
 * `registroComentable` con la misma tabla de pantallas que el menu. Un permiso
 * propio dejaria gente que ve la orden y no puede decir lo que sabe, que es
 * justo lo que se esta tratando de rescatar de los chats sueltos.
 */
const ancla = z.enum(ANCLAS as unknown as [Ancla, ...Ancla[]]);

const leer = z.object({ ancla, anclaId: z.string().trim().min(1).max(60) });

const escribir = leer.extend({
  texto: z.string().trim().min(1).max(MAXIMO_TEXTO),
  /**
   * A quien se nombra, por identificador.
   *
   * Diez es de sobra para una nota de trabajo, y pone techo a cuantos avisos
   * puede disparar un solo comentario.
   */
  menciones: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
});

export async function GET(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const url = new URL(request.url);
    const datos = leer.safeParse({
      ancla: url.searchParams.get("ancla"),
      anclaId: url.searchParams.get("anclaId"),
    });
    if (!datos.success) return fail("Falta decir de qué registro", 422);

    const permiso = await registroComentable(orgId, user.role, datos.data.ancla, datos.data.anclaId, {
      esSuperAdmin: user.isSuperAdmin, esDemo: user.organization.esDemo,
    });
    if (!permiso.ok) return fail(permiso.motivo, 403);

    // La gente viaja con los comentarios: quien puede comentar puede mencionar,
    // asi que pedirla aparte serian dos viajes para el mismo permiso.
    const [comentarios, gente] = await Promise.all([
      listarComentarios(orgId, datos.data.ancla, datos.data.anclaId),
      genteMencionable(orgId),
    ]);
    return ok({ comentarios, gente });
  });
}

export async function POST(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const datos = escribir.parse(await request.json());

    const permiso = await registroComentable(orgId, user.role, datos.ancla, datos.anclaId, {
      esSuperAdmin: user.isSuperAdmin, esDemo: user.organization.esDemo,
    });
    if (!permiso.ok) return fail(permiso.motivo, 403);

    const r = await crearComentario({
      organizationId: orgId,
      autorId: user.id,
      autorNombre: user.name,
      ancla: datos.ancla,
      anclaId: datos.anclaId,
      texto: datos.texto,
      menciones: datos.menciones,
      enlace: permiso.enlace,
      comoSeLlama: permiso.comoSeLlama,
    });
    if (!r.ok) return fail(r.motivo, 422);

    // Se devuelve la lista entera y no solo el nuevo: si dos personas
    // escribieron a la vez, quien acaba de comentar ve las dos cosas sin
    // recargar, que es lo que uno espera de una conversacion.
    return ok({ comentarios: await listarComentarios(orgId, datos.ancla, datos.anclaId) });
  });
}
