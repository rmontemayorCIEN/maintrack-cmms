/** Por que el programador no genera OT para cada plan de una organizacion. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const buscado = process.argv[2] ?? "Casa Montemayor";

const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: { contains: buscado } } });
  if (!org) throw new Error("organizacion no encontrada");
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

  const planes = await prisma.maintenancePlan.findMany({
    where: { organizationId: org.id },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, active: true, assetId: true, triggerType: true,
      intervalDays: true, leadTimeDays: true, nextDueDate: true, lastGeneratedAt: true,
      _count: { select: { tasks: true, workOrders: true } },
    },
  });

  console.log(`\n${org.name} — hoy es ${dia(hoy)}\n`);
  for (const p of planes) {
    const abierta = await prisma.workOrder.findFirst({
      where: { organizationId: org.id, planId: p.id, status: { in: ["DRAFT", "OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] } },
      select: { number: true },
    });

    let motivo: string;
    if (!p.active) motivo = "el plan esta pausado";
    else if (!p.assetId) motivo = "no tiene activo asignado";
    else if (abierta) motivo = `ya existe ${abierta.number} abierta`;
    else if (p.triggerType === "CALENDAR" && !p.nextDueDate && !p.intervalDays) motivo = "sin intervalo ni proximo vencimiento";
    else {
      const vence = p.nextDueDate ?? new Date();
      const dispara = new Date(vence); dispara.setDate(dispara.getDate() - p.leadTimeDays);
      const diasFalta = Math.round((dispara.getTime() - hoy.getTime()) / 86400000);
      motivo = diasFalta > 0
        ? `fuera de ventana: vence ${dia(vence)}, dispara ${dia(dispara)} (faltan ${diasFalta} dias)`
        : "SI DEBERIA GENERAR";
    }

    console.log(`  ${p.name.slice(0, 44).padEnd(45)}`);
    console.log(`     vence ${dia(p.nextDueDate)} · cada ${p.intervalDays ?? "?"} d · anticipa ${p.leadTimeDays} d · ${p._count.tasks} actividades · ${p._count.workOrders} OT generadas`);
    console.log(`     → ${motivo}\n`);
  }
}
main().catch((e) => console.error("ERROR:", e.message)).finally(() => prisma.$disconnect());
