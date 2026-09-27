/**
 * Comprueba que «Cumplimiento normativo» quedo bien puesto en produccion.
 *
 * Solo LEE. Se corre con:
 *   ./scripts/con-produccion.sh scripts/revisar-normas-produccion.ts
 *
 * Existe por la misma razon que el de registros propios: una migracion que no
 * se aplico no se nota hasta que alguien abre la pantalla y truena con un
 * P2022 —ya paso en la revision 00108—.
 */
import { prisma } from "../lib/db";
import { NORMAS, TOTAL_OBLIGACIONES } from "../lib/normas-catalogo";

async function main() {
  // Si las migraciones no llegaron, estas consultas revientan.
  const normas = await prisma.normaAdoptada.count();
  const obligaciones = await prisma.obligacionAdoptada.count();
  const amarres = await prisma.amarreDeCumplimiento.count();
  console.log(`Esquema OK — adoptadas:${normas} obligaciones:${obligaciones} amarres:${amarres}`);
  console.log(`Catalogo en codigo: ${NORMAS.length} normas, ${TOTAL_OBLIGACIONES} obligaciones.`);

  const orgs = await prisma.organization.findMany({
    select: {
      name: true, esDemo: true, registrosPropios: true, cumplimientoNormas: true,
      codigoFormatoOT: true, _count: { select: { normasAdoptadas: true, tablasPropias: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  console.log("\nComplementos por empresa (los dos se cobran aparte y nacen apagados):");
  for (const o of orgs) {
    console.log(
      `  ${o.cumplimientoNormas ? "NORMAS" : "  ·   "} ${o.registrosPropios ? "REGISTROS" : "    ·    "}` +
      `  ${o.name}${o.esDemo ? " (demo)" : ""}` +
      `  — ${o._count.normasAdoptadas} normas, ${o._count.tablasPropias} tablas` +
      (o.codigoFormatoOT ? `, formato ${o.codigoFormatoOT}` : ""),
    );
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
