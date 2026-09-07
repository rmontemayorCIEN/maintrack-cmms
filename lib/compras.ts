import { prisma } from "./db";
import { ErrorDeAlmacen, aplicarMovimiento } from "./almacen";
import { siguienteFolio } from "./numbering";
import { notify } from "./audit";

/**
 * Requisicion de compra y recepcion.
 *
 * El proceso de compras es opcional por organizacion. Con `comprasInternas`
 * apagado —el caso de la mayoria, que ya compra en su ERP— la requisicion se
 * autoriza, se le anota el folio de la orden externa y salta directo a
 * recepcion. Con el encendido, entre autorizar y recibir entran cotizaciones y
 * orden de compra, que es la fase siguiente.
 *
 * Lo que no cambia en ninguno de los dos casos: quien pidio, quien autorizo,
 * que llego y a que almacen entro.
 */

export const ESTADOS_COMPRA = {
  SOLICITADA: "Solicitada",
  AUTORIZADA: "Autorizada",
  RECHAZADA: "Rechazada",
  EN_COMPRA: "En compra",
  RECIBIDA_PARCIAL: "Recibida en parte",
  RECIBIDA: "Recibida",
  CERRADA: "Cerrada",
  CANCELADA: "Cancelada",
} as const;

export type EstadoCompra = keyof typeof ESTADOS_COMPRA;

export class ErrorDeCompra extends Error {}

/** Si la requisicion necesita firma segun el monto de la organizacion. */
export function requiereAutorizacion(montoEstimado: number, umbral: number) {
  return montoEstimado >= umbral;
}

/**
 * Avisa a quien compra que hay algo que adquirir.
 *
 * Va por aviso dentro de la aplicacion, no por correo: el correo necesita
 * dominio propio y un proveedor de envio, y desde una direccion prestada los
 * avisos se van a spam. Esto no depende de nada y no se pierde.
 */
async function avisarACompras(params: {
  organizationId: string;
  folio: string;
  requestId: string;
  urgencia: string;
  monto: number;
}) {
  const destinatarios = await prisma.user.findMany({
    where: {
      organizationId: params.organizationId,
      active: true,
      role: { in: ["COMPRAS", "OWNER", "ADMIN"] },
    },
    select: { id: true },
  });

  await Promise.all(
    destinatarios.map((u) =>
      notify({
        organizationId: params.organizationId,
        userId: u.id,
        title: `Requisicion de compra ${params.folio}`,
        body:
          params.urgencia === "PARO"
            ? "Hay equipo parado esperando este material."
            : "Mantenimiento necesita material que no hay en almacén.",
        link: `/compras/${params.requestId}`,
        kind: params.urgencia === "PARO" ? "CRITICAL" : "WARNING",
      }),
    ),
  );
}

export async function crearRequisicionDeCompra(params: {
  organizationId: string;
  userId: string;
  warehouseId: string;
  materialRequestId?: string | null;
  proveedorSugeridoId?: string | null;
  urgencia: string;
  justificacion?: string | null;
  renglones: Array<{
    partId?: string | null;
    descripcion: string;
    cantidadSolicitada: number;
    costoEstimado: number;
    nota?: string | null;
  }>;
}) {
  const montoEstimado = params.renglones.reduce(
    (s, r) => s + r.cantidadSolicitada * r.costoEstimado,
    0,
  );

  const folio = await siguienteFolio(params.organizationId, "compra");
  const req = await prisma.purchaseRequest.create({
    data: {
      organizationId: params.organizationId,
      folio,
      warehouseId: params.warehouseId,
      materialRequestId: params.materialRequestId || null,
      solicitanteId: params.userId,
      proveedorSugeridoId: params.proveedorSugeridoId || null,
      urgencia: params.urgencia,
      justificacion: params.justificacion || null,
      montoEstimado,
      renglones: {
        create: params.renglones.map((r) => ({
          partId: r.partId || null,
          descripcion: r.descripcion,
          cantidadSolicitada: r.cantidadSolicitada,
          costoEstimado: r.costoEstimado,
          nota: r.nota || null,
        })),
      },
    },
    select: { id: true, folio: true, urgencia: true, montoEstimado: true },
  });

  await avisarACompras({
    organizationId: params.organizationId,
    folio: req.folio,
    requestId: req.id,
    urgencia: req.urgencia,
    monto: req.montoEstimado,
  });

  return req;
}

