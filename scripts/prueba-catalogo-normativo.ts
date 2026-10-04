/**
 * El paquete del catálogo normativo y su validador.
 *
 * Llama a las MISMAS funciones que corren en el despliegue
 * (`lib/normas-revision.ts`), no a una copia de sus reglas.
 *
 * Lo que más vigila es que el validador RECHACE lo que debe rechazar. Un
 * validador que solo se prueba con entradas buenas no prueba nada: el gancho
 * de secretos de este proyecto parecía servir hasta que se le pasó una llave
 * falsa y la dejó pasar.
 *
 *   npx tsx scripts/prueba-catalogo-normativo.ts
 */
import { readFileSync } from "node:fs";
import {
  NORMAS, REVISADO_POR, TOTAL_OBLIGACIONES, VERSION_CATALOGO, normaDeCatalogo, normasParaGiro,
} from "../lib/normas-catalogo";
import { problemasContraAnterior, problemasDeCoherencia, problemasDeForma } from "../lib/normas-revision";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 200)}` : ""}`);
}

const real = JSON.parse(readFileSync("catalogo-normativo/normas.json", "utf8"));
/** Una copia honda del paquete real, para poder romperla sin tocar el archivo. */
const copia = () => JSON.parse(JSON.stringify(real));
const graves = (h: Array<{ grave: boolean }>) => h.filter((x) => x.grave).length;

function main() {
  console.log("\n1. El paquete real está bien\n");
  revisar("la forma cumple el contrato", problemasDeForma(real).length === 0, problemasDeForma(real));
  revisar("es coherente", graves(problemasDeCoherencia(real)) === 0, problemasDeCoherencia(real));
  revisar("trae ocho normas", NORMAS.length === 8);
  revisar("trae 22 obligaciones", TOTAL_OBLIGACIONES === 22);
  revisar("el contrato es el 1", real.contrato === 1);
  revisar("declara su versión de contenido", VERSION_CATALOGO >= 1);
  revisar("sigue marcado como borrador (nadie lo ha revisado)", REVISADO_POR === null);
  revisar("se lee una norma por su clave", normaDeCatalogo("NOM-002-STPS")?.obligaciones.length === 3);
  revisar("una planta ve las ocho", normasParaGiro("PLANTA").length === 8);

  console.log("\n2. Lo que el validador TIENE que rechazar\n");

  const sinFuera = copia();
  delete sinFuera.normas[0].fueraDeAlcance;
  revisar("una norma sin «fuera de alcance» se rechaza — es el campo que protege al usuario",
    problemasDeForma(sinFuera).length > 0, problemasDeForma(sinFuera)[0]?.texto);

  const fueraCorto = copia();
  fueraCorto.normas[0].fueraDeAlcance = "Nada.";
  revisar("un «fuera de alcance» de relleno también se rechaza", problemasDeForma(fueraCorto).length > 0);

  const sinEvidencia = copia();
  sinEvidencia.normas[0].obligaciones[0].evidencia = "";
  revisar("una obligación sin decir qué evidencia deja se rechaza", problemasDeForma(sinEvidencia).length > 0);

  const tipoMalo = copia();
  tipoMalo.normas[0].obligaciones[0].tipo = "INVENTADO";
  revisar("un tipo de obligación inventado se rechaza", problemasDeForma(tipoMalo).length > 0);

  const giroMalo = copia();
  giroMalo.normas[0].giros = ["MARCIANO"];
  revisar("un giro que no existe se rechaza",
    graves(problemasDeCoherencia(giroMalo)) > 0, problemasDeCoherencia(giroMalo)[0]?.texto);

  const claveRepetida = copia();
  claveRepetida.normas[1].clave = claveRepetida.normas[0].clave;
  revisar("dos normas con la misma clave se rechazan", graves(problemasDeCoherencia(claveRepetida)) > 0);

  const obligacionRepetida = copia();
  obligacionRepetida.normas[0].obligaciones[1].clave = obligacionRepetida.normas[0].obligaciones[0].clave;
  revisar("dos obligaciones con la misma clave dentro de una norma se rechazan",
    graves(problemasDeCoherencia(obligacionRepetida)) > 0);

  const contratoViejo = copia();
  contratoViejo.contrato = 99;
  revisar("un contrato que no reconocemos se rechaza", problemasDeForma(contratoViejo).length > 0);

  const sinNormas = copia();
  sinNormas.normas = [];
  revisar("un paquete vacío se rechaza", problemasDeForma(sinNormas).length > 0);

  console.log("\n3. Lo que se vigila contra la versión anterior\n");

  const borraNorma = copia();
  borraNorma.normas.shift();
  borraNorma.version = real.version + 1;
  revisar("borrar una norma se rechaza: deja huérfano lo que el cliente amarró",
    graves(problemasContraAnterior(real, borraNorma)) > 0, problemasContraAnterior(real, borraNorma)[0]?.texto);

  const borraObligacion = copia();
  borraObligacion.normas[0].obligaciones.pop();
  borraObligacion.normas[0].version += 1;
  borraObligacion.version = real.version + 1;
  revisar("borrar una obligación también se rechaza",
    graves(problemasContraAnterior(real, borraObligacion)) > 0);

  const cambioSinVersion = copia();
  cambioSinVersion.normas[0].obligaciones[0].detalle += " Ahora dice otra cosa distinta.";
  revisar("cambiar el contenido sin subir la versión se rechaza — de eso depende el aviso de «esto cambió»",
    graves(problemasContraAnterior(real, cambioSinVersion)) > 0,
    problemasContraAnterior(real, cambioSinVersion).map((h) => h.texto));

  const cambioBienHecho = copia();
  cambioBienHecho.normas[0].obligaciones[0].detalle += " Ahora dice otra cosa distinta.";
  cambioBienHecho.normas[0].version += 1;
  cambioBienHecho.version = real.version + 1;
  revisar("cambiarlo SUBIENDO las dos versiones sí pasa",
    graves(problemasContraAnterior(real, cambioBienHecho)) === 0,
    problemasContraAnterior(real, cambioBienHecho).map((h) => h.texto));

  const agregaNorma = copia();
  agregaNorma.normas.push({
    ...copia().normas[0], clave: "NOM-999-XXX", version: 1,
  });
  agregaNorma.version = real.version + 1;
  revisar("agregar una norma nueva sí pasa", graves(problemasContraAnterior(real, agregaNorma)) === 0);

  const renombra = copia();
  renombra.normas[0].titulo = "Otro título";
  renombra.normas[0].version += 1;
  renombra.version = real.version + 1;
  revisar("renombrar una norma (sin tocar su clave) sí pasa", graves(problemasContraAnterior(real, renombra)) === 0);

  console.log("\n4. Avisos que no bloquean\n");
  const actividadSinPeriodo = copia();
  actividadSinPeriodo.normas[0].obligaciones[0].tipo = "ACTIVIDAD";
  delete actividadSinPeriodo.normas[0].obligaciones[0].cadaDias;
  const h = problemasDeCoherencia(actividadSinPeriodo);
  revisar("una actividad sin periodo avisa, pero no bloquea",
    h.some((x) => !x.grave && x.texto.includes("no se puede medir")) && graves(h) === 0, h.map((x) => x.texto));

  console.log(fallos === 0 ? "\n✓ Todo pasa\n" : `\n✗ ${fallos} fallas\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main();
