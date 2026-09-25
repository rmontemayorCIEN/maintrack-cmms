/**
 * El glosario y sus cifras: que las dos listas no se desincronicen.
 *
 * El puente entre el glosario y los indicadores son dos mapas de texto —el
 * termino tal cual se escribe, la clave tal cual se calcula—. Eso se rompe en
 * silencio: alguien renombra «Cumplimiento PM» y la cifra simplemente deja de
 * aparecer, sin un solo error. Nadie lo nota hasta que un cliente pregunta
 * por que su tarjeta ya no trae numero.
 *
 *   npx tsx scripts/prueba-glosario.ts
 */
import { GLOSARIO } from "../lib/glosario";
import { CIFRA_DE_TERMINO, SIN_CIFRA } from "../lib/glosario-cifras";
import { CLAVES_INDICADOR } from "../lib/indicadores";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

function main() {
  const terminos = new Set(GLOSARIO.map((t) => t.t));

  console.log("\nCada cifra apunta a un término que existe\n");
  const huerfanos = Object.keys(CIFRA_DE_TERMINO).filter((t) => !terminos.has(t));
  revisar("ningún término con cifra fue renombrado o borrado del glosario",
    huerfanos.length === 0, huerfanos.join(" "));

  const sinCifraHuerfanos = Object.keys(SIN_CIFRA).filter((t) => !terminos.has(t));
  revisar("ni ninguno de los que se dice que NO se calculan",
    sinCifraHuerfanos.length === 0, sinCifraHuerfanos.join(" "));

  console.log("\nCada cifra apunta a un indicador que se calcula\n");
  const claves = new Set<string>(CLAVES_INDICADOR as readonly string[]);
  const inventadas = Object.entries(CIFRA_DE_TERMINO).filter(([, c]) => !claves.has(c));
  revisar("ninguna clave de indicador quedó colgando",
    inventadas.length === 0, inventadas.map(([t, c]) => `${t}→${c}`).join(" "));

  console.log("\nLo que NO debe pasar\n");
  /**
   * Un termino no puede estar en las dos listas: seria enseñar la cifra y al
   * mismo tiempo decir que no se calcula. Absurdo, y el tipo de contradiccion
   * que se cuela al agregar una entrada sin mirar la otra lista.
   */
  const enAmbas = Object.keys(CIFRA_DE_TERMINO).filter((t) => t in SIN_CIFRA);
  revisar("ningún término promete cifra y a la vez dice que no se calcula",
    enAmbas.length === 0, enAmbas.join(" "));

  // Dos términos no pueden reclamar el mismo indicador: uno de los dos está mal.
  const usadas = Object.values(CIFRA_DE_TERMINO);
  revisar("ningún indicador está reclamado por dos términos",
    new Set(usadas).size === usadas.length, usadas.join(" "));

  console.log("\nLos cinco que no se calculan siguen explicados\n");
  for (const t of ["OEE", "Confiabilidad", "Wrench time", "MTTF", "Adherencia al programa"]) {
    const razon = SIN_CIFRA[t];
    revisar(`«${t}» dice por qué no`, Boolean(razon) && razon.length > 60,
      razon ? `${razon.slice(0, 50)}…` : "SIN RAZÓN");
  }

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
  process.exit(fallas ? 1 : 0);
}

main();
