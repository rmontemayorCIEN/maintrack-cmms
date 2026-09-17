/**
 * Saneamiento controlado de fechas predictivas anteriores a su deteccion.
 * La logica vive en `lib/saneamiento-predictivo.ts`.
 *
 *   npx tsx scripts/sanear-fechas-predictivas.ts            # ENSAYO: no escribe
 *   npx tsx scripts/sanear-fechas-predictivas.ts --aplicar  # aplica con bitacora
 *
 * Contra produccion: ./scripts/con-produccion.sh scripts/sanear-fechas-predictivas.ts
 */
import { prisma } from "../lib/db";
import { aplicarSaneamiento, planearSaneamiento } from "../lib/saneamiento-predictivo";

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const ahora = new Date();
  const empresas = await prisma.organization.findMany({
    where: { alerts: { some: {} } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  let total = 0;
  let aplicados = 0;
  for (const org of empresas) {
    const cambios = await planearSaneamiento(org.id, ahora);
    if (!cambios.length) continue;
    console.log(`\n══ ${org.name}`);
    for (const c of cambios) {
      console.log(`  ${c.titulo} [${c.estado}] detectada ${c.detectadaEl.toISOString()}`);
      console.log(`    ${c.campo}: ${c.antes.toISOString()} → ${c.despues ? c.despues.toISOString() : "vacía"}`);
      console.log(`    ${c.motivo}`);
    }
    total += cambios.length;
    if (aplicar) aplicados += await aplicarSaneamiento(org.id, cambios, ahora);
  }
  console.log(`\nModo: ${aplicar ? "APLICAR" : "ENSAYO (no se escribió nada)"}`);
  console.log(`Campos con fecha anterior a la detección: ${total}`);
  if (aplicar) console.log(`Campos saneados: ${aplicados}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
