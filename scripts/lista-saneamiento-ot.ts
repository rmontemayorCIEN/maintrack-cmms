/**
 * Lista de saneamiento del proceso de ordenes. SOLO LECTURA: no modifica nada.
 *
 * Enumera, por empresa, los registros historicos que requieren revision
 * humana. No propone horas, causas, responsables ni paros: esos datos solo los
 * sabe quien hizo el trabajo. Los filtros son los mismos de la calidad de
 * captura (`lib/saneamiento-ot.ts`).
 *
 *   npx tsx scripts/lista-saneamiento-ot.ts [nombre de empresa]
 *   ./scripts/con-produccion.sh scripts/lista-saneamiento-ot.ts
 */
import { prisma } from "../lib/db";
import { listaDeSaneamientoOt, TITULOS_SANEAMIENTO, type ListaSaneamiento } from "../lib/saneamiento-ot";
import { saludDeDatos } from "../lib/salud-datos";

async function main() {
  const filtro = process.argv[2];
  const empresas = await prisma.organization.findMany({
    where: { workOrders: { some: {} }, ...(filtro ? { name: { contains: filtro } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  for (const org of empresas) {
    const [lista, salud] = await Promise.all([listaDeSaneamientoOt(org.id), saludDeDatos(org.id)]);
    const total = Object.values(lista).reduce((a, xs) => a + xs.length, 0);
    console.log(`\n══ ${org.name} — ${total} registro(s) por revisar · calidad de captura ${salud.indice}/100`);
    for (const clave of Object.keys(TITULOS_SANEAMIENTO) as (keyof ListaSaneamiento)[]) {
      const xs = lista[clave];
      console.log(`  ${TITULOS_SANEAMIENTO[clave]}: ${xs.length}`);
      for (const r of xs) console.log(`    · ${r.folio} ${r.titulo} — ${r.detalle}`);
    }
    const criticas = salud.revisiones.filter((r) => r.critica && r.total > 0);
    if (criticas.length) {
      console.log("  Reglas críticas del proceso (cumplimiento → calificación):");
      for (const r of criticas) console.log(`    · ${r.titulo}: ${r.total - r.cumplidos} de ${r.total} → ${r.porcentaje}% → ${Math.round(r.calificacion)}`);
    }
  }
  console.log("\nSolo lectura: no se modificó ningún registro.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
