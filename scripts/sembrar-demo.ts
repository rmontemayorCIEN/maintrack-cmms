/**
 * Siembra una empresa de demostracion en la base que se le indique, sin tocar
 * a ninguna otra organizacion.
 *
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sembrar-demo.ts
 *   ... --nombre "Acero Industrial del Norte (Demo)"
 *   ... --slug demo --dominio demo.maintrack.mx
 *   ... --plan ENTERPRISE
 *   ... --password MiClaveParaLaDemo
 *   ... --reemplazar        vuelve a generarla si ya existe
 *
 * Pensado para la cuenta de presentaciones: la misma planta de la demo local,
 * con seis meses de historial, viviendo en la nube junto a los clientes reales
 * pero completamente aislada de ellos.
 *
 * Dos cosas que hace a proposito:
 *
 *   1. Nunca borra fuera de la organizacion demo. Sin --reemplazar, si ya
 *      existe se detiene en vez de adivinar.
 *   2. El director de la demo NO es operador de plataforma. En local si lo es,
 *      porque ahi no hay datos de nadie mas que perder.
 */
import { randomBytes } from "node:crypto";
import { prisma, sembrarDemo } from "../prisma/demo";

function arg(nombre: string) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const bandera = (nombre: string) => process.argv.includes(`--${nombre}`);

/** Legible para dictarla en una presentacion, aleatoria para no ser adivinable. */
function claveLegible() {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let clave = "";
  for (const b of bytes) clave += alfabeto[b % alfabeto.length];
  return `Demo-${clave}`;
}

async function main() {
  const nombre = arg("nombre") ?? "Acero Industrial del Norte (Demo)";
  const slug = arg("slug") ?? "demo";
  const dominio = arg("dominio") ?? "demo.maintrack.mx";
  const plan = arg("plan") ?? "ENTERPRISE";
  const password = arg("password") ?? claveLegible();

  const destino = process.env.DATABASE_URL ?? "";
  const motor = destino.startsWith("postgresql") ? "PostgreSQL" : destino.startsWith("file:") ? "SQLite local" : "desconocido";
  console.log(`Base de datos: ${motor}`);

  const existente = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true, name: true, _count: { select: { assets: true, workOrders: true } } },
  });

  if (existente && !bandera("reemplazar")) {
    console.error(`\nYa existe la organizacion "${existente.name}" con el identificador "${slug}":`);
    console.error(`  ${existente._count.assets} activos, ${existente._count.workOrders} ordenes de trabajo.`);
    console.error(`\nPara volver a generarla desde cero (se pierde lo que tenga dentro):`);
    console.error(`  npx tsx scripts/sembrar-demo.ts --slug ${slug} --reemplazar\n`);
    process.exit(1);
  }

  // El resto de las organizaciones no se toca: todo va filtrado por el id de
  // esta.
  //
  // El borrado no puede ser un solo delete en cascada: varias tablas apuntan a
  // User sin cascada —las horas de mano de obra, los movimientos de almacen,
  // las lecturas de medidor— y PostgreSQL rechaza el borrado del usuario
  // mientras existan. Se limpia de las hojas hacia la raiz; lo que queda
  // (activos, refacciones, planes, sitios) si cae por cascada de Organization.
  if (existente) {
    console.log(`Reemplazando "${existente.name}" (${existente._count.workOrders} ordenes)…`);
    const id = existente.id;
    const deOrden = { workOrder: { organizationId: id } };

    await prisma.$transaction([
      prisma.workOrderLabor.deleteMany({ where: deOrden }),
      prisma.workOrderPart.deleteMany({ where: deOrden }),
      prisma.workOrderService.deleteMany({ where: deOrden }),
      prisma.workOrderTask.deleteMany({ where: deOrden }),
      prisma.workOrderComment.deleteMany({ where: deOrden }),
      prisma.downtimeEvent.deleteMany({ where: deOrden }),
      prisma.stockMovement.deleteMany({ where: { organizationId: id } }),
      prisma.meterReading.deleteMany({ where: { organizationId: id } }),
      prisma.attachment.deleteMany({ where: { organizationId: id } }),
      prisma.referenceLink.deleteMany({ where: { organizationId: id } }),
      prisma.predictiveAlert.deleteMany({ where: { organizationId: id } }),
      prisma.notification.deleteMany({ where: { organizationId: id } }),
      prisma.auditLog.deleteMany({ where: { organizationId: id } }),
      prisma.aiUsage.deleteMany({ where: { organizationId: id } }),
      prisma.aiReport.deleteMany({ where: { organizationId: id } }),
      prisma.planRequest.deleteMany({ where: { organizationId: id } }),
      prisma.workRequest.deleteMany({ where: { organizationId: id } }),
      prisma.workOrder.deleteMany({ where: { organizationId: id } }),
      prisma.organization.delete({ where: { id } }),
    ]);
  }

  const otras = await prisma.organization.count();
  console.log(`Organizaciones que permanecen intactas: ${otras}`);

  const r = await sembrarDemo({ nombre, slug, dominio, password, plan, superAdmin: false });

  console.log(`\n✓ ${r.nombre}`);
  console.log(`  ${r.activos} activos · ${r.planes} planes · ${r.ordenes} ordenes de trabajo`);
  console.log(`\n  Acceso a la demo`);
  console.log(`  ────────────────`);
  console.log(`  Usuario     ${r.acceso}`);
  console.log(`  Contraseña  ${password}`);
  console.log(`\n  Los seis usuarios de ejemplo comparten esa contraseña:`);
  for (const rol of ["director", "supervisor", "tecnico", "electrico", "confiabilidad", "produccion"]) {
    console.log(`    ${rol}@${dominio}`);
  }
  console.log(`\n  Ninguno es operador de plataforma: solo ven esta empresa.\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
