/**
 * Liga los movimientos de almacen anteriores con la recepcion que los origino.
 *
 * La columna `goodsReceiptId` nacio vacia: los movimientos de antes solo traen
 * el texto «Recepcion RE-000001 · remision X». Ese folio es un dato duro, no una
 * suposicion, asi que se puede volver a ligar sin adivinar nada. Lo que no trae
 * folio reconocible se deja como esta y se reporta.
 *
 *   npx tsx scripts/ligar-movimientos-a-recepcion.ts             (ensayo)
 *   npx tsx scripts/ligar-movimientos-a-recepcion.ts --aplicar   (escribe)
 *
 * Contra produccion: ./scripts/con-produccion.sh scripts/ligar-movimientos-a-recepcion.ts
 */
import { prisma } from "../lib/db";

const aplicar = process.argv.includes("--aplicar");

async function main() {
  const movimientos = await prisma.stockMovement.findMany({
    where: { goodsReceiptId: null, movementType: "IN", reference: { contains: "Recepcion" } },
    select: { id: true, organizationId: true, partId: true, reference: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  let ligados = 0;
  const sinPareja: string[] = [];

  for (const m of movimientos) {
    const folio = /Recepcion\s+(\S+)/.exec(m.reference ?? "")?.[1];
    if (!folio) { sinPareja.push(`${m.id}: sin folio en «${m.reference}»`); continue; }

    // Acotado por organizacion: los folios son unicos por empresa, no globales.
    const recepcion = await prisma.goodsReceipt.findFirst({
      where: {
        organizationId: m.organizationId,
        folio,
        renglones: { some: { partId: m.partId } },
      },
      select: { id: true, folio: true },
    });
    if (!recepcion) { sinPareja.push(`${m.id}: no existe ${folio} con esa refacción`); continue; }

    console.log(`  ${aplicar ? "ligando" : "ligaría"}  movimiento ${m.id} → recepción ${recepcion.folio}`);
    if (aplicar) {
      await prisma.stockMovement.update({ where: { id: m.id }, data: { goodsReceiptId: recepcion.id } });
    }
    ligados++;
  }

  console.log(`\n${movimientos.length} movimiento(s) de recepción sin ligar.`);
  console.log(`${ligados} se ${aplicar ? "ligaron" : "ligarían"}.`);
  if (sinPareja.length) {
    console.log(`\n${sinPareja.length} no se pueden ligar sin adivinar, y se quedan como están:`);
    for (const s of sinPareja) console.log(`  · ${s}`);
  }
  if (!aplicar && ligados) console.log("\nEnsayo. Para escribir: agregue --aplicar");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
