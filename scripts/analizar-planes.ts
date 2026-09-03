/** Cuanto plan repetido hay: mismo nombre y mismo intervalo en activos distintos. */
import { prisma } from "../lib/db";
async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  for (const org of orgs) {
    const planes = await prisma.maintenancePlan.findMany({
      where: { organizationId: org.id, active: true },
      select: {
        id: true, name: true, intervalDays: true, intervalMeter: true, maintenanceType: true,
        asset: { select: { code: true, name: true, model: true, categoryId: true } },
        _count: { select: { tasks: true } },
      },
    });
    if (!planes.length) continue;

    // Firma de "es el mismo plan": nombre normalizado + intervalo + tipo
    const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, " ").trim();
    const grupos = new Map<string, typeof planes>();
    for (const p of planes) {
      const clave = `${norm(p.name)}|${p.intervalDays ?? p.intervalMeter}|${p.maintenanceType}`;
      grupos.set(clave, [...(grupos.get(clave) ?? []), p]);
    }
    const repetidos = [...grupos.entries()].filter(([, g]) => g.length > 1);

    console.log(`\n${org.name}: ${planes.length} planes activos`);
    if (!repetidos.length) { console.log("  sin planes repetidos"); continue; }
    const ahorro = repetidos.reduce((s, [, g]) => s + g.length - 1, 0);
    console.log(`  ${repetidos.length} plan(es) que se repiten en varios activos`);
    console.log(`  se podrian eliminar ${ahorro} de ${planes.length} (${Math.round(ahorro / planes.length * 100)}%)`);
    for (const [clave, g] of repetidos.slice(0, 5)) {
      console.log(`    «${g[0].name}» en ${g.length} activos: ${g.map((p) => p.asset?.code).join(", ")}`);
      const modelos = new Set(g.map((p) => p.asset?.model ?? "?"));
      console.log(`       modelos distintos: ${modelos.size} · actividades por plan: ${g.map((p) => p._count.tasks).join("/")}`);
    }
  }
}
main().finally(() => prisma.$disconnect());
