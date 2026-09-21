/**
 * La voz del sistema: convertir el parte del dia en audio.
 *
 * ── Por que una voz del servidor y no la del aparato ──
 *
 * La voz que trae el telefono es gratis y no manda nada a ningun lado, pero
 * suena a maquina, y el producto que se vende aqui es «su director se entera
 * manejando». Una voz que no se puede oir treinta segundos sin fastidiarse no
 * cumple eso. Asi que la buena se sintetiza en el servidor y la del aparato se
 * queda como respaldo: cuando no hay credenciales —desarrollo—, cuando falla
 * la sintesis, o cuando la empresa no tiene el complemento.
 *
 * ── Por que espanol de Estados Unidos y no de Mexico ──
 *
 * Porque Mexico NO existe en el catalogo: Google solo tiene es-ES y es-US. El
 * de Espana no va para un cliente mexicano, y es-US es el latino neutro, que
 * es lo mas cercano. No es una preferencia: es lo unico razonable que hay.
 *
 * ── El proyecto de Google va fijo aqui, no lo pone la maquina ──
 *
 * En esta computadora conviven MainTrack y otro sistema, y las credenciales
 * de desarrollo apuntan al OTRO. La primera sintesis local fallo con
 * «Text-to-Speech no esta habilitada en avisos-obligaciones-4821»: la
 * libreria toma el proyecto de las credenciales, no del codigo. Si la API
 * hubiera estado habilitada alla, no habria fallado —habria facturado la voz
 * de MainTrack al proyecto equivocado, en silencio—. Por eso el proyecto se
 * fija aqui, igual que `scripts/proyecto.sh` lo fija para gcloud.
 *
 * ── El costo, y por que se guarda el audio ──
 *
 * Treinta dolares por millon de caracteres. Un parte de 455 caracteres son
 * 1.4 centavos de dolar. Poco, pero el mismo parte se oye varias veces —uno se
 * distrae, lo repite— y pagar cada repeticion seria tirar dinero por nada. El
 * audio se guarda con la huella del texto: si el texto no cambio, no se vuelve
 * a sintetizar.
 */
import { createHash } from "crypto";
import { guardarArchivo, leerArchivo } from "./almacenamiento";

/**
 * La voz. Escogida oyendo las treinta de es-US con el parte real, no por su
 * ficha. Cambiarla es cambiar esta linea; el audio guardado lleva el nombre
 * de la voz en su huella, asi que se regenera solo.
 */
export const PROYECTO = "maintrack-cmms-4821";
export const VOZ = "es-US-Chirp3-HD-Despina";
export const IDIOMA = "es-US";

/** Mas lento que lo normal: son cifras, y al volante no hay repetir. */
export const RITMO = 0.95;

const TIPO = "audio/mpeg";

/** Si hay con que sintetizar. En desarrollo normalmente no, y esta bien. */
export function vozConfigurada(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCS_BUCKET || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

/**
 * El texto con sus pausas, en el formato de marcas de Chirp 3.
 *
 * Las voces Chirp 3 aceptan `[pause]`, `[pause short]` y `[pause long]`, pero
 * SOLO en el campo `markup`; en `text` se leerian como palabras. La pausa
 * larga va entre un tema y otro —terminar de hablar de lo que esta parado y
 * empezar con las ordenes vencidas— y la corta dentro de una misma idea. Sin
 * esto, el parte sale de corrido y con cifras adentro nadie retiene nada.
 *
 * Los corchetes que pudiera traer el texto se quitan antes: si un equipo se
 * llamara «Bomba [respaldo]», esa marca inventada se leeria o romperia el
 * ritmo.
 */
export function conPausas(texto: string): string {
  const limpio = texto.replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim();
  return limpio
    // Entre oraciones, pausa larga: ahi cambia el tema.
    .replace(/([.!?])\s+/g, "$1 [pause] ")
    // Dentro de la oracion, un respiro.
    .replace(/([;:])\s+/g, "$1 [pause short] ")
    .trim();
}

/** La huella del audio: si cambia el texto, la voz o el ritmo, es otro archivo. */
export function huella(texto: string): string {
  return createHash("sha256").update(`${VOZ}|${RITMO}|${texto}`).digest("hex").slice(0, 32);
}

function rutaDe(organizationId: string, texto: string): string {
  return `org-${organizationId}/voz/${huella(texto)}.mp3`;
}

export type Sintesis = {
  audio: Buffer;
  /** De donde salio: recien sintetizado o del guardado. */
  origen: "nuevo" | "guardado";
  /** Lo que costo esta vez. Cero cuando venia guardado. */
  costoUsd: number;
};

/** Treinta dolares por millon de caracteres (Chirp 3 HD, tarifa publicada). */
const USD_POR_CARACTER = 30 / 1_000_000;

/**
 * El parte, en audio.
 *
 * Devuelve nulo cuando no se puede sintetizar —sin credenciales, error de la
 * API, idioma no disponible—. Nulo NO es un error que haya que enseñar: la
 * pantalla se queda con la voz del aparato y la persona igual escucha su
 * parte. Que se caiga la voz bonita no puede dejar a nadie sin su informacion.
 */
export async function sintetizar(
  organizationId: string,
  texto: string,
): Promise<Sintesis | null> {
  if (!texto.trim()) return null;
  const ruta = rutaDe(organizationId, texto);

  // Lo guardado primero: el mismo parte se oye varias veces.
  try {
    const guardado = await leerArchivo(ruta);
    if (guardado?.length) return { audio: guardado, origen: "guardado", costoUsd: 0 };
  } catch {
    // No estaba. Se sintetiza.
  }

  if (!vozConfigurada()) return null;

  try {
    /**
     * El proyecto al que se le cobra, fijado antes de construir el cliente.
     *
     * No basta pasarlo como opcion: la libreria lo toma del archivo de
     * credenciales, y en esta maquina ese archivo apunta al otro sistema. La
     * variable manda sobre el archivo y vive solo en este proceso, igual que
     * CLOUDSDK_CORE_PROJECT en los scripts. En Cloud Run no cambia nada: ahi
     * la cuenta de servicio ya es la del proyecto correcto.
     */
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||= PROYECTO;
    const { TextToSpeechClient } = await import("@google-cloud/text-to-speech");
    const cliente = new TextToSpeechClient({ projectId: PROYECTO });
    const markup = conPausas(texto);
    const [respuesta] = await cliente.synthesizeSpeech({
      input: { markup },
      voice: { languageCode: IDIOMA, name: VOZ },
      audioConfig: { audioEncoding: "MP3", speakingRate: RITMO },
    });
    const contenido = respuesta.audioContent;
    if (!contenido) return null;
    const audio = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido as Uint8Array);

    // Se guarda sin esperar: si falla el guardado, el audio ya se entrego y la
    // proxima vez se vuelve a sintetizar. Molesto, no roto.
    await guardarArchivo(ruta, audio, TIPO).catch(() => undefined);

    return { audio, origen: "nuevo", costoUsd: markup.length * USD_POR_CARACTER };
  } catch (e) {
    /**
     * Que la voz falle NO puede tumbar el parte, pero tampoco puede quedarse
     * callada. Sin este registro, un permiso mal puesto en produccion dejaria
     * a todos oyendo la voz del aparato para siempre, sin un solo error en
     * pantalla y sin que nadie lo notara. Queda en los registros de Cloud Run.
     */
    console.error("[voz] no se pudo sintetizar:", e instanceof Error ? e.message : e);
    return null;
  }
}
