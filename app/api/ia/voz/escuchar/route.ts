import { fail, ok, withVista } from "@/lib/api";
import { escuchar, MAXIMO_SEGUNDOS } from "@/lib/escucha";
import { puedeHablar, tieneChatDeVoz } from "@/lib/voz";

/**
 * La pregunta, dictada.
 *
 * Recibe el audio crudo que grabo el navegador y devuelve lo que se entendio.
 * No contesta nada: solo transcribe. Quien pregunta es la pantalla, con la
 * ruta de consulta de siempre, y asi lo dictado pasa por exactamente los
 * mismos controles que lo escrito —ni un atajo—.
 *
 * ── El limite de tamaño ──
 *
 * Treinta segundos de audio comprimido no pasan de un mega. El tope existe
 * porque esto recibe un archivo: sin el, alguien podria subir una hora de
 * grabacion y cobrarsela a su empresa. Tambien evita esperas absurdas: nadie
 * hace una pregunta de cinco minutos.
 */
const MAXIMO_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  return withVista("/consulta", async ({ user, orgId }) => {
    // Dictar es parte del chat con voz, que es de Enterprise. Sin esto,
    // cualquiera podria llamar a la ruta aunque no vea el boton.
    if (!tieneChatDeVoz(user.organization.plan)) {
      return fail("El chat con voz es del plan Enterprise", 403);
    }

    // El mismo tope que la voz: transcribir tambien cuesta.
    const veredicto = await puedeHablar({ id: orgId, plan: user.organization.plan });
    if (!veredicto.puede) return fail(veredicto.motivo, 429);

    const crudo = await request.arrayBuffer();
    if (!crudo.byteLength) return fail("No llegó el audio", 422);
    if (crudo.byteLength > MAXIMO_BYTES) {
      return fail(`La grabación es muy larga. Máximo ${MAXIMO_SEGUNDOS} segundos.`, 413);
    }

    const oido = await escuchar(Buffer.from(crudo));
    // No entender NO es un error del sistema: es lo que pasa con ruido de
    // planta o con el telefono lejos. Se contesta 200 con el hueco, y la
    // pantalla dice «no le entendi» en vez de enseñar una falla.
    if (!oido) return ok({ texto: "", confianza: 0 });

    return ok({ texto: oido.texto, confianza: oido.confianza });
  });
}
