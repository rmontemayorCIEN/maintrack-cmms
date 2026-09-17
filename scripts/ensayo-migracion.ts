/**
 * Ensayo de las migraciones pendientes y del recalculo de medidores, SIN dejar
 * rastro.
 *
 * Todo corre dentro de UNA transaccion que al final se revierte a proposito:
 *
 *   1. Aplica el SQL de las migraciones que la base aun no tiene.
 *   2. Comprueba que las columnas nuevas existen.
 *   3. Corre el ensayo de recalculo de medidores (`planearRecalculo`) sobre el
 *      esquema ya migrado y los datos reales.
 *   4. Revierte todo (ROLLBACK) y comprueba que las columnas ya NO existen.
 *
 * PostgreSQL revierte DDL dentro de una transaccion, asi que la base queda
 * exactamente como estaba. Si el proceso se corta a la mitad, la conexion se
 * cierra y PostgreSQL revierte solo.
 *
 * Mientras dura, las tablas alteradas quedan bloqueadas para escritura (y
 * lectura) de la aplicacion. Por eso: `lock_timeout` corto para no quedarse
 * esperando detras de otra operacion, y el ensayo de recalculo no escribe.
 *
 *   ./scripts/con-produccion.sh scripts/ensayo-migracion.ts
 *   ./scripts/con-produccion.sh scripts/ensayo-migracion.ts --json
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/db";
import { planearRecalculo, type PlanDeRecalculo } from "../lib/medidores";

const JSON_SALIDA = process.argv.includes("--json");
const REVERTIR = Symbol("revertir");

/** Las sentencias de un migration.sql: sin comentarios, una por `;`. */
function sentencias(sql: string) {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function columnas(tabla: string): Promise<string[]> {
  const filas = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, tabla);
  return filas.map((f) => f.column_name);
}

