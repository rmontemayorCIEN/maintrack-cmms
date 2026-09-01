/**
 * Prueba del detector de duplicados. Lo que mas importa NO es encontrarlos
 * todos, sino no juntar piezas distintas: fusionar un 6205 con un 6206 seria
 * un daño que nadie nota hasta que el tecnico baja por la refaccion equivocada.
 */
import { normalizar, parecido, sonCandidatas } from "../lib/dedupe-refacciones";

let fallas = 0;
function revisar(e: string, real: unknown, esp: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esp);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(58)} ${JSON.stringify(real)}`);
}
const cerca = (a: string, b: string, umbral = 0.72) => parecido(a, b) >= umbral;
/** La decision de verdad: parecido MAS la regla de medidas. */
const junta = (a: string, b: string) => sonCandidatas({ code: "", name: a }, { code: "", name: b }).candidatas;

console.log("\nNORMALIZACION\n");
revisar("acentos y mayusculas se igualan", normalizar("Balero Cónico"), "balero conico");
revisar("guiones y puntos se vuelven espacio", normalizar("6205-2RS.SKF"), "6205 2rs skf");

console.log("\nDEBE VER PARECIDO\n");
revisar("mismo nombre en distinta caja", cerca("Balero 6205", "BALERO 6205"), true);
revisar("con sufijo de sello", cerca("Balero 6205", "Balero 6205 2RS"), true);
revisar("con acento y sin acento", cerca("Balero conico", "Balero cónico"), true);
revisar("plural contra singular", cerca("Filtro de aire", "Filtros de aire"), true);
revisar("con un error de dedo", cerca("Empaque de tapa", "Empaqeu de tapa"), true);

console.log("\nEL TEXTO SOLO NO ALCANZA\n");
revisar("como texto, 6205 y 6206 se parecen", cerca("Balero 6205", "Balero 6206"), true);
revisar("y 1/2 con 3/4 tambien", cerca("Manguera 1/2", "Manguera 3/4"), true);

console.log("\nLA DECISION REAL NO LOS JUNTA\n");
revisar("6205 contra 6206 NO son candidatas", junta("Balero 6205", "Balero 6206"), false);
revisar("manguera 1/2 contra 3/4 NO son candidatas", junta("Manguera 1/2", "Manguera 3/4"), false);
revisar("filtro de 10 micras contra 20 micras", junta("Filtro 10 micras", "Filtro 20 micras"), false);
revisar("cosas que no tienen que ver", junta("Balero 6205", "Filtro de aceite"), false);

console.log("\nLA DECISION REAL SI JUNTA LO QUE DEBE\n");
revisar("mismo balero con sufijo de sello", junta("Balero 6205", "Balero 6205 2RS"), true);
revisar("mismo balero con marca", junta("Balero 6205 2RS", "Balero 6205-2RS SKF"), true);
revisar("sin numeros, solo por nombre", junta("Empaque de tapa", "Empaque para tapa"), true);

console.log(fallas ? `${fallas} revisiones fallaron\n` : "Todas las revisiones cuadran\n");
process.exitCode = fallas ? 1 : 0;
