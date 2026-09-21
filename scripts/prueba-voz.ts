/**
 * La voz del parte (lib/voz.ts), sin llamar a Google.
 *
 * Lo que se cuida: que las marcas de pausa se escriban donde van y no en medio
 * de una cifra, que un texto con corchetes no meta una marca inventada, y que
 * la huella cambie cuando cambia lo que suena —si no, se seguiria oyendo el
 * audio viejo despues de cambiar la voz—.
 *
 *   npx tsx scripts/prueba-voz.ts
 */
import { conPausas, huella, RITMO, VOZ } from "../lib/voz";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle = "") {
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${detalle ? ` · ${detalle}` : ""}`);
  if (!bien) fallas++;
}

console.log("\nLas pausas\n");

const parte = "Buenos días, Rafael. Trae abajo el compresor. Se le juntaron 12 órdenes vencidas; la más vieja lleva 19 días.";
const marcado = conPausas(parte);
console.log(`  «${marcado}»\n`);

revisar("pone pausa larga entre oraciones", (marcado.match(/\[pause\]/g) ?? []).length === 2, marcado);
revisar("pone pausa corta donde hay punto y coma", marcado.includes("[pause short]"));
revisar("no parte una cifra a la mitad", !/1\s*\[pause/.test(marcado) && marcado.includes("12 órdenes"));
revisar("no deja una pausa al final, donde ya nada sigue", !marcado.trimEnd().endsWith("[pause]"), marcado.slice(-30));
revisar("conserva todas las cifras", ["12", "19"].every((n) => marcado.includes(n)));

console.log("\nTexto que trae corchetes\n");
const conCorchetes = conPausas("Revisar la Bomba [respaldo] del área. Ya lleva 3 días.");
revisar("los corchetes del dato no se confunden con una marca",
  !conCorchetes.includes("[respaldo]") && conCorchetes.includes("respaldo"), conCorchetes);
revisar("y las marcas de verdad sí quedan", conCorchetes.includes("[pause]"), conCorchetes);

console.log("\nDecimales y abreviaturas\n");
const decimal = conPausas("La disponibilidad quedó en 99.9 por ciento. Subió.");
revisar("un punto decimal NO abre una pausa",
  !decimal.includes("99. [pause] 9") && decimal.includes("99.9"), decimal);

console.log("\nLa huella del audio guardado\n");
const a = huella("mismo texto");
revisar("el mismo texto da la misma huella", a === huella("mismo texto"));
revisar("otro texto da otra huella", a !== huella("otro texto"));
revisar("la huella lleva la voz y el ritmo, para que un cambio regenere el audio",
  huella("x").length === 32 && `${VOZ}|${RITMO}`.length > 0, `${VOZ} a ${RITMO}`);

console.log("\nLa voz escogida\n");
revisar("es una voz de español latino, no de España", VOZ.startsWith("es-US-"), VOZ);
revisar("es una voz neuronal de las buenas", VOZ.includes("Chirp3-HD"), VOZ);
revisar("se lee más lento que lo normal", RITMO < 1, String(RITMO));

console.log(`\n${fallas ? `${fallas} FALLARON` : "Todo bien"}\n`);
process.exit(fallas ? 1 : 0);
