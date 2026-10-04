/**
 * Borra de la base LOCAL las empresas que dejaron las pruebas.
 *
 *   npx tsx scripts/limpiar-residuos-de-prueba.ts            (solo reporta)
 *   npx tsx scripts/limpiar-residuos-de-prueba.ts --aplicar
 *
 * Cada prueba crea su empresa y la borra al terminar, pero una que aborta a
 * medias —porque falló, porque se interrumpió, porque el esquema apuntaba a
 * otra base— deja la suya. Se acumulan por miles sin que nadie lo note, y el
 * día que una de esas quedó con un traspaso a medias, el borrado en cascada de
 * OTRA prueba empieza a fallar por una llave foránea. Se diagnostica como un
 * defecto del cambio del día y no lo es.
 *
 * SE NIEGA A CORRER CONTRA CUALQUIER COSA QUE NO SEA EL ARCHIVO LOCAL, con la
 * misma comprobación que `scripts/clave-de-desarrollo.ts`: sin ella, bastaría
 * tener exportada la cadena de producción para borrarle las empresas a los
 * clientes.
 */
import { prisma } from "../lib/db";

/** Lo que crean las pruebas: prefijos conocidos, o un sello de tiempo en el slug. */
const ES_DE_PRUEBA = (slug: string) =>
  /^(prueba-|pb-|aj-|rs-|diag-|demo-|rreal-|nor-|her-|reg-|fav-)/.test(slug) || /\d{10,}/.test(slug);

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:") || /postgres|@|:\/\//.test(url.replace(/^file:/, ""))) {
    console.error("Esto solo corre contra la base SQLite local. DATABASE_URL apunta a otra cosa.");
    process.exit(1);
  }

  const aplicar = process.argv.includes("--aplicar");
  const todas = await prisma.organization.findMany({ select: { id: true, name: true, slug: true } });
  const basura = todas.filter((o) => ES_DE_PRUEBA(o.slug));
  const seQuedan = todas.filter((o) => !ES_DE_PRUEBA(o.slug));

  console.log(`\nEn la base local hay ${todas.length} empresas.`);
  console.log(`  Residuos de prueba: ${basura.length}`);
  console.log(`  Se conservan:       ${seQuedan.length} (${seQuedan.map((o) => o.slug).join(", ")})`);

  if (!aplicar) {
    console.log("\nEnsayo. Para borrarlos:  npx tsx scripts/limpiar-residuos-de-prueba.ts --aplicar\n");
    return;
  }

  let borradas = 0;
  let atoradas = 0;
  for (const o of basura) {
    try {
      await prisma.organization.delete({ where: { id: o.id } });
      borradas++;
    } catch {
      /*
       * Una empresa que no se deja borrar es justamente la que causa el
       * problema: quedó con un documento que RESTRINGE el borrado de su
       * almacén o de una persona —un traspaso, una requisición, un resguardo—.
       * El borrado en cascada de la empresa no los alcanza a tiempo.
       *
       * Se quitan esos documentos primero y se reintenta. El orden importa:
       * los renglones antes que sus encabezados.
       */
      try {
        const w = { organizationId: o.id };
        await prisma.stockTransferLine.deleteMany({ where: { transfer: w } });
        await prisma.stockTransfer.deleteMany({ where: w });
        await prisma.goodsReceiptLine.deleteMany({ where: { receipt: w } });
        await prisma.goodsReceipt.deleteMany({ where: w });
        await prisma.purchaseOrder.deleteMany({ where: w });
        await prisma.quoteLine.deleteMany({ where: { quote: w } });
        await prisma.quote.deleteMany({ where: w });
        await prisma.purchaseRequestLine.deleteMany({ where: { request: w } });
        await prisma.purchaseRequest.deleteMany({ where: w });
        await prisma.inventoryCountLine.deleteMany({ where: { count: w } });
        await prisma.inventoryCount.deleteMany({ where: w });
        await prisma.materialRequestLine.deleteMany({ where: { request: w } });
        await prisma.materialRequest.deleteMany({ where: w });
        await prisma.resguardo.deleteMany({ where: w });
        await prisma.workOrderComment.deleteMany({ where: { workOrder: w } });
        await prisma.workOrderLabor.deleteMany({ where: { workOrder: w } });
        await prisma.workOrderPart.deleteMany({ where: { workOrder: w } });
        await prisma.organization.delete({ where: { id: o.id } });
        borradas++;
      } catch {
        atoradas++;
      }
    }
    if (borradas % 500 === 0 && borradas) console.log(`  … ${borradas}`);
  }

  console.log(`\n✓ Borradas ${borradas}${atoradas ? `, ${atoradas} no se dejaron (quedaron con documentos que restringen el borrado)` : ""}.\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
