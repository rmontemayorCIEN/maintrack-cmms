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
