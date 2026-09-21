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
import { conPausas, huella, nombreDeVoz, paraDecir, RITMO, VOCES, VOZ_POR_OMISION, vozValida } from "../lib/voz";

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
const voz = nombreDeVoz(VOZ_POR_OMISION);
const a = huella("mismo texto", voz);
revisar("el mismo texto y la misma voz dan la misma huella", a === huella("mismo texto", voz));
revisar("otro texto da otra huella", a !== huella("otro texto", voz));
revisar("CAMBIAR DE VOZ da otra huella: si no, se seguiría oyendo la vieja",
  a !== huella("mismo texto", nombreDeVoz("Orus")), "Despina contra Orus");

console.log("\nEl catálogo de voces\n");
revisar("todas son de español latino, ninguna de España",
  VOCES.every((v) => nombreDeVoz(v.id).startsWith("es-US-")), `${VOCES.length} voces`);
revisar("todas son neuronales de las buenas", VOCES.every((v) => nombreDeVoz(v.id).includes("Chirp3-HD")));
revisar("hay voces de hombre y de mujer",
  VOCES.some((v) => v.quien === "hombre") && VOCES.some((v) => v.quien === "mujer"),
  `${VOCES.filter((v) => v.quien === "mujer").length} y ${VOCES.filter((v) => v.quien === "hombre").length}`);
revisar("cada una dice cómo suena, para poder escoger sin oírlas todas",
  VOCES.every((v) => v.como.length > 4));
revisar("ninguna clave repetida", new Set(VOCES.map((v) => v.id)).size === VOCES.length);
revisar("la de omisión está en el catálogo", vozValida(VOZ_POR_OMISION), VOZ_POR_OMISION);

console.log("\nUna voz guardada que ya no ofrecemos\n");
revisar("una clave desconocida NO se acepta", !vozValida("VozQueYaNoExiste"));
revisar("y cae a la de omisión en vez de romper",
  nombreDeVoz("VozQueYaNoExiste") === nombreDeVoz(VOZ_POR_OMISION), nombreDeVoz("VozQueYaNoExiste"));
revisar("sin preferencia, también la de omisión", nombreDeVoz(null) === nombreDeVoz(VOZ_POR_OMISION));

revisar("se lee más lento que lo normal", RITMO < 1, String(RITMO));

console.log("\nLo escrito para leerse, dicho en voz alta\n");

const importe = paraDecir("El costo fue de $128,400.50 en 90 días.");
revisar("un importe se dice como lo diría una persona",
  importe.includes("128 mil 400 pesos") && !importe.includes("$"), importe);
revisar("NO redondea la cifra: el número es la respuesta", importe.includes("400"), importe);

revisar("los millones llevan «de»",
  paraDecir("Costó $2,500,000.").includes("millones de pesos"), paraDecir("Costó $2,500,000."));
revisar("«$45 pesos» no sale «45 pesos pesos»",
  !paraDecir("Son $45 pesos.").includes("pesos pesos"), paraDecir("Son $45 pesos."));
revisar("el porcentaje se dice, no se deletrea el símbolo",
  paraDecir("Quedó en 87.5% este mes.").includes("87.5 por ciento"), paraDecir("Quedó en 87.5% este mes."));

const lista = paraDecir("- Revisar CMP-301\n- Cambiar BOM-602");
// Ojo: no vale buscar «-» a secas, que los codigos de equipo lo llevan.
revisar("las viñetas no se oyen como «guion»", !/(^|\s)[-•*]\s/.test(lista), lista);
revisar("y cada renglón cierra, para que no se digan de corrido",
  lista.includes("CMP-301. Cambiar"), lista);

revisar("los códigos de equipo se dicen tal cual: así se llaman en la planta",
  paraDecir("Falló CMP-301 y BOM-602.").includes("CMP-301") && paraDecir("Falló CMP-301 y BOM-602.").includes("BOM-602"));
revisar("el markdown que a veces cuela el modelo no se lee",
  paraDecir("**Resumen:** tres fallas.") === "Resumen: tres fallas.", paraDecir("**Resumen:** tres fallas."));
revisar("un texto ya limpio no se estropea",
  paraDecir("La bomba falló tres veces en septiembre.") === "La bomba falló tres veces en septiembre.");

console.log(`\n${fallas ? `${fallas} FALLARON` : "Todo bien"}\n`);
process.exit(fallas ? 1 : 0);
