// Guardián de dependencias (ISO/IEC 27001:2022, control 8.8): antes de publicar,
// ninguna dependencia de producción con vulnerabilidad alta o crítica, salvo las
// aceptadas en seguridad/excepciones-dependencias.json y todavía en fecha.
//
//   node scripts/revisar-dependencias.mjs
//
// El 29 oct 2026 encontró un Next.js con ejecución remota de código sin sesión
// (optimizador de imágenes con SVG): por eso existe.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

let crudo;
try {
  crudo = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch (e) {
  // npm audit sale con error cuando encuentra algo: la salida igual trae el JSON.
  crudo = e.stdout?.toString() ?? "";
}
let reporte;
try { reporte = JSON.parse(crudo); } catch {
  console.error("No se pudo leer el resultado de npm audit (¿sin internet?). No se publica a ciegas: revisa la conexión y repite.");
  process.exit(1);
}
const excepciones = JSON.parse(readFileSync(new URL("../seguridad/excepciones-dependencias.json", import.meta.url), "utf8"));
const hoy = new Date().toISOString().slice(0, 10);
const graves = Object.entries(reporte.vulnerabilities ?? {}).filter(([, v]) => ["high", "critical"].includes(v.severity));
const detener = [], aceptadas = [];
for (const [nombre, v] of graves) {
  const ex = excepciones[nombre];
  if (ex && ex.revisarAntesDe >= hoy) aceptadas.push(`${nombre} (${v.severity}, aceptada hasta ${ex.revisarAntesDe})`);
  else detener.push(`${nombre} (${v.severity})${ex ? ` — su excepción venció el ${ex.revisarAntesDe}` : ""}: ${(v.via ?? []).map((x) => (typeof x === "string" ? x : x.title)).slice(0, 2).join(" · ")}`);
}
if (detener.length) {
  console.error("ERROR: dependencias de producción con vulnerabilidades altas o críticas:");
  for (const d of detener) console.error("  · " + d);
  console.error("Actualízalas (npm install <paquete>@<versión corregida>) o, si no hay arreglo y el riesgo es aceptable, regístralo en seguridad/excepciones-dependencias.json con su porqué y fecha de revisión.");
  process.exit(1);
}
console.log(`dependencias: sin vulnerabilidades altas ni críticas${aceptadas.length ? ` (aceptadas: ${aceptadas.join(", ")})` : ""}`);
