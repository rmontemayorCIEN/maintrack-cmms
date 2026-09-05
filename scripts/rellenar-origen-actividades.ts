/**
 * Rellena el origen de las actividades que ya existian.
 *
 * La migracion las deja todas en MANUAL, que es falso: las que nacieron de un
 * plan preventivo vienen de ahi, y las de una solicitud de servicio tambien.
 * Sin esto el backlog y el avance de planes trabajarian sobre datos mentirosos.
 *
 * Ensayo por omision. Para aplicar:  --aplicar
 */
import { prisma } from "../lib/db";

const aplicar = process.argv.includes("--aplicar");

async function main() {
  const tareas = await prisma.workOrderTask.findMany({
    where: { origen: "MANUAL" },
    select: {
      id: true, title: true,
      workOrder: {
        select: {
          number: true, planId: true, maintenanceType: true,
          requests: { select: { id: true } },
        },
      },
    },
  });

  const cambios: { id: string; origen: string; datos: Record<string, unknown>; nota: string }[] = [];

  for (const t of tareas) {
    const wo = t.workOrder;
    // El tipo de la OT es lo mejor que se sabe de cada actividad vieja: antes
    // no habia forma de que difirieran.
    const base = { maintenanceType: wo.maintenanceType };

    if (wo.planId) {
      cambios.push({
        id: t.id, origen: "PLAN",
        datos: { ...base, origen: "PLAN", origenPlanId: wo.planId },
        nota: `${wo.number}  ${t.title.slice(0, 44)}`,
      });
    } else if (wo.requests.length === 1) {
      // Solo cuando la orden atiende UNA solicitud. Con varias no hay forma de
      // saber cual actividad corresponde a cual reporte, y adivinar seria peor
      // que dejarla en MANUAL.
      cambios.push({
        id: t.id, origen: "SOLICITUD",
        datos: { ...base, origen: "SOLICITUD", origenRequestId: wo.requests[0].id },
        nota: `${wo.number}  ${t.title.slice(0, 44)}`,
      });
    } else {
      cambios.push({
        id: t.id, origen: "MANUAL",
        datos: base,
        nota: `${wo.number}  ${t.title.slice(0, 44)}`,
      });
    }
  }

  const porOrigen = cambios.reduce<Record<string, number>>((a, c) => {
    a[c.origen] = (a[c.origen] ?? 0) + 1; return a;
  }, {});

  console.log(`\n${tareas.length} actividades sin origen\n`);
  for (const [origen, n] of Object.entries(porOrigen)) console.log(`  ${origen.padEnd(11)} ${n}`);
  console.log("\nMuestra:\n");
  for (const c of cambios.slice(0, 8)) console.log(`  ${c.origen.padEnd(11)} ${c.nota}`);

  if (!aplicar) {
    console.log("\nEnsayo. Nada se escribio. Para aplicar: --aplicar\n");
    return;
  }

  let n = 0;
  for (const c of cambios) {
    await prisma.workOrderTask.update({ where: { id: c.id }, data: c.datos });
    n++;
  }
  console.log(`\n${n} actividades actualizadas\n`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
