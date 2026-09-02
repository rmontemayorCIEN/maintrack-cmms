/**
 * Ciclo completo de las propuestas de equivalencia contra catalogos reales.
 *
 * El filtro deterministico se prueba en seco. Esto verifica lo otro: que el
 * modelo no invente refacciones ni proponga piezas de medida distinta.
 */
import { prisma } from "../lib/db";
import { proponerEquivalencias } from "../lib/ia/equivalencias";

let fallas = 0;
const revisar = (e: string, ok: boolean, nota = "") => {
  if (!ok) fallas++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${e.padEnd(46)} ${nota}`);
};

async function main() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, plan: true, iaComplemento: true, iaExtra: true },
  });

  for (const org of orgs) {
    const cuantas = await prisma.part.count({ where: { organizationId: org.id, active: true } });
    console.log(`\n${org.name} — ${cuantas} refacciones`);

    const r = await proponerEquivalencias(org, {});
    if (!r.ok) {
      const valida = /catalogo|designacion|permiso|limite|cuota/i.test(r.motivo);
      revisar(valida ? "se niega con motivo claro" : "propone", valida, r.motivo.slice(0, 80));
      continue;
    }
    revisar("propone", true, `$${r.costoUsd.toFixed(4)} · ${r.propuestas.length} propuesta(s)`);
    console.log(`     «${r.resumen.slice(0, 110)}${r.resumen.length > 110 ? "…" : ""}»`);

    const codigos = new Set(
      (await prisma.part.findMany({ where: { organizationId: org.id }, select: { code: true } })).map((p) => p.code),
    );
    revisar("no invento ninguna refaccion",
      r.propuestas.every((p) => codigos.has(p.codigoA) && codigos.has(p.codigoB)));
    revisar("ninguna se propone consigo misma",
      r.propuestas.every((p) => p.partAId !== p.partBId));
    revisar("los sustitutos traen su salvedad",
      r.propuestas.filter((p) => p.tipo === "SUSTITUTO").every((p) => (p.salvedad ?? "").trim().length > 3),
      `${r.propuestas.filter((p) => p.tipo === "SUSTITUTO").length} sustituto(s)`);

    for (const p of r.propuestas.slice(0, 4)) {
      console.log(`     ${p.codigoA} ↔ ${p.codigoB}  [${p.tipo}, ${p.confianza}]  ${p.porQue.slice(0, 70)}`);
    }
  }

  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nEl ciclo completo cuadra\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