export async function autorizar(params: {
  organizationId: string;
  requestId: string;
  userId: string;
  aprueba: boolean;
  motivo?: string | null;
}) {
  const req = await prisma.purchaseRequest.findFirst({
    where: { id: params.requestId, organizationId: params.organizationId },
    select: { id: true, folio: true, estado: true, solicitanteId: true },
  });
  if (!req) throw new ErrorDeCompra("Requisición de compra no encontrada");
  if (req.estado !== "SOLICITADA") {
    throw new ErrorDeCompra(`Ya esta ${ESTADOS_COMPRA[req.estado as EstadoCompra].toLowerCase()}`);
  }
  if (!params.aprueba && !params.motivo?.trim()) {
    throw new ErrorDeCompra("Indique por que se rechaza");
  }

  const actualizada = await prisma.purchaseRequest.update({
    where: { id: req.id },
    data: {
      estado: params.aprueba ? "AUTORIZADA" : "RECHAZADA",
      autorizadaPorId: params.userId,
      autorizadaEl: new Date(),
      motivoRechazo: params.aprueba ? null : params.motivo?.trim(),
    },
    select: { id: true, folio: true, estado: true },
  });

  // Quien pidio se entera sin tener que ir a revisar.
  if (req.solicitanteId) {
    await notify({
      organizationId: params.organizationId,
      userId: req.solicitanteId,
      title: `Compra ${req.folio} ${params.aprueba ? "autorizada" : "rechazada"}`,
      body: params.aprueba ? undefined : params.motivo?.trim(),
      link: `/compras/${req.id}`,
      kind: params.aprueba ? "SUCCESS" : "WARNING",
    });
  }

  return actualizada;
}

/** Marca que la compra ya se colocó, con el folio de la orden. */
export async function enCompra(params: {
  organizationId: string;
  requestId: string;
  ordenCompra: string;
}) {
  const req = await prisma.purchaseRequest.findFirst({
    where: { id: params.requestId, organizationId: params.organizationId },
    select: { id: true, estado: true },
  });
  if (!req) throw new ErrorDeCompra("Requisición de compra no encontrada");
  if (!["SOLICITADA", "AUTORIZADA"].includes(req.estado)) {
    throw new ErrorDeCompra("Solo se puede colocar una requisición autorizada");
  }
  if (!params.ordenCompra.trim()) throw new ErrorDeCompra("Indique el folio de la orden de compra");

  return prisma.purchaseRequest.update({
    where: { id: req.id },
    data: { estado: "EN_COMPRA", ordenCompra: params.ordenCompra.trim() },
    select: { id: true, folio: true, estado: true },
  });
}

/**
 * Recibe mercancia: la entrada al inventario y el documento de recepcion.
 *
 * Lo que no pasa la revision fisica se recibe igual pero queda senalado.
 * Rechazarlo en la puerta es una conversacion con el proveedor, no un borrado:
 * si el material se quedo en el almacen, el sistema tiene que decirlo.
 */
export async function recibir(params: {
  organizationId: string;
  userId: string;
  purchaseRequestId?: string | null;
  warehouseId: string;
  supplierId?: string | null;
  remision?: string | null;
  ordenCompra?: string | null;
  nota?: string | null;
  renglones: Array<{
    requestLineId?: string | null;
    partId: string;
    cantidad: number;
    costoUnitario: number;
    conforme: boolean;
    observacion?: string | null;
  }>;
}) {
  const utiles = params.renglones.filter((r) => r.cantidad > 0);
  if (!utiles.length) throw new ErrorDeCompra("No hay cantidades que recibir");

  const folio = await siguienteFolio(params.organizationId, "recepcion");

  return prisma.$transaction(async (tx) => {
    const recepcion = await tx.goodsReceipt.create({
      data: {
        organizationId: params.organizationId,
        folio,
        purchaseRequestId: params.purchaseRequestId || null,
        warehouseId: params.warehouseId,
        supplierId: params.supplierId || null,
        remision: params.remision || null,
        ordenCompra: params.ordenCompra || null,
        recibidoPorId: params.userId,
        nota: params.nota || null,
      },
      select: { id: true, folio: true },
    });

    for (const r of utiles) {
      await tx.goodsReceiptLine.create({
        data: {
          receiptId: recepcion.id,
          requestLineId: r.requestLineId || null,
          partId: r.partId,
          cantidad: r.cantidad,
          costoUnitario: r.costoUnitario,
          conforme: r.conforme,
          observacion: r.observacion || null,
        },
      });

      await aplicarMovimiento(
        {
          organizationId: params.organizationId,
          partId: r.partId,
          warehouseId: params.warehouseId,
          tipo: "IN",
          cantidad: r.cantidad,
          costoUnitario: r.costoUnitario,
          userId: params.userId,
          referencia: `Recepcion ${recepcion.folio}${params.remision ? ` · remision ${params.remision}` : ""}`,
        },
        tx,
      );

      if (r.requestLineId) {
        await tx.purchaseRequestLine.update({
          where: { id: r.requestLineId },
          data: { cantidadRecibida: { increment: r.cantidad } },
        });
      }
    }

    // El estado de la compra sigue a lo recibido, no se captura a mano.
    if (params.purchaseRequestId) {
      const renglones = await tx.purchaseRequestLine.findMany({
        where: { requestId: params.purchaseRequestId },
        select: { cantidadSolicitada: true, cantidadRecibida: true },
      });
      const completo = renglones.every((l) => l.cantidadRecibida >= l.cantidadSolicitada);
      await tx.purchaseRequest.update({
        where: { id: params.purchaseRequestId },
        data: { estado: completo ? "RECIBIDA" : "RECIBIDA_PARCIAL" },
      });
    }

    return recepcion;
  });
}

