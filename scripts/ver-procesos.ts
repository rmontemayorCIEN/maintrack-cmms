/**
 * Como va cada proceso programado. Solo lectura.
 *
 *   ./scripts/con-produccion.sh scripts/ver-procesos.ts
 */
import { estadoDeProcesos } from "../lib/procesos";

(async () => {
  for (const p of await estadoDeProcesos()) {
    const cuando = p.ultimoFin ? `${p.ultimoFin.toISOString()} (hace ${p.desdeMinutos} min)` : "nunca";
    console.log(`${p.nombre.padEnd(38)} ${p.callado ? "CALLADO" : p.sinDatos ? "sin datos" : "al día  "} ${p.ultimoOk === false ? "FALLÓ" : "      "} ${cuando}`);
    if (p.ultimoError) console.log(`  último error: ${p.ultimoError}`);
  }
  process.exit(0);
})();