async function main() {
  if (!(process.env.DATABASE_URL ?? "").startsWith("postgres")) {
    console.error("Este ensayo es para PostgreSQL (produccion o una copia). Use ./scripts/con-produccion.sh");
    process.exit(1);
  }

  const aplicadas = new Set(
    (await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    )).map((r) => r.migration_name),
  );
  const carpeta = join(process.cwd(), "prisma", "migrations");
  const pendientes = readdirSync(carpeta, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !aplicadas.has(d.name))
    .map((d) => d.name)
    .sort();

  console.log(`Migraciones pendientes: ${pendientes.length ? pendientes.join(", ") : "ninguna"}`);

  const antes = {
    Meter: await columnas("Meter"),
    MeterReading: await columnas("MeterReading"),
    PlanTask: await columnas("PlanTask"),
    PredictiveAlert: await columnas("PredictiveAlert"),
    WorkOrder: await columnas("WorkOrder"),
    Organization: await columnas("Organization"),
    RevisionAgenda: await columnas("RevisionAgenda"),
    WorkOrderPart: await columnas("WorkOrderPart"),
    PurchaseRequestLine: await columnas("PurchaseRequestLine"),
    GoodsReceipt: await columnas("GoodsReceipt"),
  };

  const reporte: {
    migracion: Array<{ migracion: string; sentencias: number; ms: number }>;
    columnasNuevas: Record<string, string[]>;
    medidores: Array<{ empresa: string } & PlanDeRecalculo>;
    duracionTransaccionMs: number;
  } = { migracion: [], columnasNuevas: {}, medidores: [], duracionTransaccionMs: 0 };

  const inicio = Date.now();
  try {
    await prisma.$transaction(async (tx) => {
      // No esperar detras de nadie: si una tabla esta ocupada, el ensayo
      // aborta en vez de congelar la aplicacion.
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '3s'`);
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '60s'`);

      for (const nombre of pendientes) {
        const sql = readFileSync(join(carpeta, nombre, "migration.sql"), "utf8");
        const t0 = Date.now();
        const lista = sentencias(sql);
        for (const s of lista) await tx.$executeRawUnsafe(s);
        reporte.migracion.push({ migracion: nombre, sentencias: lista.length, ms: Date.now() - t0 });
      }

      for (const tabla of Object.keys(antes) as Array<keyof typeof antes>) {
        const filas = await tx.$queryRawUnsafe<Array<{ column_name: string }>>(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, tabla);
        reporte.columnasNuevas[tabla] = filas.map((f) => f.column_name).filter((c) => !antes[tabla].includes(c));
      }

      // Ensayo de recalculo sobre el esquema migrado y los datos reales.
      const ahora = new Date();
      const empresas = await tx.organization.findMany({
        where: { meters: { some: {} } },
        select: { id: true, name: true, timezone: true },
        orderBy: { name: "asc" },
      });
      for (const org of empresas) {
        const medidores = await tx.meter.findMany({ where: { organizationId: org.id }, select: { id: true }, orderBy: { name: "asc" } });
        for (const m of medidores) {
          const plan = await planearRecalculo(tx, org.id, m.id, ahora, org.timezone || "America/Mexico_City");
          reporte.medidores.push({ empresa: org.name, ...plan });
        }
      }

      reporte.duracionTransaccionMs = Date.now() - inicio;
      throw REVERTIR;
    }, { timeout: 90_000, maxWait: 10_000 });
  } catch (e) {
    if (e !== REVERTIR) throw e;
  }

  // Comprobacion de que la reversion fue real.
  const despues = {
    Meter: await columnas("Meter"),
    MeterReading: await columnas("MeterReading"),
    PlanTask: await columnas("PlanTask"),
    PredictiveAlert: await columnas("PredictiveAlert"),
    WorkOrder: await columnas("WorkOrder"),
    Organization: await columnas("Organization"),
    RevisionAgenda: await columnas("RevisionAgenda"),
    WorkOrderPart: await columnas("WorkOrderPart"),
    PurchaseRequestLine: await columnas("PurchaseRequestLine"),
    GoodsReceipt: await columnas("GoodsReceipt"),
  };
  const intacta = (Object.keys(antes) as Array<keyof typeof antes>).every(
    (t) => antes[t].length === despues[t].length && antes[t].every((c) => despues[t].includes(c)),
  );

  if (JSON_SALIDA) {
    console.log(JSON.stringify({ ...reporte, baseIntacta: intacta }, null, 1));
  } else {
    for (const m of reporte.migracion) console.log(`  ✓ ${m.migracion}: ${m.sentencias} sentencias en ${m.ms} ms`);
    for (const [t, cols] of Object.entries(reporte.columnasNuevas)) if (cols.length) console.log(`  Columnas nuevas en ${t}: ${cols.join(", ")}`);
    console.log(`  Transacción abierta: ${reporte.duracionTransaccionMs} ms`);
    console.log(`  Base intacta tras revertir: ${intacta ? "SÍ" : "NO — REVISAR"}`);

    const fmt = (v: number | null, d = 1) => (v === null ? "—" : new Intl.NumberFormat("es-MX", { maximumFractionDigits: d }).format(v));
    const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
    const c = (a: string, b: string) => (a === b ? a : `${a} → ${b}`);
    let registros = 0, sospechosas = 0, avisos = 0;
    let empresa = "";
    for (const p of reporte.medidores) {
      if (p.empresa !== empresa) { empresa = p.empresa; console.log(`\n══ ${empresa}`); }
      registros += p.registrosAModificar;
      sospechosas += p.lecturasSospechosas.length;
      console.log(`  ${p.activo} · ${p.medidor}: ${p.registrosAModificar} registro(s)`);
      console.log(`    valor ${c(fmt(p.antes.currentValue), fmt(p.despues.currentValue))} · promedio ${c(fmt(p.antes.dailyAverage, 2), fmt(p.despues.dailyAverage, 2))} · incrementos a rehacer ${p.incrementos.length}`);
      for (const pl of p.planes) {
        if (pl.estadoAntes !== pl.estadoDespues) avisos += 1;
        console.log(`    plan «${pl.plan}»: meta ${c(fmt(pl.metaAntes), fmt(pl.metaDespues))} · fecha ${c(dia(pl.fechaAntes), dia(pl.fechaDespues))} · estado ${c(pl.estadoAntes, pl.estadoDespues)}`);
      }
      for (const s of p.lecturasSospechosas) console.log(`    ⚠ ${dia(s.readingAt)} ${fmt(s.value)}: ${s.motivo} (no se corrige)`);
    }
    console.log(`\nTotal: ${reporte.medidores.length} medidores · ${registros} registros se modificarían · ${avisos} avisos de plan cambian · ${sospechosas} lecturas sospechosas`);
  }
  await prisma.$disconnect();
  process.exit(intacta ? 0 : 2);
}

main().catch(async (e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