export { ErrorDeAlmacen };

// ═══════════════════════════════════════════════════════════════════════════
// Fase 4: cotizaciones, comparativo y orden de compra.
//
// Todo esto solo aplica cuando la organizacion tiene el proceso de compras
// interno encendido. Con el apagado, la requisicion salta de autorizada a
// recepcion con el folio de la orden del ERP del cliente.
// ═══════════════════════════════════════════════════════════════════════════

/** Registra la cotizacion de un proveedor contra una requisicion. */
export async function registrarCotizacion(params: {
  organizationId: string;
  purchaseRequestId: string;
  supplierId: string;
  userId: string;
  folioProveedor?: string | null;
  vigenciaHasta?: Date | null;
  diasEntrega?: number | null;
  condicionesPago?: string | null;
  garantia?: string | null;
  monedaOriginal?: string | null;
  tipoCambio?: number | null;
  nota?: string | null;
  renglones: Array<{
    requestLineId?: string | null;
    partId?: string | null;
    descripcion: string;
    marca?: string | null;
    especificacion?: string | null;
    cantidad: number;
    costoUnitario: number;
    disponible: boolean;
  }>;
}) {
  const compra = await prisma.purchaseRequest.findFirst({
    where: { id: params.purchaseRequestId, organizationId: params.organizationId },
    select: { id: true, estado: true },
  });
  if (!compra) throw new ErrorDeCompra("Requisición de compra no encontrada");
  if (["RECHAZADA", "CANCELADA", "CERRADA"].includes(compra.estado)) {
    throw new ErrorDeCompra("No se pueden capturar cotizaciones sobre una requisición cerrada");
  }

  const proveedor = await prisma.supplier.findFirst({
    where: { id: params.supplierId, organizationId: params.organizationId },
    select: { id: true },
  });
  if (!proveedor) throw new ErrorDeCompra("Proveedor no encontrado");

  // Solo suma lo que el proveedor si tiene: cobrar por lo que no surte
  // inflaria su total y lo sacaria injustamente del comparativo.
  const total = params.renglones
    .filter((r) => r.disponible)
    .reduce((s, r) => s + r.cantidad * r.costoUnitario, 0);

  return prisma.quote.create({
    data: {
      organizationId: params.organizationId,
      purchaseRequestId: params.purchaseRequestId,
      supplierId: params.supplierId,
      capturadaPorId: params.userId,
      folioProveedor: params.folioProveedor || null,
      vigenciaHasta: params.vigenciaHasta || null,
      diasEntrega: params.diasEntrega ?? null,
      condicionesPago: params.condicionesPago || null,
      garantia: params.garantia || null,
      monedaOriginal: params.monedaOriginal || null,
      tipoCambio: params.tipoCambio ?? null,
      nota: params.nota || null,
      total,
      renglones: {
        create: params.renglones.map((r) => ({
          requestLineId: r.requestLineId || null,
          partId: r.partId || null,
          descripcion: r.descripcion,
          marca: r.marca || null,
          especificacion: r.especificacion || null,
          cantidad: r.cantidad,
          costoUnitario: r.costoUnitario,
          disponible: r.disponible,
        })),
      },
    },
    select: { id: true, total: true },
  });
}

