import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";

/**
 * El unico lugar por donde se mueve la existencia.
 *
 * Antes esto vivia repartido en tres: la ruta de movimientos manuales, el
 * consumo desde una orden de trabajo y la importacion. Cada una recalculaba el
 * saldo a su manera y solo una sabia de costo promedio, asi que consumir una
 * refaccion en una OT dejaba el costo intacto y darla de baja a mano no. Con
 * varios almacenes esa division se volvia insostenible: cada copia tendria que
 * acordarse de actualizar el saldo del almacen y ademas la suma global.
 *
 * Aqui vive una sola vez: valida, calcula, escribe el kardex, actualiza el
 * saldo del almacen y refresca el total de la refaccion. Todo en una
 * transaccion, porque un saldo actualizado sin su movimiento es un descuadre
 * que nadie puede reconstruir despues.
 */

export const TIPOS_MOVIMIENTO = ["IN", "OUT", "ADJUST", "RETURN", "TRANSFER_IN", "TRANSFER_OUT"] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

/** Los que suman al saldo del almacen. El resto resta, salvo ADJUST que fija. */
const SUMAN: TipoMovimiento[] = ["IN", "RETURN", "TRANSFER_IN"];

export type Movimiento = {
  organizationId: string;
  partId: string;
  warehouseId: string;
  tipo: TipoMovimiento;
  cantidad: number;
  /** Solo se usa en entradas. En salidas manda el costo promedio de la refaccion. */
  costoUnitario?: number;
  referencia?: string | null;
  workOrderId?: string | null;
  transferId?: string | null;
  materialRequestId?: string | null;
  /// A quien se le entrego fisicamente. Solo aplica en salidas y devoluciones.
  entregadoA?: string | null;
  userId?: string | null;
};

export class ErrorDeAlmacen extends Error {}

type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * Aplica un movimiento y devuelve el saldo que quedo en ese almacen.
 *
 * Recibe un cliente opcional para poder participar en una transaccion mayor
 * —un traspaso son dos movimientos que tienen que cuadrar o no ocurrir—.
 */
export async function aplicarMovimiento(m: Movimiento, tx?: Cliente): Promise<number> {
  if (!tx) return prisma.$transaction((t) => aplicarMovimiento(m, t));
  const db = tx;

  const cantidad = Math.abs(m.cantidad);
  if (!Number.isFinite(cantidad) || (cantidad === 0 && m.tipo !== "ADJUST")) {
    throw new ErrorDeAlmacen("La cantidad del movimiento debe ser mayor que cero");
  }

  const [part, almacen] = await Promise.all([
    db.part.findFirst({
      where: { id: m.partId, organizationId: m.organizationId },
      select: { id: true, unitCost: true, quantityOnHand: true },
    }),
    db.warehouse.findFirst({
      where: { id: m.warehouseId, organizationId: m.organizationId },
      select: { id: true, active: true, name: true },
    }),
  ]);
  if (!part) throw new ErrorDeAlmacen("Refacción no encontrada");
  if (!almacen) throw new ErrorDeAlmacen("Almacén no encontrado");
  if (!almacen.active) throw new ErrorDeAlmacen(`El almacen ${almacen.name} esta inactivo`);

  // La existencia en este almacen nace en cero la primera vez que algo entra.
  const existencia = await db.partStock.findUnique({
    where: { partId_warehouseId: { partId: m.partId, warehouseId: m.warehouseId } },
    select: { id: true, quantity: true },
  });
  const saldoPrevio = existencia?.quantity ?? 0;

  const saldo =
    m.tipo === "ADJUST" ? m.cantidad
      : SUMAN.includes(m.tipo) ? saldoPrevio + cantidad
      : saldoPrevio - cantidad;

  if (saldo < 0) {
    throw new ErrorDeAlmacen(
      `No hay suficiente en ${almacen.name}: hay ${saldoPrevio} y se intentan sacar ${cantidad}`,
    );
  }

  // Costo promedio ponderado, solo en entradas de compra o devolucion. Una
  // salida no puede cambiar lo que costo lo que ya estaba.
  const costoEntrada = m.costoUnitario ?? part.unitCost;
  const totalPrevio = part.quantityOnHand;
  const entra = m.tipo === "IN" || m.tipo === "TRANSFER_IN";
  const nuevoCosto =
    entra && totalPrevio + cantidad > 0
      ? (totalPrevio * part.unitCost + cantidad * costoEntrada) / (totalPrevio + cantidad)
      : part.unitCost;

  if (existencia) {
    /**
     * El saldo se escribe SOLO si sigue siendo el que se leyo.
     *
     * Dos salidas al mismo tiempo —doble clic, dos personas surtiendo, un
     * reintento del navegador— leian el mismo saldo previo y las dos escribian
     * el suyo: una de las dos se perdia y el almacen quedaba con existencia
     * que ya no estaba. Quien pierde la carrera no descuenta de mas: se le
     * dice que vuelva a intentar.
     */
    const escrito = await db.partStock.updateMany({
      where: { id: existencia.id, quantity: saldoPrevio },
      data: { quantity: saldo },
    });
    if (escrito.count === 0) {
      throw new ErrorDeAlmacen(
        "La existencia cambió mientras se registraba el movimiento. Vuelva a intentarlo para no descontar dos veces.",
      );
    }
  } else {
    await db.partStock.create({
      data: {
        organizationId: m.organizationId,
        partId: m.partId,
        warehouseId: m.warehouseId,
        quantity: saldo,
      },
    });
  }

  await db.stockMovement.create({
    data: {
      organizationId: m.organizationId,
      partId: m.partId,
      warehouseId: m.warehouseId,
      workOrderId: m.workOrderId ?? null,
      transferId: m.transferId ?? null,
      materialRequestId: m.materialRequestId ?? null,
      entregadoA: m.entregadoA ?? null,
      userId: m.userId ?? null,
      movementType: m.tipo,
      quantity: cantidad,
      unitCost: entra ? costoEntrada : part.unitCost,
      // El saldo del ALMACEN, no el global: es contra lo que se cuadra un
      // conteo fisico, que siempre se hace en un almacen concreto.
      balanceAfter: saldo,
      reference: m.referencia ?? null,
    },
  });

  await refrescarTotal(m.partId, db, entra ? nuevoCosto : undefined);
  return saldo;
}

