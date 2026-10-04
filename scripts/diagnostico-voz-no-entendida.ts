/**
 * Lo que la gente dijo y el sistema no supo atender.
 *
 * La navegacion por voz se resuelve con reglas, no con el modelo. Eso la hace
 * instantanea y casi gratis, pero deja fuera las formas de hablar que nadie
 * previo. Esto es lo que dice CUALES son —sin esto, «no encontre eso» seria un
 * callejon sin salida y nadie sabria nunca que falto—.
 *
 *   ./scripts/con-produccion.sh scripts/diagnostico-voz-no-entendida.ts
 */
import { prisma } from "../lib/db";

async function main() {
  const fallidos = await prisma.aiUsage.findMany({
    where: { funcion: { in: ["NAVEGAR", "DICTADO"] }, ok: false, error: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { createdAt: true, funcion: true, error: true, organization: { select: { name: true } } },
  });

  if (!fallidos.length) {
    console.log("\n  No hay nada registrado como no entendido.\n");
    return;
  }

  console.log(`\nLo que no se pudo atender (${fallidos.length})\n`);
  for (const f of fallidos) {
    const cuando = f.createdAt.toLocaleString("es-MX", { timeZone: "America/Monterrey" });
    console.log(`  ${f.funcion.padEnd(8)} ${cuando} · ${f.organization.name}`);
    console.log(`           «${f.error}»`);
  }
  console.log("");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
