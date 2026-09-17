/**
 * Bloque 2 — El ciclo de materiales, de punta a punta.
 *
 * Necesidad en la OT → requisicion → entrega total o parcial → faltante →
 * compra → recepcion → inventario → consumo o devolucion.
 *
 * Llama a las MISMAS funciones que las rutas (`surtir`, `devolver`,
 * `crearRequisicionDeCompra`, `autorizar`, `enCompra`, `recibir`,
 * `aplicarMovimiento`, `recalcWorkOrder`), no a una copia de sus pasos.
 *
 *   npx tsx scripts/prueba-materiales.ts
 */
import { prisma } from "../lib/db";
import { ErrorDeAlmacen, aplicarMovimiento } from "../lib/almacen";
import { ErrorDeRequisicion, devolver, surtir } from "../lib/requisiciones";
import { motivoDeLaOrden } from "../lib/requisiciones-datos";
import {
  ErrorDeCompra, autorizar, crearRequisicionDeCompra, cubiertoPorCompras, enCompra, recibir,
} from "../lib/compras";
import { can } from "../lib/rbac";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${typeof detalle === "string" ? detalle : JSON.stringify(detalle)}` : ""}`);
}

async function rechaza(afirmacion: string, fn: () => Promise<unknown>, contiene?: string) {
  try {
    await fn();
    revisar(afirmacion, false, "no se rechazó");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    revisar(afirmacion, !contiene || m.includes(contiene), m);
  }
}

