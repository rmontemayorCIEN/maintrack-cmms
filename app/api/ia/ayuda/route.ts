import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada, motivoLegible } from "@/lib/ia/cliente";
import { responderAyuda } from "@/lib/ia/ayuda-ia";
import { ayudaDe } from "@/lib/ayuda";
import { GLOSARIO } from "@/lib/glosario";

export const maxDuration = 120;

const schema = z.object({
  pregunta: z.string().trim().min(4).max(500),
  pantalla: z.string().trim().max(200).default("/dashboard"),
  /**
   * El termino del glosario del que sale la pregunta.
   *
   * Viaja la CLAVE, no la definicion: la definicion se busca aqui en el
   * catalogo. Dejar que el navegador mande el texto seria dejar que quien
   * pregunta le dicte al modelo que significa un termino, y con eso se le
   * puede hacer decir casi cualquier cosa.
   */
  termino: z.string().trim().max(80).optional(),
});

/** Ayuda con IA: la documentacion del sistema mas los datos de la cuenta. */
export async function POST(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("La ayuda con inteligencia artificial no esta configurada en este servidor.", 503);
    }
    const input = schema.parse(await request.json());

    try {
      const r = await responderAyuda(
        {
          id: orgId,
          plan: user.organization.plan,
          iaComplemento: user.organization.iaComplemento,
          iaExtra: user.organization.iaExtra,
        },
        {
          pregunta: input.pregunta,
          pantalla: input.pantalla,
          titulo: ayudaDe(input.pantalla)?.titulo ?? null,
          rol: user.role,
          userId: user.id,
          operador: user.isSuperAdmin,
          termino: input.termino
            ? GLOSARIO.find((t) => t.t.toLowerCase() === input.termino!.toLowerCase()) ?? null
            : null,
        },
      );
      if (!r.ok) return fail(r.motivo, 402);
      return ok({ respuesta: r.respuesta, consultas: r.consultas });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(motivoLegible(error), 502);
    }
  });
}
