/**
 * Solo lee. Mide cuanto dato quedaria afectado por mover el codigo de falla
 * del encabezado de la OT a la actividad.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`Organizaciones: ${orgs.length}\n`);

  const conCodigo = await prisma.workOrder.groupBy({
    by: ["maintenanceType"],
    where: { OR: [{ failureCodeId: { not: null } }, { rootCauseId: { not: null } }] },
    _count: { _all: true },
  });
  console.log("OT con codigo de falla o causa raiz, por tipo:");
  if (!conCodigo.length) console.log("  (ninguna)");
  for (const r of conCodigo) console.log(`  ${r.maintenanceType.padEnd(12)} ${r._count._all}`);

  const sospechosas = conCodigo
    .filter((r) => !["CORRECTIVE", "SAFETY"].includes(r.maintenanceType))
    .reduce((a, r) => a + r._count._all, 0);
  console.log(`\n  -> ${sospechosas} contaminan el Pareto (no son falla)\n`);

  if (sospechosas > 0) {
    const detalle = await prisma.workOrder.findMany({
      where: {
        maintenanceType: { notIn: ["CORRECTIVE", "SAFETY"] },
        OR: [{ failureCodeId: { not: null } }, { rootCauseId: { not: null } }],
      },
      select: {
        number: true, title: true, maintenanceType: true, status: true,
        organization: { select: { name: true } },
        failureCode: { select: { code: true, description: true } },
        rootCause: { select: { code: true } },
      },
      take: 25,
    });
    console.log("Detalle:");
    for (const w of detalle) {
      console.log(`  ${w.number} [${w.maintenanceType}] ${w.organization.name}`);
      console.log(`     "${w.title}"`);
      console.log(`     falla: ${w.failureCode ? `${w.failureCode.code} — ${w.failureCode.description}` : "—"}  causa: ${w.rootCause?.code ?? "—"}`);
    }
  }

  const solicitudes = await prisma.workRequest.count({ where: { workOrderId: { not: null } } });
  const tareas = await prisma.workOrderTask.count();
  const tareasConOrigen = await prisma.workOrderTask.count({ where: { origen: { not: "MANUAL" } } });
  const tareasConTipo = await prisma.workOrderTask.count({ where: { maintenanceType: { not: null } } });
  console.log(`\nSolicitudes ya convertidas (amarradas 1 a 1): ${solicitudes}`);
  console.log(`Actividades totales: ${tareas}`);
  console.log(`  con origen distinto de MANUAL: ${tareasConOrigen}`);
  console.log(`  con maintenanceType propio:    ${tareasConTipo}`);
}

main().finally(() => prisma.$disconnect());
