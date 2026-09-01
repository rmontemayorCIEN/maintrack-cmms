/**
 * Siembra la base de datos LOCAL de desarrollo.
 *
 *   npm run db:reset
 *
 * Borra todo y vuelve a generar la planta de demostracion. Solo para el
 * entorno local: para sembrar una empresa demo en la nube sin tocar a los
 * demas clientes, use scripts/sembrar-demo.ts.
 */
import { prisma, sembrarDemo } from "./demo";

async function main() {
  console.log("Limpiando base de datos…");
  await prisma.organization.deleteMany();

  const r = await sembrarDemo({
    nombre: "Acero Industrial del Norte",
    slug: "acero-industrial",
    dominio: "aceroindustrial.mx",
    password: "demo1234",
    plan: "PROFESSIONAL",
    // Solo en local: asi se puede probar la consola de plataforma sin montar
    // una segunda empresa a mano.
    superAdmin: true,
  });

  console.log(`\nListo. ${r.activos} activos, ${r.planes} planes, ${r.ordenes} ordenes de trabajo.`);
  console.log(`Acceso: ${r.acceso} / demo1234\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
