/**
 * Siembra los festivos de ley de Mexico en cada organizacion.
 *
 * Se guardan por organizacion aunque sean los mismos para todos: cada empresa
 * despues agrega los suyos —el aniversario de la planta, la semana de
 * vacaciones— y quita los que si trabaja. Marcados como deLey para poder
 * distinguirlos de los propios.
 *
 * Ensayo por omision. Para aplicar:  --aplicar
 */
import { prisma } from "../lib/db";
import { festivosDeLey } from "../lib/agenda";

const aplicar = process.argv.includes("--aplicar");
const ANIOS = [2026, 2027];

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`\n${orgs.length} organizaciones · anios ${ANIOS.join(", ")}\n`);

  let nuevos = 0, existentes = 0;
  for (const org of orgs) {
    for (const anio of ANIOS) {
      for (const f of festivosDeLey(anio)) {
        const ya = await prisma.diaFestivo.findUnique({
          where: { organizationId_fecha: { organizationId: org.id, fecha: f.fecha } },
          select: { id: true },
        });
        if (ya) { existentes++; continue; }
        nuevos++;
        if (aplicar) {
          await prisma.diaFestivo.create({
            data: { organizationId: org.id, fecha: f.fecha, nombre: f.nombre, deLey: true },
          });
        }
      }
    }
    console.log(`  ${org.name}`);
  }

  console.log(`\n  ${nuevos} por crear · ${existentes} ya estaban`);
  console.log(aplicar ? "\nAplicado\n" : "\nEnsayo. Nada se escribio. Para aplicar: --aplicar\n");
}
main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
