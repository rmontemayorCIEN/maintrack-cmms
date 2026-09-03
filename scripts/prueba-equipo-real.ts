/** Ciclo completo de «Revisar al equipo» contra datos reales. */
import { prisma } from "../lib/db";
import { revisarEquipo } from "../lib/ia/equipo";
import { cargaDelEquipo } from "../lib/personal";

let fallas = 0;
const revisar = (e: string, ok: boolean, nota = "") => {
  if (!ok) fallas++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${e.padEnd(46)} ${nota}`);
};
const PROHIBIDAS = /\b(productiv|eficien|rendimiento|ranking|peor|mejor tecnico|flojo|lento)\b/i;

async function main() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, plan: true, iaComplemento: true, iaExtra: true },
  });

  for (const org of orgs) {
    const datos = await cargaDelEquipo(org.id);
    console.log(`\n${org.name} — ${datos.personas.length} personas, ${datos.personas.reduce((s, p) => s + p.aplicado.horas, 0)} h aplicadas`);

    const r = await revisarEquipo(org, {});
    if (!r.ok) {
      const valida = /persona|horas|permiso|limite|cuota/i.test(r.motivo);
      revisar(valida ? "se niega con motivo claro" : "revisa", valida, r.motivo.slice(0, 70));
      continue;
    }
    revisar("revisa", true, `$${r.costoUsd.toFixed(4)} · ${r.revision.hallazgos.length} hallazgo(s)`);
    console.log(`     «${r.revision.resumen.slice(0, 110)}…»`);

    const nombres = new Set(datos.personas.map((p) => p.nombre));
    revisar("no menciona gente que no existe",
      r.revision.hallazgos.every((h) => h.personas.every((n) => nombres.has(n))));
    revisar("cada hallazgo trae que hacer",
      r.revision.hallazgos.every((h) => h.queHacer.trim().length > 5));

    const texto = `${r.revision.resumen} ${r.revision.hallazgos.map((h) => `${h.titulo} ${h.detalle}`).join(" ")}`;
    revisar("no califica a las personas", !PROHIBIDAS.test(texto),
      PROHIBIDAS.test(texto) ? `uso: ${texto.match(PROHIBIDAS)?.[0]}` : "");

    for (const h of r.revision.hallazgos.slice(0, 3)) {
      console.log(`     [${h.tema}] ${h.titulo}`);
      console.log(`        → ${h.queHacer.slice(0, 80)}`);
    }
  }

  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nEl ciclo completo cuadra\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
