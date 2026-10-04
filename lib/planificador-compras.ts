/**
 * Que hay que comprar, cuanto, y cuando pedirlo.
 *
 * ── Por que existe ──
 *
 * El almacen ya avisaba «bajo minimo», pero eso llega tarde por definicion:
 * cuando la existencia cruza el minimo, el material tarda en llegar lo que
 * tarde el proveedor, y en ese hueco es cuando se para un equipo. La pregunta
 * util no es «que esta bajo minimo» sino «que se va a acabar antes de que
 * alcance a llegar».
 *
 * ── Lo que junta ──
 *
 * Tres cosas que el sistema ya sabia por separado:
 *   1. `consumoProyectado`: que va a pedir el preventivo y que dia.
 *   2. El consumo real del kardex: lo que de verdad ha salido, que incluye lo
 *      correctivo, que no se puede proyectar porque una falla no tiene fecha.
 *   3. Lo que ya viene en camino y cuanto tarda cada proveedor.
 *
 * ── Lo que NO hace, y es a proposito ──
 *
 * **No crea requisiciones.** Propone; alguien decide. Una requisicion que nace
 * sola por un minimo mal capturado es dinero comprometido sin que nadie lo
 * haya mirado, y los minimos de una cuenta recien importada casi nunca estan
 * bien. La pantalla lleva a la requisicion con los renglones precargados: un
 * clic menos, no una decision menos.
 *
 * ── Y por que lo planeado y lo historico NO se suman ──
 *
 * Seria la cuenta comoda y estaria mal: el historico del kardex YA incluye los
 * preventivos que se hicieron, asi que sumarlos cuenta dos veces lo mismo y
 * manda a comprar de mas. Se toma el MAYOR de los dos y se dice cual mando,
 * porque son dos lecturas de la misma demanda, no dos demandas.
 */
import { prisma } from "./db";
import { consumoProyectado, type Cobertura } from "./consumo-proyectado";
import { ESTADOS_COMPRA_ABIERTA } from "./compras";
import type { OrigenDemanda, UrgenciaPlan } from "./planificador-tipos";
import { ORDEN_URGENCIA } from "./planificador-tipos";

const DIA = 24 * 60 * 60 * 1000;

/** Cuanto historial se mira para sacar el consumo real. */
export const DIAS_DE_HISTORIA = 180;

/** Lo que se propone pedir de una refaccion, con el porque completo. */
export type Sugerencia = {
  partId: string;
  code: string;
  name: string;
  unit: string;
  costoUnitario: number;

  existencia: number;
  minimo: number;
  maximo: number;
  /** Pedido y todavia no recibido, en compras que siguen vivas. */
  enCamino: number;
  /** En que compras viene, para poder ir a verlas. */
  folios: string[];

  /** Lo que comprometen los preventivos en el horizonte. */
  demandaPlan: number;
  /** Lo que se consumiria segun el ritmo real del kardex, al mismo horizonte. */
  demandaHistorica: number;
  /** La que se usa: la mayor de las dos. Nunca la suma. */
  demanda: number;
  origen: OrigenDemanda;

  proveedor: string | null;
  diasEntrega: number;
  /**
   * Dias desde hoy hasta quedarse por debajo del minimo, segun el plan.
   * Null cuando no se cruza dentro del horizonte.
   */
  diasParaQuiebre: number | null;

  urgencia: UrgenciaPlan;
  /** Cuanto conviene pedir. Es una propuesta: la pantalla la deja editar. */
  sugerido: number;
  costoSugerido: number;
  /** La razon, redactada para que el comprador pueda defenderla. */
  porQue: string;
  /** Equipos que la van a pedir. Vacio si la demanda es solo historica. */
  equipos: string[];
};

/**
 * Cuanto pedir.
 *
 * Con maximo definido se repone hasta el maximo, que es lo que el almacen ya
 * declaro que quiere tener. Sin maximo se cubre la demanda del horizonte mas
 * el minimo, que es el colchon para no quedar en cero justo cuando toca el
 * preventivo. En los dos casos se descuenta lo que ya viene en camino.
 */
