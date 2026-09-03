/**
 * Borra el "tipo" que se le habia deducido a los planes.
 *
 * Ese campo lo escribio una version anterior deduciendo la categoria de los
 * equipos asignados. Miente cuando hay compresores tipo A, B y C en la misma
 * categoria: los tres planes deducian «Compresores» y cada uno reclamaba los
 * equipos de los otros. Ya no se escribe; aqui se limpia lo que quedo.
 *
 * Ensayo por omision. Para aplicar:  --aplicar
 */
import { prisma } from "../lib/db";
const aplicar = process.argv.includes("--aplicar");

async function main() {
  const conTipo = await prisma.maintenancePlan.findMany({
    where: { categoryId: { not: null } },
    select: {
      id: true, name: true,
      category: { select: { name: true } },
      organization: { select: { name: true } },
    },
  });
  console.log(`\n${conTipo.length} plan(es) con tipo deducido\n`);
  for (const p of conTipo) {
    console.log(`  ${p.organization.name.slice(0, 24).padEnd(26)} ${p.name.slice(0, 40).padEnd(42)} ${p.category?.name ?? ""}`);
  }
  if (!aplicar) {
    console.log("\nEnsayo. Nada se escribio. Para aplicar: --aplicar\n");
    return;
  }
  const r = await prisma.maintenancePlan.updateMany({
    where: { categoryId: { not: null } },
    data: { categoryId: null },
  });
  console.log(`\n${r.count} plan(es) limpiados\n`);
}
main().finally(() => prisma.$disconnect());
