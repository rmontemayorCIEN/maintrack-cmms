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

// El tope de la grabacion vive en `lib/dictado.ts`, que no importa nada:
// lo necesitan por igual el navegador y el servidor.
export { MAXIMO_SEGUNDOS_DICTADO } from "./dictado";

/** Espanol de Mexico: aqui si existe, a diferencia de la voz. */
export const IDIOMA_ESCUCHA = "es-MX";

/** Lo que se acepta grabar en el chat. Mas que esto no es una pregunta. */
export const MAXIMO_SEGUNDOS = 30;

/**
 * Lo que cuesta escuchar, por segundo.
 *
 * Es la tarifa de lista de Google al momento de escribir esto; la verdad es
 * la factura. Vive aqui para que el costo del dictado se vea junto al de la
 * voz en la consola y nadie tenga que adivinarlo. Si cambia el precio, se
 * cambia aqui y ya.
 */
export const USD_POR_SEGUNDO = 0.016 / 60;

/**
 * Cual modelo de reconocimiento, y por que son dos.
 *
 * `corto` es el del chat de voz: alguien suelta una pregunta de cinco
 * segundos. `largo` es el del dictado, donde un tecnico cuenta de corrido lo
 * que hizo durante casi un minuto.
 *
 * Esto esta medido, con el mismo audio de cuarenta y nueve segundos y tres
 * corridas de cada lado:
 *
 *   latest_short   38 % (19 s)   76 % (39 s)   76 % (39 s)
 *   latest_long    94 % (48 s)   94 % (48 s)   94 % (48 s)
 *
 * El corto NUNCA entrego el dictado completo: se quedo entre los 19 y los 39
 * segundos de los 49, y facturo solo eso. Y lo grave no es que entienda
 * menos: es que **falla en silencio**. Devuelve un texto que se lee perfecto,
 * bien puntuado, sin un solo error en pantalla. El tecnico no se acuerda
 * palabra por palabra de lo que acaba de dictar, lo da por bueno, y la orden
 * queda con la mitad de lo que paso.
 *
 * Hubo una medicion anterior, de una corrida por lado, en la que el corto
 * salio igual de bien y se concluyo que el modelo largo sobraba. Estaba mal:
 * esa corrida le toco de las buenas.
 *
 * La medicion esta en `scripts/prueba-dictado-real.ts` y se repite en un
 * minuto. Antes de volver a un solo modelo, correrla varias veces de cada
 * lado: una sola corrida por lado fue justo lo que llevo a la conclusion
 * equivocada la primera vez.
 */
export const MODELOS = { corto: "latest_short", largo: "latest_long" } as const;
export type ModoDeEscucha = keyof typeof MODELOS;

/**
 * Lo que se oyo.
 *
 * `texto` vacio y nulo NO son lo mismo, y confundirlos sale caro:
 *
 *   texto: ""  — Google escucho y no entendio nada. Pasa con ruido de planta
 *                o con el telefono lejos. **Se facturo igual**, asi que el
 *                gasto existe y hay que registrarlo.
 *   null       — la llamada ni siquiera se pudo hacer: credencial, permiso,
 *                red. No se facturo nada, y registrar un costo aqui seria
 *                inventar un gasto que nunca ocurrio.
 *
 * Antes los dos casos devolvian nulo. Daba igual mientras nadie contara el
 * dinero; desde que el dictado se cobra de una bolsa, no.
 */
export type Escuchado = {
  texto: string;
  confianza: number;
  /**
   * Los segundos que Google dice que facturo.
   *
   * Nulo cuando no los reporto. Nulo NO es cero: quien lo use tiene que
   * resolver que hacer sin el dato, no registrar un costo de cero que
   * ensuciaria el tablero haciendo ver el dictado como gratis.
   */
  segundosFacturados: number | null;
} | null;

/**
 * El audio, en palabras.
 *
 * No entender no es un error que haya que gritar: la pantalla dice «no le
 * entendi, intente de nuevo», que es lo que diria una persona. Que falle la
 * llamada tampoco tumba nada —se escribe a mano—, pero si queda en los
 * registros: un permiso mal puesto dejaria el microfono mudo para siempre sin
 * que nadie lo notara.
 */
export async function escuchar(audio: Buffer, modo: ModoDeEscucha = "corto"): Promise<Escuchado> {
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
        model: MODELOS[modo],
        features: { enableAutomaticPunctuation: true },
      },
      content: audio,
    });

    // Lo que Google dice que facturo, no lo que duro la grabacion. Es la
    // unica cifra que cuadra con el recibo. Viene como Duration, con los
    // segundos en un campo que a veces llega como texto.
    //
    // Se lee ANTES de mirar si se entendio algo, a proposito: el audio que no
    // se entendio tambien se cobro, y ese es justo el caso en el que el gasto
    // se perderia de vista.
    const medido = respuesta.metadata?.totalBilledDuration;
    const crudo = medido ? Number(medido.seconds ?? 0) + Number(medido.nanos ?? 0) / 1e9 : NaN;
    const segundosFacturados = Number.isFinite(crudo) && crudo > 0 ? crudo : null;

    const partes = (respuesta.results ?? [])
      .map((r) => r.alternatives?.[0])
      .filter((a): a is NonNullable<typeof a> => Boolean(a?.transcript));

    const texto = partes.map((a) => a.transcript).join(" ").trim();
    if (!texto) return { texto: "", confianza: 0, segundosFacturados };

    // La confianza promedio, para poder repreguntar cuando se entendio mal
    // en vez de contestar una pregunta que nadie hizo.
    const confianza = partes.reduce((s, a) => s + (a.confidence ?? 0), 0) / partes.length;

    return { texto, confianza, segundosFacturados };
  } catch (e) {
    // Nulo: la llamada no se hizo. Nada que cobrar y nada que transcribir.
    console.error("[escucha] no se pudo transcribir:", e instanceof Error ? e.message : e);
    return null;
  }
}
