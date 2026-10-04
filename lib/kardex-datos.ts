/**
 * De donde viene un movimiento de almacen, en un solo lugar.
 *
 * El kardex mostraba «—» en la columna Documento cuando la entrada venia de una
 * recepcion de compra: la compra conservaba todo —folio, proveedor, remision,
 * quien recibio— y el movimiento no tenia como volver a ella. Al revisar la
 * entrada desde almacen se perdia el rastro justo donde mas se necesita.
 *
 * Este archivo no toca la base: lo usan la pantalla del kardex y las pruebas.
 */

export type OrigenDeMovimiento = {
  materialRequest?: { id: string; folio: string } | null;
  transfer?: { id: string; folio: string } | null;
  workOrder?: { id: string; number: string } | null;
  goodsReceipt?: {
    id: string;
    folio: string;
    purchaseRequest?: { id: string; folio: string } | null;
    recibidoPor?: { name: string | null } | null;
    recibidoPorNombre?: string | null;
  } | null;
  entregadoA?: string | null;
};

export type DocumentoDeMovimiento = { texto: string; href: string };

/**
 * El documento que lo origino, del mas cercano al mas lejano: el vale y la
 * recepcion dicen mas que la orden, y la orden mas que nada.
 *
 * La recepcion lleva a la compra, que es donde vive el expediente completo. Si
 * la recepcion no cuelga de una compra —una entrada capturada sola— se muestra
 * su folio y se lleva al almacen, no a una pantalla que no existe.
 */
export function documentoDeMovimiento(m: OrigenDeMovimiento): DocumentoDeMovimiento | null {
  if (m.materialRequest) {
    return { texto: m.materialRequest.folio, href: `/requisiciones/${m.materialRequest.id}` };
  }
  if (m.goodsReceipt) {
    const compra = m.goodsReceipt.purchaseRequest;
    return {
      texto: compra ? `${m.goodsReceipt.folio} · ${compra.folio}` : m.goodsReceipt.folio,
      href: compra ? `/compras/${compra.id}` : "/inventory/kardex",
    };
  }
  if (m.transfer) return { texto: m.transfer.folio, href: "/inventory/traspasos" };
  if (m.workOrder) return { texto: m.workOrder.number, href: `/work-orders/${m.workOrder.id}` };
  return null;
}

/**
 * Quien recibio el material fisicamente.
 *
 * En una salida es a quien se le entrego —texto libre, porque el que recoge no
 * siempre es usuario del sistema—. En una entrada de compra es quien firmo la
 * recepcion. Son la misma pregunta desde los dos lados del mostrador, y por eso
 * comparten columna.
 *
 * Cuando la recepcion la mando una integracion no hay persona, y entonces se
 * dice el nombre de la integracion. Dejarlo vacio habria hecho parecer que a
 * esa entrada le falta un dato, cuando en realidad se sabe perfectamente de
 * donde vino.
 */
export function quienRecibio(m: OrigenDeMovimiento): string | null {
  return m.entregadoA ?? m.goodsReceipt?.recibidoPor?.name ?? m.goodsReceipt?.recibidoPorNombre ?? null;
}