function cuantoPedir(s: {
  existencia: number; minimo: number; maximo: number; enCamino: number; demanda: number;
}) {
  const disponible = s.existencia + s.enCamino;
  const objetivo = s.maximo > 0 ? s.maximo : s.demanda + s.minimo;
  return Math.max(0, objetivo - disponible);
}

/**
 * Que tan urgente es, comparando cuando se acaba contra cuanto tarda.
 *
 * Sin fecha de quiebre no hay urgencia por tiempo: si ademas falta material
 * contra el minimo, se vigila; si no, no es sugerencia.
 */
function urgenciaDe(diasParaQuiebre: number | null, diasEntrega: number): UrgenciaPlan {
  if (diasParaQuiebre === null) return "VIGILAR";
  if (diasParaQuiebre < diasEntrega) return "TARDE";
  if (diasParaQuiebre <= diasEntrega + 3) return "HOY";
  if (diasParaQuiebre <= diasEntrega * 2 + 7) return "PRONTO";
  return "VIGILAR";
}

export async function planDeCompras(
  organizationId: string,
  opciones: { dias?: number } = {},
): Promise<{
  sugerencias: Sugerencia[];
  cobertura: Cobertura;
  dias: number;
  diasDeHistoria: number;
  costoTotal: number;
  conFecha: number;
  costoConFecha: number;
}> {
  const dias = opciones.dias ?? 90;
  const ahora = new Date();

  // La misma proyeccion del calendario y del consumo proyectado. En semanas,
  // porque la fecha de quiebre con resolucion mensual no sirve para decidir.
  const proy = await consumoProyectado(organizationId, { dias, periodo: "semana" });

  const [pedidos, salidas, refacciones] = await Promise.all([
    // Lo que ya se pidio y no ha llegado, con el folio para poder ir a verlo.
    prisma.purchaseRequestLine.findMany({
      where: {
        partId: { not: null },
        request: { organizationId, estado: { in: ESTADOS_COMPRA_ABIERTA } },
      },
      select: {
        partId: true, cantidadSolicitada: true, cantidadRecibida: true,
        request: { select: { folio: true } },
      },
    }),
    // El consumo real: incluye lo correctivo, que ningun plan puede anticipar.
    prisma.stockMovement.groupBy({
      by: ["partId"],
      where: {
        organizationId, movementType: "OUT",
        createdAt: { gte: new Date(ahora.getTime() - DIAS_DE_HISTORIA * DIA) },
      },
      _sum: { quantity: true },
    }),
    // Las que tienen minimo o ya se mueven: una refaccion que nadie usa y sin
    // minimo no es una compra pendiente, es ruido.
    prisma.part.findMany({
      where: { organizationId, active: true },
      select: {
        id: true, code: true, name: true, unit: true, unitCost: true,
        quantityOnHand: true, minQuantity: true, maxQuantity: true,
        supplier: { select: { name: true, leadTimeDays: true } },
      },
    }),
  ]);

  const enCaminoPorParte = new Map<string, { cantidad: number; folios: string[] }>();
  for (const l of pedidos) {
    const falta = Math.max(0, l.cantidadSolicitada - l.cantidadRecibida);
    if (!l.partId || falta <= 0) continue;
    const previo = enCaminoPorParte.get(l.partId) ?? { cantidad: 0, folios: [] };
    previo.cantidad += falta;
    if (!previo.folios.includes(l.request.folio)) previo.folios.push(l.request.folio);
    enCaminoPorParte.set(l.partId, previo);
  }

  const salidaPorParte = new Map<string, number>();
  for (const s of salidas) if (s.partId) salidaPorParte.set(s.partId, s._sum.quantity ?? 0);

  const planPorParte = new Map(proy.renglones.map((r) => [r.partId, r]));

  const sugerencias: Sugerencia[] = [];

  for (const p of refacciones) {
    const enCamino = enCaminoPorParte.get(p.id) ?? { cantidad: 0, folios: [] };
    const delPlan = planPorParte.get(p.id);
    const demandaPlan = delPlan?.total ?? 0;

    // Ritmo real llevado al mismo horizonte. Es una tasa, no una prediccion:
    // dice a que velocidad se ha ido gastando, nada mas.
    const consumido = salidaPorParte.get(p.id) ?? 0;
    const demandaHistorica = (consumido / DIAS_DE_HISTORIA) * dias;

    const demanda = Math.max(demandaPlan, demandaHistorica);
    const minimo = p.minQuantity;
    const existencia = p.quantityOnHand;

    // Cuando cae por debajo del minimo, semana por semana, contando lo que ya
    // viene en camino como si ya estuviera (es lo mas optimista defendible).
    let diasParaQuiebre: number | null = null;
    if (delPlan) {
      let saldo = existencia + enCamino.cantidad;
      for (let i = 0; i < delPlan.porPeriodo.length; i++) {
        saldo -= delPlan.porPeriodo[i];
        if (saldo < minimo) {
          const col = proy.columnas[i];
          diasParaQuiebre = Math.max(0, Math.round((col.hasta.getTime() - ahora.getTime()) / DIA));
          break;
        }
      }
    }

    const diasEntrega = p.supplier?.leadTimeDays ?? 7;
    const sugerido = cuantoPedir({ existencia, minimo, maximo: p.maxQuantity, enCamino: enCamino.cantidad, demanda });
    if (sugerido <= 0) continue;

    const origen: OrigenDemanda =
      demanda === 0 ? "MINIMO" : demandaPlan >= demandaHistorica ? "PLAN" : "HISTORICO";

    const urgencia = urgenciaDe(diasParaQuiebre, diasEntrega);

    const porQue = [
      `Hay ${redondear(existencia)} ${p.unit}`,
      enCamino.cantidad > 0 ? `y vienen ${redondear(enCamino.cantidad)} en ${enCamino.folios.join(", ")}` : null,
      minimo > 0 ? `con mínimo de ${redondear(minimo)}` : null,
      demandaPlan > 0 ? `El preventivo va a pedir ${redondear(demandaPlan)} en ${dias} días` : null,
      demandaHistorica > 0.01
        ? `Al ritmo de los últimos ${DIAS_DE_HISTORIA} días serían ${redondear(demandaHistorica)}`
        : null,
      diasParaQuiebre !== null
        ? `Se queda por debajo del mínimo en unos ${diasParaQuiebre} días y ${p.supplier?.name ?? "el proveedor"} tarda ${diasEntrega}`
        : null,
    ].filter(Boolean).join(". ") + ".";

    sugerencias.push({
      partId: p.id, code: p.code, name: p.name, unit: p.unit, costoUnitario: p.unitCost,
      existencia, minimo, maximo: p.maxQuantity,
      enCamino: enCamino.cantidad, folios: enCamino.folios,
      demandaPlan, demandaHistorica, demanda, origen,
      proveedor: p.supplier?.name ?? null, diasEntrega, diasParaQuiebre,
      urgencia, sugerido, costoSugerido: sugerido * p.unitCost,
      porQue,
      equipos: delPlan?.equipos ?? [],
    });
  }

  // Lo que ya va tarde primero y, dentro de eso, lo que mas dinero mueve: es
  // el orden en que un comprador lo va a atender.
  sugerencias.sort((a, b) => {
    const u = ORDEN_URGENCIA.indexOf(a.urgencia) - ORDEN_URGENCIA.indexOf(b.urgencia);
    if (u !== 0) return u;
    // Lo que tiene fecha de quiebre antes que la reposicion de minimo: se
    // midio en la demo y veintiuna reposiciones tapaban las tres refacciones
    // que de verdad se van a acabar. El dinero decide solo al final.
    const fa = a.diasParaQuiebre !== null ? 0 : 1;
    const fb = b.diasParaQuiebre !== null ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return b.costoSugerido - a.costoSugerido;
  });

  const conFecha = sugerencias.filter((s) => s.diasParaQuiebre !== null);
  return {
    sugerencias,
    cobertura: proy.cobertura,
    dias,
    diasDeHistoria: DIAS_DE_HISTORIA,
    costoTotal: sugerencias.reduce((s, x) => s + x.costoSugerido, 0),
    /** Las que se van a acabar en una fecha, no solo reponer minimo. */
    conFecha: conFecha.length,
    costoConFecha: conFecha.reduce((s, x) => s + x.costoSugerido, 0),
  };
}

/** Dos decimales como mucho, y sin el «.00» cuando es entero. */
function redondear(n: number) {
  return Number(n.toFixed(2)).toString();
}
