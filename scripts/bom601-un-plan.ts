/**
 * BOM-601: un equipo, un plan, con frecuencias por actividad.
 *
 *   ./scripts/con-produccion.sh scripts/bom601-un-plan.ts            # ensayo
 *   ./scripts/con-produccion.sh scripts/bom601-un-plan.ts --aplicar
 *
 * ── Por que no es una fusion ──
 *
 * El plan de 45 dias es "Limpieza y tratamiento torre de enfriamiento" y sirve
 * a DOS equipos: BOM-601 y TOR-701. Sus actividades —limpieza de charola y
 * relleno, dosificar biocida, medir pH, tension de bandas del ventilador— son
 * todas de torre de enfriamiento. Ninguna aplica a una bomba centrifuga.
 *
 * O sea que BOM-601 no tiene dos planes por diseño: esta MAL ASIGNADA al plan
 * de la torre. Fusionarlos habria arrastrado el plan de la torre al de la
 * bomba y roto a TOR-701, que si lo necesita.
 *
 * Lo que se hace:
 *   1. Sacar a BOM-601 del plan de la torre. TOR-701 se queda con el suyo.
 *   2. Darle a su plan de lubricacion las frecuencias que una bomba lleva de
 *      verdad, para que quede un equipo con UN plan y tres cadencias.
 *
 * Las ordenes ya generadas NO se tocan: son historia.
 */
import { prisma } from "../lib/db";
import { resolverCadenciaDelPlan } from "../lib/frecuencias";

const APLICAR = process.argv.includes("--aplicar");

/** Lo que lleva la bomba, con sus dias. Lo de 30 ya existe. */
const NUEVAS = [
  { title: "Alinear acoplamiento con reloj comparador", taskType: "CHECK", cadaDias: 90 },
  { title: "Cambio de rodamientos", taskType: "REPLACE", cadaDias: 360 },
];

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: "demo" }, select: { id: true, name: true } });
  if (!org) throw new Error("No existe la cuenta demo.");
  console.log(`\n${org.name}`);
  console.log(APLICAR ? "MODO: aplicar\n" : "MODO: ensayo (no escribe nada)\n");

  const bomba = await prisma.asset.findFirst({
    where: { organizationId: org.id, code: "BOM-601" },
    select: { id: true, code: true, name: true },
  });
  if (!bomba) throw new Error("No existe BOM-601.");

  const torre = await prisma.maintenancePlan.findFirst({
    where: { organizationId: org.id, name: { contains: "torre de enfriamiento" } },
    select: { id: true, name: true, asignaciones: { select: { assetId: true, asset: { select: { code: true } } } } },
  });
  const lubricacion = await prisma.maintenancePlan.findFirst({
    where: { organizationId: org.id, name: { contains: "Lubricacion mensual" } },
    select: { id: true, name: true, intervalDays: true,
      tasks: { select: { id: true, title: true, cadaCuantas: true }, orderBy: { position: "asc" } } },
  });
  if (!torre || !lubricacion) throw new Error("No encontre alguno de los dos planes.");

  console.log(`1. Sacar a ${bomba.code} del plan «${torre.name}»`);
  console.log(`   ese plan queda con: ${torre.asignaciones.filter((a) => a.assetId !== bomba.id).map((a) => a.asset.code).join(", ") || "(ninguno)"}`);

  const base = lubricacion.intervalDays ?? 30;
  const todas = [
    ...lubricacion.tasks.map((t) => ({ title: t.title, cadaDias: base })),
    ...NUEVAS.map((n) => ({ title: n.title, cadaDias: n.cadaDias })),
  ];
  const cadencia = resolverCadenciaDelPlan(base, todas);

  console.log(`\n2. «${lubricacion.name}» pasa a cadencia base cada ${cadencia.base} d (era ${base})`);
  todas.forEach((t, i) => {
    console.log(`   1 de cada ${String(cadencia.multiplos[i]).padStart(2)} · ${t.title.slice(0, 46).padEnd(48)} cada ${t.cadaDias} d`);
  });

  const ordenes = await prisma.workOrder.count({ where: { planId: torre.id, assetId: bomba.id } });
  console.log(`\n   Órdenes ya generadas de ${bomba.code} por el plan de la torre: ${ordenes} (NO se tocan: son historia)`);

  if (!APLICAR) {
    console.log("\nEnsayo. Para escribir, agregue --aplicar\n");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.planAsset.deleteMany({ where: { planId: torre.id, assetId: bomba.id } });

    for (const n of NUEVAS) {
      const ultima = await tx.planTask.aggregate({
        where: { planId: lubricacion.id }, _max: { position: true },
      });
      await tx.planTask.create({
        data: {
          planId: lubricacion.id,
          position: (ultima._max.position ?? -1) + 1,
          title: n.title,
          taskType: n.taskType,
          cadaCuantas: 1, // se corrige abajo, con la cadencia ya resuelta
        },
      });
    }
    // Con todas las actividades ya creadas, se escriben los multiplos y la base.
    const tareas = await tx.planTask.findMany({
      where: { planId: lubricacion.id }, select: { id: true }, orderBy: { position: "asc" },
    });
    for (let i = 0; i < tareas.length; i++) {
      await tx.planTask.update({
        where: { id: tareas[i].id }, data: { cadaCuantas: cadencia.multiplos[i] ?? 1 },
      });
    }
    await tx.maintenancePlan.update({
      where: { id: lubricacion.id }, data: { intervalDays: cadencia.base },
    });
  });

  // Verificacion contra la cuenta.
  const despues = await prisma.planAsset.findMany({
    where: { organizationId: org.id, assetId: bomba.id },
    select: { plan: { select: { name: true, intervalDays: true,
      tasks: { select: { title: true, cadaCuantas: true }, orderBy: { position: "asc" } } } } },
  });
  console.log("\nVerificacion contra la cuenta:");
  console.log(`   ${bomba.code} tiene ahora ${despues.length} plan(es)`);
  for (const a of despues) {
    console.log(`   «${a.plan.name}» cada ${a.plan.intervalDays} d`);
    for (const t of a.plan.tasks) {
      console.log(`      1 de cada ${String(t.cadaCuantas).padStart(2)} · ${t.title}`);
    }
  }
  const torreDespues = await prisma.planAsset.count({ where: { planId: torre.id } });
  console.log(`   El plan de la torre conserva ${torreDespues} equipo(s)`);
  console.log(despues.length === 1 ? "   Un equipo, un plan.\n" : "   NO quedo en un solo plan. Revise.\n");
}

main().finally(() => prisma.$disconnect());
