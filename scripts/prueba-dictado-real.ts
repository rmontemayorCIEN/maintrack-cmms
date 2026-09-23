/**
 * El dictado, de verdad: voz sintetizada → audio → texto.
 *
 * Cuesta dinero y llama a Google, asi que NO corre sola: hay que pedirla.
 *
 *   ./scripts/con-produccion.sh scripts/prueba-dictado-real.ts --cobrar
 *
 * ── Por que pide una bandera y las demas `*-real` no ──
 *
 * Las otras fallan solas en la maquina de desarrollo porque ahi no hay llave
 * de Anthropic, y esa ausencia las frena. Esta no: las credenciales de Google
 * de la maquina si sirven para Speech, asi que se ejecuto DENTRO de la suite
 * completa —ocho transcripciones de casi un minuto— y lo cobro sin que nadie
 * lo pidiera. Se descubrio porque fue la unica `*-real` que no aparecio en la
 * lista de fallidas, que era justo la señal de que si habia corrido.
 *
 * Sin la bandera no hace nada y sale bien: una prueba que no se pidio no es
 * una prueba fallida, y ensuciar la lista de fallas con esto haria que se
 * dejara de mirar.
 *
 * `prueba-escucha-real` se frena pidiendo `GOOGLE_CLOUD_PROJECT` en el
 * entorno. Aqui no basta: esa variable si viene puesta cuando se corre con
 * `con-produccion.sh`, que es como se corre esto. La bandera ademas dice en
 * una palabra lo que va a pasar.
 *
 * ── Por que existe ──
 *
 * `prueba-dictado.ts` cuida los candados y la bolsa, pero no toca a Google:
 * en la maquina de desarrollo no hay credencial, asi que ahi la transcripcion
 * siempre falla y la prueba no puede distinguir «el modelo no existe» de «no
 * hay llave». El dictado usa un modelo DISTINTO al del chat de voz —largo, no
 * corto— y un nombre de modelo equivocado no rompe la compilacion: rompe el
 * dia que un tecnico toca el microfono, y se ve como «no se pudo transcribir»
 * sin decir por que.
 *
 * ── Como se prueba sin un microfono ──
 *
 * El sistema ya sabe hablar. Se le hace decir un cierre como lo diria un
 * tecnico, y ese audio se mete por donde entraria el del telefono. No prueba
 * el ruido de la planta —eso no lo prueba nadie desde un escritorio— pero si
 * prueba el camino completo y, sobre todo, que lo largo no salga cortado, que
 * es el riesgo real del modelo.
 */
import { escuchar, MODELOS, MAXIMO_SEGUNDOS_DICTADO, type ModoDeEscucha } from "../lib/escucha";
import { PROYECTO, IDIOMA, RITMO, nombreDeVoz, VOZ_POR_OMISION } from "../lib/voz";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

/**
 * Un cierre como lo dicta un tecnico: de corrido, con marca de refaccion,
 * numero de equipo y duracion. Es largo a proposito —del orden de lo que se
 * dicta de verdad—, porque lo que se quiere descubrir es si el modelo largo
 * lo entrega completo o lo corta a la mitad.
 */
const CIERRE = [
  "Revisé la bomba tres de la línea dos.",
  "Venía haciendo ruido desde el lunes por el lado libre.",
  "Cambié el rodamiento y el sello mecánico, me llevó hora y media.",
  "Aproveché para alinear el motor, quedó dentro de tolerancia.",
  "Queda pendiente revisar la base, tiene un tornillo flojo.",
  "Le puse grasa nueva a las chumaceras y limpié el cárter, estaba con lodo.",
  "La temperatura del cojinete bajó de setenta y ocho a cincuenta y dos grados.",
  "Revisé también el acoplamiento y las gomas están gastadas, hay que pedirlas.",
  "El manómetro de descarga no marca, creo que está tapado o descompuesto.",
  "Dejé la bomba corriendo veinte minutos y no volvió a hacer el ruido.",
  "El operador de turno quedó enterado de que hay que estarla vigilando.",
].join(" ");

/** Palabras que TIENEN que sobrevivir el viaje para que el cierre sirva. */
const CLAVES = ["bomba", "rodamiento", "sello", "alinear", "pendiente"];

async function hablar(texto: string): Promise<Buffer> {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||= PROYECTO;
  const { TextToSpeechClient } = await import("@google-cloud/text-to-speech");
  const cliente = new TextToSpeechClient({ projectId: PROYECTO });
  /**
   * Exactamente como habla el sistema, y las dos partes importan:
   *
   *   `markup` y no `text` — estas voces rechazan el texto plano con «requiere
   *   un modelo», que suena a otra cosa y manda a buscar donde no es.
   *
   *   `nombreDeVoz()` y no la clave — Google quiere «es-US-Chirp3-HD-Despina»;
   *   con «Despina» a secas contesta que la voz necesita modelo, que tampoco
   *   dice nada del problema real.
   */
  const [r] = await cliente.synthesizeSpeech({
    input: { markup: texto },
    voice: { languageCode: IDIOMA, name: nombreDeVoz(VOZ_POR_OMISION) },
    audioConfig: { audioEncoding: "LINEAR16", speakingRate: RITMO },
  });
  const c = r.audioContent;
  if (!c) throw new Error("La síntesis no devolvió audio");
  return Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array);
}