/**
 * Elige la cotizacion ganadora.
 *
 * Exige el motivo cuando la elegida NO es la mas barata. No es burocracia: es
 * lo unico que defiende la decision cuando alguien la revise en dos años, y es
 * justo lo que una auditoria pregunta. Cuando gana la mas barata el motivo
 * sobra, porque el precio ya lo explica.
 */
export async function elegirCotizacion(params: {
  organizationId: string;
  purchaseRequestId: string;
  quoteId: string;
  motivo?: string | null;
}) {
  const cotizaciones = await prisma.quote.findMany({
    where: { organizationId: params.organizationId, purchaseRequestId: params.purchaseRequestId },
    select: { id: true, total: true },
  });
  if (!cotizaciones.length) throw new ErrorDeCompra("No hay cotizaciones que comparar");

  const elegida = cotizaciones.find((c) => c.id === params.quoteId);
  if (!elegida) throw new ErrorDeCompra("Esa cotización no pertenece a esta requisición");

  const masBarata = cotizaciones.reduce((a, b) => (b.total < a.total ? b : a));
  if (elegida.id !== masBarata.id && !params.motivo?.trim()) {
    throw new ErrorDeCompra(
      "No es la cotizacion mas barata. Explique por que se elige: entrega, marca, garantia o disponibilidad.",
    );
  }

  await prisma.$transaction([
    prisma.quote.updateMany({
      where: { purchaseRequestId: params.purchaseRequestId },
      data: { seleccionada: false, motivoSeleccion: null },
    }),
    prisma.quote.update({
      where: { id: params.quoteId },
      data: { seleccionada: true, motivoSeleccion: params.motivo?.trim() || null },
    }),
    // El monto estimado pasa a ser el cotizado: a partir de aqui la
    // autorizacion se firma sobre dinero real, no sobre una estimacion.
    prisma.purchaseRequest.update({
      where: { id: params.purchaseRequestId },
      data: { montoEstimado: elegida.total },
    }),
  ]);

  return { quoteId: params.quoteId, total: elegida.total, eraLaMasBarata: elegida.id === masBarata.id };
}

/**
 * Emite la orden de compra a partir de la cotizacion elegida.
 *
 * La requisicion pasa a EN_COMPRA con el folio de la orden, que es el mismo
 * estado al que llega cuando compras vive afuera. De ahi en adelante la
 * recepcion es identica en los dos casos.
 */
export async function emitirOrdenDeCompra(params: {
  organizationId: string;
  purchaseRequestId: string;
  userId: string;
  fechaPrometida?: Date | null;
  nota?: string | null;
}) {
  const compra = await prisma.purchaseRequest.findFirst({
    where: { id: params.purchaseRequestId, organizationId: params.organizationId },
    select: {
      id: true, folio: true, estado: true, warehouseId: true,
      cotizaciones: {
        where: { seleccionada: true },
        select: { id: true, supplierId: true, total: true, condicionesPago: true, diasEntrega: true },
      },
    },
  });
  if (!compra) throw new ErrorDeCompra("Requisición de compra no encontrada");
  if (compra.estado !== "AUTORIZADA") {
    throw new ErrorDeCompra("La orden se emite sobre una requisición autorizada");
  }
  const ganadora = compra.cotizaciones[0];
  if (!ganadora) throw new ErrorDeCompra("Primero elija la cotización ganadora en el comparativo");

  const folio = await siguienteFolio(params.organizationId, "ordenCompra");

  const prometida =
    params.fechaPrometida ??
    (ganadora.diasEntrega != null
      ? new Date(Date.now() + ganadora.diasEntrega * 86400000)
      : null);

  const [orden] = await prisma.$transaction([
    prisma.purchaseOrder.create({
      data: {
        organizationId: params.organizationId,
        folio,
        purchaseRequestId: compra.id,
        quoteId: ganadora.id,
        supplierId: ganadora.supplierId,
        warehouseId: compra.warehouseId,
        condicionesPago: ganadora.condicionesPago,
        fechaPrometida: prometida,
        total: ganadora.total,
        nota: params.nota || null,
        emitidaPorId: params.userId,
      },
      select: { id: true, folio: true, total: true },
    }),
    prisma.purchaseRequest.update({
      where: { id: compra.id },
      data: { estado: "EN_COMPRA", ordenCompra: folio },
    }),
  ]);

  return orden;
}
