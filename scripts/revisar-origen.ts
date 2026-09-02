/** Comprueba que el relleno quedo bien y no dejo nada suelto. */
import { prisma } from "../lib/db";
async function main() {
  const grupos = await prisma.workOrderTask.groupBy({
    by: ["origen"], _count: true, orderBy: { origen: "asc" },
  });
  console.log("\nActividades por origen\n");
  for (const g of grupos) console.log(`  ${g.origen.padEnd(11)} ${g._count}`);

  const huerfanas = await prisma.workOrderTask.count({
    where: { origen: "PLAN", origenPlanId: null },
  });
  const sinTipo = await prisma.workOrderTask.count({ where: { maintenanceType: null } });
  console.log(`\n  ${huerfanas === 0 ? "ok   " : "FALLA"} ninguna de PLAN sin su plan  (${huerfanas})`);
  console.log(`  ${sinTipo === 0 ? "ok   " : "FALLA"} ninguna sin tipo de mantenimiento  (${sinTipo})\n`);
  process.exitCode = huerfanas || sinTipo ? 1 : 0;
}
main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
