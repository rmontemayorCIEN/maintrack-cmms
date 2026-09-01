import { prisma } from "./db";

/**
 * Indicadores del almacen.
 *
 * Todos se calculan aqui, en el servidor y con aritmetica explicita. No es
 * casualidad: son las cifras con las que un jefe de mantenimiento defiende su
 * presupuesto, y cada una tiene que poder rastrearse hasta los movimientos que
 * la produjeron.
 */

export type Indicadores = Awaited<ReturnType<typeof indicadoresDeAlmacen>>;

export async function indicadoresDeAlmacen(organizationId: string, desde: Date, hasta: Date) {
  const [movimientos, requisiciones, compras, conteos, partes, ordenes] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { organizationId, createdAt: { gte: desde, lte: hasta } },
      select: { movementType: true, quantity: true, unitCost: true, partId: true, createdAt: true },
    }),
    prisma.materialRequest.findMany({
      where: { organizationId, createdAt: { gte: desde, lte: hasta } },
      select: {
        urgencia: true, createdAt: true, estado: true,
        renglones: { select: { cantidadSolicitada: true, cantidadSurtida: true, cantidadDevuelta: true, partId: true } },
      },
    }),
    prisma.purchaseRequest.findMany({
      where: { organizationId, createdAt: { gte: desde, lte: hasta } },
      select: {
        urgencia: true, createdAt: true, estado: true, montoEstimado: true,
        recepciones: { select: { createdAt: true }, orderBy: { createdAt: "asc" }, take: 1 },
      },
    }),
    prisma.inventoryCount.findMany({
      where: { organizationId, estado: "CERRADO", cerradoEl: { gte: desde, lte: hasta } },
      select: {
        folio: true, cerradoEl: true,
        renglones: { select: { cantidadSistema: true, cantidadContada: true, cantidadAlCerrar: true } },
      },
      orderBy: { cerradoEl: "desc" },
    }),
    prisma.part.findMany({
      where: { organizationId, active: true },
      select: { id: true, code: true, name: true, quantityOnHand: true, unitCost: true },
    }),
    prisma.workOrderPart.findMany({
      where: { workOrder: { organizationId, createdAt: { gte: desde, lte: hasta } } },
      select: { cost: true, workOrder: { select: { asset: { select: { id: true, code: true, name: true } } } } },
    }),
  ]);

  // ── Nivel de servicio: renglones que el almacen surtio completos ─────────
  const renglones = requisiciones.flatMap((r) => r.renglones);
  const completos = renglones.filter((l) => l.cantidadSurtida >= l.cantidadSolicitada).length;
  const nivelServicio = renglones.length ? Math.round((completos / renglones.length) * 100) : null;

  // ── Rotacion: lo que salio contra lo que hay parado ──────────────────────
  const salidas = movimientos.filter((m) => m.movementType === "OUT");
  const valorConsumido = salidas.reduce((s, m) => s + m.quantity * m.unitCost, 0);
  const valorInventario = partes.reduce((s, p) => s + p.quantityOnHand * p.unitCost, 0);
  const dias = Math.max(1, Math.round((hasta.getTime() - desde.getTime()) / 86400000));
  // Se anualiza para que la cifra sea comparable sin importar el periodo elegido.
  const rotacion = valorInventario > 0 ? (valorConsumido / valorInventario) * (365 / dias) : null;

  // ── Devoluciones: sintoma de pedir de mas ────────────────────────────────
  const surtido = renglones.reduce((s, l) => s + l.cantidadSurtida, 0);
  const devuelto = renglones.reduce((s, l) => s + l.cantidadDevuelta, 0);
  const tasaDevolucion = surtido > 0 ? Math.round((devuelto / surtido) * 100) : null;

  // ── Urgencia: cuanto del trabajo llega como emergencia ───────────────────
  const urgentes = [...requisiciones, ...compras].filter((r) => r.urgencia !== "NORMAL").length;
  const totalPeticiones = requisiciones.length + compras.length;
  const tasaUrgencia = totalPeticiones ? Math.round((urgentes / totalPeticiones) * 100) : null;

  // ── Entrega real: de que se pidio la compra a que llego lo primero ───────
  const conEntrega = compras.filter((c) => c.recepciones.length);
  const diasEntrega = conEntrega.length
    ? Math.round(
        conEntrega.reduce((s, c) => s + (c.recepciones[0].createdAt.getTime() - c.createdAt.getTime()) / 86400000, 0) /
          conEntrega.length,
      )
    : null;

  // ── Exactitud de inventario, del ultimo conteo cerrado ───────────────────
  const ultimoConteo = conteos[0];
  const exactitudInventario = ultimoConteo
    ? (() => {
        const c = ultimoConteo.renglones.filter((r) => r.cantidadContada !== null);
        if (!c.length) return null;
        const ok = c.filter((r) => Math.abs(r.cantidadContada! - (r.cantidadAlCerrar ?? r.cantidadSistema)) < 0.0001).length;
        return { folio: ultimoConteo.folio, porcentaje: Math.round((ok / c.length) * 100), renglones: c.length };
      })()
    : null;

  // ── Sin movimiento en el periodo ─────────────────────────────────────────
  const conMovimiento = new Set(movimientos.map((m) => m.partId));
  const quietas = partes.filter((p) => !conMovimiento.has(p.id) && p.quantityOnHand > 0);
  const valorQuieto = quietas.reduce((s, p) => s + p.quantityOnHand * p.unitCost, 0);

  // ── Costo de refacciones por equipo ──────────────────────────────────────
  const porEquipo = new Map<string, { code: string; name: string; costo: number }>();
  for (const o of ordenes) {
    const a = o.workOrder.asset;
    if (!a) continue;
    const previo = porEquipo.get(a.id) ?? { code: a.code, name: a.name, costo: 0 };
    previo.costo += o.cost;
    porEquipo.set(a.id, previo);
  }
  const equiposCaros = [...porEquipo.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.costo - a.costo)
    .slice(0, 10);

  return {
    dias,
    nivelServicio, renglonesPedidos: renglones.length, renglonesCompletos: completos,
    rotacion, valorConsumido, valorInventario,
    tasaDevolucion, surtido, devuelto,
    tasaUrgencia, urgentes, totalPeticiones,
    diasEntrega, comprasRecibidas: conEntrega.length,
    exactitudInventario, conteosCerrados: conteos.length,
    quietas: quietas.length, valorQuieto,
    equiposCaros,
  };
}
