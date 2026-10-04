/**
 * Comprueba que «Registros propios» quedo bien puesto en produccion.
 *
 * Solo LEE. Se corre con:
 *   ./scripts/con-produccion.sh scripts/revisar-registros-produccion.ts
 *
 * Existe porque una migracion que no se aplico no se nota hasta que alguien
 * abre la pantalla y truena con un P2022 —ya paso en la revision 00108— y
 * porque el modulo se cobra aparte: hay que ver que nadie lo tenga encendido
 * sin haberlo contratado.
 */
import { prisma } from "../lib/db";

async function main() {
  // Si la migracion no llego, esta consulta revienta: es la comprobacion.
  const tablas = await prisma.tablaPropia.count();
  const campos = await prisma.campoPropio.count();
  const renglones = await prisma.renglonPropio.count();
  const valores = await prisma.valorPropio.count();
  console.log(`Tablas del esquema OK — tablas:${tablas} campos:${campos} renglones:${renglones} valores:${valores}`);

  const orgs = await prisma.organization.findMany({
    select: { name: true, registrosPropios: true, esDemo: true, _count: { select: { tablasPropias: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log("\nQuien lo tiene encendido:");
  for (const o of orgs) {
    console.log(`  ${o.registrosPropios ? "SI" : "no"}  ${o.name}${o.esDemo ? " (demo)" : ""} — ${o._count.tablasPropias} tablas`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
