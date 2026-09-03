import { prisma } from "../lib/db";
async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  for (const o of orgs) {
    const cats = await prisma.assetCategory.findMany({
      where: { organizationId: o.id },
      select: { name: true, code: true, _count: { select: { assets: true, plans: true } } },
      orderBy: { name: "asc" },
    });
    if (!cats.length) continue;
    console.log(`\n${o.name}`);
    for (const c of cats) console.log(`  ${c.code.padEnd(8)} ${c.name.padEnd(26)} ${c._count.assets} activo(s) · ${c._count.plans} plan(es)`);
  }
}
main().finally(() => prisma.$disconnect());
