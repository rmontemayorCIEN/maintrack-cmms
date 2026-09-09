/**
 * Un equipo dado de baja no genera preventivos.
 *
 * El defecto: el programador filtraba por PlanAsset.active y plan.active pero
 * nunca miraba el equipo. Se retiraba un activo —desaparecia de la lista, todo
 * se veia bien— y el sistema seguia emitiendo ordenes para el. Falla callada
 * de manual: nada truena, y el tecnico recibe trabajo de un equipo que ya no
 * existe.
 *
 * Se prueban los tres casos de la regla 6, no solo el que se arreglo:
 *
 *   - el caso nuevo: el equipo de baja YA NO genera
 *   - el caso viejo: el equipo operando SIGUE generando
 *   - el que no debe pasar: reactivar el equipo devuelve sus planes
 *
 * Y la proyeccion aparte, porque tenia el mismo hueco por su cuenta.
 *
 *   npx tsx scripts/prueba-equipo-de-baja.ts
 */
import { prisma } from "../lib/db";
import { generateScheduledWorkOrders, forecastSchedule } from "../lib/scheduler";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  const sello = `prueba-baja-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE" },
  });
  const sitio = await prisma.site.create({
    data: { organizationId: org.id, code: "PL", name: "Planta" },
  });

  const crear = (code: string) =>
    prisma.asset.create({
      data: { organizationId: org.id, siteId: sitio.id, code, name: code, status: "OPERATIONAL" },
    });
  const operando = await crear("OPERA-1");
  const deBaja = await crear("BAJA-1");
  const soloRetirado = await crear("RETIRADO-1");

  const plan = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Preventivo mensual", triggerType: "CALENDAR",
      intervalDays: 30, active: true,
      tasks: { create: [{ position: 1, title: "Revisar" }] },
    },
  });
  const ayer = new Date(Date.now() - 86_400_000);
  for (const a of [operando, deBaja, soloRetirado]) {
    await prisma.planAsset.create({
      data: { organizationId: org.id, planId: plan.id, assetId: a.id, nextDueDate: ayer, active: true },
    });
  }

  // Las dos formas de estar fuera. La pantalla pone las dos juntas, pero desde
  // la ficha se puede poner el estado sin tocar `active`: si solo se cubriera
  // una, el defecto entraria por la puerta de al lado.
  await prisma.asset.update({ where: { id: deBaja.id }, data: { active: false, status: "RETIRED" } });
  await prisma.asset.update({ where: { id: soloRetirado.id }, data: { status: "RETIRED" } });

  const conCodigo = async () => {
    const ots = await prisma.workOrder.findMany({
      where: { organizationId: org.id },
      select: { asset: { select: { code: true } } },
    });
    return ots.map((o) => o.asset?.code);
  };

  console.log("\nGenerar preventivos");
  await generateScheduledWorkOrders(org.id);
  let codigos = await conCodigo();
  revisar("al equipo operando SÍ le genera", codigos.includes("OPERA-1"));
  revisar("al equipo dado de baja NO le genera", !codigos.includes("BAJA-1"));
  revisar("al equipo marcado retirado tampoco, aunque siga activo",
    !codigos.includes("RETIRADO-1"));
  revisar("y no genera de más", codigos.length === 1, `${codigos.length} órdenes`);

  console.log("\nProyección a futuro");
  const proyeccion = await forecastSchedule(org.id, 90);
  const proyectados = JSON.stringify(proyeccion);
  revisar("no proyecta trabajo del equipo dado de baja", !proyectados.includes("BAJA-1"));
  revisar("no proyecta trabajo del equipo retirado", !proyectados.includes("RETIRADO-1"));
  revisar("sí proyecta el del equipo operando", proyectados.includes("OPERA-1"));

  console.log("\nReactivar devuelve sus planes");
  // Sin acordarse de nada: el filtro vive en el programador, no en la baja.
  await prisma.asset.update({
    where: { id: deBaja.id }, data: { active: true, status: "OPERATIONAL" },
  });
  await prisma.planAsset.updateMany({
    where: { organizationId: org.id, assetId: deBaja.id }, data: { nextDueDate: ayer },
  });
  await generateScheduledWorkOrders(org.id);
  codigos = await conCodigo();
  revisar("el equipo reactivado vuelve a generar", codigos.includes("BAJA-1"));

  console.log("\nEl historial se conserva");
  const asignaciones = await prisma.planAsset.count({
    where: { organizationId: org.id, assetId: soloRetirado.id },
  });
  revisar("la asignación del retirado NO se borró, solo dejó de programarse",
    asignaciones === 1, `${asignaciones} asignaciones`);

  await prisma.workOrderTask.deleteMany({ where: { workOrder: { organizationId: org.id } } });
  await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });
  await prisma.planAsset.deleteMany({ where: { organizationId: org.id } });
  await prisma.planTask.deleteMany({ where: { planId: plan.id } });
  await prisma.maintenancePlan.deleteMany({ where: { organizationId: org.id } });
  await prisma.asset.deleteMany({ where: { organizationId: org.id } });
  await prisma.site.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });

  console.log(fallos ? `\n${fallos} fallas\n` : "\nTodo bien\n");
  process.exit(fallos ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
