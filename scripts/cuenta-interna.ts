/**
 * Marca o desmarca una empresa como cuenta interna del operador.
 *
 *   npx tsx scripts/cuenta-interna.ts --listar
 *   npx tsx scripts/cuenta-interna.ts --org "Acero Industrial del Norte (Demo)"            (ensayo)
 *   npx tsx scripts/cuenta-interna.ts --org "Acero Industrial del Norte (Demo)" --aplicar
 *   npx tsx scripts/cuenta-interna.ts --org <id> --retirar --aplicar
 *
 * En produccion: ./scripts/con-produccion.sh scripts/cuenta-interna.ts --org "…" --aplicar
 *
 * Una cuenta interna sale de las cifras del negocio (servidor MCP) y de la
 * cobranza, y nada mas: sigue funcionando igual. NO es la empresa
 * demostrativa (`esDemo`), que ofrece «Restaurar» y borra todo; por eso existe
 * esta bandera aparte. Como el rol de operador, se pone por linea de comandos
 * y no desde una pantalla: decide que es un cliente y que se le cobra.
 */
import { prisma } from "../lib/db";
import { logAudit } from "../lib/audit";

function arg(n: string) {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const tiene = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  if (tiene("listar")) {
    const orgs = await prisma.organization.findMany({
      where: { OR: [{ cuentaInterna: true }, { esDemo: true }] },
      select: { id: true, name: true, cuentaInterna: true, esDemo: true },
    });
    if (!orgs.length) console.log("No hay cuentas internas ni demostrativas.");
    for (const o of orgs) console.log(`  ${o.id}  ·  ${o.name}  ·  ${o.esDemo ? "demostrativa" : "cuenta interna"}`);
    return;
  }

  const clave = arg("org")?.trim();
  if (!clave) {
    console.error('Uso: npx tsx scripts/cuenta-interna.ts --org "<nombre exacto o id>" [--retirar] [--aplicar]');
    process.exit(1);
  }
  // Por id o por nombre EXACTO. Un nombre parecido no basta: «Acero Industrial
  // del Norte» y «Acero Industrial del Norte (Demo)» son dos cuentas distintas.
  const encontradas = await prisma.organization.findMany({
    where: { OR: [{ id: clave }, { name: clave }] },
    select: { id: true, name: true, cuentaInterna: true, esDemo: true, status: true },
  });
  if (encontradas.length !== 1) {
    console.error(encontradas.length ? `Hay ${encontradas.length} empresas con ese nombre; use el id.` : `No existe una empresa con id o nombre «${clave}».`);
    for (const o of encontradas) console.error(`  ${o.id}  ·  ${o.name}`);
    process.exit(1);
  }
  const org = encontradas[0];
  const marcar = !tiene("retirar");

  console.log(`Empresa: ${org.name} (${org.id}) · ${org.status}${org.esDemo ? " · demostrativa" : ""}`);
  console.log(`Hoy: ${org.cuentaInterna ? "cuenta interna" : "cuenta de cliente"}`);
  if (org.cuentaInterna === marcar) {
    console.log("No hay nada que cambiar.");
    return;
  }
  console.log(`Queda: ${marcar ? "cuenta interna (fuera de cifras y de cobranza)" : "cuenta de cliente (vuelve a cifras y cobranza)"}`);
  if (!tiene("aplicar")) {
    console.log("\nEnsayo: no se cambió nada. Agregue --aplicar para hacerlo.");
    return;
  }

  await prisma.organization.update({ where: { id: org.id }, data: { cuentaInterna: marcar } });
  await logAudit({
    organizationId: org.id, entity: "Organization", entityId: org.id, action: "CLIENT_UPDATED",
    summary: marcar ? "Marcada como cuenta interna del operador: fuera de cifras del negocio y de cobranza" : "Deja de ser cuenta interna: vuelve a cifras del negocio y cobranza",
    changes: { cuentaInterna: { antes: !marcar, despues: marcar } },
  });
  const ya = await prisma.organization.findUnique({ where: { id: org.id }, select: { cuentaInterna: true } });
  console.log(ya?.cuentaInterna === marcar ? "\n✓ Hecho y verificado." : "\nATENCION: el cambio no quedó; revise.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
