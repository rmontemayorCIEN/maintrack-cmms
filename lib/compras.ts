import { prisma } from "./db";
import { ErrorDeAlmacen, aplicarMovimiento } from "./almacen";
import { siguienteFolio } from "./numbering";
import { emitirAviso } from "./avisos/emitir";
import { reconciliar } from "./avisos/condiciones";
import { avisarCompraPorAutorizar } from "./avisos/detectores";

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

// Los nombres visibles de los estados viven en lib/estados-compra.ts y NO se
// reexportan desde aqui a proposito: reexportarlos deja abierta la puerta a que
// una pantalla los vuelva a tomar de este modulo y se lleve consigo prisma y el
// envio de avisos al paquete del navegador. Ya paso una vez.
import { ESTADOS_COMPRA, type EstadoCompra } from "./estados-compra";

/** Regla de compras incumplida: es del usuario, no del sistema (ver ErrorDeAlmacen). */
export class ErrorDeCompra extends Error {
  constructor(mensaje: string, readonly codigo = 409) { super(mensaje); }
}

/** Si la requisicion necesita firma segun el monto de la organizacion. */
export function requiereAutorizacion(montoEstimado: number, umbral: number) {
  return montoEstimado >= umbral;
}

/**
 * Lo que cuesta hoy cada renglon, y como se llama esa cifra.
 *
 * Al elegir cotizacion, `montoEstimado` pasa a ser el cotizado (ver
 * `elegirCotizacion`), pero el costo de cada renglon se queda como se pidio.
 * La pantalla sumaba los estimados y el encabezado mostraba el cotizado: dos
 * cifras distintas para la misma compra, a diez centimetros una de otra y sin
 * decir por que. Se vio abriendo la pantalla; ninguna prueba de datos lo iba
 * a notar, porque las dos cifras son correctas por separado.
 *
 * El total de una cotizacion solo suma lo que el proveedor SI surte, asi que
 * un renglon que el no tiene queda fuera de la cifra: eso se marca con
 * `fuera`, para que la pantalla lo muestre aparte en vez de cuadrarlo a la
 * fuerza.
 */
export function costosVigentes(
  renglones: Array<{ id: string; costoEstimado: number }>,
  cotizaciones: Array<{
    seleccionada: boolean;
    renglones: Array<{ requestLineId: string | null; costoUnitario: number; disponible: boolean }>;
  }>,
) {
  const elegida = cotizaciones.find((c) => c.seleccionada);
  const porRenglon = new Map<string, { costo: number; fuera: boolean }>();

  for (const r of renglones) {
    if (!elegida) {
      porRenglon.set(r.id, { costo: r.costoEstimado, fuera: false });
      continue;
    }
    const cotizado = elegida.renglones.find((l) => l.requestLineId === r.id);
    porRenglon.set(
      r.id,
      cotizado
        ? { costo: cotizado.costoUnitario, fuera: !cotizado.disponible }
        : { costo: r.costoEstimado, fuera: true },
    );
  }

  return { base: elegida ? ("cotizado" as const) : ("estimado" as const), porRenglon };
}

/**
 * Avisa de una compra nueva a quien le toca actuar.
 *
 * Si espera firma, a quien puede autorizar (nunca a quien la pidió). Si nació
 * autorizada por estar debajo del umbral, a compras, que es quien la coloca.
 * Antes iba a compras, dueño y administrador por igual, firmara o no.
 */
async function avisarACompras(params: {
  organizationId: string;
  req: { id: string; folio: string; urgencia: string; montoEstimado: number; estado: string; solicitanteId: string | null; warehouseId: string };
  montoAutorizacion: number;
}) {
  const { req } = params;
  if (req.estado === "SOLICITADA") {
    await avisarCompraPorAutorizar(params.organizationId, req, params.montoAutorizacion);
    return;
  }
  await emitirAviso({
    organizationId: params.organizationId, tipo: "ORDEN_COMPRA_PENDIENTE", entidad: "PurchaseRequest", entidadId: req.id,
    titulo: `Compra ${req.folio} autorizada: falta colocarla`,
    cuerpo: req.urgencia === "PARO" ? "Hay equipo parado esperando este material." : "Mantenimiento necesita material que no hay en almacén.",
    porQue: "Se autorizó sola por estar debajo del umbral; nadie la ha pedido al proveedor.",
    accion: "Coloque la orden de compra.", enlace: `/compras/${req.id}`,
    prioridad: req.urgencia === "PARO" ? "ALTA" : undefined,
    contexto: { warehouseId: req.warehouseId }, tag: req.folio, datos: { folio: req.folio, urgencia: req.urgencia },
  });
}

