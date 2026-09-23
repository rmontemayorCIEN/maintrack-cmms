/**
 * Saber cuándo alguien terminó de hablar, sin micrófono de por medio.
 *
 * La medición del audio vive en el navegador y no se puede correr aquí; la
 * DECISIÓN sí, y es donde están los errores que importan. Se le dan niveles a
 * mano —como si vinieran del micrófono— y se comprueba cuándo corta.
 *
 * Los tres defectos que esto vigila, y los tres se sienten igual de mal:
 *
 *   1. Cortar a media frase. Quien está dictando pierde lo que dijo.
 *   2. No cortar nunca en un lugar ruidoso, que devuelve al problema de tener
 *      que dar dos toques —y peor, sin que se entienda por qué—.
 *   3. Cortar antes de que la persona empiece: uno toca el botón y después
 *      piensa qué va a decir.
 *
 *   npx tsx scripts/prueba-deteccion-voz.ts
 */
import { crearDetectorDeSilencio, SILENCIO_COMANDO_MS, SILENCIO_DICTADO_MS } from "../lib/deteccion-voz";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

const MUESTRA = 100;

/** Corre una secuencia de niveles y dice en qué muestra cortó (o nunca). */
function correr(niveles: number[], silencioMs = SILENCIO_COMANDO_MS): number | null {
  const d = crearDetectorDeSilencio({ silencioMs, muestraMs: MUESTRA });
  for (let i = 0; i < niveles.length; i++) {
    if (d.alNivel(niveles[i]) === "cortar") return i;
  }
  return null;
}

const repetir = (valor: number, veces: number) => Array.from({ length: veces }, () => valor);
/** Voz: no es un tono plano, sube y baja. */
const voz = (veces: number, base: number) =>
  Array.from({ length: veces }, (_, i) => base * (0.6 + 0.8 * Math.abs(Math.sin(i / 2))));

function main() {
  console.log("\nEn una oficina callada\n");
  // Medio segundo de silencio (calibración), dos de voz, y se calla.
  const oficina = [...repetir(0.002, 5), ...voz(20, 0.2), ...repetir(0.002, 40)];
  const cortoOficina = correr(oficina);
  revisar("corta cuando la persona termina", cortoOficina !== null, { muestra: cortoOficina });
  revisar("   y no antes de que termine de hablar", (cortoOficina ?? 0) > 25, { muestra: cortoOficina });
  // 1.8 s son 18 muestras: debe cortar alrededor de la 43 (25 + 18).
  revisar("   ni mucho después: cerca del silencio pedido",
    cortoOficina !== null && cortoOficina <= 25 + SILENCIO_COMANDO_MS / MUESTRA + 2, { muestra: cortoOficina });

  console.log("\nJunto a un compresor\n");
  /**
   * El ruido de fondo aquí es MÁS FUERTE que la voz de la oficina de arriba.
   * Con un umbral fijo, o esto no corta nunca o aquello cortaba enseguida: por
   * eso el umbral se calibra contra el lugar.
   */
  const planta = [...repetir(0.05, 5), ...voz(20, 0.4), ...repetir(0.05, 40)];
  const cortoPlanta = correr(planta);
  revisar("también corta, aunque el «silencio» suene fuerte", cortoPlanta !== null, { muestra: cortoPlanta });
  revisar("   y tampoco a media frase", (cortoPlanta ?? 0) > 25, { muestra: cortoPlanta });

  console.log("\nQuien tarda en arrancar\n");
  // Toca el botón y piensa cuatro segundos antes de hablar. No puede cortarse.
  const pensativo = [...repetir(0.002, 5), ...repetir(0.002, 40), ...voz(15, 0.2), ...repetir(0.002, 30)];
  const cortoPensativo = correr(pensativo);
  revisar("no corta mientras nadie ha hablado todavía",
    cortoPensativo !== null && cortoPensativo > 45, { muestra: cortoPensativo });

  console.log("\nQuien hace una pausa a media frase\n");
  /**
   * «Cambié el rodamiento… (piensa un segundo) …y el sello.» Un segundo de
   * pausa no puede cortar un dictado.
   */
  const conPausa = [...repetir(0.002, 5), ...voz(10, 0.2), ...repetir(0.002, 10), ...voz(10, 0.2), ...repetir(0.002, 40)];
  const cortoConPausa = correr(conPausa, SILENCIO_DICTADO_MS);
  revisar("una pausa de un segundo NO corta el dictado",
    cortoConPausa !== null && cortoConPausa > 35, { muestra: cortoConPausa, finDeLaVoz: 35 });

  console.log("\nLos números elegidos\n");
  revisar("el comando espera menos que el dictado", SILENCIO_COMANDO_MS < SILENCIO_DICTADO_MS,
    { comando: SILENCIO_COMANDO_MS, dictado: SILENCIO_DICTADO_MS });
  // Menos de un segundo cortaria a cualquiera que respire; mas de cinco se
  // siente abandonado.
  revisar("y los dos están en un rango razonable",
    SILENCIO_COMANDO_MS >= 1000 && SILENCIO_DICTADO_MS <= 5000);

  console.log("\nLo que NO debe pasar\n");
  // Grabación muda entera: nadie habló nunca. No debe cortar sola, para eso
  // está el tope de los 60 segundos.
  const muda = repetir(0.001, 100);
  revisar("una grabación muda no corta sola: de eso se encarga el tope",
    correr(muda) === null);
  // Y al revés: alguien que no para de hablar tampoco se corta.
  const sinParar = [...repetir(0.002, 5), ...voz(100, 0.3)];
  revisar("quien no para de hablar no se corta a media frase", correr(sinParar) === null);

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
  process.exit(fallas ? 1 : 0);
}

main();
