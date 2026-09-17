/**
 * Recalculo de medidores desde su historial de lecturas.
 *
 * Usa `planearRecalculo` / `aplicarRecalculo` de `lib/medidores.ts`: exactamente
 * lo mismo que corre el sistema al registrar, corregir o anular una lectura.
 *
 *   npx tsx scripts/recalcular-medidores.ts                 # ENSAYO: no escribe nada
 *   npx tsx scripts/recalcular-medidores.ts --json          # ensayo, salida JSON
 *   npx tsx scripts/recalcular-medidores.ts --aplicar       # escribe, tras aprobar el ensayo
 *   npx tsx scripts/recalcular-medidores.ts --empresa <slug>  # solo una empresa
 *
 * Contra produccion: ./scripts/con-produccion.sh scripts/recalcular-medidores.ts
 *
 * Garantias:
 *  - Sin `--aplicar` no se escribe un solo registro.
 *  - Cada medidor se recalcula en su propia transaccion: o queda completo o no
 *    queda nada.
 *  - Cada consulta va acotada por empresa.
 *  - Idempotente: solo escribe lo que difiere; una segunda corrida el mismo dia
 *    reporta cero cambios.
 *  - NO corrige lecturas. Las invalidas o sospechosas (como la de 20,500 h de
 *    CMP-301) se reportan y siguen contando tal cual hasta que una persona las
 *    corrija o anule desde Medidores.
 */
import { prisma } from "../lib/db";
import { aplicarRecalculo, planearRecalculo, type PlanDeRecalculo } from "../lib/medidores";

const args = process.argv.slice(2);
const APLICAR = args.includes("--aplicar");
const JSON_SALIDA = args.includes("--json");
const empresaArg = args.includes("--empresa") ? args[args.indexOf("--empresa") + 1] : null;

const n = (v: number | null, d = 1) => (v === null ? "—" : new Intl.NumberFormat("es-MX", { maximumFractionDigits: d }).format(v));
const f = (d: Date | null, zona: string) =>
  d ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: zona }).format(d) : "—";
const cambio = (a: string, b: string) => (a === b ? a : `${a} → ${b}`);

async function main() {
  const ahora = new Date();
  const empresas = await prisma.organization.findMany({
    where: empresaArg ? { slug: empresaArg } : { meters: { some: {} } },
    select: { id: true, name: true, slug: true, timezone: true },
    orderBy: { name: "asc" },
  });

  const salida: Array<{ empresa: string; slug: string; medidores: PlanDeRecalculo[] }> = [];
  let totalRegistros = 0;
  let totalSospechosas = 0;
  let totalAlertas = 0;
  let aplicados = 0;

  for (const org of empresas) {
    const zona = org.timezone || "America/Mexico_City";
    const medidores = await prisma.meter.findMany({
      where: { organizationId: org.id },
      select: { id: true },
      orderBy: { name: "asc" },
    });
    const planes: PlanDeRecalculo[] = [];
    for (const m of medidores) {
      const plan = await planearRecalculo(prisma, org.id, m.id, ahora, zona);
      planes.push(plan);
      totalRegistros += plan.registrosAModificar;
      totalSospechosas += plan.lecturasSospechosas.length;
      totalAlertas += plan.planes.filter((p) => p.estadoAntes !== p.estadoDespues).length;

      if (APLICAR && plan.registrosAModificar > 0) {
        await prisma.$transaction(async (tx) => {
          // Se vuelve a planear DENTRO de la transaccion: si algo cambio entre
          // el ensayo y la escritura, se aplica lo vigente, no lo leido antes.
          const vigente = await planearRecalculo(tx, org.id, m.id, ahora, zona);
          await aplicarRecalculo(tx, vigente);
        });
        aplicados += 1;
      }
    }
    salida.push({ empresa: org.name, slug: org.slug, medidores: planes });

    if (!JSON_SALIDA) {
      console.log(`\n══ ${org.name} (${org.slug}) · zona ${zona} · ${planes.length} medidor(es)`);
      for (const p of planes) {
        console.log(`\n  ${p.activo} · ${p.medidor} (${p.unidad}) — ${p.registrosAModificar} registro(s) a modificar`);
        console.log(`    Valor actual:   ${cambio(p.antes.lecturaVigente ? n(p.antes.currentValue) : "sin lectura vigente", p.despues.lecturaVigente ? n(p.despues.currentValue) : "sin lectura vigente")}`);
        console.log(`    Promedio/día:   ${cambio(n(p.antes.dailyAverage, 2), n(p.despues.dailyAverage, 2))}`);
        console.log(`    Última lectura: ${cambio(f(p.antes.lastReadingAt, zona), f(p.despues.lastReadingAt, zona))}`);
        if (p.incrementos.length) console.log(`    Incrementos a rehacer: ${p.incrementos.length}`);
        for (const pl of p.planes) {
          console.log(`    Plan «${pl.plan}»`);
          console.log(`      Meta:            ${cambio(n(pl.metaAntes), n(pl.metaDespues))}`);
          console.log(`      Fecha estimada:  ${cambio(f(pl.fechaAntes, zona), f(pl.fechaDespues, zona))}`);
          console.log(`      Estado:          ${cambio(pl.estadoAntes, pl.estadoDespues)}${pl.estadoAntes !== pl.estadoDespues ? "   ← cambia su aviso" : ""}`);
        }
        for (const s of p.lecturasSospechosas) {
          console.log(`    ⚠ Lectura sospechosa ${f(s.readingAt, zona)} · ${n(s.value)} ${p.unidad}: ${s.motivo}  (NO se corrige)`);
        }
      }
    }
  }

  if (JSON_SALIDA) {
    console.log(JSON.stringify({ modo: APLICAR ? "APLICAR" : "ENSAYO", ahora, totalRegistros, totalSospechosas, totalAlertas, salida }, null, 1));
  } else {
    console.log("\n──────────────────────────────────────────");
    console.log(`Modo: ${APLICAR ? "APLICAR" : "ENSAYO (no se escribió nada)"}`);
    console.log(`Empresas: ${empresas.length} · Medidores: ${salida.reduce((s, e) => s + e.medidores.length, 0)}`);
    console.log(`Registros que ${APLICAR ? "se modificaron" : "se modificarían"}: ${totalRegistros}`);
    console.log(`Planes por uso cuyo aviso cambia (vencido / por vencer): ${totalAlertas}`);
    console.log(`Lecturas inválidas o sospechosas (sin corregir): ${totalSospechosas}`);
    console.log("Alertas predictivas: no dependen de medidores; el recálculo no las toca.");
    if (APLICAR) console.log(`Medidores escritos: ${aplicados}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
