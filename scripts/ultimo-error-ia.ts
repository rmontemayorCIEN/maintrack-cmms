/** El detalle de los ultimos fallos de IA, que la pantalla no muestra. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const fallos = await prisma.aiUsage.findMany({
    where: { ok: false },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { funcion: true, modelo: true, error: true, createdAt: true },
  });
  console.log(`\n${fallos.length} fallos recientes\n`);
  for (const f of fallos) {
    console.log(`  ${f.createdAt.toISOString().slice(0, 16)}  ${f.funcion}`);
    console.log(`     ${f.error ?? "(sin detalle)"}\n`);
  }
}
main().catch((e) => console.error("ERROR:", e.message)).finally(() => prisma.$disconnect());
