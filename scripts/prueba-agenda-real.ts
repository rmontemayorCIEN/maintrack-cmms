/**
 * Ciclo completo de «Revisar la semana» contra datos reales.
 *
 * La aritmetica se prueba en seco en prueba-agenda.ts. Esto es lo otro: llamar
 * al modelo de verdad y verificar que respeta las anclas —que no invente
 * fechas fuera de los dias laborables ni ordenes que no existen.
 */
import { prisma } from "../lib/db";
import { revisarSemana } from "../lib/ia/agenda";
import { esHabil, jornada } from "../lib/agenda";

let fallas = 0;
const revisar = (e: string, ok: boolean, nota = "") => {
  if (!ok) fallas++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${e.padEnd(48)} ${nota}`);
};

async function main() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, plan: true, iaComplemento: true, iaExtra: true },
  });

  for (const org of orgs) {
    // La semana donde de verdad haya trabajo abierto en esta cuenta.
    const proxima = await prisma.workOrder.findFirst({
      where: { organizationId: org.id, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] }, dueDate: { not: null } },
      orderBy: { dueDate: "asc" },
      select: { dueDate: true },
    });
    if (!proxima?.dueDate) { console.log(`\n${org.name}: sin ordenes abiertas con fecha, se salta\n`); continue; }

    console.log(`\n${org.name} — semana de ${proxima.dueDate.toISOString().slice(0, 10)}`);
    const r = await revisarSemana(org, { desde: proxima.dueDate });

    if (!r.ok) {
      const valida = /no hay|permiso|limite|cuota/i.test(r.motivo);
      revisar(valida ? "se niega con motivo claro" : "revisa", valida, r.motivo);
      continue;
    }
    revisar("revisa", true, `$${r.costoUsd.toFixed(4)}`);

    const v = r.revision;
    console.log(`     «${v.resumen.slice(0, 100)}${v.resumen.length > 100 ? "…" : ""}»`);
    revisar("trae resumen con contenido", v.resumen.trim().length > 20);

    // Las anclas: nada inventado.
    const lunes = new Date(proxima.dueDate);
    lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7));
    lunes.setHours(0, 0, 0, 0);
    const fin = new Date(lunes); fin.setDate(lunes.getDate() + 13);
    const j = await jornada(org.id, lunes, fin);

    const todasHabiles = v.movimientos.every((m) => {
      const [a, mes, d] = m.aFecha.split("-").map(Number);
      return esHabil(new Date(a, mes - 1, d), j);
    });
    revisar("ninguna fecha propuesta cae en dia muerto", todasHabiles,
      `${v.movimientos.length} movimiento(s)`);

    const numeros = new Set(
      (await prisma.workOrder.findMany({
        where: { organizationId: org.id },
        select: { number: true },
      })).map((o) => o.number),
    );
    revisar("todas las ordenes citadas existen",
      v.movimientos.every((m) => numeros.has(m.orden)) &&
      v.noMover.every((n) => numeros.has(n.orden)) &&
      v.agrupaciones.every((a) => a.ordenes.every((n) => numeros.has(n))), "");

    if (v.agrupaciones.length) console.log(`     junta: ${v.agrupaciones.map((a) => a.activo).join(", ")}`);
    if (v.advertencia) console.log(`     aviso: ${v.advertencia.slice(0, 90)}…`);
  }

  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nEl ciclo completo cuadra\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
