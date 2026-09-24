import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { puedeVerRuta } from "@/lib/pantallas";
import { IaNoConfigurada, iaConfigurada } from "@/lib/ia/cliente";
import { responderConsulta } from "@/lib/ia/consulta";
import { HAY_MAS_ESCRITO, largoDe, loQueSeDice } from "@/lib/respuestas-voz";

export const maxDuration = 300;

const schema = z.object({
  pregunta: z.string().trim().min(5).max(500),
  /**
   * La pregunta se hizo HABLANDO y la respuesta se va a oír.
   *
   * Lo manda el modo voz. Con esto la preferencia de «qué tanto le contesta
   * hablando» vale también ahí, y no solo en el micrófono de la barra: la
   * pantalla de Ajustes dice «con el micrófono», y el modo voz es un
   * micrófono. Escrito no cambia nada: leer de más no le cuesta tiempo a
   * nadie.
   */
  paraVoz: z.boolean().optional(),
});

/**
 * Consulta en lenguaje natural.
 *
 * Sin permiso de ESCRITURA —preguntar no cambia nada— pero con la misma
 * guardia que la pantalla: `withAuth(null)` dejaba entrar a cualquier rol con
 * sesion, y las herramientas devolvian costos a quien la interfaz se los
 * oculta. Ahora la ruta pide lo mismo que /consulta y las herramientas saben
 * con que rol corren.
 */
export async function POST(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("La función de inteligencia artificial no esta configurada en este servidor.", 503);
    }
    if (!puedeVerRuta(user.role, "/consulta", { esSuperAdmin: user.isSuperAdmin, esDemo: user.organization.esDemo })) {
      return fail("Esta función no es de su rol.", 403);
    }
    const input = schema.parse(await request.json());

    try {
      const r = await responderConsulta(
        { id: orgId, plan: user.organization.plan, iaComplemento: user.organization.iaComplemento, iaExtra: user.organization.iaExtra },
        {
          pregunta: input.pregunta, userId: user.id, rol: user.role,
          largoHablado: input.paraVoz ? largoDe(user.respuestaVoz) : undefined,
        },
      );
      if (!r.ok) return fail(r.motivo, 402);
      // Entera para leer, recortada para oír. Ver `lib/respuestas-voz.ts`.
      const d = input.paraVoz ? loQueSeDice(r.respuesta, largoDe(user.respuestaVoz)) : null;
      return ok({
        respuesta: r.respuesta,
        hablado: d ? (d.hayMas ? `${d.texto}\n\n${HAY_MAS_ESCRITO}` : d.texto) : undefined,
        consultas: r.consultas,
      });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(error instanceof Error ? error.message : "No fue posible responder", 502);
    }
  });
}