/**
 * Lo que espera la firma de esta persona.
 *
 * El «no lo mio» no es un adorno: quien levanto la requisicion no la autoriza,
 * y sin esa condicion el inicio —y el brief del dia— le dirian que tiene
 * pendiente firmar lo que el mismo pidio. Vive aqui porque lo preguntan dos
 * pantallas, y copiarlo seria garantizar que un dia dejen de coincidir.
 */
export function porAutorizar(organizationId: string, userId: string) {
  return { organizationId, estado: "SOLICITADA", NOT: { solicitanteId: userId } };
}

/** Estados en los que una requisicion de compra sigue viva (cubre un faltante). */
export const ESTADOS_COMPRA_ABIERTA = ["SOLICITADA", "AUTORIZADA", "EN_COMPRA", "RECIBIDA_PARCIAL"];

/**
 * Lo que ya esta cubierto por una compra viva, renglon por renglon de la
 * requisicion de material.
 *
 * Es lo que evita comprar dos veces el mismo faltante: alguien manda a compras
 * lo que no habia, y al dia siguiente otro abre el mismo vale y lo vuelve a
 * mandar. Se cuenta por renglon de requisicion, no por refaccion: dos vales
 * distintos pueden necesitar el mismo balero y los dos son legitimos.
 */
export async function cubiertoPorCompras(organizationId: string, materialRequestId: string) {
  const lineas = await prisma.purchaseRequestLine.findMany({
    where: {
      materialRequestLineId: { not: null },
      request: {
        organizationId,
        materialRequestId,
        estado: { in: ESTADOS_COMPRA_ABIERTA },
      },
    },
    select: { materialRequestLineId: true, cantidadSolicitada: true, request: { select: { folio: true } } },
  });
  const porRenglon = new Map<string, { cantidad: number; folios: string[] }>();
  for (const l of lineas) {
    const previo = porRenglon.get(l.materialRequestLineId!) ?? { cantidad: 0, folios: [] };
    previo.cantidad += l.cantidadSolicitada;
    if (!previo.folios.includes(l.request.folio)) previo.folios.push(l.request.folio);
    porRenglon.set(l.materialRequestLineId!, previo);
  }
  return porRenglon;
}

