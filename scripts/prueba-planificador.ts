/**
 * El planificador de compras: que pedir, cuanto y cuando.
 *
 * Arma el plan con `altaDePlan` —la misma puerta que la pantalla— y mueve el
 * inventario con `aplicarMovimiento`, que es el unico lugar donde cambia el
 * stock. Sembrar el kardex a mano probaria la aritmetica de la prueba, no la
 * del sistema.
 *
 * Lo que vigila, que es donde esta el dinero:
 *   · que lo que ya viene en camino NO se vuelva a pedir,
 *   · que lo planeado y lo historico no se sumen entre si,
 *   · que la urgencia salga de comparar el quiebre contra el tiempo de entrega.
 *
 *   npx tsx scripts/prueba-planificador.ts
 */
import { prisma } from "../lib/db";
import { altaDePlan } from "../lib/alta-de-plan";
import { aplicarMovimiento } from "../lib/almacen";
import { crearRequisicionDeCompra } from "../lib/compras";
import { planDeCompras, DIAS_DE_HISTORIA } from "../lib/planificador-compras";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 260)}` : ""}`);
}

const DIA = 24 * 60 * 60 * 1000;

async function main() {
  const sello = `prueba-pc-${Date.now()}`;
  const A = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });
  const B = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" } });

  try {
    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const equipo = await prisma.asset.create({ data: { organizationId: A.id, siteId: sitio.id, code: "CMP-1", name: "Compresor" } });
    const alm = await prisma.warehouse.create({ data: { organizationId: A.id, code: "GEN", name: "General", esGeneral: true } });
    const quien = await prisma.user.create({
      data: { organizationId: A.id, email: `u${Date.now()}@x.com`, name: "Almacén", passwordHash: "x", role: "ADMIN" },
    });

    // Un proveedor lento y uno rapido: el tiempo de entrega es la mitad de la
    // decision, y con uno solo no se nota si se esta usando.
    const lento = await prisma.supplier.create({ data: { organizationId: A.id, name: "Importador Lento", leadTimeDays: 45 } });
    const rapido = await prisma.supplier.create({ data: { organizationId: A.id, name: "Local Rápido", leadTimeDays: 2 } });

    const crear = (code: string, name: string, extra: Record<string, unknown>) =>
      prisma.part.create({ data: { organizationId: A.id, code, name, unit: "pza", ...extra } });

    // El filtro lo pide el preventivo cada mes; el proveedor tarda 45 dias.
    const filtro = await crear("FIL", "Filtro", { unitCost: 450, quantityOnHand: 2, minQuantity: 1, supplierId: lento.id });
    // El balero no esta en ningun plan: solo se rompe. Historico puro.
    const balero = await crear("ROD", "Balero", { unitCost: 120, quantityOnHand: 4, minQuantity: 6, supplierId: rapido.id });
    // La grasa ya se pidio y viene en camino: NO se debe volver a pedir.
    const grasa = await crear("GRA", "Grasa", { unitCost: 200, quantityOnHand: 0, minQuantity: 10, supplierId: rapido.id });
    // El tornillo tiene de sobra: no es una compra pendiente.
    const tornillo = await crear("TOR", "Tornillo", { unitCost: 2, quantityOnHand: 5000, minQuantity: 100, supplierId: rapido.id });
    // La banda tiene maximo declarado: se repone al maximo, no a la demanda.
    const banda = await crear("BAN", "Banda", { unitCost: 300, quantityOnHand: 1, minQuantity: 2, maxQuantity: 10, supplierId: rapido.id });
    // El aceite tiene algo en camino, pero NO alcanza: debe salir pidiendo
    // solo la diferencia. Es el caso donde un descuento mal hecho se nota.
    const aceite = await crear("ACE", "Aceite", { unitCost: 90, quantityOnHand: 0, minQuantity: 100, supplierId: rapido.id });

    const alta = await altaDePlan(A.id, null, {
      name: "Preventivo del compresor",
      maintenanceType: "PREVENTIVE", triggerType: "CALENDAR", intervalDays: 30,
      leadTimeDays: 0, toleranceDays: 3, priority: "MEDIUM", estimatedHours: 2,
      requiresShutdown: false, active: true,
      assetIds: [equipo.id],
      tasks: [
        { title: "Cambio de filtro", taskType: "REPLACE", required: true, cadaCuanto: 1, unidadFrecuencia: "MESES",
          labor: [], parts: [{ partId: filtro.id, quantity: 1 }], services: [] },
      ],
    } as never);
    if ("error" in alta) throw new Error(`No se pudo dar de alta el plan: ${alta.error}`);

    // ── El consumo real, por el unico lugar donde se mueve el stock ──
    // Doce baleros en el periodo de historia: el ritmo que el plan no ve.
    await aplicarMovimiento({
      organizationId: A.id, userId: quien.id, partId: balero.id, warehouseId: alm.id,
      tipo: "IN", cantidad: 100, costoUnitario: 120, motivo: "Existencia inicial",
    });
    await aplicarMovimiento({
      organizationId: A.id, userId: quien.id, partId: balero.id, warehouseId: alm.id,
      tipo: "OUT", cantidad: 12, motivo: "Consumo del periodo",
    });
    await prisma.part.update({ where: { id: balero.id }, data: { quantityOnHand: 4 } });

    // ── Lo que ya viene en camino ──
    await crearRequisicionDeCompra({
      organizationId: A.id, userId: quien.id, warehouseId: alm.id, urgencia: "NORMAL", montoAutorizacion: 0,
      renglones: [
        // Cubre de sobra el minimo de la grasa: esa ya no hay que pedirla.
        { partId: grasa.id, descripcion: "Grasa", cantidadSolicitada: 40, costoEstimado: 200 },
        // Se queda corta para el aceite: esa sigue pendiente, por la diferencia.
        { partId: aceite.id, descripcion: "Aceite", cantidadSolicitada: 30, costoEstimado: 90 },
      ],
    });

    const r = await planDeCompras(A.id, { dias: 90 });
    const de = (id: string) => r.sugerencias.find((s) => s.partId === id);

    console.log("\n1. Que entra y que no\n");
    revisar("lo que sobra no se propone", !de(tornillo.id), de(tornillo.id)?.sugerido);
    revisar("lo que el preventivo va a pedir, si", Boolean(de(filtro.id)), de(filtro.id)?.sugerido);
    revisar("lo que solo se rompe tambien, por su ritmo real", Boolean(de(balero.id)), {
      historico: de(balero.id)?.demandaHistorica, origen: de(balero.id)?.origen,
    });

    console.log("\n2. Lo que ya viene en camino no se vuelve a pedir\n");
    // Sin descontar lo pedido, el planificador mandaria comprar otra vez algo
    // que ya viene en camino. Es el error caro de este modulo.
    revisar("lo que una compra viva ya cubre desaparece de la lista", de(grasa.id) === undefined, de(grasa.id)?.sugerido);
    const ace = de(aceite.id);
    revisar("lo que viene pero no alcanza sigue apareciendo", Boolean(ace), ace?.sugerido);
    revisar("con lo que viene anotado y en que compra", ace?.enCamino === 30 && ace!.folios.length === 1,
      { enCamino: ace?.enCamino, folios: ace?.folios });
    revisar("y se propone solo la diferencia, no el minimo completo",
      ace?.sugerido === 70, { minimo: ace?.minimo, enCamino: ace?.enCamino, sugerido: ace?.sugerido });

    console.log("\n3. Lo planeado y lo historico no se suman\n");
    const fil = de(filtro.id)!;
    revisar("la demanda es la mayor de las dos, nunca la suma",
      fil.demanda === Math.max(fil.demandaPlan, fil.demandaHistorica)
      && fil.demanda < fil.demandaPlan + fil.demandaHistorica + 0.001,
      { plan: fil.demandaPlan, historico: fil.demandaHistorica, usada: fil.demanda });
    revisar("y dice cual de las dos mando", fil.origen === "PLAN", fil.origen);
    const rod = de(balero.id)!;
    revisar("cuando el historico es mayor, manda el historico", rod.origen === "HISTORICO", {
      plan: rod.demandaPlan, historico: Number(rod.demandaHistorica.toFixed(2)), origen: rod.origen,
    });
    revisar("el ritmo se lleva al horizonte, no se copia tal cual",
      Math.abs(rod.demandaHistorica - (12 / DIAS_DE_HISTORIA) * 90) < 0.001, rod.demandaHistorica);

    console.log("\n4. La urgencia sale del tiempo de entrega\n");
    revisar("lo que se acaba antes de poder llegar va como tarde", fil.urgencia === "TARDE", {
      quiebre: fil.diasParaQuiebre, entrega: fil.diasEntrega, urgencia: fil.urgencia,
    });
    revisar("y el porque lo dice con nombre y numeros",
      fil.porQue.includes("Importador Lento") && fil.porQue.includes("45"), fil.porQue.slice(0, 120));
    revisar("lo que no se cruza en el horizonte se deja en vigilar",
      de(banda.id)?.urgencia === "VIGILAR" || de(banda.id)?.diasParaQuiebre === null,
      { urgencia: de(banda.id)?.urgencia, quiebre: de(banda.id)?.diasParaQuiebre });

    console.log("\n5. Cuanto pedir\n");
    const ban = de(banda.id)!;
    revisar("con maximo declarado se repone al maximo", ban.sugerido === 9, { maximo: ban.maximo, hay: ban.existencia, sugerido: ban.sugerido });
    revisar("sin maximo se cubre la demanda mas el minimo",
      Math.abs(fil.sugerido - (fil.demanda + fil.minimo - fil.existencia)) < 0.001,
      { demanda: fil.demanda, minimo: fil.minimo, hay: fil.existencia, sugerido: fil.sugerido });
    revisar("el costo propuesto es la cantidad por el costo unitario",
      Math.abs(fil.costoSugerido - fil.sugerido * fil.costoUnitario) < 0.001, fil.costoSugerido);

    console.log("\n6. El orden en que se atiende\n");
    const urgencias = r.sugerencias.map((s) => s.urgencia);
    const pesos = urgencias.map((u) => ["TARDE", "HOY", "PRONTO", "VIGILAR"].indexOf(u));
    revisar("lo que ya va tarde sale primero", pesos.every((p, i) => i === 0 || pesos[i - 1] <= p), urgencias);

    console.log("\n7. Cada empresa ve lo suyo\n");
    const vacio = await planDeCompras(B.id, { dias: 90 });
    revisar("la otra empresa no ve nada de esta", vacio.sugerencias.length === 0, vacio.sugerencias.length);

    console.log("\n8. No crea nada: propone\n");
    revisar("no nacio ninguna requisicion de compra nueva",
      await prisma.purchaseRequest.count({ where: { organizationId: A.id } }) === 1,
      await prisma.purchaseRequest.count({ where: { organizationId: A.id } }));
  } finally {
    for (const org of [A.id, B.id]) {
      // Los renglones de actividad no llevan organizationId: se alcanzan por
      // sus tareas, asi que se resuelven antes de la transaccion.
      const tareas = await prisma.planTask.findMany({
        where: { plan: { organizationId: org } }, select: { id: true },
      });
      await prisma.$transaction([
        prisma.stockMovement.deleteMany({ where: { organizationId: org } }),
        prisma.purchaseRequestLine.deleteMany({ where: { request: { organizationId: org } } }),
        prisma.purchaseRequest.deleteMany({ where: { organizationId: org } }),
        prisma.notification.deleteMany({ where: { organizationId: org } }),
        prisma.planTaskPart.deleteMany({ where: { planTaskId: { in: tareas.map((t) => t.id) } } }),
        prisma.planTask.deleteMany({ where: { plan: { organizationId: org } } }),
        prisma.planAsset.deleteMany({ where: { plan: { organizationId: org } } }),
        prisma.maintenancePlan.deleteMany({ where: { organizationId: org } }),
        prisma.partStock.deleteMany({ where: { organizationId: org } }),
        prisma.part.deleteMany({ where: { organizationId: org } }),
        prisma.supplier.deleteMany({ where: { organizationId: org } }),
        prisma.warehouse.deleteMany({ where: { organizationId: org } }),
        prisma.asset.deleteMany({ where: { organizationId: org } }),
        prisma.site.deleteMany({ where: { organizationId: org } }),
        prisma.user.deleteMany({ where: { organizationId: org } }),
        prisma.organization.delete({ where: { id: org } }),
      ]);
    }
  }

  console.log(fallos ? `\n${fallos} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallos ? 1 : 0;
}

main().catch((e) => { console.error("\nERROR:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
