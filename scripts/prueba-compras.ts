/**
 * Prueba del circuito de compra: solicitar -> autorizar -> colocar -> recibir.
 * Verifica lo que cuesta caro: que lo recibido entre al almacen con su costo,
 * que el estado siga a lo recibido, y que rechazar deje motivo.
 */
import { PrismaClient } from "@prisma/client";
import { ErrorDeCompra, autorizar, costosVigentes, crearRequisicionDeCompra, elegirCotizacion, enCompra, recibir, registrarCotizacion, requiereAutorizacion } from "../lib/compras";
import { quienAutorizo } from "../lib/estados-compra";

const prisma = new PrismaClient();
let fallas = 0;
function revisar(e: string, real: unknown, esp: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esp);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(52)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esp)})`}`);
}
async function intentar(fn: () => Promise<unknown>) {
  try { await fn(); return "paso"; } catch (e) { return e instanceof ErrorDeCompra ? "rechazado" : `error: ${(e as Error).message}`; }
}

async function main() {
  const org = await prisma.organization.create({ data: { name: "Prueba RC", slug: `rc-${Date.now()}`, montoAutorizacion: 5000 } });
  const alm = await prisma.warehouse.create({ data: { organizationId: org.id, code: "GEN", name: "General", esGeneral: true } });
  const pide = await prisma.user.create({ data: { organizationId: org.id, email: `p${Date.now()}@x.com`, name: "Almacenista", passwordHash: "x", role: "TECHNICIAN" } });
  const firma = await prisma.user.create({ data: { organizationId: org.id, email: `f${Date.now()}@x.com`, name: "Gerente", passwordHash: "x", role: "ADMIN" } });
  const part = await prisma.part.create({ data: { organizationId: org.id, code: "BAL", name: "Balero", unit: "pza", unitCost: 200 } });
  await prisma.partStock.create({ data: { organizationId: org.id, partId: part.id, warehouseId: alm.id, quantity: 2 } });
  await prisma.part.update({ where: { id: part.id }, data: { quantityOnHand: 2 } });

  const saldo = async () => (await prisma.partStock.findFirst({ where: { partId: part.id }, select: { quantity: true } }))!.quantity;

  console.log("\nUMBRAL\n");
  revisar("2,000 con umbral 5,000 no requiere firma", requiereAutorizacion(2000, 5000), false);
  revisar("8,000 con umbral 5,000 si requiere firma", requiereAutorizacion(8000, 5000), true);

  console.log("\nSOLICITUD\n");
  const rc = await crearRequisicionDeCompra({
    organizationId: org.id, userId: pide.id, warehouseId: alm.id, urgencia: "PARO",
    renglones: [{ partId: part.id, descripcion: "Balero 6205", cantidadSolicitada: 10, costoEstimado: 250 }],
  });
  revisar("monto estimado calculado", rc.montoEstimado, 2500);
  revisar("avisó a quien compra", await prisma.notification.count({ where: { organizationId: org.id } }), 1);
  revisar("el aviso es critico por el paro",
    (await prisma.notification.findFirst({ where: { organizationId: org.id }, select: { kind: true } }))!.kind, "CRITICAL");

  console.log("\nAUTORIZACION\n");
  const rechazada = await crearRequisicionDeCompra({
    organizationId: org.id, userId: pide.id, warehouseId: alm.id, urgencia: "NORMAL",
    renglones: [{ partId: part.id, descripcion: "De prueba", cantidadSolicitada: 1, costoEstimado: 10 }],
  });
  revisar("rechazar sin motivo se rechaza",
    await intentar(() => autorizar({ organizationId: org.id, requestId: rechazada.id, userId: firma.id, aprueba: false, motivo: "" })),
    "rechazado");
  await autorizar({ organizationId: org.id, requestId: rechazada.id, userId: firma.id, aprueba: false, motivo: "Ya hay en el otro almacen" });
  const r2 = await prisma.purchaseRequest.findUnique({ where: { id: rechazada.id }, select: { estado: true, motivoRechazo: true } });
  revisar("queda rechazada con motivo", `${r2!.estado}:${r2!.motivoRechazo}`, "RECHAZADA:Ya hay en el otro almacen");
  revisar("autorizar dos veces se rechaza",
    await intentar(() => autorizar({ organizationId: org.id, requestId: rechazada.id, userId: firma.id, aprueba: true })),
    "rechazado");

  await autorizar({ organizationId: org.id, requestId: rc.id, userId: firma.id, aprueba: true });
  revisar("la principal queda autorizada",
    (await prisma.purchaseRequest.findUnique({ where: { id: rc.id }, select: { estado: true } }))!.estado, "AUTORIZADA");
  // Quien pidio recibe aviso de las dos: la que le rechazaron y la que le
  // autorizaron. Se verifica el tono y que el rechazo traiga el motivo, que es
  // lo que evita tener que ir a preguntar por que.
  const avisos = await prisma.notification.findMany({
    where: { userId: pide.id }, orderBy: { createdAt: "asc" },
    select: { kind: true, body: true },
  });
  revisar("se aviso a quien pidio, con su tono", avisos.map((a) => a.kind).join(","), "WARNING,SUCCESS");
  revisar("el rechazo lleva el motivo", avisos[0].body, "Ya hay en el otro almacen");

  console.log("\nCOMPRA EXTERNA\n");
  revisar("colocar sin folio se rechaza",
    await intentar(() => enCompra({ organizationId: org.id, requestId: rc.id, ordenCompra: "  " })), "rechazado");
  await enCompra({ organizationId: org.id, requestId: rc.id, ordenCompra: "OC-SAP-99231" });
  revisar("queda en compra con la orden externa",
    (await prisma.purchaseRequest.findUnique({ where: { id: rc.id }, select: { estado: true, ordenCompra: true } }))!.ordenCompra,
    "OC-SAP-99231");

  console.log("\nRECEPCION\n");
  const linea = (await prisma.purchaseRequestLine.findFirst({ where: { requestId: rc.id } }))!;
  await recibir({
    organizationId: org.id, userId: firma.id, purchaseRequestId: rc.id, warehouseId: alm.id,
    remision: "R-4471",
    renglones: [{ requestLineId: linea.id, partId: part.id, cantidad: 6, costoUnitario: 260, conforme: true }],
  });
  revisar("el almacen subio de 2 a 8", await saldo(), 8);
  revisar("estado tras recepcion parcial",
    (await prisma.purchaseRequest.findUnique({ where: { id: rc.id }, select: { estado: true } }))!.estado, "RECIBIDA_PARCIAL");
  // 2 a 200 mas 6 a 260 = (400 + 1560) / 8 = 245
  revisar("costo promedio ponderado tras recibir",
    (await prisma.part.findUnique({ where: { id: part.id }, select: { unitCost: true } }))!.unitCost, 245);

  // Lo parcial NO avisa «ya llego»: seria mentira, todavia falta material. Lo
  // que falta ya tiene su propio aviso, ese para compras y almacen.
  revisar("con recepcion parcial todavia no se avisa que llego",
    await prisma.notification.count({ where: { organizationId: org.id, tipo: "COMPRA_RECIBIDA" } }), 0);

  await recibir({
    organizationId: org.id, userId: firma.id, purchaseRequestId: rc.id, warehouseId: alm.id,
    remision: "R-4488",
    renglones: [{ requestLineId: linea.id, partId: part.id, cantidad: 4, costoUnitario: 260, conforme: false, observacion: "Empaque golpeado" }],
  });
  revisar("estado tras completar", (await prisma.purchaseRequest.findUnique({ where: { id: rc.id }, select: { estado: true } }))!.estado, "RECIBIDA");

  // El hueco que se tapo: quien pidio se enteraba de que le autorizaron la
  // compra y nunca de que el material ya estaba en el almacen.
  const llego = await prisma.notification.findMany({
    where: { organizationId: org.id, tipo: "COMPRA_RECIBIDA" },
    select: { userId: true, title: true, kind: true },
  });
  revisar("al completar se avisa que ya llego", llego.length, 1);
  revisar("le llega a quien la pidio", llego[0]?.userId, pide.id);
  revisar("el aviso nombra el folio de la compra", llego[0]?.title.includes(rc.folio), true);

  revisar("el almacen quedo en 12", await saldo(), 12);
  revisar("lo no conforme se recibio y quedo senalado",
    await prisma.goodsReceiptLine.count({ where: { conforme: false, receipt: { organizationId: org.id } } }), 1);
  revisar("dos recepciones con su remision",
    (await prisma.goodsReceipt.findMany({ where: { organizationId: org.id }, select: { remision: true }, orderBy: { folio: "asc" } })).map((r) => r.remision).join(","),
    "R-4471,R-4488");
  revisar("las entradas quedaron en el kardex",
    await prisma.stockMovement.count({ where: { organizationId: org.id, movementType: "IN" } }), 2);
  // ── La otra mitad: la orden que estaba esperando la pieza ──────────────
  //
  // Quien pide la refaccion y quien tiene la orden detenida casi nunca son la
  // misma persona. Si el aviso solo llegara al solicitante, el tecnico seguiria
  // sin saber que ya puede trabajar.
  console.log("\nLA ORDEN QUE ESPERABA\n");
  const tec = await prisma.user.create({ data: { organizationId: org.id, email: `t${Date.now()}@x.com`, name: "Tecnico", passwordHash: "x", role: "TECHNICIAN" } });
  const ot = await prisma.workOrder.create({
    data: { organizationId: org.id, number: `OT-${Date.now()}`, title: "Cambiar balero", status: "ON_HOLD", assignedToId: tec.id },
  });
  const mr = await prisma.materialRequest.create({
    data: { organizationId: org.id, folio: `RM-${Date.now()}`, warehouseId: alm.id, workOrderId: ot.id, solicitanteId: tec.id },
  });
  const rc2 = await crearRequisicionDeCompra({
    organizationId: org.id, userId: pide.id, warehouseId: alm.id, urgencia: "NORMAL", materialRequestId: mr.id,
    renglones: [{ partId: part.id, descripcion: "Balero 6205", cantidadSolicitada: 2, costoEstimado: 100 }],
  });
  const linea2 = (await prisma.purchaseRequestLine.findFirst({ where: { requestId: rc2.id } }))!;
  await recibir({
    organizationId: org.id, userId: firma.id, purchaseRequestId: rc2.id, warehouseId: alm.id,
    renglones: [{ requestLineId: linea2.id, partId: part.id, cantidad: 2, costoUnitario: 100, conforme: true }],
  });
  const aviso2 = await prisma.notification.findMany({
    where: { organizationId: org.id, tipo: "COMPRA_RECIBIDA", entidadId: rc2.id },
    select: { userId: true, body: true },
  });
  revisar("tambien se entera el responsable de la orden",
    aviso2.some((a) => a.userId === tec.id), true);
  revisar("y el aviso le dice cual orden puede seguir",
    aviso2.some((a) => a.body?.includes(ot.number) === true), true);

  /*
   * Lo que la pantalla muestra tiene que sumar lo que la pantalla dice.
   *
   * Al elegir cotizacion, el monto de la requisicion pasa a ser el cotizado,
   * pero el costo de cada renglon se queda como se pidio. La tabla sumaba los
   * estimados mientras el encabezado mostraba el cotizado: $3,720 contra
   * $3,640 en la misma pantalla. Compilaba, guardaba bien y las dos cifras
   * eran correctas por separado; solo se vio abriendo la pantalla.
   */
  console.log("\nQUE CIFRA VALE HOY\n");

  const sinCotizar = costosVigentes(
    [{ id: "a", costoEstimado: 100 }, { id: "b", costoEstimado: 50 }],
    [],
  );
  revisar("sin cotizacion la cifra es la estimada", sinCotizar.base, "estimado");
  revisar("y cada renglon conserva su estimado",
    [sinCotizar.porRenglon.get("a")!.costo, sinCotizar.porRenglon.get("b")!.costo], [100, 50]);

  const cotizado = costosVigentes(
    [{ id: "a", costoEstimado: 100 }, { id: "b", costoEstimado: 50 }],
    [{ seleccionada: false, renglones: [{ requestLineId: "a", costoUnitario: 999, disponible: true }] },
     { seleccionada: true, renglones: [
       { requestLineId: "a", costoUnitario: 90, disponible: true },
       { requestLineId: "b", costoUnitario: 45, disponible: true },
     ] }],
  );
  revisar("con cotizacion elegida la cifra es la cotizada", cotizado.base, "cotizado");
  revisar("manda la elegida, no la primera ni la mas barata",
    [cotizado.porRenglon.get("a")!.costo, cotizado.porRenglon.get("b")!.costo], [90, 45]);

  // El total de una cotizacion solo suma lo que el proveedor SI surte, asi que
  // un renglon que no tiene no puede entrar a la suma de la pantalla.
  const parcial = costosVigentes(
    [{ id: "a", costoEstimado: 100 }, { id: "b", costoEstimado: 50 }, { id: "c", costoEstimado: 30 }],
    [{ seleccionada: true, renglones: [
      { requestLineId: "a", costoUnitario: 90, disponible: true },
      { requestLineId: "b", costoUnitario: 45, disponible: false },
    ] }],
  );
  revisar("lo que el proveedor no surte queda marcado fuera", parcial.porRenglon.get("b")!.fuera, true);
  revisar("y el renglon que la cotizacion ni menciona, tambien", parcial.porRenglon.get("c")!.fuera, true);
  revisar("lo que si surte no queda fuera", parcial.porRenglon.get("a")!.fuera, false);

  // La comprobacion que importa: la suma de la tabla contra el total guardado.
  const rcCot = await crearRequisicionDeCompra({
    organizationId: org.id, userId: pide.id, warehouseId: alm.id, urgencia: "NORMAL", montoAutorizacion: 100_000,
    renglones: [
      { partId: part.id, descripcion: "Balero 6205", cantidadSolicitada: 10, costoEstimado: 120 },
      { partId: part.id, descripcion: "Grasa", cantidadSolicitada: 12, costoEstimado: 210 },
    ],
  });
  const lineasCot = await prisma.purchaseRequestLine.findMany({ where: { requestId: rcCot.id }, orderBy: { descripcion: "asc" } });
  const prov = await prisma.supplier.create({ data: { organizationId: org.id, name: "Proveedor de prueba" } });
  const cotiz = await registrarCotizacion({
    organizationId: org.id, purchaseRequestId: rcCot.id, supplierId: prov.id, userId: firma.id,
    renglones: lineasCot.map((l) => ({
      requestLineId: l.id, partId: l.partId, descripcion: l.descripcion,
      cantidad: l.cantidadSolicitada, costoUnitario: l.descripcion === "Grasa" ? 205 : 118, disponible: true,
    })),
  });
  await elegirCotizacion({ organizationId: org.id, purchaseRequestId: rcCot.id, quoteId: cotiz.id });

  const guardada = await prisma.purchaseRequest.findUniqueOrThrow({
    where: { id: rcCot.id },
    select: { montoEstimado: true, justificacion: true, estado: true, autorizadaPorId: true, autorizadaEl: true,
      renglones: { select: { id: true, cantidadSolicitada: true, costoEstimado: true } },
      cotizaciones: { select: { seleccionada: true, renglones: { select: { requestLineId: true, costoUnitario: true, disponible: true } } } } },
  });
  const vig = costosVigentes(guardada.renglones, guardada.cotizaciones);
  const sumaDeLaTabla = guardada.renglones.reduce((t, r) => {
    const v = vig.porRenglon.get(r.id)!;
    return v.fuera ? t : t + r.cantidadSolicitada * v.costo;
  }, 0);
  revisar("la suma de la tabla da el total de la compra", sumaDeLaTabla, guardada.montoEstimado);
  revisar("y NO da la suma de los estimados viejos",
    sumaDeLaTabla === guardada.renglones.reduce((t, r) => t + r.cantidadSolicitada * r.costoEstimado, 0), false);

  console.log("\nLA RAZON NO SE PEGA A LA JUSTIFICACION\n");
  const bajoUmbral = await crearRequisicionDeCompra({
    organizationId: org.id, userId: pide.id, warehouseId: alm.id, urgencia: "NORMAL", montoAutorizacion: 5000,
    justificacion: "Se acabó en el almacén",
    renglones: [{ partId: part.id, descripcion: "Balero", cantidadSolicitada: 1, costoEstimado: 100 }],
  });
  const nacida = await prisma.purchaseRequest.findUniqueOrThrow({
    where: { id: bajoUmbral.id }, select: { estado: true, justificacion: true, autorizadaPorId: true, autorizadaEl: true },
  });
  revisar("debajo del umbral nace autorizada", nacida.estado, "AUTORIZADA");
  revisar("la justificacion es solo la del usuario", nacida.justificacion, "Se acabó en el almacén");
  revisar("sin firmante, porque no la firmo nadie", nacida.autorizadaPorId, null);
  revisar("y aun asi se sabe que se autorizo sola",
    quienAutorizo(null, nacida.autorizadaEl), "Autorización automática");

  await prisma.$transaction([
    prisma.quoteLine.deleteMany({ where: { quote: { organizationId: org.id } } }),
    prisma.quote.deleteMany({ where: { organizationId: org.id } }),
    prisma.supplier.deleteMany({ where: { organizationId: org.id } }),
  ]);

  await prisma.$transaction([
    prisma.stockMovement.deleteMany({ where: { organizationId: org.id } }),
    prisma.goodsReceiptLine.deleteMany({ where: { receipt: { organizationId: org.id } } }),
    prisma.goodsReceipt.deleteMany({ where: { organizationId: org.id } }),
    prisma.purchaseRequestLine.deleteMany({ where: { request: { organizationId: org.id } } }),
    prisma.purchaseRequest.deleteMany({ where: { organizationId: org.id } }),
    prisma.notification.deleteMany({ where: { organizationId: org.id } }),
    prisma.materialRequest.deleteMany({ where: { organizationId: org.id } }),
    prisma.workOrder.deleteMany({ where: { organizationId: org.id } }),
    prisma.partStock.deleteMany({ where: { organizationId: org.id } }),
    prisma.part.deleteMany({ where: { organizationId: org.id } }),
    prisma.warehouse.deleteMany({ where: { organizationId: org.id } }),
    prisma.user.deleteMany({ where: { organizationId: org.id } }),
    prisma.organization.delete({ where: { id: org.id } }),
  ]);
  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("\nERROR:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
