/** Como quedo la cobertura preventiva despues de asignar. */
import { prisma } from "../lib/db";
import { coberturaPreventiva } from "../lib/cobertura-planes";
async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  for (const o of orgs) {
    const c = await coberturaPreventiva(o.id);
    if (c.totalActivos === 0) continue;
    const pct = Math.round((c.conPlan / c.totalActivos) * 100);
    console.log(`\n${o.name}`);
    console.log(`  ${c.conPlan} de ${c.totalActivos} equipos con plan (${pct}%)`);
    if (c.sinPlan.length) {
      console.log(`  sin ningun plan:`);
      for (const cat of c.porCategoria) console.log(`     ${cat.categoria.padEnd(30)} ${cat.sinPlan} de ${cat.total}`);
      const criticos = c.sinPlan.filter((e) => e.criticality === "A");
      if (criticos.length) console.log(`  OJO  ${criticos.length} de ellos son CRITICOS: ${criticos.map((e) => e.code).join(", ")}`);
    } else {
      console.log(`  ok   todos los equipos tienen al menos un plan`);
    }
  }
  // Los planes que ahora sirven a varios equipos
  console.log("\n\nPLANES APLICADOS A VARIOS EQUIPOS\n");
  const multi = await prisma.maintenancePlan.findMany({
    where: { asignaciones: { some: {} } },
    select: {
      name: true, triggerType: true,
      organization: { select: { name: true } },
      asignaciones: {
        orderBy: { nextDueDate: "asc" },
        select: { nextDueDate: true, asset: { select: { code: true, criticality: true } } },
      },
    },
  });
  const varios = multi.filter((p) => p.asignaciones.length > 1);
  if (!varios.length) { console.log("  (ninguno todavia)\n"); return; }
  const iso = (d: Date | null) => d ? d.toISOString().slice(0, 10) : "por medidor";
  for (const p of varios) {
    console.log(`${p.organization.name} — «${p.name}»  (${p.asignaciones.length} equipos)`);
    for (const a of p.asignaciones) {
      const d = a.nextDueDate ? ["dom","lun","mar","mie","jue","vie","sab"][a.nextDueDate.getDay()] : "";
      console.log(`   ${a.asset.code.padEnd(10)} ${a.asset.criticality}  ${iso(a.nextDueDate)} ${d}`);
    }
    const f = p.asignaciones.map((a) => iso(a.nextDueDate));
    const finde = p.asignaciones.filter((a) => a.nextDueDate && [0,6].includes(a.nextDueDate.getDay())).length;
    console.log(`   ${new Set(f).size === f.length || f[0] === "por medidor" ? "ok  " : "OJO "} fechas repartidas`);
    console.log(`   ${finde === 0 ? "ok  " : "OJO "} ninguna en fin de semana\n`);
  }
}
main().finally(() => prisma.$disconnect());
