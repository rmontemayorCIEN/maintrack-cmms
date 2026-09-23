/**
 * ¿Existen ya las tablas del rondin en produccion?
 *
 * Una migracion que no se aplico no se nota al desplegar: se nota cuando
 * alguien abre la pantalla y truena con un P2022 pidiendo una columna que la
 * base no tiene. Esto lo pregunta antes, en lugar de esperar al cliente.
 *
 *   ./scripts/con-produccion.sh scripts/diagnostico-rondin-tablas.ts
 */
import { prisma } from "../lib/db";

async function main() {
  const rondines = await prisma.rondin.count();
  const paradas = await prisma.rondinParada.count();
  // La columna nueva de Attachment: si falta, adjuntar una foto al rondin
  // reventaria, y eso no se ve hasta que alguien lo intenta.
  const conColumna = await prisma.attachment.count({ where: { rondinParadaId: null } });
  // La segunda migracion: los hallazgos y la marca de cuando se revisaron.
  const hallazgos = await prisma.rondinHallazgo.count();
  const revisados = await prisma.rondin.count({ where: { analizadoEn: { not: null } } });
  console.log(`\n  Rondin: ${rondines} · RondinParada: ${paradas} · Attachment legible: ${conColumna}`);
  console.log(`  RondinHallazgo: ${hallazgos} · recorridos ya revisados: ${revisados}`);
  console.log("  Las tablas y las columnas existen: las dos migraciones se aplicaron.\n");
}

main()
  .catch((e) => { console.error("\n  FALLA:", e instanceof Error ? e.message.split("\n")[0] : e, "\n"); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
