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
import { filtrosDelProceso, DIAS_PARA_CERRAR } from "./saneamiento-ot";
import { motivoSinOtActiva, TITULO_SOLICITUDES_SIN_OT } from "./reglas-ot";
import { alertaAbierta } from "./alertas";

const DIA = 86_400_000;

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
  /**
   * Regla del proceso de ordenes que alimenta directamente horas, costos,
   * MTTR, paros o backlog. Su incumplimiento pesa el triple en el indice (ver
   * `lib/salud-datos.ts`): un 15 % de ordenes sin horas no es «85 % bien».
   */
  critica?: boolean;
  /** Universo revisado (lo que DEBERIA cumplir). */
  total: number;
  /** Cuantos no cumplen. */
  cantidad: number;
  /** Los primeros registros que no cumplen, para ir directo a ellos. */
  hallazgos: Hallazgo[];
};

const MUESTRA = 25;

/**
 * `cantidad` es el numero REAL de incumplimientos; `hallazgos` es solo la
 * muestra que se dibuja. Van separados porque hay reglas cuya consulta trae
 * una muestra acotada —no tiene sentido traer siete mil renglones para
 * enseñar veinticinco— pero cuyo conteo alimenta el indice de captura y
 * tiene que ser exacto.
 */
function regla(
  base: Omit<ResultadoRegla, "cantidad" | "hallazgos">,
  hallazgos: Hallazgo[],
  cantidad = hallazgos.length,
): ResultadoRegla {
  return { ...base, cantidad, hallazgos: hallazgos.slice(0, MUESTRA) };
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
  // Los huecos del proceso de ordenes: el mismo filtro que la lista de saneamiento.
  const f = await filtrosDelProceso(organizationId, ahora);
  const selOt = { id: true, number: true, title: true } as const;
  const selActivo = { id: true, code: true, name: true } as const;
  const enServicio = { organizationId, active: true, status: { not: "RETIRED" } };

  const [
    nTerminadas, sinHoras,
    nFallas, fallasSinDiagnostico,
    nConParo, paroSinDuracion, eventosSinMinutos,
    nActivas, activasSinResponsable, nCompletadas, completadasSinCerrar,
    nConvertidas, solicitudesHuerfanas, nActividadesTerminadas, actividadesSinResolver,
    costosNegativos, laborNegativa, partesNegativas,
    stockNegativo, minimosInvalidos, nRefacciones, refaccionesSinCosto, refaccionesSinMinimo,
    nCriticos, criticosSinPlan,
    nActivos, sinUbicacion, sinFamilia, sinValor, activosSinPlan,
    nPlanes, planesSinActividades, planesSinRecursos, actividadesDiarias,
    terminoAntesDeInicio, parosAlReves,
    fechasDeActivo,
    medidores, nMedidores, medidoresSinLectura,
    alertas,
    nOrdenes, nConFechas, nParosCerrados, nExistencias,
    nTerminoAntes, nParosAlReves, nMedidoresImposibles,
  ] = await Promise.all([
    prisma.workOrder.count({ where: f.terminadas }),
    prisma.workOrder.findMany({ where: f.sinHoras, select: selOt }),

    prisma.workOrder.count({ where: f.fallasTerminadas }),
    prisma.workOrder.findMany({ where: f.fallasSinDiagnostico, select: selOt }),

    prisma.workOrder.count({ where: f.conParo }),
    prisma.workOrder.findMany({ where: f.paroSinDuracion, select: selOt }),
    prisma.downtimeEvent.findMany({
      where: { organizationId, minutes: { lte: 0 } },
      select: { id: true, startedAt: true, asset: { select: selActivo } },
    }),

    prisma.workOrder.count({ where: f.activas }),
    prisma.workOrder.findMany({ where: f.activasSinResponsable, select: selOt }),
    prisma.workOrder.count({ where: f.completadas }),
    prisma.workOrder.findMany({ where: f.completadasSinCerrar, select: { ...selOt, completedAt: true } }),
    prisma.workRequest.count({ where: f.convertidas }),
    prisma.workRequest.findMany({
      where: f.solicitudesHuerfanas,
      select: { id: true, number: true, title: true, workOrder: { select: { number: true, status: true } } },
    }),
    prisma.workOrderTask.count({ where: f.actividadesDeTerminadas }),
    prisma.workOrderTask.findMany({
      where: f.actividadesSinResolver,
      select: { id: true, title: true, workOrder: { select: selOt } },
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

    // «Termino antes de empezar» lo decide la base comparando las dos
    // columnas. Antes se traian TODAS las ordenes con las dos fechas y se
    // filtraban en memoria para encontrar, casi siempre, ninguna.
    prisma.workOrder.findMany({
      where: { organizationId, startedAt: { not: null }, completedAt: { lt: prisma.workOrder.fields.startedAt } },
      select: { ...selOt, startedAt: true, completedAt: true },
      take: MUESTRA,
    }),
    prisma.downtimeEvent.findMany({
      where: { organizationId, endedAt: { lt: prisma.downtimeEvent.fields.startedAt } },
      select: { id: true, startedAt: true, endedAt: true, asset: { select: selActivo } },
      take: MUESTRA,
    }),

    prisma.asset.findMany({
      where: { organizationId, OR: [{ purchaseDate: { not: null } }, { warrantyExpiry: { not: null } }] },
      select: { ...selActivo, purchaseDate: true, warrantyExpiry: true, commissionedAt: true },
    }),

    /**
     * Medidores con uso imposible, SIN recorrer sus lecturas.
     *
     * Esto recorria todas las lecturas de todos los medidores comparando cada
     * una con la anterior: cien mil renglones traidos a memoria en cada carga
     * del inicio del administrador, y 2.4 de los 6.4 segundos que tardaba esa
     * pantalla. Era ademas trabajo repetido: el sistema YA hace esa revision
     * al registrar cada lectura y guarda el resultado en el medidor
     * (`proyeccionSuspendida` y `motivoSuspension`, ver lib/medidores.ts).
     *
     * Si un medidor viejo tuviera la marca desatrasada, se corrige con
     * `scripts/recalcular-medidores.ts`, que es quien la mantiene.
     */
    prisma.meter.findMany({
      where: {
        organizationId,
        OR: [
          { proyeccionSuspendida: true },
          { tipo: "HOROMETRO", dailyAverage: { gt: 24 } },
        ],
      },
      select: { id: true, name: true, tipo: true, dailyAverage: true, motivoSuspension: true, asset: { select: selActivo } },
      take: MUESTRA,
    }),
    prisma.meter.count({ where: { organizationId } }),
    prisma.meter.findMany({
      where: { organizationId, readings: { none: { estado: { not: "ANULADA" }, readingAt: { gte: new Date(ahora.getTime() - 45 * DIA) } } } },
      select: { id: true, name: true, asset: { select: selActivo } },
    }),

    prisma.predictiveAlert.findMany({
      where: { organizationId, ...alertaAbierta() },
      select: { id: true, title: true, createdAt: true, projectedFailureAt: true, fechaCruceCritico: true, fechaCruceAdvertencia: true },
    }),


    // Universos de las reglas de error, para que un solo registro malo pese lo
    // que pesa y no tumbe el indice completo.
    prisma.workOrder.count({ where: { organizationId } }),
    prisma.workOrder.count({ where: { organizationId, startedAt: { not: null }, completedAt: { not: null } } }),
    prisma.downtimeEvent.count({ where: { organizationId, endedAt: { not: null } } }),
    prisma.partStock.count({ where: { organizationId } }),
    // Conteos exactos de las dos reglas cuya muestra viene acotada.
    prisma.workOrder.count({ where: { organizationId, startedAt: { not: null }, completedAt: { lt: prisma.workOrder.fields.startedAt } } }),
    prisma.downtimeEvent.count({ where: { organizationId, endedAt: { lt: prisma.downtimeEvent.fields.startedAt } } }),
    prisma.meter.count({
      where: { organizationId, OR: [{ proyeccionSuspendida: true }, { tipo: "HOROMETRO", dailyAverage: { gt: 24 } }] },
    }),
  ]);

  // ── Medidores con uso imposible ─────────────────────────────────────────
  // Lo que ya dictamino el sistema al registrar las lecturas, mas el promedio
  // diario, que vive en el propio medidor.
  const medidoresImposibles: Hallazgo[] = medidores.map((m) => {
    const problemas: string[] = [];
    if (m.tipo === "HOROMETRO" && m.dailyAverage > 24) problemas.push(`promedio de ${m.dailyAverage.toFixed(1)} h/día`);
    if (m.motivoSuspension) problemas.push(m.motivoSuspension);
    return {
      id: m.id,
      etiqueta: `${m.asset.code} · ${m.name}`,
      detalle: problemas.slice(0, 2).join("; "),
      enlace: "/meters",
    };
  });

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
    ], nTerminoAntes + nParosAlReves),
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
      enlace: "/meters", peso: 2, total: nMedidores }, medidoresImposibles, nMedidoresImposibles),

    // ── Advertencias ──
    regla({ clave: "ot-sin-horas", titulo: "Órdenes terminadas sin horas reales", nivel: "ADVERTENCIA", critica: true,
      porque: "Sin horas no hay costo de mano de obra, MTTR ni productividad medible. Una excepción justificada al completar no cuenta aquí.",
      enlace: "/work-orders", peso: 3, total: nTerminadas }, sinHoras.map((o) => ot(o))),
    regla({ clave: "fallas-sin-diagnostico", titulo: "Correctivas sin diagnóstico (código de falla y causa raíz)", nivel: "ADVERTENCIA", critica: true,
      porque: "Sin código y causa no hay análisis de fallas: se repara lo mismo una y otra vez. «Sin determinar» con justificación no cuenta aquí.",
      enlace: "/work-orders", peso: 3, total: nFallas }, fallasSinDiagnostico.map((o) => ot(o))),
    regla({ clave: "paro-sin-duracion", titulo: "Paros sin duración", nivel: "ADVERTENCIA", critica: true,
      porque: "Una orden que requirió parar el equipo sin minutos de paro esconde pérdida de disponibilidad.",
      enlace: "/work-orders", peso: 2, total: nConParo + eventosSinMinutos.length },
    [
      ...paroSinDuracion.map((o) => ot(o, "requirió paro y no registra duración")),
      ...eventosSinMinutos.map((e) => activo(e.asset, `evento de paro de 0 minutos (${e.startedAt.toISOString().slice(0, 10)})`)),
    ]),
    regla({ clave: "activas-sin-responsable", titulo: "Órdenes activas sin responsable", nivel: "ADVERTENCIA", critica: true,
      porque: "Trabajo que nadie tiene en su carga: no aparece en la programación de ninguna persona y se queda sin atender.",
      enlace: "/backlog", peso: 2, total: nActivas }, activasSinResponsable.map((o) => ot(o))),
    regla({ clave: "solicitudes-sin-ot", titulo: TITULO_SOLICITUDES_SIN_OT, nivel: "ADVERTENCIA", critica: true,
      porque: "Quien reportó cree que ya se atiende, pero no hay orden viva que lo haga.",
      enlace: "/requests", peso: 2, total: nConvertidas },
    solicitudesHuerfanas.map((r) => ({
      id: r.id, etiqueta: `${r.number} · ${r.title}`,
      detalle: motivoSinOtActiva("CONVERTED", r.workOrder)?.largo,
      enlace: `/requests/${r.id}`,
    }))),
    regla({ clave: "actividades-sin-resolver", titulo: "Actividades sin resolver en órdenes terminadas", nivel: "ADVERTENCIA", critica: true,
      porque: "Ni se hicieron ni se enviaron al backlog: trabajo que se pierde de vista.",
      enlace: "/backlog", peso: 2, total: nActividadesTerminadas },
    actividadesSinResolver.map((t) => ot(t.workOrder, `«${t.title}»`))),
    regla({ clave: "completadas-sin-cerrar", titulo: `Completadas sin cierre administrativo (más de ${DIAS_PARA_CERRAR} días)`, nivel: "RECOMENDACION",
      porque: "Mientras nadie valida horas, paros y costos, la cifra de la orden puede estar mal y nadie lo revisa.",
      enlace: "/work-orders", peso: 1, total: nCompletadas }, completadasSinCerrar.map((o) => ot(o))),
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
