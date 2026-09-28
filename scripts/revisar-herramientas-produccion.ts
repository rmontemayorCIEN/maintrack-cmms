/**
 * Comprueba que Herramientas quedo puesto en produccion. Solo LEE.
 *   ./scripts/con-produccion.sh scripts/revisar-herramientas-produccion.ts
 */
import { prisma } from "../lib/db";
async function main() {
  // Si la migracion no llego, estas consultas revientan.
  const resguardos = await prisma.resguardo.count();
  const herramientas = await prisma.part.count({ where: { naturaleza: "HERRAMIENTA" } });
  const autoservicio = await prisma.warehouse.count({ where: { autoservicio: true } });
  console.log(`Esquema OK — resguardos:${resguardos} herramientas:${herramientas} almacenes en autoservicio:${autoservicio}`);
  const conStock = await prisma.partStock.aggregate({ _sum: { enResguardo: true } });
  console.log(`Piezas en resguardo: ${conStock._sum.enResguardo ?? 0}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
