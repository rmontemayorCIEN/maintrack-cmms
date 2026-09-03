/** Como quedaron los planes que ya sirven a mas de un equipo. */
import { prisma } from "../lib/db";
async function main() {
  const planes = await prisma.maintenancePlan.findMany({
    where: { asignaciones: { some: {} } },
    select: {
      name: true, intervalDays: true, triggerType: true,
      organization: { select: { name: true } },
      asignaciones: {
        orderBy: { nextDueDate: "asc" },
        select: {
          nextDueDate: true, lastGeneratedAt: true, createdAt: true,
          asset: { select: { code: true, name: true, criticality: true } },
        },
      },
    },
  });

  const varios = planes.filter((p) => p.asignaciones.length > 1);
  console.log(`\n${planes.length} planes con asignacion · ${varios.length} aplicado(s) a mas de un equipo\n`);

  const iso = (d: Date | null) => d ? d.toISOString().slice(0, 10) : "sin fecha";
  for (const p of varios) {
    console.log(`${p.organization.name} — «${p.name}»  cada ${p.intervalDays ?? "?"} dias`);
    let previa: Date | null = null;
    for (const a of p.asignaciones) {
      const dias = previa && a.nextDueDate
        ? Math.round((a.nextDueDate.getTime() - previa.getTime()) / 86_400_000) : null;
      const dia = a.nextDueDate
        ? ["dom","lun","mar","mie","jue","vie","sab"][a.nextDueDate.getDay()] : "";
      console.log(
        `   ${a.asset.code.padEnd(10)} ${a.asset.criticality}  ${iso(a.nextDueDate)} ${dia}` +
        `${dias !== null ? `  (+${dias} dias)` : ""}` +
        `${a.lastGeneratedAt ? "  ya genero OT" : ""}`,
      );
      previa = a.nextDueDate;
    }
    const fechas = p.asignaciones.map((a) => iso(a.nextDueDate));
    const enFinde = p.asignaciones.filter((a) => a.nextDueDate && [0,6].includes(a.nextDueDate.getDay())).length;
    console.log(`   ${new Set(fechas).size === fechas.length ? "ok  " : "OJO "} fechas distintas entre si`);
    console.log(`   ${enFinde === 0 ? "ok  " : "OJO "} ninguna en fin de semana\n`);
  }
  if (!varios.length) console.log("  (todavia ninguno aplica a varios equipos)\n");
}
main().finally(() => prisma.$disconnect());
