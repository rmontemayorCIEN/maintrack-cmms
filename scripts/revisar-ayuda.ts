/**
 * Revisa que la ayuda no se quede atras del sistema.
 *
 * Cada pantalla nueva deberia traer su ficha en lib/ayuda.ts. Confiar en
 * acordarse no funciona: la ficha se escribe el dia que se construye la
 * pantalla o no se escribe nunca, y una pantalla sin ficha ademas deja ciega a
 * la ayuda con IA, que lee de ahi.
 *
 * Reporta en los dos sentidos: pantallas sin ficha, y fichas de pantallas que
 * ya no existen.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { AYUDA, SIN_AYUDA } from "../lib/ayuda";

const RAIZ = "app/(app)";

/** Las rutas con parametro heredan la ficha de su padre; no necesitan la suya. */
const esDinamica = (seg: string) => seg.startsWith("[");

function rutas(dir: string, prefijo = ""): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (!statSync(ruta).isDirectory()) continue;
    // Los grupos entre parentesis no aparecen en la URL.
    const segmento = entrada.startsWith("(") ? "" : `/${entrada}`;
    const nuevoPrefijo = prefijo + segmento;
    if (!esDinamica(entrada)) {
      try {
        statSync(join(ruta, "page.tsx"));
        salida.push(nuevoPrefijo || "/");
      } catch { /* carpeta sin pantalla propia */ }
    }
    salida.push(...rutas(ruta, nuevoPrefijo));
  }
  return salida;
}

const encontradas = [...new Set(rutas(RAIZ))].sort();
const documentadas = Object.keys(AYUDA);

const sinFicha = encontradas.filter((r) => !documentadas.includes(r) && !SIN_AYUDA.includes(r));
const sobrantes = documentadas.filter((d) => !encontradas.includes(d));

if (sinFicha.length) {
  console.log(`\n  ${sinFicha.length} pantalla(s) SIN ficha de ayuda:`);
  for (const r of sinFicha) console.log(`     ${r}`);
}
if (sobrantes.length) {
  console.log(`\n  ${sobrantes.length} ficha(s) de pantallas que ya no existen:`);
  for (const r of sobrantes) console.log(`     ${r}`);
}
if (!sinFicha.length && !sobrantes.length) {
  console.log(`     Ayuda al dia: ${encontradas.length} pantallas, ${documentadas.length} fichas.`);
}
// No detiene el despliegue: falta de documentacion no debe bloquear un arreglo
// urgente. Pero sale en cada publicacion, con nombre y apellido.
process.exit(0);
