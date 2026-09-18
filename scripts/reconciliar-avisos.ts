/**
 * Reconcilia los avisos abiertos con el estado real de sus registros.
 *
 * Sin `--aplicar` solo reporta, sin escribir nada: cuántos avisos abiertos
 * hay, cuáles se atenderían y con qué motivo, cuáles siguen, y cómo quedaría
 * el resumen diario de cada persona (con los repetidos que tendría el de
 * antes). Con `--aplicar` hace lo mismo que el proceso programado cada cinco
 * minutos, de una vez.
 *
 *   npx tsx scripts/reconciliar-avisos.ts [--aplicar] [--folio OT-000001,OT-000004]
 *   ./scripts/con-produccion.sh scripts/reconciliar-avisos.ts --folio OT-000001,OT-000004
 */
import { prisma } from "../lib/db";
import { reconciliar } from "../lib/avisos/condiciones";
import { configDe } from "../lib/avisos/config";
import { resumenDiario } from "../lib/avisos/resumenes";

const aplicar = process.argv.includes("--aplicar");
const iFolio = process.argv.indexOf("--folio");
const folios = iFolio > 0 ? (process.argv[iFolio + 1] ?? "").split(",").filter(Boolean) : [];

async function main() {
  console.log(aplicar ? "MODO APLICAR: se escriben los cambios." : "Ensayo: no se escribe nada.");
  const ahora = new Date();
  const orgs = await prisma.organization.findMany({ where: { status: { in: ["ACTIVE", "TRIAL"] } }, select: { id: true, name: true } });
  for (const org of orgs) {
    const cfg = await configDe(org.id, ahora);
    const r = await reconciliar({ organizationId: org.id, ahora, cfg, ensayo: !aplicar });
    if (!r.revisados) continue;
    console.log(`\n== ${org.name}: ${r.revisados} abiertos · ${r.atendidos} se atienden · ${r.unificados} se unifican`);
    const porMotivo = new Map<string, number>();
    for (const d of r.decisiones ?? []) if (!d.sigue) porMotivo.set(`${d.condicion}: ${d.motivo}`, (porMotivo.get(`${d.condicion}: ${d.motivo}`) ?? 0) + 1);
    for (const [m, n] of porMotivo) console.log(`   ${n} × ${m}`);

    if (folios.length) {
      const ots = await prisma.workOrder.findMany({ where: { organizationId: org.id, number: { in: folios } }, select: { id: true, number: true, status: true, dueDate: true } });
      for (const o of ots) {
        console.log(`   ${o.number} (${o.status}, vence ${o.dueDate?.toISOString().slice(0, 10) ?? "—"}):`);
        for (const d of (r.decisiones ?? []).filter((x) => x.entidadId === o.id)) {
          console.log(`     ${d.condicion} · ${d.userId.slice(-5)} → ${d.sigue ? `SIGUE (${d.estado})` : `ATENDIDA: ${d.motivo}`}`);
        }
      }
    }

    // El resumen de cada persona: que ningún registro se repita.
    const personas = await prisma.user.findMany({ where: { organizationId: org.id, active: true, role: { not: "VIEWER" } }, select: { id: true, role: true, name: true } });
    for (const p of personas) {
      const res = await resumenDiario(org.id, p, cfg, ahora);
      const claves = res.secciones.flatMap((s) => s.items.map((i) => i.clave).filter(Boolean));
      const repetidos = claves.length - new Set(claves).size;
      if (!res.secciones.length) continue;
      console.log(`   resumen de ${p.name} (${p.role}): ${res.secciones.map((s) => `${s.titulo} ${s.total}`).join(" · ")}${repetidos ? ` — ${repetidos} REPETIDOS` : ""}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
