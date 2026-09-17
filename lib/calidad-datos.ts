/**
 * Las reglas de calidad de datos, en UN solo lugar.
 *
 * Las leen el indice de calidad de captura (`lib/salud-datos.ts`), la
 * pantalla de Diagnostico y el expediente de la IA. Antes el indice tenia sus
 * propias cuentas y la IA las suyas; una misma pregunta —¿cuantas ordenes
 * cerradas no tienen causa?— tenia dos respuestas.
 *
 * Cada regla se clasifica:
 *
 *   ERROR          — dato imposible. Donde se captura, impide guardar
 *                    (`validarFechasDeActivo`, lecturas de medidor). Lo que se
 *                    encuentra aqui es historia anterior a la regla.
 *   ADVERTENCIA    — dato posible pero sospechoso: pide revision o confirmacion.
 *   RECOMENDACION  — dato que falta y resta valor a los indicadores.
 *
 * Nada de esto corrige datos: los señala con el registro exacto para que
 * alguien los revise. Corregir en automatico seria esconder la inconsistencia.
 */
import { prisma } from "./db";
import { filtroDeFalla } from "./fallas";
import { ESTADOS_TERMINADOS } from "./vencimiento";

const DIA = 86_400_000;
const HORA = 3_600_000;

export type NivelRegla = "ERROR" | "ADVERTENCIA" | "RECOMENDACION";

export const NIVELES: Record<NivelRegla, { etiqueta: string; tono: "danger" | "warning" | "info" }> = {
  ERROR: { etiqueta: "Error: impide guardar", tono: "danger" },
  ADVERTENCIA: { etiqueta: "Advertencia: requiere confirmación", tono: "warning" },
  RECOMENDACION: { etiqueta: "Recomendación", tono: "info" },
};

export type Hallazgo = { id: string; etiqueta: string; detalle?: string; enlace: string };

export type ResultadoRegla = {
  clave: string;
  titulo: string;
  nivel: NivelRegla;
  porque: string;
  enlace: string;
  /** Peso en el indice de captura. */
  peso: number;
  /** Universo revisado (lo que DEBERIA cumplir). */
  total: number;
  /** Cuantos no cumplen. */
  cantidad: number;
  /** Los primeros registros que no cumplen, para ir directo a ellos. */
  hallazgos: Hallazgo[];
};

const MUESTRA = 25;

function regla(
  base: Omit<ResultadoRegla, "cantidad" | "hallazgos">,
  hallazgos: Hallazgo[],
): ResultadoRegla {
  return { ...base, cantidad: hallazgos.length, hallazgos: hallazgos.slice(0, MUESTRA) };
}

const ot = (o: { id: string; number: string; title: string }, detalle?: string): Hallazgo => ({
  id: o.id, etiqueta: `${o.number} · ${o.title}`, detalle, enlace: `/work-orders/${o.id}`,
});
const activo = (a: { id: string; code: string; name: string }, detalle?: string): Hallazgo => ({
  id: a.id, etiqueta: `${a.code} · ${a.name}`, detalle, enlace: `/assets/${a.id}`,
});

/** Validacion al guardar un activo: fechas que no pueden ser. */
export function validarFechasDeActivo(
  datos: { purchaseDate?: Date | null; warrantyExpiry?: Date | null; commissionedAt?: Date | null },
  ahora = new Date(),
): string | null {
  if (datos.purchaseDate && datos.purchaseDate.getTime() > ahora.getTime() + DIA) {
    return "La fecha de compra no puede ser posterior a hoy.";
  }
  if (datos.purchaseDate && datos.warrantyExpiry && datos.warrantyExpiry < datos.purchaseDate) {
    return "La garantía no puede vencer antes de la fecha de compra.";
  }
  if (datos.purchaseDate && datos.commissionedAt && datos.commissionedAt < datos.purchaseDate) {
    return "La puesta en servicio no puede ser anterior a la compra.";
  }
  return null;
}