/**
 * Recalcula el total de la refaccion sumando sus almacenes.
 *
 * Se suma en vez de ajustar el valor anterior por la diferencia: sumar da el
 * dato correcto aunque algo haya quedado desalineado antes, y ajustar arrastra
 * el error para siempre.
 */
export async function refrescarTotal(partId: string, tx?: Cliente, nuevoCosto?: number) {
  const db = tx ?? prisma;
  const suma = await db.partStock.aggregate({
    where: { partId },
    _sum: { quantity: true },
  });
  await db.part.update({
    where: { id: partId },
    data: {
      quantityOnHand: suma._sum.quantity ?? 0,
      ...(nuevoCosto !== undefined ? { unitCost: nuevoCosto } : {}),
    },
  });
}

/**
 * El almacen que debe usarse cuando el usuario no eligio ninguno.
 *
 * Casi todas las cuentas tienen uno solo, y obligar a escogerlo en cada
 * movimiento seria un clic de mas mil veces al mes.
 */
export async function almacenPorOmision(organizationId: string) {
  return prisma.warehouse.findFirst({
    where: { organizationId, active: true },
    orderBy: [{ esGeneral: "desc" }, { code: "asc" }],
    select: { id: true, code: true, name: true },
  });
}

/** Traspaso entre almacenes: la salida y la entrada cuadran o no ocurre nada. */
export async function traspasar(params: {
  organizationId: string;
  folio: string;
  origenId: string;
  destinoId: string;
  userId?: string | null;
  nota?: string | null;
  renglones: Array<{ partId: string; cantidad: number }>;
}) {
  if (params.origenId === params.destinoId) {
    throw new ErrorDeAlmacen("El origen y el destino no pueden ser el mismo almacén");
  }
  if (!params.renglones.length) throw new ErrorDeAlmacen("El traspaso no tiene renglones");

  return prisma.$transaction(async (tx) => {
    const traspaso = await tx.stockTransfer.create({
      data: {
        organizationId: params.organizationId,
        folio: params.folio,
        origenId: params.origenId,
        destinoId: params.destinoId,
        userId: params.userId ?? null,
        nota: params.nota ?? null,
      },
      select: { id: true, folio: true },
    });

    for (const r of params.renglones) {
      const part = await tx.part.findFirst({
        where: { id: r.partId, organizationId: params.organizationId },
        select: { unitCost: true },
      });
      if (!part) throw new ErrorDeAlmacen("Refacción no encontrada en el traspaso");

      await tx.stockTransferLine.create({
        data: { transferId: traspaso.id, partId: r.partId, quantity: r.cantidad, unitCost: part.unitCost },
      });

      const comun = {
        organizationId: params.organizationId,
        partId: r.partId,
        cantidad: r.cantidad,
        transferId: traspaso.id,
        userId: params.userId ?? null,
        referencia: `Traspaso ${traspaso.folio}`,
      };
      // Primero sale y luego entra: si el origen no alcanza, nada ocurrio.
      await aplicarMovimiento({ ...comun, warehouseId: params.origenId, tipo: "TRANSFER_OUT" }, tx);
      await aplicarMovimiento({ ...comun, warehouseId: params.destinoId, tipo: "TRANSFER_IN", costoUnitario: part.unitCost }, tx);
    }

    return traspaso;
  });
}
