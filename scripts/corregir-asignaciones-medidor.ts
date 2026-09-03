/**
 * Repara las asignaciones de planes por medidor hechas antes del arreglo.
 *
 * Se les puso una fecha que no significa nada y se quedaron sin medidor, asi
 * que se ven asignadas y no generan nunca. Aqui se les liga el medidor del
 * equipo si existe, y se les quita la fecha inventada.
 *
 * Ensayo por omision. Para aplicar:  --aplicar
 */
import { prisma } from "../lib/db";
const aplicar = process.argv.includes("--aplicar");

async function main() {
  const asigs = await prisma.planAsset.findMany({
    where: { plan: { triggerType: "METER" } },
    select: {
      id: true, meterId: true, nextDueDate: true, organizationId: true,
      asset: { select: { id: true, code: true } },
      plan: { select: { name: true } },
    },
  });

  const porArreglar = asigs.filter((a) => !a.meterId || a.nextDueDate !== null);
  console.log(`\n${asigs.length} asignaciones de planes por medidor · ${porArreglar.length} por corregir\n`);

  for (const a of porArreglar) {
    const medidor = await prisma.meter.findFirst({
      where: { organizationId: a.organizationId, assetId: a.asset.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, currentValue: true, unit: true },
    });
    const que = [
      !a.meterId ? (medidor ? `ligar medidor «${medidor.name}» (${medidor.currentValue} ${medidor.unit})` : "SIN MEDIDOR — no va a generar") : null,
      a.nextDueDate ? "quitar la fecha inventada" : null,
    ].filter(Boolean).join(" · ");
    console.log(`  ${a.asset.code.padEnd(10)} ${que}`);

    if (aplicar) {
      await prisma.planAsset.update({
        where: { id: a.id },
        data: { meterId: a.meterId ?? medidor?.id ?? null, nextDueDate: null },
      });
    }
  }
  console.log(aplicar ? "\nAplicado\n" : "\nEnsayo. Nada se escribio. Para aplicar: --aplicar\n");
}
main().finally(() => prisma.$disconnect());
