/**
 * Planes que nunca van a generar una orden.
 *
 * El programador itera PlanAsset. Un plan sin asignacion se ve bien en la
 * lista, tiene fecha, y no genera nada nunca. Solo lee.
 */
import { prisma } from "../lib/db";

async function main() {
  const planes = await prisma.maintenancePlan.findMany({
    where: { active: true },
    select: {
      id: true, name: true, assetId: true, categoryId: true,
      _count: { select: { asignaciones: true, tasks: true } },
      organization: { select: { name: true } },
      asset: { select: { code: true } },
    },
  });

  const huerfanos = planes.filter((p) => p._count.asignaciones === 0);
  console.log(`\nPlanes activos: ${planes.length}`);
  console.log(`  con asignacion (generan):      ${planes.length - huerfanos.length}`);
  console.log(`  SIN asignacion (nunca generan): ${huerfanos.length}`);

  const conAssetId = huerfanos.filter((p) => p.assetId).length;
  console.log(`\n  De los huerfanos, ${conAssetId} traen assetId en el encabezado`);
  console.log("  —se ven amarrados a un equipo, pero el programador no los mira.");

  const porOrg = new Map<string, number>();
  for (const p of huerfanos) porOrg.set(p.organization.name, (porOrg.get(p.organization.name) ?? 0) + 1);
  const top = [...porOrg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length) {
    console.log("\n  Por cuenta:");
    for (const [n, c] of top) console.log(`    ${String(c).padStart(4)}  ${n}`);
  }

  const conCategoria = planes.filter((p) => p.categoryId).length;
  console.log(`\nPlanes con categoria (tipo de activo): ${conCategoria}`);
}

main().finally(() => prisma.$disconnect());