async function main() {
  const sello = `prueba-mat-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", montoAutorizacion: 5000, comprasInternas: true },
  });
  const orgB = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" } });

  try {
    const almacenista = await prisma.user.create({
      data: { organizationId: org.id, email: `alm-${sello}@t.mx`, name: "Almacenista", role: "TECHNICIAN", passwordHash: "x" },
    });
    const jefe = await prisma.user.create({
      data: { organizationId: org.id, email: `jefe-${sello}@t.mx`, name: "Jefa", role: "ADMIN", passwordHash: "x" },
    });
    const almacen = await prisma.warehouse.create({
      data: { organizationId: org.id, code: "GEN", name: "General", esGeneral: true },
    });
    const proveedor = await prisma.supplier.create({ data: { organizationId: org.id, name: "Proveedor SA" } });
    const sitio = await prisma.site.create({ data: { organizationId: org.id, code: "PL", name: "Planta" } });
    const activo = await prisma.asset.create({
      data: { organizationId: org.id, siteId: sitio.id, code: "BOM-1", name: "Bomba", status: "OPERATIONAL" },
    });
    const parte = async (code: string, cantidad: number, costo: number) => {
      const p = await prisma.part.create({
        data: { organizationId: org.id, code, name: `Refacción ${code}`, unit: "pza", unitCost: costo, minQuantity: 2 },
      });
      if (cantidad > 0) {
        await aplicarMovimiento({
          organizationId: org.id, partId: p.id, warehouseId: almacen.id, tipo: "IN",
          cantidad, costoUnitario: costo, userId: jefe.id, referencia: "Existencia inicial",
        });
      }
      return prisma.part.findUniqueOrThrow({ where: { id: p.id } });
    };
    const rodamiento = await parte("ROD-1", 10, 100);   // hay de sobra
    const sello2 = await parte("SEL-1", 1, 50);         // solo alcanza para uno
    const sinCosto = await parte("EMP-1", 5, 0);        // sin costo capturado

    const ot = await prisma.workOrder.create({
      data: {
        organizationId: org.id, number: "OT-M1", title: "Preventivo bomba", assetId: activo.id,
        maintenanceType: "PREVENTIVE", status: "IN_PROGRESS", assignedToId: almacenista.id, startedAt: new Date(),
      },
    });
    const vale = async (renglones: Array<{ partId?: string; descripcion: string; cantidad: number }>) =>
      prisma.materialRequest.create({
        data: {
          organizationId: org.id, folio: `RM-${Math.random().toString(36).slice(2, 7)}`,
          warehouseId: almacen.id, workOrderId: ot.id, assetId: activo.id,
          solicitanteId: almacenista.id, motivo: motivoDeLaOrden("PREVENTIVE"),
          renglones: {
            create: renglones.map((r) => ({
              partId: r.partId ?? null, descripcion: r.descripcion, cantidadSolicitada: r.cantidad,
            })),
          },
        },
        include: { renglones: true },
      });

    // ───────────────────────────────── 1. Clasificación y trazabilidad ───
    console.log("\n1. La requisición nace bien clasificada y ligada");
    const v1 = await vale([{ partId: rodamiento.id, descripcion: "ROD-1 rodamiento", cantidad: 4 }]);
    revisar("el motivo sale del tipo de la orden, no del formulario",
      v1.motivo === "PREVENTIVO" && motivoDeLaOrden("CORRECTIVE") === "CORRECTIVO" && motivoDeLaOrden("SUPPORT") === "PROYECTO");
    revisar("queda ligada a OT, activo, solicitante, almacén y partidas",
      v1.workOrderId === ot.id && v1.assetId === activo.id && v1.solicitanteId === almacenista.id &&
      v1.warehouseId === almacen.id && v1.renglones[0].cantidadSolicitada === 4);

    // ───────────────────────────────── 2. Entrega con existencia ───
    console.log("\n2. Entrega con existencia suficiente");
    const surtida = await surtir({
      organizationId: org.id, requestId: v1.id, userId: almacenista.id, entregadoA: "Miguel",
      renglones: [{ lineId: v1.renglones[0].id, cantidad: 4 }],
    });
    const stock1 = await prisma.partStock.findFirstOrThrow({ where: { partId: rodamiento.id, warehouseId: almacen.id } });
    const ot1 = await prisma.workOrder.findUniqueOrThrow({ where: { id: ot.id } });
    const mov1 = await prisma.stockMovement.findFirst({ where: { materialRequestId: v1.id }, orderBy: { createdAt: "desc" } });
    revisar("la requisición queda surtida y el inventario baja de 10 a 6", surtida.estado === "SURTIDA" && stock1.quantity === 6);
    revisar("el kardex guarda quién, desde qué documento y a quién se entregó",
      mov1?.movementType === "OUT" && mov1.userId === almacenista.id && mov1.materialRequestId === v1.id &&
      mov1.workOrderId === ot.id && mov1.entregadoA === "Miguel" && mov1.balanceAfter === 6);
    revisar("el costo de la orden se actualiza con lo entregado (4 × $100)", ot1.partsCost === 400 && ot1.totalCost === 400, { partsCost: ot1.partsCost });

    // ───────────────────────────────── 3. Doble clic y reintento ───
    console.log("\n3. Doble clic, reintento y sobre-entrega");
    const v2 = await vale([{ partId: rodamiento.id, descripcion: "ROD-1 rodamiento", cantidad: 2 }]);
    const dobles = await Promise.allSettled([
      surtir({ organizationId: org.id, requestId: v2.id, userId: almacenista.id, entregadoA: "Miguel", renglones: [{ lineId: v2.renglones[0].id, cantidad: 2 }] }),
      surtir({ organizationId: org.id, requestId: v2.id, userId: almacenista.id, entregadoA: "Miguel", renglones: [{ lineId: v2.renglones[0].id, cantidad: 2 }] }),
    ]);
    const linea2 = await prisma.materialRequestLine.findUniqueOrThrow({ where: { id: v2.renglones[0].id } });
    const stock2 = await prisma.partStock.findFirstOrThrow({ where: { partId: rodamiento.id, warehouseId: almacen.id } });
    revisar("dos entregas simultáneas del mismo renglón: solo una descuenta",
      linea2.cantidadSurtida === 2 && stock2.quantity === 4 && dobles.filter((d) => d.status === "fulfilled").length === 1,
      { surtida: linea2.cantidadSurtida, existencia: stock2.quantity, resultados: dobles.map((d) => d.status) });
    await rechaza("no se puede surtir más de lo pedido",
      () => surtir({ organizationId: org.id, requestId: v2.id, userId: almacenista.id, entregadoA: "Miguel", renglones: [{ lineId: v2.renglones[0].id, cantidad: 1 }] }),
      "solo faltan 0");
    await rechaza("no se puede dejar el inventario en negativo",
      () => aplicarMovimiento({ organizationId: org.id, partId: rodamiento.id, warehouseId: almacen.id, tipo: "OUT", cantidad: 99, userId: jefe.id }),
      "No hay suficiente");

    // ───────────────────────────────── 4. Entrega parcial y faltante ───
    console.log("\n4. Entrega parcial por falta de existencia");
    const v3 = await vale([
      { partId: sello2.id, descripcion: "SEL-1 sello", cantidad: 3 },
      { descripcion: "Manguera especial sin catálogo", cantidad: 1 },
    ]);
    const parcial = await surtir({
      organizationId: org.id, requestId: v3.id, userId: almacenista.id, entregadoA: "Miguel",
      renglones: [{ lineId: v3.renglones[0].id, cantidad: 1 }],
    });
    const lineaSello = await prisma.materialRequestLine.findUniqueOrThrow({ where: { id: v3.renglones[0].id } });
    revisar("queda «surtida en parte» con solicitado 3, entregado 1, pendiente 2",
      parcial.estado === "PARCIAL" && lineaSello.cantidadSolicitada === 3 && lineaSello.cantidadSurtida === 1);
    await rechaza("lo que no está en el catálogo no se puede surtir del almacén",
      () => surtir({ organizationId: org.id, requestId: v3.id, userId: almacenista.id, entregadoA: "Miguel", renglones: [{ lineId: v3.renglones[1].id, cantidad: 1 }] }),
      "no esta en el catalogo");

    // ───────────────────────────────── 5. El faltante se vuelve compra ───
    console.log("\n5. El faltante se convierte en compra, sin duplicados");
    const compra = await crearRequisicionDeCompra({
      organizationId: org.id, userId: almacenista.id, warehouseId: almacen.id,
      materialRequestId: v3.id, urgencia: "ALTA", montoAutorizacion: 5000,
      renglones: [{
        partId: sello2.id, descripcion: "SEL-1 sello", cantidadSolicitada: 2, costoEstimado: 3000,
        materialRequestLineId: v3.renglones[0].id,
      }],
    });
    const compraD = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: compra.id }, include: { renglones: true } });
    revisar("la compra conserva la pista hacia el vale, el renglón, la OT y el activo",
      compraD.materialRequestId === v3.id && compraD.renglones[0].materialRequestLineId === v3.renglones[0].id &&
      (await prisma.materialRequest.findUniqueOrThrow({ where: { id: v3.id } })).workOrderId === ot.id);
    const cubierto = await cubiertoPorCompras(org.id, v3.id);
    revisar("el faltante ya cubierto se puede consultar por renglón", cubierto.get(v3.renglones[0].id)?.cantidad === 2);
    await rechaza("no se puede volver a comprar el mismo faltante",
      () => crearRequisicionDeCompra({
        organizationId: org.id, userId: almacenista.id, warehouseId: almacen.id, materialRequestId: v3.id,
        urgencia: "NORMAL", montoAutorizacion: 5000,
        renglones: [{ partId: sello2.id, descripcion: "SEL-1 sello", cantidadSolicitada: 2, costoEstimado: 3000, materialRequestLineId: v3.renglones[0].id }],
      }),
      "Ya hay una compra abierta");

    // ───────────────────────────────── 6. Autorización ───
    console.log("\n6. Autorización según monto y permisos");
    revisar("la compra de $6,000 con umbral $5,000 nace pendiente de firma", compraD.estado === "SOLICITADA");
    const chica = await crearRequisicionDeCompra({
      organizationId: org.id, userId: almacenista.id, warehouseId: almacen.id, urgencia: "NORMAL", montoAutorizacion: 5000,
      renglones: [{ partId: rodamiento.id, descripcion: "ROD-1", cantidadSolicitada: 1, costoEstimado: 100 }],
    });
    revisar("por debajo del umbral se autoriza sola y dice por qué",
      chica.estado === "AUTORIZADA" &&
      /debajo del umbral/.test((await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: chica.id } })).justificacion ?? ""));
    await rechaza("sin autorizar no se puede colocar la compra",
      () => enCompra({ organizationId: org.id, requestId: compra.id, ordenCompra: "OC-999" }),
      "Falta autorizar");
    revisar("los permisos: el técnico no autoriza compras, la administración sí",
      !can("TECHNICIAN", "purchase:authorize") && can("ADMIN", "purchase:authorize") &&
      can("TECHNICIAN", "purchase:receive") && !can("VIEWER", "requisition:create"));
    await autorizar({ organizationId: org.id, requestId: compra.id, userId: jefe.id, aprueba: true });
    await rechaza("no se autoriza dos veces",
      () => autorizar({ organizationId: org.id, requestId: compra.id, userId: jefe.id, aprueba: true }), "Ya esta");
    const rechazada = await crearRequisicionDeCompra({
      organizationId: org.id, userId: almacenista.id, warehouseId: almacen.id, urgencia: "NORMAL", montoAutorizacion: 5000,
      renglones: [{ partId: rodamiento.id, descripcion: "ROD-1", cantidadSolicitada: 10, costoEstimado: 900 }],
    });
    await rechaza("rechazar exige motivo",
      () => autorizar({ organizationId: org.id, requestId: rechazada.id, userId: jefe.id, aprueba: false }), "por que se rechaza");
    await autorizar({ organizationId: org.id, requestId: rechazada.id, userId: jefe.id, aprueba: false, motivo: "Se consigue en planta" });
    await rechaza("no se recibe contra una compra rechazada",
      () => recibir({
        organizationId: org.id, userId: jefe.id, purchaseRequestId: rechazada.id, warehouseId: almacen.id,
        renglones: [{ partId: rodamiento.id, cantidad: 1, costoUnitario: 900, conforme: true }],
      }),
      "rechazada");

    // ───────────────────────────────── 7. Recepción parcial y total ───
    console.log("\n7. Recepción parcial, luego completa");
    await enCompra({ organizationId: org.id, requestId: compra.id, ordenCompra: "OC-100" });
    const lineaCompra = compraD.renglones[0];
    await recibir({
      organizationId: org.id, userId: jefe.id, purchaseRequestId: compra.id, warehouseId: almacen.id,
      supplierId: proveedor.id, remision: "R-1", clave: `${sello}-r1`,
      renglones: [{ requestLineId: lineaCompra.id, partId: sello2.id, cantidad: 1, costoUnitario: 3000, conforme: true }],
    });
    const trasParcial = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: compra.id }, include: { renglones: true } });
    const stockSello = await prisma.partStock.findFirstOrThrow({ where: { partId: sello2.id, warehouseId: almacen.id } });
    revisar("recepción parcial: la compra queda «recibida en parte» y el inventario sube solo lo recibido",
      trasParcial.estado === "RECIBIDA_PARCIAL" && trasParcial.renglones[0].cantidadRecibida === 1 && stockSello.quantity === 1,
      { estado: trasParcial.estado, existencia: stockSello.quantity });
    const movIn = await prisma.stockMovement.findFirst({ where: { partId: sello2.id, movementType: "IN" }, orderBy: { createdAt: "desc" } });
    revisar("el kardex registra la entrada con su referencia de recepción", movIn?.quantity === 1 && /Recepcion/.test(movIn.reference ?? ""));
    const repetida = await recibir({
      organizationId: org.id, userId: jefe.id, purchaseRequestId: compra.id, warehouseId: almacen.id,
      supplierId: proveedor.id, remision: "R-1", clave: `${sello}-r1`,
      renglones: [{ requestLineId: lineaCompra.id, partId: sello2.id, cantidad: 1, costoUnitario: 3000, conforme: true }],
    });
    const stockTrasRepetir = await prisma.partStock.findFirstOrThrow({ where: { partId: sello2.id, warehouseId: almacen.id } });
    revisar("el mismo recibo enviado dos veces no entra material dos veces",
      stockTrasRepetir.quantity === 1 && (await prisma.goodsReceipt.count({ where: { organizationId: org.id } })) === 1,
      { existencia: stockTrasRepetir.quantity, folio: repetida.folio });
    // Dos recibos identicos a la vez: el segundo no entra material ni revienta.
    const aLaVez = await Promise.allSettled([
      recibir({ organizationId: org.id, userId: jefe.id, purchaseRequestId: compra.id, warehouseId: almacen.id, clave: `${sello}-r-carrera`, renglones: [{ requestLineId: lineaCompra.id, partId: sello2.id, cantidad: 1, costoUnitario: 3000, conforme: true }] }),
      recibir({ organizationId: org.id, userId: jefe.id, purchaseRequestId: compra.id, warehouseId: almacen.id, clave: `${sello}-r-carrera`, renglones: [{ requestLineId: lineaCompra.id, partId: sello2.id, cantidad: 1, costoUnitario: 3000, conforme: true }] }),
    ]);
    const stockCarrera = await prisma.partStock.findFirstOrThrow({ where: { partId: sello2.id, warehouseId: almacen.id } });
    revisar("dos recibos idénticos simultáneos: uno entra, el otro devuelve el mismo folio sin error",
      aLaVez.every((x) => x.status === "fulfilled") &&
      new Set(aLaVez.map((x) => (x as PromiseFulfilledResult<{ folio: string }>).value.folio)).size === 1 &&
      stockCarrera.quantity === 2,
      { resultados: aLaVez.map((x) => x.status), existencia: stockCarrera.quantity });

    await rechaza("no se puede recibir más de lo pedido",
      () => recibir({
        organizationId: org.id, userId: jefe.id, purchaseRequestId: compra.id, warehouseId: almacen.id,
        clave: `${sello}-r-exceso`,
        renglones: [{ requestLineId: lineaCompra.id, partId: sello2.id, cantidad: 5, costoUnitario: 3000, conforme: true }],
      }),
      "faltan 0 por recibir");
    const completa = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: compra.id } });
    const stockFinal = await prisma.partStock.findFirstOrThrow({ where: { partId: sello2.id, warehouseId: almacen.id } });
    const costoSello = await prisma.part.findUniqueOrThrow({ where: { id: sello2.id } });
    revisar("al completarse: compra «recibida», existencia 2 y costo promedio actualizado",
      completa.estado === "RECIBIDA" && stockFinal.quantity === 2 && costoSello.unitCost > 50,
      { estado: completa.estado, existencia: stockFinal.quantity, costo: costoSello.unitCost });

    // ───────────────────────────────── 8. Devolución ───
    console.log("\n8. Devolución de lo que no se usó");
    const antesDev = await prisma.workOrder.findUniqueOrThrow({ where: { id: ot.id } });
    await devolver({
      organizationId: org.id, requestId: v1.id, userId: almacenista.id, devuelvePor: "Miguel",
      renglones: [{ lineId: v1.renglones[0].id, cantidad: 1 }],
    });
    const trasDev = await prisma.workOrder.findUniqueOrThrow({ where: { id: ot.id } });
    const stockDev = await prisma.partStock.findFirstOrThrow({ where: { partId: rodamiento.id, warehouseId: almacen.id } });
    const cargos = await prisma.workOrderPart.findMany({ where: { workOrderId: ot.id, partId: rodamiento.id } });
    const movDev = await prisma.stockMovement.findFirst({ where: { movementType: "RETURN" }, orderBy: { createdAt: "desc" } });
    revisar("lo devuelto regresa al almacén con su movimiento, sin borrar la salida",
      stockDev.quantity === 5 && movDev?.quantity === 1 && movDev.materialRequestId === v1.id &&
      (await prisma.stockMovement.count({ where: { materialRequestId: v1.id, movementType: "OUT" } })) === 1);
    revisar("el cargo original se conserva y el costo de la orden baja lo devuelto",
      cargos[0].quantity === 4 && cargos[0].devuelto === 1 && trasDev.partsCost === antesDev.partsCost - 100,
      { cantidad: cargos[0].quantity, devuelto: cargos[0].devuelto, antes: antesDev.partsCost, ahora: trasDev.partsCost });
    await rechaza("no se puede devolver más de lo que se tiene",
      () => devolver({ organizationId: org.id, requestId: v1.id, userId: almacenista.id, devuelvePor: "Miguel", renglones: [{ lineId: v1.renglones[0].id, cantidad: 9 }] }),
      "solo hay 3");

    // ───────────────────────────────── 9. Ajustes y costo pendiente ───
    console.log("\n9. Ajustes y refacciones sin costo");
    const antesAjuste = await prisma.stockMovement.count({ where: { partId: rodamiento.id } });
    await aplicarMovimiento({
      organizationId: org.id, partId: rodamiento.id, warehouseId: almacen.id, tipo: "ADJUST",
      cantidad: 4, userId: jefe.id, referencia: "Conteo físico: faltó una pieza",
    });
    const movs = await prisma.stockMovement.count({ where: { partId: rodamiento.id } });
    const ajustado = await prisma.partStock.findFirstOrThrow({ where: { partId: rodamiento.id, warehouseId: almacen.id } });
    revisar("un ajuste agrega movimiento con su motivo y no borra los anteriores",
      movs === antesAjuste + 1 && ajustado.quantity === 4);
    const vSinCosto = await vale([{ partId: sinCosto.id, descripcion: "EMP-1 empaque", cantidad: 1 }]);
    await surtir({ organizationId: org.id, requestId: vSinCosto.id, userId: almacenista.id, entregadoA: "Miguel", renglones: [{ lineId: vSinCosto.renglones[0].id, cantidad: 1 }] });
    const cargoSinCosto = await prisma.workOrderPart.findFirstOrThrow({ where: { workOrderId: ot.id, partId: sinCosto.id } });
    revisar("una refacción sin costo se entrega, pero su cargo queda en cero (dato pendiente, visible en la requisición)",
      cargoSinCosto.cost === 0 && sinCosto.unitCost === 0);

    // ───────────────────────────────── 10. Aislamiento ───
    console.log("\n10. Aislamiento entre organizaciones");
    const almacenB = await prisma.warehouse.create({ data: { organizationId: orgB.id, code: "GEN", name: "General B", esGeneral: true } });
    await rechaza("otra empresa no puede mover la refacción ajena",
      () => aplicarMovimiento({ organizationId: orgB.id, partId: rodamiento.id, warehouseId: almacenB.id, tipo: "OUT", cantidad: 1 }),
      "Refacción no encontrada");
    await rechaza("ni surtir un vale ajeno",
      () => surtir({ organizationId: orgB.id, requestId: v1.id, userId: almacenista.id, entregadoA: "X", renglones: [{ lineId: v1.renglones[0].id, cantidad: 1 }] }),
      "no encontrada");
    await rechaza("ni recibir contra una compra ajena",
      () => recibir({ organizationId: orgB.id, userId: jefe.id, purchaseRequestId: compra.id, warehouseId: almacenB.id, renglones: [{ partId: rodamiento.id, cantidad: 1, costoUnitario: 1, conforme: true }] }),
      "no encontrada");
    revisar("el almacén de la otra empresa sigue vacío",
      (await prisma.partStock.count({ where: { warehouseId: almacenB.id } })) === 0 &&
      (await prisma.goodsReceipt.count({ where: { organizationId: orgB.id } })) === 0);

    // ───────────────────────────────── Cuadre final ───
    console.log("\n11. El kardex cuadra con la existencia");
    for (const p of [rodamiento, sello2, sinCosto]) {
      const movimientos = await prisma.stockMovement.findMany({ where: { partId: p.id }, orderBy: { createdAt: "asc" } });
      const ultimo = movimientos.at(-1);
      const stock = await prisma.partStock.findFirstOrThrow({ where: { partId: p.id, warehouseId: almacen.id } });
      const total = await prisma.part.findUniqueOrThrow({ where: { id: p.id } });
      revisar(`${p.code}: el último saldo del kardex, la existencia y el total de la refacción coinciden`,
        ultimo?.balanceAfter === stock.quantity && total.quantityOnHand === stock.quantity,
        { kardex: ultimo?.balanceAfter, existencia: stock.quantity, total: total.quantityOnHand });
    }
  } finally {
    for (const id of [org.id, orgB.id]) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
  }

  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  if (fallos) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
