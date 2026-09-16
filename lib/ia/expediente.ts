import { prisma } from "../db";
import { assetCostRanking, computeKpis } from "../kpi";
import { saludDeDatos } from "../salud-datos";
import { contextoDeLaEmpresa } from "../contexto-negocio";
import { contextoGeografico } from "../geografia";
import { agruparPorCodigo, fallasCodificadas } from "@/lib/fallas";

/**
 * El expediente que se le entrega al modelo.
 *
 * Todo lo que hay aqui esta calculado por el sistema: promedios, conteos,
 * tendencias y comparaciones contra el periodo anterior. El modelo no ve un
 * solo renglon crudo ni hace una sola cuenta.
 *
 * Esa es la regla que hace confiable el diagnostico. Un modelo de lenguaje
 * interpreta bien y suma mal; si le pidieramos que calculara el MTTR sobre
 * 400 ordenes, el numero saldria plausible y equivocado, y nadie lo notaria.
 * Aqui el numero viene de la base de datos y el modelo solo explica que
 * significa y que hacer con el.
 */

const DIA = 86_400_000;

export async function construirExpediente(organizationId: string, dias = 30) {
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - dias * DIA);
  const desdePrevio = new Date(desde.getTime() - dias * DIA);

  const [org, sitios, salud, actual, previo, topCosto] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, plan: true, currency: true, industry: true, tipoInstalacion: true, queProduce: true, comoOpera: true, noPuedeParar: true, dueleHoy: true, objetivoDelAno: true, contextoAt: true },
    }),
    prisma.site.findMany({
      where: { organizationId },
      select: { name: true, city: true, country: true, address: true, latitud: true, longitud: true, notasAcceso: true },
    }),
    saludDeDatos(organizationId),
    computeKpis(organizationId, { from: desde, to: hasta }),
    computeKpis(organizationId, { from: desdePrevio, to: desde }),
    assetCostRanking(organizationId, 6),
  ]);

  const [fallas, causas, bajoMinimo, planesVencidos, alertas, sinMovimiento, correctivasRepetidas] =
    await Promise.all([
      // Por fallasCodificadas y no por groupBy: este contaba cualquier OT con
      // codigo, y el modelo razonaba sobre preventivos codificados por error.
      fallasCodificadas(organizationId, desdePrevio).then(agruparPorCodigo),
      prisma.workOrder.groupBy({
        by: ["rootCauseId"],
        where: { organizationId, rootCauseId: { not: null }, createdAt: { gte: desdePrevio } },
        _count: { _all: true },
      }),
      prisma.part.findMany({
        where: { organizationId, active: true, minQuantity: { gt: 0 } },
        select: { code: true, name: true, quantityOnHand: true, minQuantity: true, unit: true, unitCost: true },
      }),
      /**
       * Lo vencido sale de las ASIGNACIONES —un renglon por plan y equipo—, no
       * del encabezado del plan.
       *
       * La fecha del encabezado dejo de moverse cuando el calendario paso a
       * vivir en cada equipo, y luego en cada actividad: leerla le reportaba a
       * la IA atrasos que no eran, y le escondia los de los equipos que no
       * fueran el del encabezado.
       */
      prisma.planAsset.findMany({
        where: {
          organizationId, active: true, nextDueDate: { lt: hasta },
          plan: { active: true },
          asset: { active: true, status: { not: "RETIRED" } },
        },
        select: { nextDueDate: true, plan: { select: { name: true } }, asset: { select: { code: true } } },
        orderBy: { nextDueDate: "asc" },
        take: 10,
      }),
      prisma.predictiveAlert.findMany({
        where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        select: {
          severity: true, message: true, createdAt: true,
          sensor: { select: { name: true, unit: true, asset: { select: { code: true } } } },
        },
        take: 10,
      }),
      prisma.part.count({
        where: {
          organizationId, active: true, quantityOnHand: { gt: 0 },
          movements: { none: { createdAt: { gte: new Date(hasta.getTime() - 180 * DIA) } } },
        },
      }),
      prisma.workOrder.groupBy({
        by: ["assetId"],
        where: { organizationId, maintenanceType: "CORRECTIVE", createdAt: { gte: desdePrevio }, assetId: { not: null } },
        _count: { _all: true },
        having: { assetId: { _count: { gt: 2 } } },
      }),
    ]);

  const sinPlan = await prisma.asset.findMany({
    where: { organizationId, active: true, plans: { none: {} } },
    select: { code: true, name: true, criticality: true },
    orderBy: [{ criticality: "asc" }, { code: "asc" }],
    take: 15,
  });

  const [codigos, raices, activosRepetidos] = await Promise.all([
    prisma.failureCode.findMany({
      where: { id: { in: fallas.map((f) => f.failureCodeId) } },
      select: { id: true, code: true, description: true },
    }),
    prisma.rootCause.findMany({
      where: { id: { in: causas.map((c) => c.rootCauseId!) } },
      select: { id: true, code: true, description: true },
    }),
    prisma.asset.findMany({
      where: { id: { in: correctivasRepetidas.map((c) => c.assetId!) } },
      select: { id: true, code: true, name: true, criticality: true },
    }),
  ]);

  const delta = (hoy: number, antes: number) =>
    antes === 0 ? null : Math.round(((hoy - antes) / antes) * 1000) / 10;

  const redondear = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

  return {
    empresa: {
      nombre: org.name,
      giro: org.industry,
      instalacion: contextoDeLaEmpresa(org),
      ubicacion: contextoGeografico(sitios),
      plan: org.plan,
      moneda: org.currency,
    },
    periodo: {
      dias,
      desde: desde.toISOString().slice(0, 10),
      hasta: hasta.toISOString().slice(0, 10),
      nota: "Los campos «cambio» son variación porcentual contra el periodo inmediato anterior de la misma duración.",
    },

    calidadDeCaptura: {
      indice: salud.indice,
      nota: "De 0 a 100. Por debajo de 60 los indicadores no son confiables y hay que decirlo antes que cualquier otra cosa.",
      revisiones: salud.revisiones
        .filter((r) => r.total > 0)
        .map((r) => ({
          revision: r.titulo,
          porcentaje: r.porcentaje,
          cumplidos: r.cumplidos,
          total: r.total,
          faltan: r.total - r.cumplidos,
          importa: r.porque,
        })),
    },

    confiabilidad: {
      mttrHoras: redondear(actual.reliability.mttr),
      mttrCambio: delta(actual.reliability.mttr, previo.reliability.mttr),
      mtbfHoras: redondear(actual.reliability.mtbf),
      mtbfCambio: delta(actual.reliability.mtbf, previo.reliability.mtbf),
      disponibilidad: redondear(actual.reliability.availability, 2),
      cumplimientoPreventivo: redondear(actual.reliability.pmCompliance),
      cumplimientoPreventivoCambio: delta(actual.reliability.pmCompliance, previo.reliability.pmCompliance),
      trabajoPlanificado: redondear(actual.reliability.plannedRatio),
      metaTrabajoPlanificado: 80,
      horasParoNoPlaneado: redondear(actual.reliability.unplannedDowntimeMinutes / 60),
      horasParoNoPlaneadoPrevio: redondear(previo.reliability.unplannedDowntimeMinutes / 60),
      precisionDeEstimacion: redondear(actual.reliability.estimateAccuracy),
      tiempoDeRespuestaHoras: redondear(actual.reliability.avgResponseHours),
    },

    trabajo: {
      ordenesCreadas: actual.totals.workOrders,
      ordenesCreadasPrevio: previo.totals.workOrders,
      ordenesCerradas: actual.totals.completed,
      backlogAbierto: actual.totals.backlog,
      backlogVencido: actual.totals.overdue,
      backlogHoras: redondear(actual.totals.backlogHours),
      porTipo: actual.byType,
      porPrioridad: actual.byPriority,
      activos: actual.totals.assets,
      activosDetenidos: actual.totals.assetsDown,
      activosCriticos: actual.totals.criticalAssets,
    },

    costos: {
      moneda: org.currency,
      total: Math.round(actual.costs.totalCost),
      totalPrevio: Math.round(previo.costs.totalCost),
      manoDeObra: Math.round(actual.costs.laborCost),
      refacciones: Math.round(actual.costs.partsCost),
      serviciosExternos: Math.round(actual.costs.serviceCost),
      otros: Math.round(actual.costs.otherCost),
      activosMasCaros: topCosto.map((a) => ({
        activo: `${a.code} ${a.name}`,
        criticidad: a.criticality,
        costo: a.costo,
        paroHoras: a.paroHoras,
      })),
    },

    fallas: {
      codigosMasFrecuentes: fallas
        .map((f) => {
          const c = codigos.find((x) => x.id === f.failureCodeId);
          return { codigo: c?.code ?? "?", descripcion: c?.description ?? "", ordenes: f.eventos };
        })
        .sort((a, b) => b.ordenes - a.ordenes)
        .slice(0, 8),
      causasRaizMasFrecuentes: causas
        .map((c) => {
          const r = raices.find((x) => x.id === c.rootCauseId);
          return { causa: r?.description ?? "?", ordenes: c._count._all };
        })
        .sort((a, b) => b.ordenes - a.ordenes)
        .slice(0, 8),
      activosConCorrectivosRepetidos: correctivasRepetidas
        .map((c) => {
          const a = activosRepetidos.find((x) => x.id === c.assetId);
          return {
            activo: a ? `${a.code} ${a.name}` : "?",
            criticidad: a?.criticality ?? "C",
            correctivos: c._count._all,
          };
        })
        .sort((a, b) => b.correctivos - a.correctivos)
        .slice(0, 8),
    },

    preventivo: {
      activosSinPlan: sinPlan.map((a) => ({
        activo: `${a.code} ${a.name}`,
        criticidad: a.criticality,
      })),
      planesVencidos: planesVencidos.map((p) => ({
        plan: p.plan.name,
        activo: p.asset.code,
        vencioEl: p.nextDueDate?.toISOString().slice(0, 10) ?? null,
        diasDeAtraso: p.nextDueDate
          ? Math.floor((hasta.getTime() - p.nextDueDate.getTime()) / DIA)
          : null,
      })),
    },

    almacen: {
      articulosBajoMinimo: bajoMinimo
        .filter((p) => p.quantityOnHand <= p.minQuantity)
        .map((p) => ({
          refaccion: `${p.code} ${p.name}`,
          existencia: p.quantityOnHand,
          minimo: p.minQuantity,
          unidad: p.unit,
          costoUnitario: Math.round(p.unitCost),
          // En el minimo exacto el faltante es cero y aun asi hay que resurtir:
          // cualquier consumo la deja sin existencia.
          estado: p.quantityOnHand < p.minQuantity ? "por debajo del mínimo" : "justo en el mínimo",
        }))
        .slice(0, 10),
      articulosSinMovimientoEn180Dias: sinMovimiento,
    },

    predictivo: {
      alertasAbiertas: alertas.map((a) => ({
        severidad: a.severity,
        activo: a.sensor?.asset?.code ?? "?",
        punto: a.sensor?.name ?? "?",
        mensaje: a.message,
        diasAbierta: Math.floor((hasta.getTime() - a.createdAt.getTime()) / DIA),
      })),
    },
  };
}

export type Expediente = Awaited<ReturnType<typeof construirExpediente>>;
