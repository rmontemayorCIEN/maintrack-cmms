import { z } from "zod";
import { withVista } from "@/lib/api";
import { paraDecir, sintetizar } from "@/lib/voz";

/**
 * La respuesta de «Pregúntale a sus datos», dicha en voz alta.
 *
 * ── Por que recibe el texto y no lo vuelve a generar ──
 *
 * La respuesta ya se calculo y ya se le cobro al cliente una operacion de IA.
 * Volver a preguntarle al modelo para poder leerla seria cobrar dos veces por
 * la misma respuesta —y podria contestar algo distinto, que es peor: lo que
 * se oye no coincidiria con lo que esta en pantalla—.
 *
 * ── El limite de largo no es un capricho ──
 *
 * Es lo unico que separa esto de un sintetizador de texto libre. Con sesion
 * de la empresa cualquiera podria mandar paginas enteras y cobrarselas a su
 * propia cuenta; 1500 caracteres cubren de sobra una respuesta —son unos
 * noventa segundos hablados— y acotan el gasto. Se recorta en vez de
 * rechazar: quedarse sin audio por tres caracteres de mas seria absurdo.
 */
const schema = z.object({
  texto: z.string().trim().min(1).transform((t) => t.slice(0, 1500)),
});

export async function POST(request: Request) {
  return withVista("/consulta", async ({ user, orgId }) => {
    const { texto } = schema.parse(await request.json());

    // Lo que se oye pasa por la misma limpieza que el parte: importes con
    // signo, porcentajes y vinetas dichos tal cual suenan a maquina.
    const audio = await sintetizar(orgId, paraDecir(texto), user.vozBrief);
    if (!audio) return new Response(null, { status: 204 });

    return new Response(new Uint8Array(audio.audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.audio.length),
        // El navegador no lo guarda: si la persona cambia de voz en Ajustes,
        // la siguiente respuesta tiene que sonar con la nueva.
        "Cache-Control": "no-store",
      },
    });
  });
}
