/**
 * Cuanto tarda CADA consulta de la revision de calidad.
 *
 * `prueba-rendimiento.ts` dice que la pantalla tarda; esto dice por que. Se
 * corre contra la instancia de pruebas, no contra produccion:
 *
 *   DATABASE_URL="postgresql://..." npx tsx scripts/perfilar-calidad.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function medir<T>(que: string, fn: () => Promise<T>) {
  const t = Date.now();
  const r = await fn();
  const ms = Date.now() - t;
  const cuantos = Array.isArray(r) ? r.length : typeof r === "number" ? r : "";
  console.log(`  ${String(ms).padStart(6)} ms  ${que.padEnd(44)} ${cuantos}`);
  return ms;
}

(async () => {
  const org = await prisma.organization.findFirstOrThrow({ where: { slug: "volumen-de-prueba" } });
  const o = org.id;
  const enServicio = { organizationId: o, active: true, status: { not: "RETIRED" } };
  console.log("\nConsultas de la revision de calidad, una por una\n");

  await medir("medidores con sus lecturas (200 c/u)", () => prisma.meter.findMany({
    where: { organizationId: o },
    select: {
      id: true, name: true, tipo: true, unit: true, dailyAverage: true, maxIncrementoDiario: true,
      asset: { select: { id: true, code: true, name: true } },
      readings: { where: { estado: { not: "ANULADA" } }, orderBy: [{ readingAt: "desc" }, { id: "desc" }], take: 200, select: { value: true, readingAt: true, tipo: true, atipica: true } },
    },
  }));
  await medir("ordenes sin horas", () => prisma.workOrder.findMany({ where: { organizationId: o, status: { in: ["COMPLETED", "CLOSED"] }, actualHours: { lte: 0 } }, select: { id: true, number: true, title: true } }));
  await medir("actividades sin resolver", () => prisma.workOrderTask.findMany({ where: { workOrder: { organizationId: o, status: { in: ["COMPLETED", "CLOSED"] } }, completedAt: null }, select: { id: true, title: true, workOrder: { select: { id: true, number: true, title: true } } } }));
  await medir("fallas sin diagnostico", () => prisma.workOrder.findMany({ where: { organizationId: o, status: { in: ["COMPLETED", "CLOSED"] }, maintenanceType: "CORRECTIVE", failureCodeId: null }, select: { id: true, number: true, title: true } }));
  await medir("completadas sin cerrar", () => prisma.workOrder.findMany({ where: { organizationId: o, status: "COMPLETED" }, select: { id: true, number: true, title: true, completedAt: true } }));
  await medir("costos negativos", () => prisma.workOrder.findMany({ where: { organizationId: o, OR: [{ laborCost: { lt: 0 } }, { partsCost: { lt: 0 } }, { serviceCost: { lt: 0 } }, { otherCost: { lt: 0 } }, { totalCost: { lt: 0 } }] }, select: { id: true, number: true, title: true } }));
  await medir("activos sin plan", () => prisma.asset.findMany({ where: { ...enServicio, planesAsignados: { none: { active: true, plan: { active: true } } } }, select: { id: true, code: true, name: true } }));
  await medir("activos sin ubicacion", () => prisma.asset.findMany({ where: { ...enServicio, locationId: null }, select: { id: true, code: true, name: true } }));
  await medir("activos con fechas", () => prisma.asset.findMany({ where: { organizationId: o, OR: [{ purchaseDate: { not: null } }, { warrantyExpiry: { not: null } }] }, select: { id: true, code: true, name: true, purchaseDate: true, warrantyExpiry: true, commissionedAt: true } }));
  await medir("refacciones sin costo", () => prisma.part.findMany({ where: { organizationId: o, active: true, unitCost: { lte: 0 } }, select: { id: true, code: true, name: true } }));
  await medir("solicitudes huerfanas", () => prisma.workRequest.findMany({ where: { organizationId: o, status: "CONVERTED", OR: [{ workOrderId: null }, { workOrder: { status: "CANCELLED" } }] }, select: { id: true, number: true, title: true, workOrder: { select: { number: true, status: true } } } }));
  await medir("termino antes de empezar (en la base)", () => prisma.workOrder.count({ where: { organizationId: o, startedAt: { not: null }, completedAt: { lt: prisma.workOrder.fields.startedAt } } }));

  console.log("");
  const { revisarCalidad } = await import("../lib/calidad-datos");
  await medir("revisarCalidad completa", () => revisarCalidad(o));
  process.exit(0);
})();
