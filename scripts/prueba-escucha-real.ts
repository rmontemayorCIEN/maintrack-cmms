/**
 * Oir de verdad: el ciclo completo contra Google.
 *
 * Se sintetiza una pregunta, se transcribe de vuelta y se compara. Es la
 * unica forma de saber si el reconocimiento sirve para esto: una prueba en
 * seco solo diria que la funcion no truena.
 *
 * Cuesta centavos y no va en el despliegue.
 *
 *   npx tsx scripts/prueba-escucha-real.ts
 */
import { escuchar, IDIOMA_ESCUCHA, MAXIMO_SEGUNDOS } from "../lib/escucha";
import { sintetizar, vozConfigurada } from "../lib/voz";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle = "") {
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${detalle ? ` · ${detalle}` : ""}`);
  if (!bien) fallas++;
}

/** Sin acentos ni signos, que es lo que varia entre decir y oir. */
const llano = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const PREGUNTAS = [
  "Qué equipo me costó más este trimestre",
  "Cuántas órdenes vencidas tengo",
  "Qué refacciones se acabaron",
  "Cómo va la disponibilidad del compresor",
];

async function main() {
  if (!vozConfigurada()) {
    console.log("\n  Sin credenciales de Google: esta prueba llama a la API y no puede correr.");
    console.log("  GOOGLE_CLOUD_PROJECT=maintrack-cmms-4821 npx tsx scripts/prueba-escucha-real.ts\n");
    process.exit(1);
  }

  console.log(`\nSe dice una pregunta y se oye de vuelta (${IDIOMA_ESCUCHA})\n`);

  let entendidas = 0;
  for (const pregunta of PREGUNTAS) {
    const audio = await sintetizar("prueba-escucha", pregunta, "Kore");
    if (!audio) { revisar(`sintetizar «${pregunta}»`, false, "no se pudo"); continue; }

    const t = Date.now();
    const oido = await escuchar(audio.audio);
    const ms = Date.now() - t;

    const igual = oido ? llano(oido.texto) === llano(pregunta) : false;
    if (igual) entendidas++;
    revisar(`«${pregunta}»`, igual, `oyó «${oido?.texto ?? "nada"}» · ${((oido?.confianza ?? 0) * 100).toFixed(0)}% · ${ms} ms`);
  }

  revisar("entiende al menos tres de cuatro", entendidas >= 3, `${entendidas} de ${PREGUNTAS.length}`);

  /**
   * Una pregunta larga, cerca del tope que el chat permite.
   *
   * Aqui arriba todas las preguntas son de tres o cuatro segundos, asi que
   * nunca se supo que pasa cerca de los treinta que el chat acepta. Y hay
   * motivo para preguntarselo: midiendo el dictado se vio que este mismo
   * modelo, con un audio de cuarenta y nueve segundos, entrego 76 %, 38 % y
   * 76 % en tres corridas, facturando solo la parte que proceso.
   *
   * Si aqui se queda corto, el chat lleva tiempo contestando preguntas a las
   * que les falta la mitad, y **sin dar error**: contesta bien a una pregunta
   * que nadie hizo. Es de los que no se anuncian.
   *
   * Tres corridas porque el corte no es constante: una sola pasada puede
   * tocarle de las buenas y decir que todo esta bien.
   */
  console.log(`\nUna pregunta larga, cerca del tope del chat (${MAXIMO_SEGUNDOS} s)\n`);
  const LARGA = [
    "Oye, necesito que me digas cómo vamos con el mantenimiento preventivo de la planta,",
    "sobre todo en la línea dos, porque el mes pasado se nos cayó dos veces el compresor",
    "y quiero saber si las órdenes preventivas de ese equipo se están haciendo a tiempo",
    "o si se están recorriendo, y de paso cuánto llevamos gastado en refacciones de esa línea",
    "en lo que va del trimestre comparado con el anterior.",
  ].join(" ");

  const audioLargo = await sintetizar("prueba-escucha", LARGA, "Kore");
  if (!audioLargo) {
    revisar("sintetizar la pregunta larga", false, "no se pudo");
  } else {
    const vueltas: Array<{ pct: number; seg: number }> = [];
    for (let i = 0; i < 3; i++) {
      const r = await escuchar(audioLargo.audio);
      vueltas.push({
        pct: Math.round(((r?.texto.length ?? 0) / LARGA.length) * 100),
        seg: Math.round(r?.segundosFacturados ?? 0),
      });
    }
    console.log(`  ${LARGA.length} caracteres dichos`);
    console.log(`  entendido: ${vueltas.map((v) => `${v.pct}% (${v.seg}s)`).join("   ")}`);

    // El criterio es el mismo del dictado: que NINGUNA corrida se quede
    // corta. Un promedio bueno con una mala sigue siendo una pregunta
    // contestada a medias para alguien.
    revisar("una pregunta larga se entiende COMPLETA las tres veces",
      vueltas.every((v) => v.pct > 70), vueltas.map((v) => `${v.pct}%`).join(" "));
  }

  console.log("\nLo que NO debe pasar\n");
  const vacio = await escuchar(Buffer.alloc(0));
  revisar("con audio vacío devuelve nada, sin reventar", vacio === null);

  const basura = await escuchar(Buffer.from("esto no es audio, es texto suelto"));
  revisar("con basura devuelve nada, sin reventar", basura === null);

  revisar("el tope de grabación es corto: nadie pregunta cinco minutos",
    MAXIMO_SEGUNDOS <= 60, `${MAXIMO_SEGUNDOS} segundos`);

  console.log(`\n${fallas ? `${fallas} FALLARON` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(() => process.exit(fallas ? 1 : 0));
