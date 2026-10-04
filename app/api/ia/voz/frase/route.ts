import { z } from "zod";
import { withVista } from "@/lib/api";
import { FRASES, sintetizar } from "@/lib/voz";

/**
 * Las frases fijas del modo voz, dichas.
 *
 * Solo se pueden pedir ESTAS, por clave: el saludo, el acuse de «deme un
 * momento» y los dos avisos. No recibe texto libre a proposito —para eso
 * esta la ruta de la respuesta, con su limite—, asi que por aqui nadie puede
 * usar el sistema como sintetizador.
 *
 * El audio de cada frase se guarda como cualquier otro, y como el texto no
 * cambia nunca, se genera una sola vez por empresa y voz. El saludo de todos
 * los dias sale gratis a partir del segundo.
 */
const schema = z.object({
  clave: z.enum(["saludo", "pensando", "sinDatos", "tope", "vamos"]),
});

export async function POST(request: Request) {
  return withVista("/consulta", async ({ user, orgId }) => {
    const { clave } = schema.parse(await request.json());
    const texto = clave === "saludo" ? FRASES.saludo(user.name) : FRASES[clave];

    const audio = await sintetizar(orgId, texto, user.vozBrief, user.id, user.organization.plan);
    if (!audio) return new Response(null, { status: 204 });

    return new Response(new Uint8Array(audio.audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.audio.length),
        "Cache-Control": "no-store",
      },
    });
  });
}
