/**
 * El ciclo de compra visto desde el ERP: consultar, colocar y recibir.
 *
 * Entra por HTTP a un servidor de verdad, con una credencial de verdad, porque
 * lo que se prueba aquí no es la regla de negocio —esa ya la cubre
 * `prueba-materiales.ts`— sino la puerta: permisos, aislamiento entre empresas,
 * idempotencia, y que el material no entre dos veces al inventario.
 *
 * Las funciones de negocio son las MISMAS que usa la pantalla (`enCompra`,
 * `recibir`). Si esta prueba pasara llamando a una copia de sus pasos, no
 * probaría nada: el ERP podría recibir de más y la pantalla no.
 *
 *   npx tsx scripts/prueba-compras-api.ts
 */
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { apagarServidor, colaDelLog, levantarServidor } from "./servidor-de-prueba";

function llaveDeSesion(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const linea = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("AUTH_SECRET="));
  const valor = linea?.slice("AUTH_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  if (!valor) throw new Error("No hay AUTH_SECRET en el entorno ni en .env");
  return valor;
}
process.env.AUTH_SECRET = llaveDeSesion();

const PUERTO = 3210;
let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 280)}` : ""}`);
}

async function esperarServidor(base: string, limiteMs: number) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try { const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10_000) }); if (r.status < 500) return; } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

