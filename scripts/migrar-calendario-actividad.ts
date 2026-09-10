/**
 * Lleva los planes existentes al calendario por actividad.
 *
 * Dos cosas, en este orden:
 *
 *  1. **La frecuencia.** Cada actividad guardaba un MULTIPLO de la cadencia
 *     base del plan (`cadaCuantas`). Se traduce a numero + unidad: un multiplo
 *     de 3 en un plan de 30 dias son 90 dias, y 90 dias se guardan como
 *     "cada 3 meses", que es como lo diria una persona.
 *
 *  2. **El reloj de cada actividad en cada equipo.** Arranca en la fecha que la
 *     asignacion ya tenia, tomada como "arranca ese dia". Asi el calendario que
 *     el cliente ya conocia NO se mueve el dia de la migracion: todas las
 *     actividades vencen cuando vencia el plan, y de ahi cada una sigue su
 *     ritmo.
 *
 * Sin `--aplicar` solo reporta. Con `--aplicar` escribe y vuelve a consultar
 * para comprobar lo que quedo.
 *
 *   ./scripts/con-produccion.sh scripts/migrar-calendario-actividad.ts
 *   ./scripts/con-produccion.sh scripts/migrar-calendario-actividad.ts --aplicar
 */
import { prisma } from "../lib/db";
import { desdeDias, describirIntervalo, type Unidad } from "../lib/calendario";
import { sembrarLoQueFalte } from "../lib/calendario-actividad";

const APLICAR = process.argv.includes("--aplicar");

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");

async function main() {
  console.log(APLICAR ? "\n=== APLICANDO ===\n" : "\n=== ENSAYO (sin --aplicar no se escribe nada) ===\n");

  // ── 1 · La frecuencia de cada actividad ─────────────────────────────────
  const sinFrecuencia = await prisma.planTask.findMany({
    where: { cadaCuanto: null },
    select: {
      id: true, title: true, cadaCuantas: true,
      plan: {
        select: {
          id: true, name: true, intervalDays: true, triggerType: true,
          organization: { select: { name: true } },
        },
      },
    },
  });

  console.log(`Actividades sin frecuencia propia: ${sinFrecuencia.length}\n`);

  const traducciones: Array<{ id: string; cadaCuanto: number; unidad: Unidad; linea: string }> = [];
  const sinBase: string[] = [];

  for (const t of sinFrecuencia) {
    // Un plan por medidor no lleva calendario: su fecha sale de la lectura.
    if (t.plan.triggerType !== "CALENDAR") continue;

    const base = t.plan.intervalDays;
    if (!base || base < 1) {
      sinBase.push(`${t.plan.organization.name} · ${t.plan.name} · ${t.title}`);
      continue;
    }
    const dias = Math.max(t.cadaCuantas, 1) * base;
    const { cadaCuanto, unidad } = desdeDias(dias);
    traducciones.push({
      id: t.id,
      cadaCuanto,
      unidad,
      linea: `${t.plan.organization.name.slice(0, 18).padEnd(18)} ${t.plan.name.slice(0, 26).padEnd(26)} ${t.title.slice(0, 30).padEnd(30)} ${String(t.cadaCuantas).padStart(2)}×${String(base).padStart(3)}d = ${String(dias).padStart(4)}d → ${describirIntervalo(cadaCuanto, unidad)}`,
    });
  }

  for (const t of traducciones.slice(0, 40)) console.log(`   ${t.linea}`);
  if (traducciones.length > 40) console.log(`   … y ${traducciones.length - 40} más`);

  if (sinBase.length) {
    console.log(`\n   ATENCIÓN — ${sinBase.length} actividad(es) sin intervalo del plan del cual derivar.`);
    console.log("   Quedan sin frecuencia y NO se van a programar. Hay que capturarlas a mano:");
    for (const l of sinBase.slice(0, 10)) console.log(`     · ${l}`);
  }

  if (APLICAR) {
    for (const t of traducciones) {
      await prisma.planTask.update({
        where: { id: t.id },
        data: { cadaCuanto: t.cadaCuanto, unidadFrecuencia: t.unidad },
      });
    }
    console.log(`\n   ${traducciones.length} actividades traducidas.`);
  }

  // ── 2 · Los relojes ─────────────────────────────────────────────────────
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });

  console.log("\nRelojes por actividad y equipo\n");
  let totalFaltantes = 0;
  for (const org of orgs) {
    const asignaciones = await prisma.planAsset.findMany({
      where: {
        organizationId: org.id, active: true,
        plan: { active: true, triggerType: "CALENDAR", tasks: { some: {} } },
        asset: { active: true, status: { not: "RETIRED" } },
      },
      select: {
        assetId: true, nextDueDate: true,
        asset: { select: { code: true } },
        plan: { select: { name: true, tasks: { select: { id: true } } } },
      },
    });
    if (!asignaciones.length) continue;

    const yaHay = await prisma.planTaskAsset.findMany({
      where: { organizationId: org.id },
      select: { planTaskId: true, assetId: true },
    });
    const conReloj = new Set(yaHay.map((r) => `${r.planTaskId}:${r.assetId}`));

    const faltan = asignaciones.filter((a) =>
      a.plan.tasks.some((t) => !conReloj.has(`${t.id}:${a.assetId}`)),
    );
    if (!faltan.length) continue;

    totalFaltantes += faltan.length;
    console.log(`   ${org.name}`);
    for (const a of faltan) {
      console.log(
        `     ${a.asset.code.padEnd(10)} ${a.plan.name.slice(0, 30).padEnd(30)} ` +
        `${String(a.plan.tasks.length).padStart(2)} actividad(es) arrancan el ${iso(a.nextDueDate)}`,
      );
    }

    if (APLICAR) {
      const n = await sembrarLoQueFalte(org.id);
      console.log(`     → ${n} asignación(es) sembradas`);
    }
  }
  if (!totalFaltantes) console.log("   (ninguna: todas ya tienen sus relojes)");

  // ── 3 · Comprobacion ────────────────────────────────────────────────────
  if (APLICAR) {
    console.log("\n=== COMPROBACIÓN ===\n");
    const quedanSinFrecuencia = await prisma.planTask.count({
      where: { cadaCuanto: null, plan: { triggerType: "CALENDAR", intervalDays: { gt: 0 } } },
    });
    const relojes = await prisma.planTaskAsset.count();
    const mudos = await prisma.planTaskAsset.count({
      where: {
        proximaEl: null, active: true,
        asset: { active: true, status: { not: "RETIRED" } },
        planTask: { plan: { active: true } },
      },
    });
    console.log(`   Actividades de calendario sin frecuencia: ${quedanSinFrecuencia} (debe ser 0)`);
    console.log(`   Relojes en total: ${relojes}`);
    console.log(`   Relojes SIN fecha —no se programan y no avisan—: ${mudos} (debe ser 0)`);
    if (quedanSinFrecuencia > 0 || mudos > 0) {
      console.log("\n   NO QUEDÓ LIMPIO. Revise antes de dar por buena la migración.");
      process.exit(1);
    }
    console.log("\n   Todo cuadra.\n");
  } else {
    console.log("\nNada se escribió. Para aplicar:  --aplicar\n");
  }
}

main().finally(() => prisma.$disconnect());
