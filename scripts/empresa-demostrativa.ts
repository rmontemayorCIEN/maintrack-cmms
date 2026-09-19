/**
 * La empresa demostrativa (Bloque 7): crearla o restaurarla.
 *
 *   npx tsx scripts/empresa-demostrativa.ts                 # solo informa qué haría
 *   npx tsx scripts/empresa-demostrativa.ts --aplicar       # la crea si no existe
 *   npx tsx scripts/empresa-demostrativa.ts --restaurar --aplicar   # la regresa a su estado inicial
 *
 * En producción: ./scripts/con-produccion.sh scripts/empresa-demostrativa.ts [...]
 *
 * La contraseña de las ocho cuentas demo se toma de DEMO_CONTRASENA o se
 * genera; se imprime UNA vez al crear (no es una llave del sistema: es la
 * cuenta de ejemplo con que se presenta). Restaurar conserva las cuentas y
 * sus contraseñas.
 *
 * Solo toca la organización con slug «empresa-demostrativa» y esDemo = true.
 * Nunca otra.
 */
import { randomBytes } from "node:crypto";

const aplicar = process.argv.includes("--aplicar");
const restaurar = process.argv.includes("--restaurar");

async function main() {
  const { prisma } = await import("../lib/db");
  const { DEMO, PERSONAS, correoDemo, crearEmpresaDemostrativa, restaurarDemo, resumenDemo, vistaPreviaRestauracion } = await import("../lib/demo-comercial");
  const existente = await prisma.organization.findUnique({ where: { slug: DEMO.slug }, select: { id: true, name: true, esDemo: true } });

  if (restaurar) {
    if (!existente) throw new Error("No existe la empresa demostrativa: créela primero (sin --restaurar).");
    if (!existente.esDemo) throw new Error(`La organización «${DEMO.slug}» no está marcada como demo: no se toca.`);
    const previa = await vistaPreviaRestauracion(existente.id);
    console.log("Hoy tiene:", previa.hoy);
    console.log("Se conserva:", previa.seConserva.join("; "));
    console.log("Se restaura:", previa.seRestaura.join("; "));
    if (!aplicar) { console.log("\nEnsayo: no se cambió nada. Agregue --aplicar para restaurar."); return; }
    const operador = await prisma.user.findFirst({ where: { organizationId: existente.id, role: "OWNER" }, select: { id: true } });
    const inicio = Date.now();
    const r = await restaurarDemo({ orgId: existente.id, userId: operador!.id });
    console.log(`\n✓ Restaurada en ${Math.round((Date.now() - inicio) / 1000)} s:`, r);
    return;
  }

  if (existente) {
    console.log(`Ya existe «${existente.name}» (${existente.esDemo ? "demo" : "NO es demo"}):`, await resumenDemo(existente.id));
    console.log("Para regresarla a su estado inicial use --restaurar --aplicar.");
    return;
  }
  console.log(`Se crearía «${DEMO.nombre}» (${DEMO.slug}) con ${PERSONAS.length} cuentas @${DEMO.dominio}, plan Enterprise, sin cobro.`);
  if (!aplicar) { console.log("\nEnsayo: no se creó nada. Agregue --aplicar para crearla."); return; }
  const contrasena = process.env.DEMO_CONTRASENA || `Demo-${randomBytes(4).toString("hex")}`;
  const inicio = Date.now();
  const org = await crearEmpresaDemostrativa({ contrasena });
  console.log(`\n✓ Creada en ${Math.round((Date.now() - inicio) / 1000)} s:`, await resumenDemo(org.id));
  console.log("\nCuentas (todas con la misma contraseña, guárdela ahora):");
  for (const p of PERSONAS) console.log(`  ${p.puesto.padEnd(30)} ${correoDemo(p.clave)}`);
  if (!process.env.DEMO_CONTRASENA) console.log(`  Contraseña: ${contrasena}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
