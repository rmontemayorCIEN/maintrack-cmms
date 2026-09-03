/**
 * Simulacro: que haria el programador HOY, sin escribir nada.
 *
 * Sirve para revisar el estado real antes de apretar el boton. Es de solo
 * lectura a proposito: en la parte mas sensible del sistema conviene poder
 * mirar sin tocar.
 */
import { prisma } from "../lib/db";
import { forecastSchedule } from "../lib/scheduler";

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

  for (const org of orgs) {
    const asigs = await prisma.planAsset.findMany({
      where: { organizationId: org.id, active: true, plan: { active: true } },
      include: { plan: true, asset: true, meter: true },
      orderBy: { nextDueDate: "asc" },
    });
    if (!asigs.length) continue;

    const vencidas = asigs.filter((a) => a.nextDueDate && a.nextDueDate <= hoy);
    const inertes = asigs.filter((a) => a.plan.triggerType === "METER" && !a.meterId);
    const abiertas = await prisma.workOrder.count({
      where: { organizationId: org.id, planId: { not: null }, status: { in: ["OPEN","ASSIGNED","IN_PROGRESS","ON_HOLD","DRAFT"] } },
    });
    const proy = await forecastSchedule(org.id, 60);

    console.log(`\n${org.name}`);
    console.log(`  ${asigs.length} equipo(s) con plan · ${vencidas.length} vencido(s) · ${abiertas} orden(es) abierta(s) de plan`);
    console.log(`  ${proy.length} proyeccion(es) en el calendario a 60 dias`);
    if (inertes.length) {
      console.log(`  OJO  ${inertes.length} equipo(s) en plan por medidor SIN medidor: no van a generar`);
      for (const a of inertes) console.log(`         ${a.asset.code} — ${a.plan.name}`);
    } else {
      console.log(`  ok   ningun equipo inerte`);
    }
    if (vencidas.length) {
      console.log(`  Al ejecutar el programador se generaria:`);
      for (const a of vencidas.slice(0, 8)) {
        console.log(`         ${a.asset.code.padEnd(10)} ${a.plan.name.slice(0, 44)}`);
      }
    }
  }
  console.log("");
}
main().finally(() => prisma.$disconnect());