export async function revisarCalidad(organizationId: string, ahora = new Date()): Promise<ResultadoRegla[]> {
  const terminadas = { organizationId, status: { in: [...ESTADOS_TERMINADOS] } };
  // La regla unica de falla; su `status` se sustituye por el de terminadas.
  const { status: _sinCanceladas, ...esFallaWhere } = await filtroDeFalla(organizationId);
  const selOt = { id: true, number: true, title: true } as const;
  const selActivo = { id: true, code: true, name: true } as const;
  const enServicio = { organizationId, active: true, status: { not: "RETIRED" } };

  const [
    nTerminadas, sinHoras,
    nFallas, fallasSinCausa,
    nConParo, paroSinDuracion, eventosSinMinutos,
    costosNegativos, laborNegativa, partesNegativas,
    stockNegativo, minimosInvalidos, nRefacciones, refaccionesSinCosto, refaccionesSinMinimo,
    nCriticos, criticosSinPlan,
    nActivos, sinUbicacion, sinFamilia, sinValor, activosSinPlan,
    nPlanes, planesSinActividades, planesSinRecursos, actividadesDiarias,
    terminoAntesDeInicio, parosAlReves,
    fechasDeActivo,
    medidores, nMedidores, medidoresSinLectura,
    alertas,
    nCorrectivas, correctivasSinFalla,
    nOrdenes, nConFechas, nParosCerrados, nExistencias,
  ] = await Promise.all([
    prisma.workOrder.count({ where: terminadas }),
    prisma.workOrder.findMany({ where: { ...terminadas, actualHours: { lte: 0 }, labor: { none: {} } }, select: selOt }),

    prisma.workOrder.count({ where: { ...terminadas, ...esFallaWhere } }),
    prisma.workOrder.findMany({
      where: { ...terminadas, ...esFallaWhere, rootCauseId: null, tasks: { none: { rootCauseId: { not: null } } } },
      select: selOt,
    }),

    prisma.workOrder.count({ where: { ...terminadas, requiresShutdown: true } }),
    prisma.workOrder.findMany({
      where: {
        ...terminadas, requiresShutdown: true, downtimeMinutes: { lte: 0 },
        downtimes: { none: { minutes: { gt: 0 } } }, tasks: { none: { downtimeMinutes: { gt: 0 } } },
      },
      select: selOt,
    }),
    prisma.downtimeEvent.findMany({
      where: { asset: { organizationId }, minutes: { lte: 0 } },
      select: { id: true, startedAt: true, asset: { select: selActivo } },
    }),

    prisma.workOrder.findMany({
      where: {
        organizationId,
        OR: [{ laborCost: { lt: 0 } }, { partsCost: { lt: 0 } }, { serviceCost: { lt: 0 } }, { otherCost: { lt: 0 } }, { totalCost: { lt: 0 } }],
      },
      select: selOt,
    }),
    prisma.workOrderLabor.findMany({
      where: { workOrder: { organizationId }, OR: [{ cost: { lt: 0 } }, { hours: { lt: 0 } }, { rate: { lt: 0 } }] },
      select: { id: true, workOrder: { select: selOt } },
    }),
    prisma.workOrderPart.findMany({
      where: { workOrder: { organizationId }, OR: [{ unitCost: { lt: 0 } }, { quantity: { lt: 0 } }] },
      select: { id: true, workOrder: { select: selOt } },
    }),

    prisma.partStock.findMany({
      where: { organizationId, quantity: { lt: 0 } },
      select: { id: true, quantity: true, part: { select: { id: true, code: true, name: true } } },
    }),
    prisma.part.findMany({
      where: { organizationId, OR: [{ minQuantity: { lt: 0 } }, { unitCost: { lt: 0 } }] },
      select: { id: true, code: true, name: true },
    }),
    prisma.part.count({ where: { organizationId, active: true } }),
    prisma.part.findMany({ where: { organizationId, active: true, unitCost: { lte: 0 } }, select: { id: true, code: true, name: true } }),
    prisma.part.findMany({ where: { organizationId, active: true, minQuantity: { lte: 0 } }, select: { id: true, code: true, name: true } }),

    prisma.asset.count({ where: { ...enServicio, criticality: "A" } }),
    // Por la ASIGNACION activa, no por el encabezado viejo del plan.
    prisma.asset.findMany({
      where: { ...enServicio, criticality: "A", planesAsignados: { none: { active: true, plan: { active: true } } } },
      select: selActivo,
    }),

    prisma.asset.count({ where: enServicio }),
    prisma.asset.findMany({ where: { ...enServicio, locationId: null }, select: selActivo }),
    prisma.asset.findMany({ where: { ...enServicio, categoryId: null }, select: selActivo }),
    prisma.asset.findMany({ where: { ...enServicio, replacementCost: { lte: 0 } }, select: selActivo }),
    prisma.asset.findMany({ where: { ...enServicio, planesAsignados: { none: { active: true, plan: { active: true } } } }, select: selActivo }),

    prisma.maintenancePlan.count({ where: { organizationId, active: true } }),
    prisma.maintenancePlan.findMany({ where: { organizationId, active: true, tasks: { none: {} } }, select: { id: true, name: true } }),
    prisma.maintenancePlan.findMany({
      where: { organizationId, active: true, tasks: { some: {} }, NOT: { tasks: { some: { labor: { some: {} } } } } },
      select: { id: true, name: true },
    }),
    prisma.planTask.findMany({
      where: {
        plan: { organizationId, active: true, triggerType: "CALENDAR" },
        // Confirmada explicitamente = rutina valida, no problema de calidad.
        diariaConfirmadaEl: null,
        OR: [
          { cadaCuanto: { lte: 1 }, unidadFrecuencia: "DIAS" },
          { cadaCuanto: null, plan: { intervalDays: { lte: 1 } } },
        ],
      },
      select: { id: true, title: true, plan: { select: { id: true, name: true } } },
    }),

    prisma.workOrder.findMany({
      where: { organizationId, startedAt: { not: null }, completedAt: { not: null } },
      select: { ...selOt, startedAt: true, completedAt: true },
    }).then((xs) => xs.filter((o) => o.completedAt! < o.startedAt!)),
    prisma.downtimeEvent.findMany({
      where: { asset: { organizationId }, endedAt: { not: null } },
      select: { id: true, startedAt: true, endedAt: true, asset: { select: selActivo } },
    }).then((xs) => xs.filter((e) => e.endedAt! < e.startedAt)),

    prisma.asset.findMany({
      where: { organizationId, OR: [{ purchaseDate: { not: null } }, { warrantyExpiry: { not: null } }] },
      select: { ...selActivo, purchaseDate: true, warrantyExpiry: true, commissionedAt: true },
    }),

    prisma.meter.findMany({
      where: { organizationId },
      select: {
        id: true, name: true, tipo: true, unit: true, dailyAverage: true, maxIncrementoDiario: true,
        asset: { select: selActivo },
        readings: {
          where: { estado: { not: "ANULADA" } },
          orderBy: [{ readingAt: "asc" }, { id: "asc" }],
          select: { value: true, readingAt: true, tipo: true, atipica: true },
        },
      },
    }),
    prisma.meter.count({ where: { organizationId } }),
    prisma.meter.findMany({
      where: { organizationId, readings: { none: { estado: { not: "ANULADA" }, readingAt: { gte: new Date(ahora.getTime() - 45 * DIA) } } } },
      select: { id: true, name: true, asset: { select: selActivo } },
    }),

    prisma.predictiveAlert.findMany({
      where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      select: { id: true, title: true, createdAt: true, projectedFailureAt: true, fechaCruceCritico: true, fechaCruceAdvertencia: true },
    }),

    prisma.workOrder.count({ where: { ...terminadas, maintenanceType: "CORRECTIVE" } }),
    prisma.workOrder.findMany({
      where: { ...terminadas, maintenanceType: "CORRECTIVE", failureCodeId: null, tasks: { none: { failureCodeId: { not: null } } } },
      select: selOt,
    }),

    // Universos de las reglas de error, para que un solo registro malo pese lo
    // que pesa y no tumbe el indice completo.
    prisma.workOrder.count({ where: { organizationId } }),
    prisma.workOrder.count({ where: { organizationId, startedAt: { not: null }, completedAt: { not: null } } }),
    prisma.downtimeEvent.count({ where: { asset: { organizationId }, endedAt: { not: null } } }),
    prisma.partStock.count({ where: { organizationId } }),
  ]);

  // ── Medidores con uso imposible ─────────────────────────────────────────
  const medidoresImposibles: Hallazgo[] = [];
  for (const m of medidores) {
    const problemas: string[] = [];
    if (m.tipo === "HOROMETRO" && m.dailyAverage > 24) problemas.push(`promedio de ${m.dailyAverage.toFixed(1)} h/día`);
    for (let i = 1; i < m.readings.length; i++) {
      const a = m.readings[i - 1];
      const b = m.readings[i];
      if (b.tipo !== "LECTURA") continue;
      const horas = (b.readingAt.getTime() - a.readingAt.getTime()) / HORA;
      const inc = b.value - a.value;
      if (inc < 0) problemas.push(`lectura menor que la anterior el ${b.readingAt.toISOString().slice(0, 10)}`);
      else if (m.tipo === "HOROMETRO" && inc > Math.max(0, horas) + 1e-9) {
        problemas.push(`+${inc.toFixed(0)} h en ${horas.toFixed(0)} h de reloj el ${b.readingAt.toISOString().slice(0, 10)}`);
      }
    }
    if (problemas.length) {
      medidoresImposibles.push({
        id: m.id,
        etiqueta: `${m.asset.code} · ${m.name}`,
        detalle: problemas.slice(0, 3).join("; "),
        enlace: "/meters",
      });
    }
  }

  // ── Alertas con fechas incoherentes ─────────────────────────────────────
  // Incoherente = anterior a la propia deteccion. Una fecha posterior que ya
  // paso no es un error de dato: fue la proyeccion de su momento, y las
  // pantallas la leen en vivo como «Proyección vencida».
  const alertasIncoherentes: Hallazgo[] = alertas
    .map((a) => {
      const campos = [
        ["cruce crítico", a.fechaCruceCritico],
        ["cruce de advertencia", a.fechaCruceAdvertencia],
        ["fecha proyectada", a.projectedFailureAt],
      ] as const;
      const mala = campos.find(([, f]) => f && f < a.createdAt);
      if (!mala) return null;
      return { id: a.id, etiqueta: a.title, detalle: `${mala[0]} ${(mala[1] as Date).toISOString().slice(0, 10)} anterior a su detección`, enlace: "/alerts" };
    })
    .filter(Boolean) as Hallazgo[];

  const fechasIncoherentes: Hallazgo[] = fechasDeActivo
    .map((a) => {
      const error = validarFechasDeActivo(a, ahora);
      return error ? activo(a, error) : null;
    })
    .filter(Boolean) as Hallazgo[];

  return [
    // ── Errores ──
    regla({ clave: "fechas-termino-antes-de-inicio", titulo: "Fechas de término anteriores al inicio", nivel: "ERROR",
      porque: "Una orden o un paro que termina antes de empezar da duraciones negativas en MTTR y disponibilidad.",
      enlace: "/work-orders", peso: 2, total: nConFechas + nParosCerrados },
    [
      ...terminoAntesDeInicio.map((o) => ot(o, "terminada antes de iniciarse")),
      ...parosAlReves.map((e) => activo(e.asset, `paro que termina antes de empezar (${e.startedAt.toISOString().slice(0, 10)})`)),
    ]),
    regla({ clave: "costos-negativos", titulo: "Costos o cantidades negativas en órdenes", nivel: "ERROR",
      porque: "Un costo negativo resta del gasto real y hace ver barato lo que no lo fue.",
      enlace: "/work-orders", peso: 2, total: nOrdenes },
    [
      ...costosNegativos.map((o) => ot(o, "costo negativo")),
      ...laborNegativa.map((l) => ot(l.workOrder, "mano de obra negativa")),
      ...partesNegativas.map((p) => ot(p.workOrder, "refacción con costo o cantidad negativa")),
    ]),
    regla({ clave: "inventario-invalido", titulo: "Existencias o parámetros de inventario inválidos", nivel: "ERROR",
      porque: "Una existencia negativa significa que se consumió lo que no había: el kardex no cuadra.",
      enlace: "/inventory", peso: 2, total: nExistencias + nRefacciones },
    [
      ...stockNegativo.map((s) => ({ id: s.id, etiqueta: `${s.part.code} · ${s.part.name}`, detalle: `existencia ${s.quantity}`, enlace: "/inventory" })),
      ...minimosInvalidos.map((p) => ({ id: p.id, etiqueta: `${p.code} · ${p.name}`, detalle: "mínimo o costo negativo", enlace: "/inventory" })),
    ]),
    regla({ clave: "fechas-de-activo", titulo: "Compras a futuro o garantías incoherentes", nivel: "ERROR",
      porque: "Una compra posterior a hoy o una garantía que vence antes de comprar invalida la antigüedad y la vigencia del equipo.",
      enlace: "/assets", peso: 1, total: fechasDeActivo.length }, fechasIncoherentes),
    regla({ clave: "medidores-imposibles", titulo: "Medidores con uso imposible", nivel: "ERROR",
      porque: "Un horómetro que suma más horas que las del reloj adelanta los planes por uso y falsea el promedio.",
      enlace: "/meters", peso: 2, total: nMedidores }, medidoresImposibles),

    // ── Advertencias ──
    regla({ clave: "ot-sin-horas", titulo: "Órdenes terminadas sin horas reales", nivel: "ADVERTENCIA",
      porque: "Sin horas no hay costo de mano de obra, MTTR ni productividad medible.",
      enlace: "/work-orders", peso: 2, total: nTerminadas }, sinHoras.map((o) => ot(o))),
    regla({ clave: "fallas-sin-causa", titulo: "Reparaciones de falla sin causa raíz", nivel: "ADVERTENCIA",
      porque: "Sin causa raíz no hay análisis de fallas: se repara lo mismo una y otra vez.",
      enlace: "/work-orders", peso: 3, total: nFallas }, fallasSinCausa.map((o) => ot(o))),
    regla({ clave: "paro-sin-duracion", titulo: "Paros sin duración", nivel: "ADVERTENCIA",
      porque: "Una orden que requirió parar el equipo sin minutos de paro esconde pérdida de disponibilidad.",
      enlace: "/work-orders", peso: 2, total: nConParo + eventosSinMinutos.length },
    [
      ...paroSinDuracion.map((o) => ot(o, "requirió paro y no registra duración")),
      ...eventosSinMinutos.map((e) => activo(e.asset, `evento de paro de 0 minutos (${e.startedAt.toISOString().slice(0, 10)})`)),
    ]),
    regla({ clave: "criticos-sin-plan", titulo: "Activos críticos sin plan", nivel: "ADVERTENCIA",
      porque: "Un equipo crítico sin plan solo recibe correctivo: nunca se adelanta a la falla.",
      enlace: "/plans", peso: 3, total: nCriticos }, criticosSinPlan.map((a) => activo(a))),
    regla({ clave: "planes-sin-actividades", titulo: "Planes sin actividades", nivel: "ADVERTENCIA",
      porque: "Un plan sin actividades genera órdenes vacías.",
      enlace: "/plans", peso: 2, total: nPlanes },
    planesSinActividades.map((p) => ({ id: p.id, etiqueta: p.name, enlace: "/plans" }))),
    regla({ clave: "frecuencia-atipica", titulo: "Rutinas diarias sin confirmar", nivel: "ADVERTENCIA",
      porque: "Una rutina diaria genera 365 visitas al año. Si fue un error de captura, satura el calendario y el backlog.",
      enlace: "/plans", peso: 1, total: nPlanes },
    actividadesDiarias.map((t) => ({ id: t.id, etiqueta: `${t.plan.name} · ${t.title}`, detalle: "cada día", enlace: "/plans" }))),
    regla({ clave: "alertas-fechas-incoherentes", titulo: "Alertas predictivas con fechas incoherentes", nivel: "ADVERTENCIA",
      porque: "Una fecha proyectada anterior a la propia detección es un dato imposible. Se sanea con scripts/sanear-fechas-predictivas.ts, que deja bitácora.",
      enlace: "/alerts", peso: 1, total: alertas.length }, alertasIncoherentes),

    // ── Recomendaciones ──
    regla({ clave: "correctivas-sin-falla", titulo: "Correctivas sin código de falla", nivel: "RECOMENDACION",
      porque: "Es lo que permite ver qué modo de falla domina en la planta.",
      enlace: "/work-orders", peso: 2, total: nCorrectivas }, correctivasSinFalla.map((o) => ot(o))),
    regla({ clave: "activos-sin-plan", titulo: "Activos sin plan de mantenimiento", nivel: "RECOMENDACION",
      porque: "Un activo sin plan solo genera trabajo correctivo.",
      enlace: "/plans", peso: 2, total: nActivos },
    activosSinPlan.map((a) => activo(a))),
    regla({ clave: "planes-sin-recursos", titulo: "Planes sin mano de obra estimada", nivel: "RECOMENDACION",
      porque: "Sin mano de obra estimada, el plan no se puede presupuestar ni preparar.",
      enlace: "/plans", peso: 2, total: nPlanes },
    planesSinRecursos.map((p) => ({ id: p.id, etiqueta: p.name, enlace: "/plans" }))),
    regla({ clave: "refacciones-sin-minimo", titulo: "Refacciones sin mínimo", nivel: "RECOMENDACION",
      porque: "El mínimo es lo que dispara la alerta de reposición. En cero, nunca avisa.",
      enlace: "/inventory", peso: 2, total: nRefacciones },
    refaccionesSinMinimo.map((p) => ({ id: p.id, etiqueta: `${p.code} · ${p.name}`, enlace: "/inventory" }))),
    regla({ clave: "refacciones-sin-costo", titulo: "Refacciones sin costo", nivel: "RECOMENDACION",
      porque: "Sin costo, el consumo de almacén no llega al costo de la orden.",
      enlace: "/inventory", peso: 1, total: nRefacciones },
    refaccionesSinCosto.map((p) => ({ id: p.id, etiqueta: `${p.code} · ${p.name}`, enlace: "/inventory" }))),
    regla({ clave: "activos-sin-ubicacion", titulo: "Activos sin ubicación", nivel: "RECOMENDACION",
      porque: "Es como se filtra el trabajo por área y como se encuentra el equipo en piso.",
      enlace: "/assets", peso: 1, total: nActivos }, sinUbicacion.map((a) => activo(a))),
    regla({ clave: "activos-sin-familia", titulo: "Activos sin familia", nivel: "RECOMENDACION",
      porque: "Es como se filtra «solo compresores» y lo que la IA necesita para proponer agrupaciones.",
      enlace: "/assets", peso: 1, total: nActivos }, sinFamilia.map((a) => activo(a))),
    regla({ clave: "activos-sin-valor", titulo: "Activos sin costo de reemplazo", nivel: "RECOMENDACION",
      porque: "Permite comparar lo gastado contra reponer el equipo: la decisión de reemplazo.",
      enlace: "/assets", peso: 1, total: nActivos }, sinValor.map((a) => activo(a))),
    regla({ clave: "medidores-sin-lectura", titulo: "Medidores sin lectura reciente", nivel: "RECOMENDACION",
      porque: "Un medidor sin lecturas en 45 días deja de disparar los planes que dependen de él.",
      enlace: "/meters", peso: 1, total: nMedidores },
    medidoresSinLectura.map((m) => ({ id: m.id, etiqueta: `${m.asset.code} · ${m.name}`, enlace: "/meters" }))),
  ];
}