const normalizar = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

async function main() {
  if (!process.argv.includes("--cobrar")) {
    console.log("");
    console.log("  Esta prueba sintetiza voz y transcribe de verdad: cuesta unos centavos");
    console.log("  y tarda un par de minutos. Por eso no corre sola.");
    console.log("");
    console.log("    ./scripts/con-produccion.sh scripts/prueba-dictado-real.ts --cobrar");
    console.log("");
    return;
  }
  console.log("\nEl camino completo: hablar, oír y entender\n");
  console.log(`  tope del dictado: ${MAXIMO_SEGUNDOS_DICTADO} s`);

  const audio = await hablar(CIERRE);
  revisar("se generó el audio de prueba", audio.length > 0, `${(audio.length / 1024).toFixed(0)} KB`);

  const oido = await escuchar(audio, "largo");
  // Nulo aqui es lo que importa cazar: quiere decir que la llamada fallo, y
  // la causa mas probable es que el modelo no se llame como creemos.
  revisar("el reconocimiento contesta", oido !== null,
    oido === null ? "nulo: revise el nombre del modelo y el permiso de Speech" : "");
  if (!oido) return;

  revisar("entendió algo", oido.texto.length > 0, oido.texto.slice(0, 120));
  revisar("Google reportó lo que facturó, que es de donde sale el costo",
    oido.segundosFacturados !== null, `${oido.segundosFacturados ?? "—"} s`);

  const dicho = normalizar(oido.texto);
  for (const clave of CLAVES) {
    revisar(`sobrevivió «${clave}»`, dicho.includes(normalizar(clave)));
  }

  /**
   * Lo que de verdad se vino a probar: que no se corte.
   *
   * El modelo corto esta afinado para frases sueltas y con un dictado largo
   * entrega los primeros segundos y suelta el resto. Eso NO se ve como error:
   * se ve como un cierre incompleto que el tecnico da por bueno.
   */
  const proporcion = oido.texto.length / CIERRE.length;
  revisar("entregó el dictado completo, no los primeros segundos",
    proporcion > 0.7, `${Math.round(proporcion * 100)} % del largo original`);

  /**
   * Cuanto se facturo contra cuanto se dicto.
   *
   * Es lo que le llega al cliente como un dictado de su bolsa y a nosotros
   * como segundos en el recibo. Verlo junto evita descubrir tarde que un
   * dictado promedio cuesta el triple de lo presupuestado.
   */
  const segundos = oido.segundosFacturados ?? 0;
  console.log("");
  console.log(`  ${CIERRE.length} caracteres dictados = ${segundos} s facturados`);
  console.log(`  un dictado así cuesta ${(segundos * (0.016 / 60)).toFixed(4)} USD, y le descuenta 1 de su bolsa`);
  revisar("un dictado largo de verdad cabe en el tope",
    segundos <= MAXIMO_SEGUNDOS_DICTADO, `${segundos} s de ${MAXIMO_SEGUNDOS_DICTADO}`);

  /**
   * Los dos modelos, con el MISMO audio y varias veces cada uno.
   *
   * Tres y no una: la primera vez que se comparo salio una corrida por lado,
   * el corto no salio peor, y se concluyo que el modelo largo sobraba. La
   * corrida siguiente del corto entrego el 38 % del texto. Una sola medicion
   * por lado ya llevo a una conclusion falsa en este proyecto mas de una vez.
   *
   * Lo que se busca no es cual entiende mejor: es cual entrega TODO. Un
   * modelo que a veces se come la mitad del dictado sin avisar es peor que
   * uno que entiende un poco menos, porque el que se lo come no se nota.
   */
  console.log("\nLos dos modelos, mismo audio, tres corridas cada uno\n");
  const VUELTAS = 3;
  const resultados: Record<ModoDeEscucha, { pct: number; seg: number }[]> = { corto: [], largo: [] };
  for (const modo of ["corto", "largo"] as ModoDeEscucha[]) {
    for (let i = 0; i < VUELTAS; i++) {
      const r = await escuchar(audio, modo);
      resultados[modo].push({
        pct: Math.round(((r?.texto.length ?? 0) / CIERRE.length) * 100),
        seg: Math.round(r?.segundosFacturados ?? 0),
      });
    }
    const v = resultados[modo];
    console.log(`  ${MODELOS[modo].padEnd(13)} ${v.map((x) => `${x.pct}% (${x.seg}s)`).join("   ")}`);
  }

  // El criterio: que NINGUNA corrida se quede corta. Un promedio bueno con
  // una corrida al 38 % sigue siendo un cierre cortado para alguien.
  const completo = (v: { pct: number }[]) => v.every((x) => x.pct > 70);
  revisar("el modelo del dictado entrega el dictado completo TODAS las veces",
    completo(resultados.largo), resultados.largo.map((x) => `${x.pct}%`).join(" "));
  if (completo(resultados.corto)) {
    console.log("");
    console.log("  El corto tampoco se quedó corto esta vez. NO basta para volver a uno");
    console.log("  solo: ya se le vio entregar el 38 %. Haría falta verlo estable varias");
    console.log("  veces, en días distintos, antes de quitarle el modelo largo al dictado.");
  }

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(() => process.exit(fallas ? 1 : 0));
