/**
 * Convierte cada plan existente en plantilla con UNA asignacion.
 *
 * El calendario se muda tal cual del plan al equipo, asi que despues de esto
 * el programador genera exactamente las mismas ordenes en las mismas fechas.
 * Nadie nota el cambio: lo que cambia es que a partir de aqui un plan puede
 * recibir un segundo equipo sin arrastrar al primero.
 *
 * Ensayo por omision. Para aplicar:  --aplicar
 */
import { prisma } from "../lib/db";

const aplicar = process.argv.includes("--aplicar");

async function main() {
  const planes = await prisma.maintenancePlan.findMany({
    where: { assetId: { not: null } },
    select: {
      id: true, name: true, organizationId: true, assetId: true, meterId: true,
      nextDueDate: true, nextDueMeter: true, lastGeneratedAt: true, lastCompletedAt: true,
      active: true,
      asset: { select: { code: true } },
      organization: { select: { name: true } },
      _count: { select: { asignaciones: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const pendientes = planes.filter((p) => p._count.asignaciones === 0);
  const sinActivo = await prisma.maintenancePlan.count({ where: { assetId: null } });

  console.log(`\n${planes.length} planes con activo · ${pendientes.length} por migrar · ${sinActivo} sin activo (se quedan igual)\n`);

  for (const p of pendientes.slice(0, 12)) {
    const fecha = p.nextDueDate ? p.nextDueDate.toISOString().slice(0, 10) : "sin fecha";
    console.log(`  ${p.organization.name.slice(0, 22).padEnd(24)} ${p.asset?.code?.padEnd(10) ?? "?".padEnd(10)} ${fecha}  ${p.name.slice(0, 40)}`);
  }
  if (pendientes.length > 12) console.log(`  … y ${pendientes.length - 12} mas`);

  if (!aplicar) {
    console.log("\nEnsayo. Nada se escribio. Para aplicar: --aplicar\n");
    return;
  }

  let n = 0;
  for (const p of pendientes) {
    await prisma.planAsset.create({
      data: {
        organizationId: p.organizationId,
        planId: p.id,
        assetId: p.assetId!,
        meterId: p.meterId,
        // El calendario se copia tal cual: mismas ordenes, mismas fechas.
        nextDueDate: p.nextDueDate,
        nextDueMeter: p.nextDueMeter,
        lastGeneratedAt: p.lastGeneratedAt,
        lastCompletedAt: p.lastCompletedAt,
        active: p.active,
      },
    });
    n++;
  }
  console.log(`\n${n} asignaciones creadas\n`);
}
main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
