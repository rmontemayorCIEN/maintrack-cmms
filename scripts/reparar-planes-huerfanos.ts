/**
 * Repara los planes que nunca van a generar una orden.
 *
 * El programador itera PlanAsset. Los planes creados desde el formulario de
 * alta guardaban el activo en el encabezado pero nunca creaban la asignacion,
 * asi que se veian bien —con fecha y todo— y no generaban nada, sin avisar.
 *
 * Solo se reparan los que traen assetId: ahi el equipo es explicito y no hay
 * nada que adivinar. Un plan huerfano SIN activo se deja en paz y se reporta,
 * porque elegirle equipo seria inventar.
 *
 * Ensayo por omision. Para aplicar:  --aplicar
 */
import { prisma } from "../lib/db";
import { asignarPlan } from "../lib/asignaciones";

const aplicar = process.argv.includes("--aplicar");

async function main() {
  const huerfanos = await prisma.maintenancePlan.findMany({
    where: { active: true, asignaciones: { none: {} } },
    select: {
      id: true, name: true, assetId: true, nextDueDate: true, meterId: true,
      intervalDays: true, triggerType: true,
      organization: { select: { name: true } },
      asset: { select: { code: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const reparables = huerfanos.filter((p) => p.assetId);
  const sinEquipo = huerfanos.filter((p) => !p.assetId);

  console.log("");
  console.log(`Planes activos que nunca generan: ${huerfanos.length}`);
  console.log(`  reparables (traen equipo):      ${reparables.length}`);
  console.log(`  sin equipo (se dejan en paz):   ${sinEquipo.length}`);
  console.log("");

  if (!reparables.length) {
    console.log("Nada que reparar.");
    return;
  }

  console.log(aplicar ? "APLICANDO:" : "ENSAYO (agregue --aplicar para hacerlo):");
  console.log("");

  let hechos = 0;
  for (const p of reparables) {
    const etiqueta = `${p.organization.name} · ${p.name} → ${p.asset?.code}`;
    if (!aplicar) {
      console.log(`  ${etiqueta}`);
      continue;
    }
    try {
      await asignarPlan({
        organizationId: (await prisma.maintenancePlan.findUniqueOrThrow({
          where: { id: p.id }, select: { organizationId: true },
        })).organizationId,
        planId: p.id,
        // La fecha que ya traia el encabezado: respeta lo que el usuario puso
        // en vez de reiniciar el calendario desde hoy.
        equipos: [{ assetId: p.assetId!, desde: p.nextDueDate, meterId: p.meterId }],
      });
      hechos++;
      console.log(`  hecho  ${etiqueta}`);
    } catch (e) {
      console.log(`  FALLO  ${etiqueta}  → ${e instanceof Error ? e.message : e}`);
    }
  }

  if (aplicar) {
    console.log("");
    console.log(`Reparados: ${hechos} de ${reparables.length}`);
    const quedan = await prisma.maintenancePlan.count({
      where: { active: true, asignaciones: { none: {} }, assetId: { not: null } },
    });
    console.log(`Quedan sin asignacion con equipo: ${quedan}`);
  }

  if (sinEquipo.length) {
    console.log("");
    console.log("Estos no traen equipo. Asignelos a mano en Equipos y sus planes:");
    for (const p of sinEquipo) console.log(`  ${p.organization.name} · ${p.name}`);
  }
  console.log("");
}

main().finally(() => prisma.$disconnect());
