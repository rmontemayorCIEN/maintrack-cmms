/**
 * Prueba del comparativo: cotizar, elegir y emitir la orden.
 * Lo que importa: que el total ignore lo que el proveedor no surte, que
 * elegir la cara sin motivo se rechace, y que la orden herede lo cotizado.
 */
import { PrismaClient } from "@prisma/client";
import { ErrorDeCompra, autorizar, crearRequisicionDeCompra, elegirCotizacion, emitirOrdenDeCompra, registrarCotizacion } from "../lib/compras";

const prisma = new PrismaClient();
let fallas = 0;
function revisar(e: string, real: unknown, esp: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esp);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(54)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esp)})`}`);
}
async function intentar(fn: () => Promise<unknown>) {
  try { await fn(); return "paso"; } catch (e) { return e instanceof ErrorDeCompra ? "rechazado" : `error: ${(e as Error).message}`; }
}

async function main() {
  const org = await prisma.organization.create({ data: { name: "Prueba OC", slug: `oc-${Date.now()}`, comprasInternas: true } });
  const alm = await prisma.warehouse.create({ data: { organizationId: org.id, code: "GEN", name: "General", esGeneral: true } });
  const pide = await prisma.user.create({ data: { organizationId: org.id, email: `a${Date.now()}@x.com`, name: "Compras", passwordHash: "x", role: "COMPRAS" } });
  const firma = await prisma.user.create({ data: { organizationId: org.id, email: `b${Date.now()}@x.com`, name: "Gerente", passwordHash: "x", role: "ADMIN" } });
  const part = await prisma.part.create({ data: { organizationId: org.id, code: "BAL", name: "Balero", unit: "pza", unitCost: 200 } });
  const [p1, p2, p3] = await Promise.all([
    prisma.supplier.create({ data: { organizationId: org.id, name: "Rodamientos del Norte", leadTimeDays: 3 } }),
    prisma.supplier.create({ data: { organizationId: org.id, name: "Baleros Express", leadTimeDays: 15 } }),
    prisma.supplier.create({ data: { organizationId: org.id, name: "Refa Total", leadTimeDays: 7 } }),
  ]);

  const rc = await crearRequisicionDeCompra({
    organizationId: org.id, userId: pide.id, warehouseId: alm.id, urgencia: "ALTA",
    renglones: [
      { partId: part.id, descripcion: "Balero 6205", cantidadSolicitada: 10, costoEstimado: 250 },
      { partId: null, descripcion: "Reten especial", cantidadSolicitada: 2, costoEstimado: 400 },
    ],
  });
  const lineas = await prisma.purchaseRequestLine.findMany({ where: { requestId: rc.id }, orderBy: { descripcion: "asc" } });

  console.log("\nCOTIZACIONES\n");

  // El barato que no tiene todo: solo se le cobra lo que si surte.
  const q1 = await registrarCotizacion({
    organizationId: org.id, purchaseRequestId: rc.id, supplierId: p1.id, userId: pide.id,
    diasEntrega: 3, condicionesPago: "Contado", garantia: "6 meses",
    renglones: [
      { requestLineId: lineas[0].id, partId: part.id, descripcion: "Balero 6205", marca: "SKF", cantidad: 10, costoUnitario: 240, disponible: true },
      { requestLineId: lineas[1].id, descripcion: "Reten especial", cantidad: 2, costoUnitario: 0, disponible: false },
    ],
  });
  revisar("el total ignora lo que no surte", q1.total, 2400);

  const q2 = await registrarCotizacion({
    organizationId: org.id, purchaseRequestId: rc.id, supplierId: p2.id, userId: pide.id,
    diasEntrega: 15, condicionesPago: "30 dias",
    renglones: [
      { requestLineId: lineas[0].id, partId: part.id, descripcion: "Balero 6205", marca: "Generico", cantidad: 10, costoUnitario: 200, disponible: true },
      { requestLineId: lineas[1].id, descripcion: "Reten especial", cantidad: 2, costoUnitario: 350, disponible: true },
    ],
  });
  revisar("la mas barata suma completa", q2.total, 2700);

  const q3 = await registrarCotizacion({
    organizationId: org.id, purchaseRequestId: rc.id, supplierId: p3.id, userId: pide.id,
    diasEntrega: 7, condicionesPago: "Contado", garantia: "12 meses",
    renglones: [
      { requestLineId: lineas[0].id, partId: part.id, descripcion: "Balero 6205", marca: "SKF", cantidad: 10, costoUnitario: 250, disponible: true },
      { requestLineId: lineas[1].id, descripcion: "Reten especial", cantidad: 2, costoUnitario: 380, disponible: true },
    ],
  });
  revisar("tres cotizaciones capturadas",
    await prisma.quote.count({ where: { purchaseRequestId: rc.id } }), 3);

  console.log("\nCOMPARATIVO\n");
  // q1 = 2400 es la mas barata, pero no surte todo.
  revisar("elegir la cara sin motivo se rechaza",
    await intentar(() => elegirCotizacion({ organizationId: org.id, purchaseRequestId: rc.id, quoteId: q3.id })),
    "rechazado");

  const eleccion = await elegirCotizacion({
    organizationId: org.id, purchaseRequestId: rc.id, quoteId: q3.id,
    motivo: "Unica con 12 meses de garantia y surte los dos renglones",
  });
  revisar("se eligio la de mejor garantia", eleccion.total, 3260);
  revisar("y se marca que no era la mas barata", eleccion.eraLaMasBarata, false);
  revisar("el monto de la requisicion pasa a lo cotizado",
    (await prisma.purchaseRequest.findUnique({ where: { id: rc.id }, select: { montoEstimado: true } }))!.montoEstimado, 3260);
  revisar("solo una queda seleccionada",
    await prisma.quote.count({ where: { purchaseRequestId: rc.id, seleccionada: true } }), 1);

  // Elegir la mas barata no necesita explicacion.
  const sinMotivo = await elegirCotizacion({ organizationId: org.id, purchaseRequestId: rc.id, quoteId: q1.id });
  revisar("la mas barata no pide motivo", sinMotivo.eraLaMasBarata, true);
  await elegirCotizacion({ organizationId: org.id, purchaseRequestId: rc.id, quoteId: q3.id, motivo: "Garantia y disponibilidad" });

  console.log("\nORDEN DE COMPRA\n");
  revisar("emitir sin autorizar se rechaza",
    await intentar(() => emitirOrdenDeCompra({ organizationId: org.id, purchaseRequestId: rc.id, userId: pide.id })),
    "rechazado");

  await autorizar({ organizationId: org.id, requestId: rc.id, userId: firma.id, aprueba: true });
  const oc = await emitirOrdenDeCompra({ organizationId: org.id, purchaseRequestId: rc.id, userId: pide.id });
  revisar("la orden hereda el total cotizado", oc.total, 3260);
  revisar("el folio es de la serie OC", oc.folio.slice(0, 3), "OC-");

  const tras = await prisma.purchaseRequest.findUnique({ where: { id: rc.id }, select: { estado: true, ordenCompra: true } });
  revisar("la requisicion queda en compra", tras!.estado, "EN_COMPRA");
  revisar("con el folio de la orden", tras!.ordenCompra, oc.folio);

  const orden = await prisma.purchaseOrder.findUnique({ where: { id: oc.id }, select: { supplierId: true, condicionesPago: true, fechaPrometida: true } });
  revisar("la orden va al proveedor ganador", orden!.supplierId, p3.id);
  revisar("hereda condiciones de pago", orden!.condicionesPago, "Contado");
  revisar("calcula fecha prometida por dias de entrega", orden!.fechaPrometida !== null, true);

  revisar("emitir dos veces se rechaza",
    await intentar(() => emitirOrdenDeCompra({ organizationId: org.id, purchaseRequestId: rc.id, userId: pide.id })),
    "rechazado");

  await prisma.$transaction([
    prisma.purchaseOrder.deleteMany({ where: { organizationId: org.id } }),
    prisma.quoteLine.deleteMany({ where: { quote: { organizationId: org.id } } }),
    prisma.quote.deleteMany({ where: { organizationId: org.id } }),
    prisma.purchaseRequestLine.deleteMany({ where: { request: { organizationId: org.id } } }),
    prisma.purchaseRequest.deleteMany({ where: { organizationId: org.id } }),
    prisma.notification.deleteMany({ where: { organizationId: org.id } }),
    prisma.part.deleteMany({ where: { organizationId: org.id } }),
    prisma.supplier.deleteMany({ where: { organizationId: org.id } }),
    prisma.warehouse.deleteMany({ where: { organizationId: org.id } }),
    prisma.user.deleteMany({ where: { organizationId: org.id } }),
    prisma.organization.delete({ where: { id: org.id } }),
  ]);
  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("\nERROR:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
