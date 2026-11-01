// La huella de una carpeta: sha256 de cada archivo, en orden.
//
// La usan el núcleo al copiarse y el guardián de cada app al revisar que la
// copia no se editó a mano. Sin dependencias: corre con node a secas.
//
//   node huella.mjs <carpeta>            imprime la huella (viaja dentro de la copia)
//   node huella.mjs <carpeta> --revisar  compara contra <carpeta>/HUELLA

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const IGNORAR = new Set(["HUELLA", ".DS_Store"]);

function archivos(dir, base = dir) {
  return readdirSync(dir)
    .filter((n) => !IGNORAR.has(n))
    .sort()
    .flatMap((n) => {
      const ruta = join(dir, n);
      return statSync(ruta).isDirectory() ? archivos(ruta, base) : [relative(base, ruta)];
    });
}

export function huellas(dir) {
  return archivos(dir).map(
    (r) => `${createHash("sha256").update(readFileSync(join(dir, r))).digest("hex")}  ${r}`,
  );
}

const [dir, modo] = process.argv.slice(2);
if (!dir) {
  console.error("Uso: node huella.mjs <carpeta> [--revisar]");
  process.exit(2);
}
if (modo === "--revisar") {
  const guardada = readFileSync(join(dir, "HUELLA"), "utf8").split("\n").filter((l) => /^[0-9a-f]{64}  /.test(l));
  const actual = huellas(dir);
  const g = new Set(guardada), a = new Set(actual);
  const cambiados = [...a].filter((l) => !g.has(l)).map((l) => l.slice(66));
  const faltan = [...g].filter((l) => !a.has(l)).map((l) => l.slice(66)).filter((r) => !cambiados.includes(r));
  if (cambiados.length || faltan.length) {
    for (const r of cambiados) console.error(`  editado o agregado a mano: ${r}`);
    for (const r of faltan) console.error(`  borrado a mano: ${r}`);
    process.exit(1);
  }
  console.log(`copia intacta (${actual.length} archivos)`);
} else {
  console.log(huellas(dir).join("\n"));
}