async function main() {
  const { prisma } = await import("../lib/db");
  const { crearCredencial } = await import("../lib/integraciones/credenciales");
  const { autorizar, crearRequisicionDeCompra } = await import("../lib/compras");
  const { quienRecibio } = await import("../lib/kardex-datos");

  const sello = `prueba-capi-${Date.now()}`;
  const base = process.env.BASE_URL ?? `http://127.0.0.1:${PUERTO}`;
  let servidor: ChildProcess | null = null;
  if (!process.env.BASE_URL) servidor = levantarServidor({ puerto: PUERTO });

  const A = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", montoAutorizacion: 100000, comprasInternas: true },
  });
  const B = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" } });

  try {
    const compras = await prisma.user.create({
      data: { organizationId: A.id, email: `compras@${sello}.mx`, name: "Compras", role: "PURCHASING", passwordHash: "x" },
    });
    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const almacen = await prisma.warehouse.create({ data: { organizationId: A.id, siteId: sitio.id, code: "ALM-01", name: "Central" } });
    const rodamiento = await prisma.part.create({
      data: { organizationId: A.id, code: "ROD-6205", name: "Rodamiento 6205", unit: "PZA", unitCost: 0, quantityOnHand: 0, minQuantity: 2 },
    });
    const sello2 = await prisma.part.create({
      data: { organizationId: A.id, code: "SEL-2020", name: "Sello 20x20", unit: "PZA", unitCost: 0, quantityOnHand: 0 },
    });
    const proveedor = await prisma.supplier.create({ data: { organizationId: A.id, name: "Rodamientos del Norte", rfc: "RDN930101AB1" } });

    // La compra nace como nace en el sistema: pedida y autorizada por personas.
    const compra = await crearRequisicionDeCompra({
      organizationId: A.id, userId: compras.id, warehouseId: almacen.id, urgencia: "ALTA",
      justificacion: "Faltante de la OT del molino",
      renglones: [
        { partId: rodamiento.id, descripcion: "Rodamiento 6205", cantidadSolicitada: 4, costoEstimado: 180 },
        { partId: sello2.id, descripcion: "Sello 20x20", cantidadSolicitada: 2, costoEstimado: 95 },
      ],
    });
    await autorizar({ organizationId: A.id, userId: compras.id, requestId: compra.id, aprueba: true });
    const folio = (await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: compra.id }, select: { folio: true } })).folio;

    // Una compra de OTRA empresa, para el aislamiento.
    const sitioB = await prisma.site.create({ data: { organizationId: B.id, code: "SB", name: "Planta B" } });
    const almacenB = await prisma.warehouse.create({ data: { organizationId: B.id, siteId: sitioB.id, code: "ALM-01", name: "De B" } });
    const parteB = await prisma.part.create({
      data: { organizationId: B.id, code: "ROD-6205", name: "Rodamiento de B", unit: "PZA", unitCost: 0, quantityOnHand: 0 },
    });
    const usuarioB = await prisma.user.create({
      data: { organizationId: B.id, email: `c@${sello}-b.mx`, name: "Compras B", role: "PURCHASING", passwordHash: "x" },
    });
    /**
     * Tres compras en B, y se usa la tercera. No es capricho.
     *
     * Los folios son unicos POR EMPRESA, no globales: la primera compra de A y
     * la primera de B se llaman las dos RC-000001. Escrita con una sola compra
     * en B, esta prueba mandaba «la compra de otra empresa» y el sistema
     * encontraba —correctamente— la de A con ese mismo folio, la colocaba, y la
     * prueba lo reportaba como fuga entre empresas. No lo era: era la prueba
     * pidiendo algo que si existe de este lado.
     *
     * Con el folio desplazado, pedir el de B es pedir algo que en A no existe,
     * que es lo unico que demuestra el aislamiento.
     */
    let compraB = await crearRequisicionDeCompra({
      organizationId: B.id, userId: usuarioB.id, warehouseId: almacenB.id, urgencia: "NORMAL",
      renglones: [{ partId: parteB.id, descripcion: "Rodamiento de B", cantidadSolicitada: 1, costoEstimado: 10 }],
    });
    for (let i = 0; i < 2; i++) {
      compraB = await crearRequisicionDeCompra({
        organizationId: B.id, userId: usuarioB.id, warehouseId: almacenB.id, urgencia: "NORMAL",
        renglones: [{ partId: parteB.id, descripcion: "Rodamiento de B", cantidadSolicitada: 1, costoEstimado: 10 }],
      });
    }
    await autorizar({ organizationId: B.id, userId: usuarioB.id, requestId: compraB.id, aprueba: true });
    const folioB = (await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: compraB.id }, select: { folio: true } })).folio;
    if (folioB === folio) throw new Error(`La prueba no sirve: el folio de B (${folioB}) coincide con el de A. Vea el comentario de arriba.`);

    const conCostos = await crearCredencial({
      organizationId: A.id, userId: compras.id, nombre: "Enlace ERP",
      alcances: ["compras:leer", "compras:escribir", "costos:leer"],
    });
    const sinCostos = await crearCredencial({
      organizationId: A.id, userId: compras.id, nombre: "Solo folios", alcances: ["compras:leer"],
    });

    await esperarServidor(base, 180_000);
    const pedir = async (metodo: string, ruta: string, cabeceras: Record<string, string>, cuerpo?: unknown) => {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo, headers: { "Content-Type": "application/json", ...cabeceras },
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}), signal: AbortSignal.timeout(120_000),
      });
      return { status: r.status, headers: r.headers, json: await r.json().catch(() => ({})) as Record<string, unknown> };
    };
    const erp = { Authorization: `Bearer ${conCostos.secreto}` };
    const mirón = { Authorization: `Bearer ${sinCostos.secreto}` };
    type Fila = { folio: string; estado: string; almacen: string; urgencia: string; montoEstimado?: number; renglones: Array<{ refaccion: string | null; porRecibir: number; costoEstimado?: number }> };

    // ─────────────────────────────────────────── 1-4 Consultar
    console.log("\n1-4. Lo que hay por comprar");
    const lista = await pedir("GET", "/api/v1/compras", erp);
    const mía = (lista.json.datos as Fila[]).find((c) => c.folio === folio);
    revisar("1. el ERP ve las compras autorizadas con su renglonaje y su porqué",
      lista.status === 200 && Boolean(mía) && mía!.estado === "AUTORIZADA" && mía!.urgencia === "ALTA"
      && mía!.almacen === "ALM-01" && mía!.renglones.length === 2
      && mía!.renglones.every((r) => r.porRecibir > 0), mía);
    revisar("2. y NO ve las de otra empresa, aunque el folio exista allá",
      !(lista.json.datos as Fila[]).some((c) => c.folio === folioB), { folioB });
    const pobre = await pedir("GET", "/api/v1/compras", mirón);
    const míaPobre = (pobre.json.datos as Fila[]).find((c) => c.folio === folio);
    revisar("3. sin «costos:leer» no salen los montos: ni el de la compra ni el del renglón",
      pobre.status === 200 && Boolean(míaPobre) && !("montoEstimado" in míaPobre!)
      && míaPobre!.renglones.every((r) => !("costoEstimado" in r))
      && typeof mía!.montoEstimado === "number" && typeof mía!.renglones[0].costoEstimado === "number");
    const inventada = await pedir("GET", "/api/v1/compras?estado=NOEXISTE", erp);
    revisar("4. un estado que no existe se rechaza diciendo cuáles hay",
      inventada.status === 422 && (inventada.json.error as { codigo: string; mensaje: string }).codigo === "ESTADO_INVALIDO"
      && (inventada.json.error as { mensaje: string }).mensaje.includes("AUTORIZADA"));

    // ─────────────────────────────────────────── 5-8 Colocar la orden
    console.log("\n5-8. Colocar la orden de compra");
    const sinPermiso = await pedir("POST", "/api/v1/ordenes-compra", mirón, { compra: folio, ordenCompra: "OC-1" });
    revisar("5. «compras:leer» no alcanza para escribir: 403 diciendo qué permiso falta",
      sinPermiso.status === 403 && (sinPermiso.json.error as { codigo: string }).codigo === "ALCANCE_INSUFICIENTE"
      && (sinPermiso.json.error as { mensaje: string }).mensaje.includes("compras:escribir"));
    const ajena = await pedir("POST", "/api/v1/ordenes-compra", erp, { compra: folioB, ordenCompra: "OC-ROBO" });
    revisar(`6. con el folio de otra empresa (${folioB}, que aquí no existe): «no encontrada», y allá no cambió nada`,
      ajena.status === 404 && (ajena.json.error as { codigo: string }).codigo === "COMPRA_NO_ENCONTRADA"
      && (await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: compraB.id } })).estado === "AUTORIZADA"
      && (await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: compra.id } })).estado === "AUTORIZADA",
      ajena.json);
    const colocada = await pedir("POST", "/api/v1/ordenes-compra", erp, { compra: folio, ordenCompra: "OC-5521" });
    const enBase = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: compra.id }, select: { estado: true, ordenCompra: true } });
    revisar("7. el ERP informa su folio y la compra pasa a «En compra» con él a la vista",
      colocada.status === 200 && enBase.estado === "EN_COMPRA" && enBase.ordenCompra === "OC-5521", { colocada: colocada.json, enBase });
    const repetida = await pedir("POST", "/api/v1/ordenes-compra", erp, { compra: folio, ordenCompra: "OC-5521" });
    const otra = await pedir("POST", "/api/v1/ordenes-compra", erp, { compra: folio, ordenCompra: "OC-9999" });
    revisar("8. repetir la MISMA orden es un reintento y no toca nada; cambiarla se rechaza con la regla",
      repetida.status === 200 && repetida.json.repetida === true
      && otra.status === 422 && (otra.json.error as { codigo: string }).codigo === "REGLA_DE_COMPRAS"
      && (await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: compra.id } })).ordenCompra === "OC-5521",
      { repetida: repetida.json, otra: otra.json });

    // ─────────────────────────────────────────── 9-14 Recibir
    console.log("\n9-14. Recibir la mercancía");
    const sinClave = await pedir("POST", "/api/v1/recepciones", erp, {
      compra: folio, almacen: "ALM-01", renglones: [{ refaccion: "ROD-6205", cantidad: 1, costoUnitario: 180 }],
    });
    revisar("9. recibir sin Idempotency-Key se rechaza: entrar dos veces al inventario es el error caro",
      sinClave.status === 400 && (sinClave.json.error as { codigo: string }).codigo === "FALTA_IDEMPOTENCIA");

    const k1 = { ...erp, "Idempotency-Key": `rec1-${sello}` };
    const parcial = await pedir("POST", "/api/v1/recepciones", k1, {
      compra: folio, almacen: "ALM-01", proveedor: "RDN930101AB1", remision: "R-88431", ordenCompra: "OC-5521",
      renglones: [{ refaccion: "ROD-6205", cantidad: 3, costoUnitario: 182.5 }],
    });
    const trasParcial = await prisma.purchaseRequest.findUniqueOrThrow({
      where: { id: compra.id },
      select: { estado: true, renglones: { select: { partId: true, cantidadRecibida: true } } },
    });
    const stock = await prisma.partStock.findFirstOrThrow({ where: { partId: rodamiento.id, warehouseId: almacen.id } });
    const parteTrasParcial = await prisma.part.findUniqueOrThrow({ where: { id: rodamiento.id }, select: { quantityOnHand: true, unitCost: true } });
    revisar("10. entra al almacén, al kardex y al renglón de la compra, y queda «Recibida en parte»",
      parcial.status === 201 && trasParcial.estado === "RECIBIDA_PARCIAL"
      && trasParcial.renglones.find((r) => r.partId === rodamiento.id)!.cantidadRecibida === 3
      && stock.quantity === 3 && parteTrasParcial.quantityOnHand === 3 && parteTrasParcial.unitCost === 182.5
      && (await prisma.stockMovement.count({ where: { partId: rodamiento.id, movementType: "IN" } })) === 1,
      { estado: trasParcial.estado, stock: stock.quantity, costo: parteTrasParcial.unitCost });

    const otraVez = await pedir("POST", "/api/v1/recepciones", k1, {
      compra: folio, almacen: "ALM-01", renglones: [{ refaccion: "ROD-6205", cantidad: 3, costoUnitario: 182.5 }],
    });
    revisar("11. el mismo envío repetido NO entra dos veces: misma respuesta, mismo inventario",
      otraVez.headers.get("idempotencia-repetida") === "true"
      && (await prisma.partStock.findFirstOrThrow({ where: { partId: rodamiento.id, warehouseId: almacen.id } })).quantity === 3
      && (await prisma.goodsReceipt.count({ where: { organizationId: A.id } })) === 1,
      { repetida: otraVez.headers.get("idempotencia-repetida"), recepciones: await prisma.goodsReceipt.count({ where: { organizationId: A.id } }) });

    const deMas = await pedir("POST", "/api/v1/recepciones", { ...erp, "Idempotency-Key": `demas-${sello}` }, {
      compra: folio, almacen: "ALM-01", renglones: [{ refaccion: "ROD-6205", cantidad: 5, costoUnitario: 182.5 }],
    });
    revisar("12. recibir de más se rechaza con la regla, y el mensaje dice cuánto falta",
      deMas.status === 422 && (deMas.json.error as { codigo: string }).codigo === "REGLA_DE_COMPRAS"
      && /falta/i.test((deMas.json.error as { mensaje: string }).mensaje)
      && (await prisma.partStock.findFirstOrThrow({ where: { partId: rodamiento.id, warehouseId: almacen.id } })).quantity === 3,
      (deMas.json.error as { mensaje: string })?.mensaje);

    const noExiste = await pedir("POST", "/api/v1/recepciones", { ...erp, "Idempotency-Key": `noex-${sello}` }, {
      compra: folio, almacen: "ALM-01", renglones: [{ refaccion: "NO-EXISTE", cantidad: 1, costoUnitario: 1 }],
    });
    const malAlmacen = await pedir("POST", "/api/v1/recepciones", { ...erp, "Idempotency-Key": `malalm-${sello}` }, {
      compra: folio, almacen: "ALM-NADA", renglones: [{ refaccion: "ROD-6205", cantidad: 1, costoUnitario: 1 }],
    });
    revisar("13. una refacción o un almacén que no existen se dicen por su nombre, sin escribir nada",
      noExiste.status === 404 && (noExiste.json.error as { codigo: string }).codigo === "REFACCION_NO_ENCONTRADA"
      && (noExiste.json.error as { mensaje: string }).mensaje.includes("NO-EXISTE")
      && malAlmacen.status === 404 && (malAlmacen.json.error as { codigo: string }).codigo === "ALMACEN_NO_ENCONTRADO"
      && (await prisma.goodsReceipt.count({ where: { organizationId: A.id } })) === 1);

    const resto = await pedir("POST", "/api/v1/recepciones", { ...erp, "Idempotency-Key": `rec2-${sello}` }, {
      compra: folio, almacen: "ALM-01", proveedor: "Rodamientos del Norte", remision: "R-88500",
      renglones: [
        { refaccion: "ROD-6205", cantidad: 1, costoUnitario: 190 },
        { refaccion: "SEL-2020", cantidad: 2, costoUnitario: 95, conforme: false, observacion: "Empaque roto" },
      ],
    });
    const cerrada = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: compra.id }, select: { estado: true } });
    const conObservacion = await prisma.goodsReceiptLine.findFirstOrThrow({ where: { partId: sello2.id }, select: { conforme: true, observacion: true } });
    revisar("14. al completar los renglones la compra queda «Recibida»; lo no conforme entra igual y señalado",
      resto.status === 201 && cerrada.estado === "RECIBIDA"
      && conObservacion.conforme === false && conObservacion.observacion === "Empaque roto"
      && (await prisma.part.findUniqueOrThrow({ where: { id: rodamiento.id } })).quantityOnHand === 4,
      { estado: cerrada.estado, proveedorPorNombre: (resto.json as { recepcion?: string }).recepcion });

    // ─────────────────────────────────────────── 15-16 Quién recibió, y los avisos
    console.log("\n15-16. Rastro de la integración");
    const recepcion = await prisma.goodsReceipt.findFirstOrThrow({
      where: { organizationId: A.id, remision: "R-88431" },
      select: { recibidoPorId: true, recibidoPorNombre: true, supplierId: true, folio: true },
    });
    revisar("15. la recepción del ERP queda a nombre de la integración, no en blanco",
      recepcion.recibidoPorId === null && recepcion.recibidoPorNombre === "Integración: Enlace ERP"
      && recepcion.supplierId === proveedor.id
      && quienRecibio({ goodsReceipt: { id: "x", folio: recepcion.folio, recibidoPorNombre: recepcion.recibidoPorNombre } }) === "Integración: Enlace ERP",
      recepcion);

    const usos = await prisma.usoApi.findMany({
      where: { organizationId: A.id, ruta: { contains: "compras" } },
      select: { metodo: true, estado: true, resultado: true },
    });
    const rechazos = await prisma.usoApi.count({ where: { organizationId: A.id, resultado: "RECHAZADA" } });
    revisar("16. todo quedó en la bitácora de uso, incluidos los rechazos",
      usos.length >= 1 && rechazos >= 4, { usos: usos.length, rechazos });

  } finally {
    if (fallos) console.log(`\n--- final del log del servidor ---\n${colaDelLog(PUERTO, 25)}`);
    await apagarServidor(servidor, PUERTO);
    for (const id of [A.id, B.id]) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log(fallos ? `\n✗ ${fallos} fallas` : "\n✓ El ciclo de compra con el ERP cierra completo");
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
