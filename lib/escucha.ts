/**
 * Oir: pasar de audio a texto.
 *
 * ── Por que se graba y se manda, en vez de usar el navegador ──
 *
 * Chrome trae reconocimiento de voz de balde. Safari de iPhone NO, y el
 * caso de uso de esto es justamente el iPhone en el camino. Asi que se graba
 * con `MediaRecorder` —que si existe en los dos— y se transcribe en el
 * servidor. Cuesta unos centavos por minuto, y es lo unico que funciona
 * donde tiene que funcionar.
 *
 * ── Por que la version 2 de la API ──
 *
 * Safari graba en MP4/AAC y Chrome en WebM/Opus. La version 1 obliga a
 * declarar el formato y no acepta el de Safari; la 2 lo detecta sola. Sin
 * eso habria que convertir el audio en el servidor —otra dependencia, otra
 * forma de fallar— o dejar fuera al iPhone, que es el aparato que importa.
 *
 * ── El proyecto va fijo, igual que en la voz ──
 *
 * Las credenciales de la maquina de desarrollo apuntan al otro sistema de
 * Rafael. Si no se fija, se factura la transcripcion al proyecto equivocado
 * y nadie se entera.
 */
import { PROYECTO } from "./voz";

/** Espanol de Mexico: aqui si existe, a diferencia de la voz. */
export const IDIOMA_ESCUCHA = "es-MX";

/** Lo que se acepta grabar, en segundos. Mas que esto no es una pregunta. */
export const MAXIMO_SEGUNDOS = 30;

export type Escuchado = { texto: string; confianza: number } | null;

/**
 * El audio, en palabras.
 *
 * Devuelve nulo cuando no se entendio nada —silencio, ruido de planta, el
 * telefono en la bolsa—. Nulo NO es un error que haya que gritar: la
 * pantalla dice «no le entendi, intente de nuevo», que es lo que diria una
 * persona.
 */
export async function escuchar(audio: Buffer): Promise<Escuchado> {
  if (!audio?.length) return null;

  try {
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||= PROYECTO;
    const { SpeechClient } = await import("@google-cloud/speech").then((m) => ({ SpeechClient: m.v2.SpeechClient }));
    const cliente = new SpeechClient({ projectId: PROYECTO });

    const [respuesta] = await cliente.recognize({
      recognizer: `projects/${PROYECTO}/locations/global/recognizers/_`,
      config: {
        // Detecta el formato solo: Safari manda MP4 y Chrome WebM.
        autoDecodingConfig: {},
        languageCodes: [IDIOMA_ESCUCHA],
        model: "latest_short",
        features: { enableAutomaticPunctuation: true },
      },
      content: audio,
    });

    const partes = (respuesta.results ?? [])
      .map((r) => r.alternatives?.[0])
      .filter((a): a is NonNullable<typeof a> => Boolean(a?.transcript));

    if (!partes.length) return null;

    const texto = partes.map((a) => a.transcript).join(" ").trim();
    if (!texto) return null;

    // La confianza promedio, para poder repreguntar cuando se entendio mal
    // en vez de contestar una pregunta que nadie hizo.
    const confianza = partes.reduce((s, a) => s + (a.confidence ?? 0), 0) / partes.length;
    return { texto, confianza };
  } catch (e) {
    // Que falle oir no puede tumbar la pantalla: se escribe la pregunta y ya.
    // Pero queda en los registros, o un permiso mal puesto dejaria el
    // microfono mudo para siempre sin que nadie lo note.
    console.error("[escucha] no se pudo transcribir:", e instanceof Error ? e.message : e);
    return null;
  }
}
