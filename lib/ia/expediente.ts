import { prisma } from "../db";
import { costoYParoPorActivo, indicadoresConComparacion, type Indicadores } from "../indicadores";
import { describirPeriodo } from "../periodos";
import { diaDelCompromiso } from "../vencimiento";
import { evaluarPuntos } from "../predictive";
import { saludDeDatos } from "../salud-datos";
import { contextoDeLaEmpresa } from "../contexto-negocio";
import { contextoGeografico } from "../geografia";
import { agruparPorCodigo, fallasCodificadas, filtroDeFalla } from "@/lib/fallas";

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
  // Los mismos indicadores, periodo y zona horaria que el Panel y Reportes:
  // el diagnostico no puede decir un MTTR distinto al que ve la persona.
  const { actual, previo } = await indicadoresConComparacion(organizationId, dias);
  const hasta = new Date();
  const desde = actual.periodo.desde;
  const desdePrevio = previo.periodo.desde;

  const deFalla = await filtroDeFalla(organizationId);
  const [org, sitios, salud, topCosto] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, plan: true, currency: true, industry: true, tipoInstalacion: true, queProduce: true, comoOpera: true, noPuedeParar: true, dueleHoy: true, objetivoDelAno: true, contextoAt: true },
    }),
    prisma.site.findMany({
      where: { organizationId },
      select: { name: true, city: true, country: true, address: true, latitud: true, longitud: true, notasAcceso: true },
    }),
    saludDeDatos(organizationId),
    costoYParoPorActivo(organizationId, actual.periodo, 6),
  ]);

  const [fallas, causas, bajoMinimo, planesVencidos, alertas, sinMovimiento, correctivasRepetidas] =
    await Promise.all([
      // Por fallasCodificadas y no por groupBy: este contaba cualquier OT con
      // codigo, y el modelo razonaba sobre preventivos codificados por error.
      fallasCodificadas(organizationId, desdePrevio, actual.periodo.hasta).then(agruparPorCodigo),
      prisma.workOrder.groupBy({
        by: ["rootCauseId"],
        where: { organizationId, rootCauseId: { not: null }, status: { not: "CANCELLED" }, createdAt: { gte: desdePrevio } },
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
          severity: true, message: true, createdAt: true, sensorId: true, normalizadaEl: true,
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
        // Fallas repetidas con la regla unica de `lib/fallas`, no solo correctivas.
        where: { ...deFalla, organizationId, createdAt: { gte: desdePrevio }, assetId: { not: null } },
        _count: { _all: true },
        having: { assetId: { _count: { gt: 2 } } },
      }),
    ]);

  // La misma evaluacion que Predictivo y Alertas: estado, tendencia y cruces
  // de hoy, no el mensaje guardado al detectar.
  const vivas = await evaluarPuntos(organizationId, alertas.map((a) => a.sensorId).filter(Boolean) as string[]);

  const medidoresSuspendidos = await prisma.meter.findMany({
    where: { organizationId, proyeccionSuspendida: true },
    select: { name: true, motivoSuspension: true, asset: { select: { code: true } } },
  });

  const sinPlan = await prisma.asset.findMany({
    // Por la ASIGNACION activa, no por el encabezado viejo del plan: un equipo
    // agregado a un plan de varios equipos no tiene el plan en su encabezado.
    where: {
      organizationId, active: true, status: { not: "RETIRED" },
      planesAsignados: { none: { active: true, plan: { active: true } } },
    },
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

  const delta = (hoy: number | null, antes: number | null) =>
    hoy === null || antes === null || antes === 0 ? null : Math.round(((hoy - antes) / antes) * 1000) / 10;
  const valor = (k: Indicadores, clave: keyof Indicadores["indicadores"], d = 1) => {
    const v = k.indicadores[clave].valor;
    return v === null ? null : redondear(v, d);
  };

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
      dias_completos: describirPeriodo(actual.periodo),
      zonaHoraria: actual.periodo.zonaHoraria,
      nota: "Los campos «cambio» son variación porcentual contra el periodo inmediato anterior de la misma duración. Un indicador en null NO es cero: no se pudo calcular, y «sinDato» dice por qué.",
    },

    calidadDeCaptura: {
      indice: salud.indice,
      nota: "De 0 a 100. Por debajo de 60 los indicadores no son confiables y hay que decirlo antes que cualquier otra cosa.",
      revisiones: salud.revisiones
        .filter((r) => r.total > 0)
        .map((r) => ({
          revision: r.titulo,
          nivel: r.nivel,
          porcentaje: r.porcentaje,
          cumplidos: r.cumplidos,
          total: r.total,
          conProblema: r.total - r.cumplidos,
          importa: r.porque,
          ejemplos: r.hallazgos.slice(0, 3).map((h) => (h.detalle ? `${h.etiqueta} (${h.detalle})` : h.etiqueta)),
        })),
    },

    confiabilidad: {
      mttrHoras: valor(actual, "mttr"),
      mttrCambio: delta(actual.indicadores.mttr.valor, previo.indicadores.mttr.valor),
      mtbfHoras: valor(actual, "mtbf"),
      mtbfCambio: delta(actual.indicadores.mtbf.valor, previo.indicadores.mtbf.valor),
      disponibilidad: valor(actual, "disponibilidad", 2),
      cumplimientoPreventivo: valor(actual, "cumplimientoPreventivo"),
      cumplimientoPreventivoCambio: delta(actual.indicadores.cumplimientoPreventivo.valor, previo.indicadores.cumplimientoPreventivo.valor),
      trabajoPlanificado: valor(actual, "trabajoPlanificado"),
      metaTrabajoPlanificado: 80,
      horasParoNoPlaneado: valor(actual, "paroNoPlaneado"),
      horasParoNoPlaneadoPrevio: valor(previo, "paroNoPlaneado"),
      horasParoPlaneado: valor(actual, "paroPlaneado"),
      horasParoAcumulado: valor(actual, "paroTotal"),
      precisionDeEstimacion: actual.precisionEstimacion === null ? null : redondear(actual.precisionEstimacion),
      tiempoDeRespuestaHoras: valor(actual, "tiempoRespuesta"),
      sinDato: Object.fromEntries(
        Object.values(actual.indicadores).filter((i) => i.sinValor).map((i) => [i.clave, i.sinValor]),
      ),
      notas: Object.values(actual.indicadores).flatMap((i) => i.notas.map((n) => `${i.nombre}: ${n}`)),
      definiciones: Object.values(actual.indicadores).map((i) => ({
        indicador: i.nombre,
        formula: i.formula,
        estados: i.alcance.estadosOT,
        fechaQueCuenta: i.alcance.fechaQueCuenta,
      })),
    },

    trabajo: {
      ordenesCreadas: actual.totales.ordenesCreadas,
      ordenesCreadasPrevio: previo.totales.ordenesCreadas,
      ordenesCanceladas: actual.totales.ordenesCanceladas,
      ordenesTerminadas: actual.totales.ordenesTerminadas,
      backlogAbierto: actual.totales.backlog,
      backlogVencido: actual.totales.backlogVencido,
      backlogHoras: redondear(actual.totales.backlogHoras),
      porTipo: actual.porTipo,
      porPrioridad: actual.porPrioridad,
      activos: actual.totales.activosEnServicio,
      activosDetenidos: actual.totales.activosParados,
      activosCriticos: actual.totales.activosCriticos,
    },

    costos: {
      moneda: org.currency,
      criterio: "Órdenes terminadas en el periodo; las canceladas no cuentan.",
      total: actual.costos.total,
      totalPrevio: previo.costos.total,
      manoDeObra: actual.costos.mano,
      refacciones: actual.costos.refacciones,
      serviciosExternos: actual.costos.servicios,
      otros: actual.costos.otros,
      enOrdenesAbiertas: actual.costos.enCurso,
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
      /** Planes por uso sin fecha confiable: su medidor tiene una lectura invalida. No inventar fecha. */
      medidoresConProyeccionSuspendida: medidoresSuspendidos.map((m) => ({
        activo: m.asset.code, medidor: m.name, motivo: m.motivoSuspension,
      })),
      activosSinPlan: sinPlan.map((a) => ({
        activo: `${a.code} ${a.name}`,
        criticidad: a.criticality,
      })),
      planesVencidos: planesVencidos.map((p) => ({
        plan: p.plan.name,
        activo: p.asset.code,
        vencioEl: p.nextDueDate ? diaDelCompromiso(p.nextDueDate, actual.periodo.zonaHoraria) : null,
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
      nota: "No hay modelo de falla: las fechas son cruces estimados de umbral por tendencia lineal. «Umbral crítico superado» es crítico aunque la tendencia sea estable. Una proyección vencida no es una fecha futura.",
      alertasAbiertas: alertas.map((a) => ({
        severidad: a.severity,
        activo: a.sensor?.asset?.code ?? "?",
        punto: a.sensor?.name ?? "?",
        mensajeAlDetectar: a.message,
        ...(() => {
          const e = a.sensorId ? vivas.get(a.sensorId) : undefined;
          return e
            ? {
                estadoHoy: e.etiquetaEstado,
                resumenHoy: e.resumen,
                tendencia: e.etiquetaTendencia,
                confianza: e.etiquetaConfianza,
                cruceAdvertencia: e.cruceAdvertencia.texto,
                cruceCritico: e.cruceCritico.texto,
              }
            : {};
        })(),
        normalizadaSinValidar: Boolean(a.normalizadaEl),
        diasAbierta: Math.floor((hasta.getTime() - a.createdAt.getTime()) / DIA),
      })),
    },
  };
}

export type Expediente = Awaited<ReturnType<typeof construirExpediente>>;
