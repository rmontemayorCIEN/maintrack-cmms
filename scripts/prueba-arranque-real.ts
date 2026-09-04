/** Ciclo real de «por donde empezar» contra los catalogos de produccion. */
import { prisma } from "../lib/db";
import { proponerArranque } from "../lib/ia/arranque-planes";
import { coberturaPreventiva } from "../lib/cobertura-planes";

let fallas = 0;
const revisar = (e: string, ok: boolean, nota = "") => {
  if (!ok) fallas++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${e.padEnd(44)} ${nota}`);
};

async function main() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, plan: true, iaComplemento: true, iaExtra: true },
  });
  for (const org of orgs) {
    const cob = await coberturaPreventiva(org.id);
    console.log(`\n${org.name} — ${cob.sinPlan.length} de ${cob.totalActivos} sin plan`);
    const r = await proponerArranque(org, {});
    if (!r.ok) {
      const valida = /ya tienen|no hay|permiso|limite|cuota/i.test(r.motivo);
      revisar(valida ? "se niega con motivo claro" : "propone", valida, r.motivo.slice(0, 60));
      continue;
    }
    revisar("propone", true, `$${r.costoUsd.toFixed(4)} · ${r.propuesta.propuestas.length} familia(s)`);
    console.log(`     «${r.propuesta.diagnostico.slice(0, 120)}…»`);

    const familias = new Set(
      (await prisma.assetCategory.findMany({ where: { organizationId: org.id }, select: { name: true } })).map((c) => c.name),
    );
    revisar("no inventa familias", r.propuesta.propuestas.every((p) => familias.has(p.familia)));
    revisar("el orden viene ordenado",
      r.propuesta.propuestas.every((p, i, a) => i === 0 || a[i - 1].orden <= p.orden));
    revisar("cada una trae actividades tipicas",
      r.propuesta.propuestas.every((p) => p.actividadesTipicas.length >= 3));

    for (const p of r.propuesta.propuestas.slice(0, 4)) {
      console.log(`     ${p.orden}. ${p.familia.padEnd(26)} ${p.frecuenciaSugerida}`);
      console.log(`        ${p.porQue.slice(0, 92)}`);
    }
    if (r.propuesta.noTodavia) console.log(`     para despues: ${r.propuesta.noTodavia.slice(0, 90)}…`);
  }
  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nEl ciclo cuadra\n");
  process.exitCode = fallas ? 1 : 0;
}
main().finally(() => prisma.$disconnect());