export async function crearRequisicionDeCompra(params: {
  organizationId: string;
  userId: string;
  warehouseId: string;
  materialRequestId?: string | null;
  proveedorSugeridoId?: string | null;
  urgencia: string;
  justificacion?: string | null;
  /** Arriba de este monto hace falta firma. Cero significa que siempre se firma. */
  montoAutorizacion?: number;
  renglones: Array<{
    partId?: string | null;
    descripcion: string;
    cantidadSolicitada: number;
    costoEstimado: number;
    nota?: string | null;
    /** El renglon del vale que quedo faltante, si viene de uno. */
    materialRequestLineId?: string | null;
  }>;
}) {
  const montoEstimado = params.renglones.reduce(
    (s, r) => s + r.cantidadSolicitada * r.costoEstimado,
    0,
  );

  /**
   * No se compra dos veces el mismo faltante.
   *
   * Se revisa contra las compras vivas del mismo vale, renglon por renglon. Si
   * ya hay una compra abierta que lo cubre, se dice cual: casi siempre la
   * respuesta correcta es seguir esa, no abrir otra.
   */
  if (params.materialRequestId) {
    const cubierto = await cubiertoPorCompras(params.organizationId, params.materialRequestId);
    const vale = await prisma.materialRequest.findFirst({
      where: { id: params.materialRequestId, organizationId: params.organizationId },
      include: { renglones: true },
    });
    if (!vale) throw new ErrorDeCompra("La requisición de material no existe");
    const repetidos: string[] = [];
    for (const r of params.renglones) {
      /**
       * Si no viene el renglon pero si la refaccion, se deduce: la pantalla
       * precarga el faltante, pero alguien puede capturarlo a mano. Sin esta
       * deduccion, volver a teclear lo mismo abria una segunda compra del
       * mismo faltante sin que nada lo notara.
       */
      if (!r.materialRequestLineId && r.partId) {
        const candidatos = vale.renglones.filter((x) => x.partId === r.partId);
        if (candidatos.length === 1) r.materialRequestLineId = candidatos[0].id;
      }
      if (!r.materialRequestLineId) continue;
      const renglon = vale.renglones.find((x) => x.id === r.materialRequestLineId);
      if (!renglon) throw new ErrorDeCompra("Un renglón no pertenece a esa requisición de material");
      const yaCubierto = cubierto.get(renglon.id);
      const faltante = renglon.cantidadSolicitada - renglon.cantidadSurtida;
      if (yaCubierto && yaCubierto.cantidad + r.cantidadSolicitada > faltante + 0.0001) {
        repetidos.push(`${renglon.descripcion} (ya en ${yaCubierto.folios.join(", ")})`);
      }
    }
    if (repetidos.length) {
      throw new ErrorDeCompra(
        `Ya hay una compra abierta para: ${repetidos.join("; ")}. Siga esa compra en vez de abrir otra.`,
      );
    }
  }

  const umbral = params.montoAutorizacion ?? 0;
  // Debajo del umbral configurado no se pide firma: la requisicion nace
  // autorizada y se anota por que. El umbral existia en configuracion pero
  // ningun lado lo leia, asi que todo pasaba por firma o se colocaba sin ella.
  const sinFirma = umbral > 0 && montoEstimado < umbral;

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
      /*
       * Nace autorizada, y nada mas. La razon NO se pega a `justificacion`:
       * ese campo es lo que escribio quien pidio, y el sistema le agregaba su
       * propia nota con el monto de ese momento. Cuando despues se elegia una
       * cotizacion, el monto cambiaba y la nota se quedaba citando el viejo:
       * la pantalla mostraba las dos cifras juntas, contradiciendose. Ademas
       * el inicio usa ese texto como titulo del renglon, asi que una compra
       * sin justificacion propia se titulaba con la nota del sistema.
       *
       * Que se autorizo sola se deduce de tener fecha sin firmante, que es lo
       * que lee `quienAutorizo()`; el monto y el umbral de ese momento quedan
       * en la bitacora, que es el registro que sirve para auditar.
       */
      ...(sinFirma ? { estado: "AUTORIZADA", autorizadaEl: new Date() } : {}),
      renglones: {
        create: params.renglones.map((r) => ({
          partId: r.partId || null,
          materialRequestLineId: r.materialRequestLineId || null,
          descripcion: r.descripcion,
          cantidadSolicitada: r.cantidadSolicitada,
          costoEstimado: r.costoEstimado,
          nota: r.nota || null,
        })),
      },
    },
    select: { id: true, folio: true, urgencia: true, montoEstimado: true, estado: true, solicitanteId: true, warehouseId: true },
  });

  await avisarACompras({ organizationId: params.organizationId, req, montoAutorizacion: umbral });

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

  // Solo si sigue solicitada: dos toques (o dos personas) a la vez leían
  // «solicitada» y las dos firmaban. Ahora gana una; la otra se entera.
  const firmada = await prisma.purchaseRequest.updateMany({
    where: { id: req.id, estado: "SOLICITADA" },
    data: {
      estado: params.aprueba ? "AUTORIZADA" : "RECHAZADA",
      autorizadaPorId: params.userId,
      autorizadaEl: new Date(),
      motivoRechazo: params.aprueba ? null : params.motivo?.trim(),
    },
  });
  if (!firmada.count) throw new ErrorDeCompra("Esta compra ya se había firmado hace un momento. No se volvió a firmar.");
  const actualizada = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: req.id }, select: { id: true, folio: true, estado: true } });

  // Ya se firmó: los avisos de «por autorizar» se reconcilian contra el estado nuevo.
  await reconciliar({ organizationId: params.organizationId, entidadId: req.id, origen: "FLUJO", actorId: params.userId, evento: params.aprueba ? "Autorización" : "Rechazo" });
  // Quien pidio se entera sin tener que ir a revisar.
  if (req.solicitanteId) {
    await emitirAviso({
      organizationId: params.organizationId, tipo: "REQUISICION_RESUELTA", entidad: "PurchaseRequest", entidadId: req.id,
      version: params.aprueba ? "AUTORIZADA" : "RECHAZADA",
      prioridad: params.aprueba ? "INFORMATIVA" : "MEDIA", kind: params.aprueba ? "SUCCESS" : "WARNING",
      titulo: `Compra ${req.folio} ${params.aprueba ? "autorizada" : "rechazada"}`,
      cuerpo: params.aprueba ? undefined : params.motivo?.trim(),
      enlace: `/compras/${req.id}`, contexto: { solicitanteId: req.solicitanteId }, tag: req.folio,
      datos: { folio: req.folio, estado: params.aprueba ? "AUTORIZADA" : "RECHAZADA" },
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
  if (req.estado !== "AUTORIZADA") {
    throw new ErrorDeCompra(
      req.estado === "SOLICITADA"
        ? "Falta autorizar la requisición antes de colocarla."
        : `No se puede colocar: la requisición está ${ESTADOS_COMPRA[req.estado as EstadoCompra].toLowerCase()}.`,
    );
  }
  if (!params.ordenCompra.trim()) throw new ErrorDeCompra("Indique el folio de la orden de compra");

  const colocada = await prisma.purchaseRequest.update({
    where: { id: req.id },
    data: { estado: "EN_COMPRA", ordenCompra: params.ordenCompra.trim() },
    select: { id: true, folio: true, estado: true },
  });
  await reconciliar({ organizationId: params.organizationId, entidadId: req.id, origen: "FLUJO", evento: "Orden de compra colocada" });
  return colocada;
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
  /**
   * Quien recibio. Nulo cuando la recepcion la mando una integracion: ahi no
   * hay persona, y entonces se llena `integracion`.
   */
  userId: string | null;
  /** Nombre de la integracion, cuando no hay persona. Ver `quienFirmoLaRecepcion`. */
  integracion?: string | null;
  purchaseRequestId?: string | null;
  warehouseId: string;
  supplierId?: string | null;
  remision?: string | null;
  ordenCompra?: string | null;
  nota?: string | null;
  /** Clave de la pantalla: el mismo envio repetido no entra dos veces. */
  clave?: string | null;
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

  // Un reintento del mismo envio devuelve la recepcion que ya se hizo: el
  // material no entra dos veces al inventario.
  if (params.clave) {
    const previa = await prisma.goodsReceipt.findFirst({
      where: { organizationId: params.organizationId, clave: params.clave },
      select: { id: true, folio: true },
    });
    if (previa) return previa;
  }

  if (params.purchaseRequestId) {
    const compra = await prisma.purchaseRequest.findFirst({
      where: { id: params.purchaseRequestId, organizationId: params.organizationId },
      include: { renglones: { select: { id: true, descripcion: true, cantidadSolicitada: true, cantidadRecibida: true } } },
    });
    if (!compra) throw new ErrorDeCompra("Requisición de compra no encontrada");
    if (["RECHAZADA", "CANCELADA", "CERRADA"].includes(compra.estado)) {
      throw new ErrorDeCompra(
        `No se puede recibir contra ${compra.folio}: está ${ESTADOS_COMPRA[compra.estado as EstadoCompra].toLowerCase()}.`,
      );
    }
    // Cada renglon recibido debe ser de ESTA compra, y no se recibe de mas: un
    // renglon de otra requisicion habria sumado su recibido al documento ajeno.
    for (const r of utiles) {
      if (!r.requestLineId) continue;
      const renglon = compra.renglones.find((l) => l.id === r.requestLineId);
      if (!renglon) throw new ErrorDeCompra("Un renglón recibido no pertenece a esta requisición de compra");
      const falta = renglon.cantidadSolicitada - renglon.cantidadRecibida;
      if (r.cantidad > falta + 0.0001) {
        throw new ErrorDeCompra(
          `De ${renglon.descripcion} faltan ${falta} por recibir y se intentan entrar ${r.cantidad}. ` +
            "Si el proveedor mandó de más, ajuste la requisición o registre la diferencia como entrada de almacén.",
        );
      }
    }
  }

  const folio = await siguienteFolio(params.organizationId, "recepcion");

  try {
    const recepcion = await registrarRecepcion(params, folio, utiles);
    await reconciliarRecepcion(params);
    await avisarSiYaLlego(params);
    return recepcion;
  } catch (e) {
    /**
     * Dos clics a la vez pasan los dos la revision de la clave y el segundo
     * choca contra el indice unico. Eso es exactamente lo que se buscaba —el
     * material entro una sola vez— pero a la persona no se le enseña el error
     * de la base: se le devuelve la recepcion que si quedo.
     */
    const choque = typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
    if (choque && params.clave) {
      const previa = await prisma.goodsReceipt.findFirst({
        where: { organizationId: params.organizationId, clave: params.clave },
        select: { id: true, folio: true },
      });
      if (previa) return previa;
    }
    throw e;
  }
}

/**
 * Lo que la mercancía que entró pudo resolver, en el momento: la compra
 * recibida (parcial o completa), su orden de compra vencida, las refacciones
 * bajo mínimo o agotadas. Cada aviso se atiende solo si su condición se acabó.
 */
async function reconciliarRecepcion(params: Parameters<typeof recibir>[0]) {
  const organizationId = params.organizationId;
  const evento = "Recepción de mercancía";
  if (params.purchaseRequestId) {
    await reconciliar({ organizationId, entidadId: params.purchaseRequestId, origen: "FLUJO", actorId: params.userId, evento });
    const ordenes = await prisma.purchaseOrder.findMany({ where: { organizationId, purchaseRequestId: params.purchaseRequestId }, select: { id: true } });
    for (const o of ordenes) await reconciliar({ organizationId, entidadId: o.id, origen: "FLUJO", actorId: params.userId, evento });
  }
  await reconciliar({ organizationId, tipos: ["REFACCION_BAJO_MINIMO", "REFACCION_CRITICA_AGOTADA"], origen: "FLUJO", actorId: params.userId, evento });
}

/**
 * «Ya llego lo que pidio».
 *
 * Era el hueco del flujo de compras. A quien pedia una refaccion se le avisaba
 * que su solicitud se habia autorizado —y nada mas—. Lo unico que de verdad
 * estaba esperando, que el material llegara, tenia que ir a buscarlo a mano; y
 * muchas veces hay una orden detenida por esa pieza, asi que el aviso tambien
 * va al responsable de esa orden, que casi nunca es la misma persona.
 *
 * Solo cuando llega COMPLETA. Lo parcial ya tiene su propio aviso, ese a
 * compras y almacen, que son quienes tienen que hacer algo con la diferencia.
 *
 * Va DESPUES de la transaccion y con su propio try: un fallo al avisar no
 * puede deshacer una entrada de almacen que ya se asento.
 */
async function avisarSiYaLlego(params: Parameters<typeof recibir>[0]) {
  if (!params.purchaseRequestId) return;
  try {
    const req = await prisma.purchaseRequest.findFirst({
      where: { id: params.purchaseRequestId, organizationId: params.organizationId },
      select: { id: true, folio: true, estado: true, solicitanteId: true, materialRequestId: true },
    });
    if (!req || req.estado !== "RECIBIDA") return;

    // La orden que espera el material, si la compra nacio de una.
    const orden = req.materialRequestId
      ? await prisma.materialRequest.findFirst({
        where: { id: req.materialRequestId, organizationId: params.organizationId },
        select: { workOrder: { select: { id: true, number: true, assignedToId: true } } },
      })
      : null;
    const ot = orden?.workOrder ?? null;

    await emitirAviso({
      organizationId: params.organizationId, tipo: "COMPRA_RECIBIDA", entidad: "PurchaseRequest", entidadId: req.id,
      version: "RECIBIDA", prioridad: "MEDIA", kind: "SUCCESS",
      titulo: `Ya llegó lo de la compra ${req.folio}`,
      cuerpo: ot ? `Con esto se puede seguir la orden ${ot.number}.` : undefined,
      enlace: `/compras/${req.id}`,
      contexto: { solicitanteId: req.solicitanteId, responsableId: ot?.assignedToId ?? null },
      tag: req.folio,
      datos: { folio: req.folio, estado: "RECIBIDA", ordenDeTrabajo: ot?.number ?? null },
    });
  } catch (e) {
    // Que no se pueda avisar no puede tumbar la recepcion: la mercancia ya
    // entro y el kardex ya esta escrito. Queda en el registro para que no se
    // vuelva mudo sin que nadie lo note.
    console.error("[compras] no se pudo avisar que llego la compra:", e instanceof Error ? e.message : e);
  }
}

async function registrarRecepcion(
  params: Parameters<typeof recibir>[0],
  folio: string,
  utiles: Parameters<typeof recibir>[0]["renglones"],
) {
  return prisma.$transaction(async (tx) => {
    const recepcion = await tx.goodsReceipt.create({
      data: {
        organizationId: params.organizationId,
        folio,
        purchaseRequestId: params.purchaseRequestId || null,
        clave: params.clave || null,
        warehouseId: params.warehouseId,
        supplierId: params.supplierId || null,
        remision: params.remision || null,
        ordenCompra: params.ordenCompra || null,
        recibidoPorId: params.userId,
        recibidoPorNombre: params.integracion || null,
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
          goodsReceiptId: recepcion.id,
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

  await reconciliar({ organizationId: params.organizationId, entidadId: compra.id, origen: "FLUJO", actorId: params.userId, evento: "Orden de compra emitida" });
  return orden;
}
