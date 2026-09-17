/**
 * Aplica en la base de DESARROLLO (SQLite) el mismo paso de datos que la
 * migracion `integridad_medidores_y_predictivo`: el tipo de cada medidor sale
 * de su unidad. En produccion lo hace la migracion; `prisma db push` no corre
 * los UPDATE, por eso existe este script.
 *
 *   npx tsx scripts/derivar-tipo-medidor.ts            # solo reporta
 *   npx tsx scripts/derivar-tipo-medidor.ts --aplicar
 */
import { prisma } from "../lib/db";
import { tipoPorUnidad } from "../lib/medidores";

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const medidores = await prisma.meter.findMany({ select: { id: true, unit: true, tipo: true } });
  let cambian = 0;
  for (const m of medidores) {
    const tipo = tipoPorUnidad(m.unit);
    if (tipo === m.tipo) continue;
    cambian += 1;
    if (aplicar) await prisma.meter.update({ where: { id: m.id }, data: { tipo } });
  }
  console.log(`${medidores.length} medidores · ${cambian} ${aplicar ? "actualizados" : "cambiarían"}`);
}

main().finally(() => prisma.$disconnect());
