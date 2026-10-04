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
import { crearDetectorDeSilencio, ESPERA_MAXIMA_MS, SILENCIO_COMANDO_MS, SILENCIO_DICTADO_MS } from "../lib/deteccion-voz";
import { porQueNoSePudo } from "../lib/dictado";

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

/** Lo mismo, pero diciendo en que muestra se dio por vencido (o nunca). */
function correrHastaRendirse(niveles: number[], esperaMaximaMs: number): number | null {
  const d = crearDetectorDeSilencio({ silencioMs: SILENCIO_COMANDO_MS, muestraMs: MUESTRA, esperaMaximaMs });
  for (let i = 0; i < niveles.length; i++) {
    const decision = d.alNivel(niveles[i]);
    if (decision === "abandonar") return i;
    // Cortar es otra cosa: alguien hablo y termino. Si pasa, no se rindio.
    if (decision === "cortar") return null;
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

  console.log("\nCuando no habla NADIE\n");
  /**
   * Manos libres reabre el micrófono solo. Quien deja la conversación abierta
   * y se va tenía el micrófono encendido hasta el tope de 60 segundos, y al
   * final subía ese minuto de silencio a transcribir —que se cobra por
   * segundo—. Cada vez, no una.
   */
  const nadie = repetir(0.002, 300);
  const seRindio = correrHastaRendirse(nadie, ESPERA_MAXIMA_MS);
  const esperado = 5 + ESPERA_MAXIMA_MS / MUESTRA;
  revisar("se da por vencido cuando nadie habla", seRindio !== null, { muestra: seRindio });
  revisar("   y a la hora pedida, no antes ni mucho después",
    seRindio !== null && Math.abs(seRindio - esperado) <= 2, { muestra: seRindio, esperado });

  // El caso VIEJO sigue igual: sin pedirlo, no se rinde nunca. El dictado del
  // cierre de orden depende de eso.
  revisar("sin pedirlo, no se rinde: el dictado se comporta como siempre",
    correr(nadie) === null && crearDetectorDeSilencio({ silencioMs: SILENCIO_COMANDO_MS, muestraMs: MUESTRA }) !== null);

  // Y lo que NO debe pasar: cortarle a quien tardó en arrancar pero arrancó.
  const tardio = [...repetir(0.002, 5 + ESPERA_MAXIMA_MS / MUESTRA - 15), ...voz(20, 0.2), ...repetir(0.002, 60)];
  revisar("quien tarda en arrancar pero arranca, NO se abandona",
    correrHastaRendirse(tardio, ESPERA_MAXIMA_MS) === null);
  // Y quien ya habló nunca se abandona, por larga que sea la pausa después.
  const hablóYCalló = [...repetir(0.002, 5), ...voz(10, 0.3), ...repetir(0.002, 400)];
  revisar("quien ya habló se corta, no se abandona",
    correrHastaRendirse(hablóYCalló, ESPERA_MAXIMA_MS) === null && correr(hablóYCalló) !== null);

  console.log("\nCuando el micrófono no se puede usar, decir POR QUÉ\n");
  /**
   * Cinco problemas distintos con cinco soluciones distintas estaban bajo el
   * mismo «no se pudo usar el micrófono». Con ese mensaje, un bloqueo del
   * SERVIDOR mandaba a la gente a revisar los ajustes de su Mac, donde no
   * había nada que arreglar. Costó un día.
   */
  const porPermiso = porQueNoSePudo({ name: "NotAllowedError" });
  revisar("permiso denegado: dice dónde darlo", porPermiso.includes("candado"), porPermiso.slice(0, 60));
  const sinAparato = porQueNoSePudo({ name: "NotFoundError" });
  revisar("sin micrófono: lo dice sin mandar a buscar permisos",
    sinAparato.includes("no tiene micrófono") && !sinAparato.includes("candado"), sinAparato);
  const ocupado = porQueNoSePudo({ name: "NotReadableError" });
  revisar("lo tiene otro programa: dice que lo cierre", ocupado.includes("Otro programa"), ocupado);
  // Cada causa tiene que decir algo DISTINTO, o volvemos al cajón único.
  const todos = ["NotAllowedError", "NotFoundError", "NotReadableError", "LoQueSea"].map((n) => porQueNoSePudo({ name: n }));
  revisar("cada causa dice algo distinto", new Set(todos).size === todos.length, `${new Set(todos).size} de ${todos.length}`);
  revisar("y lo desconocido no inventa una causa", porQueNoSePudo({ name: "LoQueSea" }) === "No se pudo usar el micrófono.");

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
  process.exit(fallas ? 1 : 0);
}

main();
