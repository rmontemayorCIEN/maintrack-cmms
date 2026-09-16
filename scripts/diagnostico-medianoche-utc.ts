/**
 * Cuantas fechas quedarian recorridas si el servidor pasara a TZ=America/Monterrey.
 *
 * SOLO LECTURA. Por cada campo de fecha cuenta los valores a medianoche UTC
 * exacta (un dia calculado por el servidor en UTC: son los que habria que
 * mover +6 h), los que ya estan a medianoche de Mexico (06:00 UTC) y el resto
 * (momentos con hora, que no se tocan). Desglosado por organizacion.
 *
 *   ./scripts/con-produccion.sh scripts/diagnostico-medianoche-utc.ts
 */
import { prisma } from "../lib/db";

/** Campos que representan un DIA, no un momento. */
const DE_DIA: [string, string][] = [
  ["Asset", "purchaseDate"], ["Asset", "warrantyExpiry"], ["Asset", "commissionedAt"],
  ["MaintenancePlan", "nextDueDate"], ["PlanAsset", "nextDueDate"],
  ["PlanTaskAsset", "arranqueEl"], ["PlanTaskAsset", "ultimaEl"], ["PlanTaskAsset", "proximaEl"],
  ["WorkOrder", "dueDate"], ["WorkOrder", "scheduledStart"], ["WorkOrder", "scheduledEnd"],
  ["DiaFestivo", "fecha"], ["Invoice", "emitidaEl"], ["Invoice", "venceEl"],
  ["Quote", "vigenciaHasta"], ["PurchaseOrder", "fechaPrometida"],
  ["AiReport", "desde"], ["AiReport", "hasta"], ["Organization", "trialEndsAt"],
];

type Fila = { org: string; total: bigint; utc: bigint; mexico: bigint };

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("postgres")) console.log("(Aviso: no es PostgreSQL; se cuenta la base local)\n");

  let granUtc = 0;
  const porOrg = new Map<string, number>();
  for (const [modelo, campo] of DE_DIA) {
    const orgExpr = modelo === "Organization" ? `t."name"` : `o."name"`;
    const union = modelo === "Organization" ? "" : `LEFT JOIN "Organization" o ON o."id" = t."organizationId"`;
    let filas: Fila[];
    try {
      filas = await prisma.$queryRawUnsafe<Fila[]>(`
        SELECT COALESCE(${orgExpr}, '(sin empresa)') AS org,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE t."${campo}"::time = '00:00:00') AS utc,
               COUNT(*) FILTER (WHERE t."${campo}"::time = '06:00:00') AS mexico
        FROM "${modelo}" t ${union}
        WHERE t."${campo}" IS NOT NULL
        GROUP BY 1 ORDER BY 3 DESC`);
    } catch (e) {
      console.log(`${modelo}.${campo}: no se pudo contar (${(e as Error).message.split("\n")[0]})`);
      continue;
    }
    const total = filas.reduce((s, f) => s + Number(f.total), 0);
    const utc = filas.reduce((s, f) => s + Number(f.utc), 0);
    const mx = filas.reduce((s, f) => s + Number(f.mexico), 0);
    granUtc += utc;
    console.log(`${`${modelo}.${campo}`.padEnd(30)} total ${String(total).padStart(6)} · medianoche UTC ${String(utc).padStart(6)} · medianoche MX ${String(mx).padStart(6)} · con hora ${String(total - utc - mx).padStart(6)}`);
    for (const f of filas) {
      if (Number(f.utc)) {
        console.log(`    ${f.org}: ${f.utc} de ${f.total}`);
        porOrg.set(f.org, (porOrg.get(f.org) ?? 0) + Number(f.utc));
      }
    }
  }

  console.log(`\nTotal a medianoche UTC (se moverian): ${granUtc}`);
  for (const [org, n] of [...porOrg].sort((a, b) => b[1] - a[1])) console.log(`  ${org}: ${n}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
