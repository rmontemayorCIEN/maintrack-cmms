/**
 * Ordenar la lista tocando el titulo de la columna.
 *
 * Llama a las MISMAS funciones que usa `TablaConfigurable` —por eso viven en
 * `lib/orden-tabla.ts` y no dentro del componente—. Una prueba que reescribiera
 * el ciclo de tres estados probaria su propia copia, no la del sistema.
 *
 *   npx tsx scripts/prueba-orden-tabla.ts
 */
import { compararValores, siguienteOrden, type Orden } from "../lib/orden-tabla";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 200)}` : ""}`);
}

const ordenar = <T,>(xs: T[], clave: (x: T) => string | number, dir: "asc" | "desc") =>
  [...xs].sort((a, b) => (dir === "asc" ? 1 : -1) * compararValores(clave(a), clave(b)));

function main() {
  console.log("\nEL CICLO DE TRES ESTADOS\n");
  let o: Orden | null = null;
  o = siguienteOrden(o, "folio");
  revisar("el primer toque ordena ascendente", JSON.stringify(o) === '{"id":"folio","dir":"asc"}', o);
  o = siguienteOrden(o, "folio");
  revisar("el segundo invierte", JSON.stringify(o) === '{"id":"folio","dir":"desc"}', o);
  o = siguienteOrden(o, "folio");
  revisar("el tercero lo quita y deja la lista como llegó", o === null, o);
  o = siguienteOrden(o, "folio");
  revisar("y el cuarto vuelve a empezar", JSON.stringify(o) === '{"id":"folio","dir":"asc"}', o);

  o = { id: "folio", dir: "desc" };
  o = siguienteOrden(o, "costo");
  revisar("tocar otra columna empieza en ascendente, no hereda el sentido",
    JSON.stringify(o) === '{"id":"costo","dir":"asc"}', o);

  console.log("\nLOS NUMEROS DENTRO DEL TEXTO\n");
  const folios = ["OT-9", "OT-10", "OT-100", "OT-2"];
  revisar("los folios se ordenan por su número, no como palabras",
    JSON.stringify(ordenar(folios, (x) => x, "asc")) === JSON.stringify(["OT-2", "OT-9", "OT-10", "OT-100"]),
    ordenar(folios, (x) => x, "asc"));
  // Como texto puro, «OT-10» va antes que «OT-9» porque compara «1» con «9».
  revisar("y al revés, invertido",
    JSON.stringify(ordenar(folios, (x) => x, "desc")) === JSON.stringify(["OT-100", "OT-10", "OT-9", "OT-2"]),
    ordenar(folios, (x) => x, "desc"));

  console.log("\nACENTOS Y MAYUSCULAS\n");
  const nombres = ["Émbolo", "banda", "Ácido", "Zapata", "aceite"];
  revisar("los acentos no mandan la palabra al final",
    ordenar(nombres, (x) => x, "asc")[0] === "aceite" || ordenar(nombres, (x) => x, "asc")[0] === "Ácido",
    ordenar(nombres, (x) => x, "asc"));
  revisar("las mayúsculas no separan la lista en dos bloques",
    ordenar(["banda", "Banda", "aceite"], (x) => x, "asc")[0] === "aceite",
    ordenar(["banda", "Banda", "aceite"], (x) => x, "asc"));

  console.log("\nDINERO Y FECHAS: POR SU VALOR, NO POR SU TEXTO\n");
  // Es el caso que obliga a que las columnas de dinero declaren `ordenPor`.
  const montos = [{ t: "$900", v: 900 }, { t: "$1,200", v: 1200 }, { t: "$85", v: 85 }];
  revisar("por el número, el orden es el correcto",
    JSON.stringify(ordenar(montos, (m) => m.v, "asc").map((m) => m.t)) === JSON.stringify(["$85", "$900", "$1,200"]),
    ordenar(montos, (m) => m.v, "asc").map((m) => m.t));
  const comoTexto = ordenar(montos, (m) => m.t, "asc").map((m) => m.t);
  revisar("y por el texto NO lo es: por eso la columna declara con qué se ordena",
    JSON.stringify(comoTexto) !== JSON.stringify(["$85", "$900", "$1,200"]), comoTexto);

  const fechas = [
    { t: "26 sep 2026", v: new Date("2026-09-26").getTime() },
    { t: "3 ene 2026", v: new Date("2026-01-03").getTime() },
    { t: "15 feb 2026", v: new Date("2026-02-15").getTime() },
  ];
  revisar("las fechas se ordenan cronológicamente",
    JSON.stringify(ordenar(fechas, (f) => f.v, "asc").map((f) => f.t)) === JSON.stringify(["3 ene 2026", "15 feb 2026", "26 sep 2026"]),
    ordenar(fechas, (f) => f.v, "asc").map((f) => f.t));

  console.log("\nLO QUE NO DEBE PASAR\n");
  const original = ["c", "a", "b"];
  ordenar(original, (x) => x, "asc");
  revisar("ordenar no altera la lista que le pasaron",
    JSON.stringify(original) === JSON.stringify(["c", "a", "b"]), original);
  revisar("los vacíos no revientan la comparación",
    typeof compararValores("", "algo") === "number" && typeof compararValores(0, 0) === "number");

  console.log(fallos ? `\n${fallos} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallos ? 1 : 0;
}

main();
