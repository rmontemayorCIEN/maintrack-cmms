/** Que la migracion no cambio ninguna fecha: mismas ordenes, mismos dias. */
import { prisma } from "../lib/db";
async function main() {
  const planes = await prisma.maintenancePlan.findMany({
    where: { assetId: { not: null } },
    select: {
      name: true, assetId: true, nextDueDate: true, lastCompletedAt: true,
      asignaciones: { select: { assetId: true, nextDueDate: true, lastCompletedAt: true } },
    },
  });
  let mal = 0, sin = 0;
  for (const p of planes) {
    if (p.asignaciones.length !== 1) { sin++; continue; }
    const a = p.asignaciones[0];
    const iso = (d: Date | null) => d?.toISOString() ?? null;
    if (a.assetId !== p.assetId || iso(a.nextDueDate) !== iso(p.nextDueDate) ||
        iso(a.lastCompletedAt) !== iso(p.lastCompletedAt)) {
      mal++;
      console.log(`  DIFIERE  ${p.name}`);
    }
  }
  console.log(`\n  ${planes.length} planes revisados`);
  console.log(`  ${mal === 0 ? "ok   " : "FALLA"} el calendario se copio identico  (${mal} diferencias)`);
  console.log(`  ${sin === 0 ? "ok   " : "FALLA"} todos tienen su asignacion       (${sin} sin ella)`);
  const total = await prisma.planAsset.count();
  console.log(`  ${total} asignaciones en total\n`);
  process.exitCode = mal || sin ? 1 : 0;
}
main().finally(() => prisma.$disconnect());
