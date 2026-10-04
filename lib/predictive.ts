import { prisma } from "./db";
import { centroDeCostoDelActivo } from "./centro-de-costo";
import { nextWorkOrderNumber } from "./numbering";
import { logAudit } from "./audit";

/**
 * El estado predictivo de un punto de monitoreo: la UNICA evaluacion que leen
 * Predictivo, Alertas, la ficha del activo, el Panel y el Diagnostico IA.
 *
 * Lo que estaba mal y por que:
 *
 *  - Una sola fecha (`projectedFailureAt`) mezclaba el cruce del umbral de
 *    advertencia con el del critico, y se mostraba como «Falla proyectada».
 *    No hay modelo de falla: lo que se proyecta es cuando la tendencia cruza un
 *    umbral. Ahora son dos fechas separadas, y la palabra «falla» no aparece.
 *  - La fecha se guardaba al detectar y nunca se actualizaba. CNC-201 tenia
 *    una alerta detectada el 29 de agosto con «falla» el 22 de julio: una
 *    fecha anterior a su propia deteccion, presentada como futura.
 *  - Un valor ya sobre el umbral critico podia verse «estable»: la pendiente
 *    describe la tendencia, no el estado. Ahora el estado manda: sobre el
 *    critico es CRITICO, con la tendencia que tenga.
 *  - El R² de cuatro lecturas se mostraba como «confianza 87%». Un porcentaje
 *    con tan pocos datos es precision falsa. Ahora es alta/media/baja, y con
 *    menos de 5 lecturas no se proyecta.
 */

/** Minimo de lecturas para proyectar, y el tramo minimo que deben abarcar. */
export const MIN_LECTURAS_PROYECCION = 5;
export const MIN_DIAS_PROYECCION = 1;
/** Cuantas lecturas recientes entran a la regresion. */
export const LECTURAS_PARA_TENDENCIA = 30;
/** Cruce proyectado mas lejano que se reporta como fecha. */
const HORIZONTE_DIAS = 3650;
/** Una tendencia que abre alerta sin haber cruzado: critico en 30 dias o menos. */
export const DIAS_ALERTA_POR_TENDENCIA = 30;

const DIA = 86_400_000;

type Umbrales = { warningThreshold: number | null; criticalThreshold: number | null; direction: string };

/** Clasifica una lectura contra los umbrales del sensor. */
export function classify(value: number, sensor: Umbrales): "NORMAL" | "WARNING" | "CRITICAL" {
  const above = sensor.direction !== "BELOW";
  const { warningThreshold: warn, criticalThreshold: crit } = sensor;
  if (above) {
    if (crit !== null && value >= crit) return "CRITICAL";
    if (warn !== null && value >= warn) return "WARNING";
  } else {
    if (crit !== null && value <= crit) return "CRITICAL";
    if (warn !== null && value <= warn) return "WARNING";
  }
  return "NORMAL";
}

export type EstadoPunto = "NORMAL" | "ADVERTENCIA" | "CRITICO" | "SIN_DATOS";
export type Tendencia = "EMPEORA" | "MEJORA" | "ESTABLE" | "SIN_DATOS";
export type Confianza = "ALTA" | "MEDIA" | "BAJA" | "INSUFICIENTE";

export const ETIQUETA_ESTADO: Record<EstadoPunto, string> = {
  NORMAL: "Normal",
  ADVERTENCIA: "Advertencia",
  CRITICO: "Crítico",
  SIN_DATOS: "Sin datos suficientes",
};
export const ETIQUETA_TENDENCIA: Record<Tendencia, string> = {
  EMPEORA: "Empeorando",
  MEJORA: "Mejorando",
  ESTABLE: "Estable",
  SIN_DATOS: "Sin tendencia",
};
export const ETIQUETA_CONFIANZA: Record<Confianza, string> = {
  ALTA: "Confianza alta",
  MEDIA: "Confianza media",
  BAJA: "Confianza baja",
  INSUFICIENTE: "Datos insuficientes",
};

/** Por que NO hay fecha de cruce. Siempre una razon real, nunca un silencio. */
export type RazonSinCruce =
  | "UMBRAL_SUPERADO"
  | "DATOS_INSUFICIENTES"
  | "PENDIENTE_NO_SIGNIFICATIVA"
  | "DIRECCION_CONTRARIA"
  | "CONFIANZA_INSUFICIENTE"
  | "FUERA_DE_HORIZONTE"
  | "SIN_UMBRAL"
  | "PROYECCION_VENCIDA";

export type Cruce = {
  /** Solo cuando hay proyeccion futura valida. */
  fecha: Date | null;
  dias: number | null;
  texto: string;
  /** Nulo cuando hay fecha. */
  razon: RazonSinCruce | null;
};

/**
 * Una pendiente es significativa cuando su estadistico t (pendiente entre su
 * error estandar) llega a 2: con esa regresion, la probabilidad de ver esa
 * inclinacion solo por ruido es de alrededor de 5%. Debajo de eso la tendencia
 * es «Estable»: no se distingue del ruido. Es la misma regresion que da la
 * fecha, asi que estado, tendencia y proyeccion nunca se contradicen.
 */
export const T_SIGNIFICATIVA = 2;

export type EvaluacionPunto = {
  estado: EstadoPunto;
  etiquetaEstado: string;
  valorActual: number | null;
  lecturaEl: Date | null;
  tendencia: Tendencia;
  etiquetaTendencia: string;
  /** Unidades por dia, en la direccion del umbral (positivo = hacia el umbral). ES la que usa la proyeccion. */
  pendientePorDia: number;
  /** Estadistico t de la pendiente (|pendiente| / error estandar). Nulo sin datos. */
  tPendiente: number | null;
  /** R² del ajuste. Nulo sin datos. */
  r2: number | null;
  confianza: Confianza;
  etiquetaConfianza: string;
  lecturasUsadas: number;
  cruceAdvertencia: Cruce;
  cruceCritico: Cruce;
  /** Una frase para listas y para la IA. Siempre coherente con el estado. */
  resumen: string;
};

const fmtFecha = (d: Date, zona?: string) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", ...(zona ? { timeZone: zona } : {}) }).format(d);

/**
 * El texto de una fecha de cruce vista HOY. Sirve igual para una evaluacion
 * nueva que para una fecha guardada: una fecha ya pasada nunca se presenta
 * como futura.
 */
export function textoDeCruce(fecha: Date | null, ahora = new Date(), yaSuperado = false, zona?: string): Cruce {
  if (yaSuperado) return { fecha: null, dias: null, texto: "Umbral ya superado", razon: "UMBRAL_SUPERADO" };
  if (!fecha) return { fecha: null, dias: null, texto: "Sin cruce proyectado", razon: "DATOS_INSUFICIENTES" };
  const dias = Math.ceil((fecha.getTime() - ahora.getTime()) / DIA);
  if (dias < 0) return { fecha: null, dias: null, texto: `Proyección vencida (era ${fmtFecha(fecha, zona)})`, razon: "PROYECCION_VENCIDA" };
  return { fecha, dias, razon: null, texto: dias === 0 ? `Estimado hoy` : `Estimado el ${fmtFecha(fecha, zona)} (en ${dias} ${dias === 1 ? "día" : "días"})` };
}

/**
 * Evalua un punto con sus lecturas. Pura: no toca la base.
 *
 * Estado: la ultima lectura contra los umbrales. Tendencia y cruces: regresion
 * lineal sobre las ultimas 30 lecturas, solo con 5 o mas que abarquen al
 * menos un dia y un ajuste razonable (R² ≥ 0.5).
 */
export function evaluarPunto(
  lecturas: Array<{ value: number; readingAt: Date }>,
  sensor: Umbrales & { unit?: string },
  ahora = new Date(),
  zona?: string,
): EvaluacionPunto {
  const puntos = [...lecturas]
    .sort((a, b) => a.readingAt.getTime() - b.readingAt.getTime())
    .slice(-LECTURAS_PARA_TENDENCIA);
  const ultima = puntos.at(-1) ?? null;
  const sube = sensor.direction !== "BELOW";

  const clasif = ultima ? classify(ultima.value, sensor) : null;
  const estado: EstadoPunto = !clasif ? "SIN_DATOS" : clasif === "CRITICAL" ? "CRITICO" : clasif === "WARNING" ? "ADVERTENCIA" : "NORMAL";
  const superado = (umbral: number | null) =>
    umbral !== null && ultima !== null && (sube ? ultima.value >= umbral : ultima.value <= umbral);

  const base = {
    estado,
    etiquetaEstado: ETIQUETA_ESTADO[estado],
    valorActual: ultima?.value ?? null,
    lecturaEl: ultima?.readingAt ?? null,
    lecturasUsadas: puntos.length,
  };

  const n = puntos.length;
  const abarca = n ? (puntos[n - 1].readingAt.getTime() - puntos[0].readingAt.getTime()) / DIA : 0;
  const insuficiente = (umbral: number | null): Cruce =>
    superado(umbral)
      ? textoDeCruce(null, ahora, true)
      : umbral === null
        ? { fecha: null, dias: null, texto: "Sin umbral definido", razon: "SIN_UMBRAL" }
        : { fecha: null, dias: null, texto: `Datos insuficientes para proyectar (se necesitan ${MIN_LECTURAS_PROYECCION} lecturas en al menos ${MIN_DIAS_PROYECCION} día)`, razon: "DATOS_INSUFICIENTES" };

  if (n < MIN_LECTURAS_PROYECCION || abarca < MIN_DIAS_PROYECCION) {
    return {
      ...base,
      tendencia: "SIN_DATOS",
      etiquetaTendencia: ETIQUETA_TENDENCIA.SIN_DATOS,
      pendientePorDia: 0,
      tPendiente: null,
      r2: null,
      confianza: "INSUFICIENTE",
      etiquetaConfianza: ETIQUETA_CONFIANZA.INSUFICIENTE,
      cruceAdvertencia: insuficiente(sensor.warningThreshold),
      cruceCritico: insuficiente(sensor.criticalThreshold),
      resumen: resumir(estado, "SIN_DATOS", "INSUFICIENTE", insuficiente(sensor.criticalThreshold)),
    };
  }

  const t0 = puntos[0].readingAt.getTime();
  const xs = puntos.map((p) => (p.readingAt.getTime() - t0) / DIA);
  const ys = puntos.map((p) => p.value);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const pendiente = den === 0 ? 0 : num / den;
  const intercepto = my - pendiente * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (ys[i] - (intercepto + pendiente * xs[i])) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  // Hacia el umbral = positivo, sin importar la direccion del sensor. Es LA
  // pendiente: la que se muestra y la que proyecta.
  const haciaUmbral = sube ? pendiente : -pendiente;

  /**
   * Significancia estadistica de la pendiente, del mismo ajuste.
   *
   * Antes «Estable» era «en 30 dias se moveria menos del 5% del umbral»: una
   * regla arbitraria que dependia de la escala. En CMP-301 (temperatura, umbral
   * de 98 °C) una subida clara de +0.131 °C/dia con R² alto quedaba «Estable»
   * porque 0.131 × 30 = 3.9 era menos que 4.9, y por eso decia «Sin cruce
   * proyectado» mientras mostraba una pendiente positiva. Ahora estable quiere
   * decir «no se distingue del ruido».
   */
  const errorEstandar = n > 2 && den > 0 ? Math.sqrt(ssRes / (n - 2)) / Math.sqrt(den) : 0;
  const tPendiente = errorEstandar > 0 ? Math.abs(pendiente) / errorEstandar : pendiente === 0 ? 0 : Number.POSITIVE_INFINITY;
  const significativa = tPendiente >= T_SIGNIFICATIVA;
  const tendencia: Tendencia = !significativa ? "ESTABLE" : haciaUmbral > 0 ? "EMPEORA" : "MEJORA";

  const confianza: Confianza = r2 >= 0.8 && n >= 10 ? "ALTA" : r2 >= 0.5 ? "MEDIA" : "BAJA";

  const unidad = sensor.unit ? ` ${sensor.unit}` : "";
  const pendienteTexto = `${haciaUmbral >= 0 ? "+" : ""}${haciaUmbral.toFixed(3)}${unidad}/día`;

  const cruce = (umbral: number | null): Cruce => {
    if (umbral === null) return { fecha: null, dias: null, texto: "Sin umbral definido", razon: "SIN_UMBRAL" };
    if (superado(umbral)) return textoDeCruce(null, ahora, true);
    if (tendencia === "ESTABLE") {
      return { fecha: null, dias: null, razon: "PENDIENTE_NO_SIGNIFICATIVA",
        texto: `Sin cruce: la pendiente (${pendienteTexto}) no se distingue del ruido de las lecturas` };
    }
    if (tendencia === "MEJORA") {
      return { fecha: null, dias: null, razon: "DIRECCION_CONTRARIA",
        texto: `Sin cruce: la tendencia se aleja del umbral (${pendienteTexto})` };
    }
    if (confianza === "BAJA") {
      return { fecha: null, dias: null, razon: "CONFIANZA_INSUFICIENTE",
        texto: `Sin fecha: la tendencia es hacia el umbral pero el ajuste es pobre (R² ${r2.toFixed(2)})` };
    }
    // Desde la ultima lectura real con la MISMA pendiente que se muestra.
    const distancia = sube ? umbral - ultima!.value : ultima!.value - umbral;
    const diasDesdeUltima = distancia / haciaUmbral;
    if (!(diasDesdeUltima > 0) || diasDesdeUltima > HORIZONTE_DIAS) {
      return { fecha: null, dias: null, texto: "Sin cruce en los próximos 10 años con esta pendiente", razon: "FUERA_DE_HORIZONTE" };
    }
    return textoDeCruce(new Date(ultima!.readingAt.getTime() + diasDesdeUltima * DIA), ahora, false, zona);
  };

  const cruceCritico = cruce(sensor.criticalThreshold);
  return {
    ...base,
    tendencia,
    etiquetaTendencia: ETIQUETA_TENDENCIA[tendencia],
    pendientePorDia: haciaUmbral,
    tPendiente: Number.isFinite(tPendiente) ? tPendiente : null,
    r2,
    confianza,
    etiquetaConfianza: ETIQUETA_CONFIANZA[confianza],
    cruceAdvertencia: cruce(sensor.warningThreshold),
    cruceCritico,
    resumen: resumir(estado, tendencia, confianza, cruceCritico),
  };
}

function resumir(estado: EstadoPunto, tendencia: Tendencia, confianza: Confianza, critico: Cruce): string {
  if (estado === "SIN_DATOS") return "Sin lecturas registradas.";
  if (estado === "CRITICO") {
    // «Estable» sobre el critico no es buena noticia: sigue critico.
    const t = tendencia === "SIN_DATOS" ? "" : tendencia === "MEJORA" ? " · tendencia a la baja, aún sin normalizar" : tendencia === "ESTABLE" ? " · tendencia estable, sin mejora" : " · sigue empeorando";
    return `Umbral crítico superado${t}.`;
  }
  const est = estado === "ADVERTENCIA" ? "En advertencia" : "Normal";
  if (confianza === "INSUFICIENTE") return `${est}. Datos insuficientes para proyectar.`;
  return `${est} · ${ETIQUETA_TENDENCIA[tendencia].toLowerCase()} · crítico: ${critico.texto.charAt(0).toLowerCase()}${critico.texto.slice(1)}.`;
}

/** Que condicion abriria (o mantiene) una alerta con esta evaluacion. */
export function condicionDeAlerta(e: EvaluacionPunto): "CRITICO" | "ADVERTENCIA" | "TENDENCIA" | null {
  if (e.estado === "CRITICO") return "CRITICO";
  if (e.estado === "ADVERTENCIA") return "ADVERTENCIA";
  if (
    e.cruceCritico.dias !== null && e.cruceCritico.dias <= DIAS_ALERTA_POR_TENDENCIA &&
    (e.confianza === "ALTA" || e.confianza === "MEDIA")
  ) {
    return "TENDENCIA";
  }
  return null;
}

const GRAVEDAD = { TENDENCIA: 1, ADVERTENCIA: 2, CRITICO: 3 } as const;

/** Los campos de evaluacion que se guardan en la alerta. */
function camposDeEvaluacion(e: EvaluacionPunto, ahora: Date) {
  return {
    estadoActual: e.estado,
    tendencia: e.tendencia,
    confianza: e.confianza,
    lecturasUsadas: e.lecturasUsadas,
    fechaCruceAdvertencia: e.cruceAdvertencia.fecha,
    fechaCruceCritico: e.cruceCritico.fecha,
    evaluadaEl: ahora,
    value: e.valorActual,
    trendSlope: e.pendientePorDia,
    // Legado: solo el cruce critico futuro. Nunca una fecha pasada.
    projectedFailureAt: e.cruceCritico.fecha,
  };
}

function mensajeDeAlerta(e: EvaluacionPunto, sensor: { unit: string; warningThreshold: number | null; criticalThreshold: number | null }) {
  const v = e.valorActual === null ? "—" : `${e.valorActual} ${sensor.unit}`;
  if (e.estado === "CRITICO") return `Lectura ${v} sobre el umbral crítico (${sensor.criticalThreshold} ${sensor.unit}). ${e.resumen}`;
  if (e.estado === "ADVERTENCIA") return `Lectura ${v} sobre el umbral de advertencia (${sensor.warningThreshold} ${sensor.unit}). Crítico: ${e.cruceCritico.texto}.`;
  return `Tendencia hacia el umbral crítico: ${e.cruceCritico.texto} (${e.etiquetaConfianza.toLowerCase()}).`;
}

/**
 * Ingesta de lectura de condicion: guarda el dato, reevalua el punto y
 * mantiene UNA alerta abierta por punto.
 *
 *  - Sin alerta y con condicion: se crea (critica abre OT predictiva).
 *  - Con alerta: se actualiza su evaluacion. Si la condicion empeoro, se
 *    escala la misma alerta; no se crea otra.
 *  - Si el valor se normaliza, la alerta NO se cierra sola: se marca
 *    `normalizadaEl` y alguien valida la normalizacion desde Alertas.
 */
export async function ingestSensorReading(params: {
  organizationId: string;
  sensorId: string;
  value: number;
  readingAt?: Date;
  source?: string;
  userId?: string | null;
  autoWorkOrder?: boolean;
  ahora?: Date;
}) {
  const sensor = await prisma.sensor.findFirst({
    where: { id: params.sensorId, organizationId: params.organizationId },
    include: { asset: true },
  });
  if (!sensor) throw new Error("Sensor no encontrado");

  const ahora = params.ahora ?? new Date();
  const readingAt = params.readingAt ?? ahora;
  const status = classify(params.value, sensor);

  await prisma.sensorReading.create({
    data: {
      organizationId: params.organizationId,
      sensorId: sensor.id,
      value: params.value,
      status,
      readingAt,
      source: params.source ?? "IOT",
    },
  });

  // El ultimo valor es el de la lectura mas reciente, no el de la que llego al
  // final: una lectura capturada con fecha pasada no pisa el estado actual.
  const history = await prisma.sensorReading.findMany({
    where: { sensorId: sensor.id, organizationId: params.organizationId },
    orderBy: { readingAt: "desc" },
    take: LECTURAS_PARA_TENDENCIA,
    select: { id: true, value: true, readingAt: true, status: true },
  });
  const masReciente = history[0];
  await prisma.sensor.update({
    where: { id: sensor.id },
    data: { lastValue: masReciente.value, lastStatus: masReciente.status, lastReadingAt: masReciente.readingAt },
  });

  const orgZona = await prisma.organization.findUnique({ where: { id: params.organizationId }, select: { timezone: true } });
  const evaluacion = evaluarPunto(history, sensor, ahora, orgZona?.timezone || "America/Mexico_City");
  const condicion = condicionDeAlerta(evaluacion);

  let alertId: string | null = null;
  let workOrderNumber: string | null = null;

  /** Abre la OT predictiva y avisa a los supervisores. */
  async function openPredictiveWorkOrder(alertDbId: string, message: string) {
    const number = await nextWorkOrderNumber(params.organizationId);
    const wo = await prisma.workOrder.create({
      data: {
        organizationId: params.organizationId,
        number,
        title: `Intervencion predictiva: ${sensor!.asset.name}`,
        description: message,
        maintenanceType: "PREDICTIVE",
        status: "OPEN",
        priority: sensor!.asset.criticality === "A" ? "CRITICAL" : "HIGH",
        assetId: sensor!.assetId,
        // El eje contable se hereda del equipo. Ver lib/centro-de-costo.ts.
        centroDeCostoId: await centroDeCostoDelActivo(params.organizationId, sensor!.asset.id),
        siteId: sensor!.asset.siteId,
        locationId: sensor!.asset.locationId,
        // Ya critico: se atiende pronto. La fecha de cruce no aplica, ya cruzo.
        dueDate: new Date(ahora.getTime() + 3 * DIA),
        estimatedHours: 3,
        createdById: params.userId ?? null,
      },
    });
    await prisma.predictiveAlert.update({ where: { id: alertDbId }, data: { workOrderId: wo.id } });

    // A supervisión (no a todo rol alto), con liga a la orden. Ver lib/avisos.
    const { avisarAlerta } = await import("./avisos/detectores");
    await avisarAlerta(params.organizationId, alertDbId).catch(() => undefined);
    return number;
  }

  const existing = await prisma.predictiveAlert.findFirst({
    where: { organizationId: params.organizationId, sensorId: sensor.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    alertId = existing.id;
    const anterior = (existing.condicion ?? (existing.severity === "CRITICAL" ? "CRITICO" : "ADVERTENCIA")) as keyof typeof GRAVEDAD;
    const escala = condicion !== null && GRAVEDAD[condicion] > (GRAVEDAD[anterior] ?? 0);
    const message = condicion ? mensajeDeAlerta(evaluacion, sensor) : existing.message;

    await prisma.predictiveAlert.update({
      where: { id: existing.id },
      data: {
        ...camposDeEvaluacion(evaluacion, ahora),
        // Normalizada: se marca con la lectura que lo mostro —la evidencia—,
        // pero la alerta sigue abierta hasta que alguien la valide. Si vuelve
        // a salirse de rango, la normalizacion y su evidencia se limpian.
        ...(condicion === null
          ? existing.normalizadaEl
            ? {}
            : {
                normalizadaEl: ahora,
                normalizacionLecturaId: masReciente.id,
                normalizacionValor: masReciente.value,
                normalizacionLecturaEl: masReciente.readingAt,
              }
          : { normalizadaEl: null, normalizacionLecturaId: null, normalizacionValor: null, normalizacionLecturaEl: null }),
        ...(escala
          ? {
              condicion,
              severity: condicion === "CRITICO" ? "CRITICAL" : "WARNING",
              message,
              threshold: condicion === "CRITICO" ? sensor.criticalThreshold : sensor.warningThreshold,
            }
          : condicion && GRAVEDAD[condicion] === (GRAVEDAD[anterior] ?? 0)
            ? { message }
            : {}),
      },
    });

    if (escala) {
      await logAudit({
        organizationId: params.organizationId,
        userId: params.userId,
        entity: "PredictiveAlert",
        entityId: existing.id,
        action: "ESCALATED",
        summary: message,
      });
      if (params.autoWorkOrder !== false && condicion === "CRITICO" && !existing.workOrderId) {
        workOrderNumber = await openPredictiveWorkOrder(existing.id, message);
      }
    }
  } else if (condicion) {
    const message = mensajeDeAlerta(evaluacion, sensor);
    const alert = await prisma.predictiveAlert.create({
      data: {
        organizationId: params.organizationId,
        sensorId: sensor.id,
        assetId: sensor.assetId,
        condicion,
        severity: condicion === "CRITICO" ? "CRITICAL" : "WARNING",
        title: `${sensor.name} — ${sensor.asset.name}`,
        message,
        threshold: condicion === "CRITICO" ? sensor.criticalThreshold : sensor.warningThreshold,
        ...camposDeEvaluacion(evaluacion, ahora),
      },
    });
    alertId = alert.id;
    if (params.autoWorkOrder !== false && condicion === "CRITICO") {
      workOrderNumber = await openPredictiveWorkOrder(alert.id, message);
    }
    await logAudit({
      organizationId: params.organizationId,
      userId: params.userId,
      entity: "PredictiveAlert",
      entityId: alert.id,
      action: "CREATED",
      summary: message,
    });
  }

  return { status, evaluacion, condicion, alertId, workOrderNumber };
}

/**
 * Cierra una alerta validando su normalizacion.
 *
 * «Resolver» y «validar normalizacion» son lo mismo: una alerta no se cierra
 * mientras el punto siga fuera de rango. Exige que la ingesta haya registrado
 * la lectura que mostro la normalizacion (la evidencia) y que el punto siga
 * normal HOY. Guarda quien cerro, cuando, con que nota y con que lectura.
 */
export async function validarNormalizacion(params: {
  organizationId: string;
  alertId: string;
  userId: string;
  nota?: string | null;
  ahora?: Date;
}): Promise<{ alerta: Awaited<ReturnType<typeof prisma.predictiveAlert.update>> } | { error: string }> {
  const alerta = await prisma.predictiveAlert.findFirst({
    where: { id: params.alertId, organizationId: params.organizationId },
  });
  if (!alerta) return { error: "Alerta no encontrada" };
  if (!["OPEN", "ACKNOWLEDGED"].includes(alerta.status)) return { error: "La alerta ya está cerrada" };
  if (!alerta.normalizadaEl || !alerta.normalizacionLecturaId) {
    return { error: "El punto sigue fuera de rango: la alerta se resuelve cuando una lectura muestre la normalización." };
  }
  const ahora = params.ahora ?? new Date();
  const hoy = alerta.sensorId ? (await evaluarPuntos(params.organizationId, [alerta.sensorId], ahora)).get(alerta.sensorId) : undefined;
  if (hoy && hoy.estado !== "NORMAL") {
    return { error: `El punto volvió a ${hoy.etiquetaEstado.toLowerCase()}: no se puede validar la normalización.` };
  }
  const resolucion = params.nota?.trim() ||
    `Normalización validada con la lectura ${alerta.normalizacionValor} del ${alerta.normalizacionLecturaEl?.toISOString()}`;
  const actualizada = await prisma.predictiveAlert.update({
    where: { id: alerta.id },
    data: { status: "RESOLVED", resueltaPorId: params.userId, resueltaEl: ahora, resolucion },
  });
  await logAudit({
    organizationId: params.organizationId,
    userId: params.userId,
    entity: "PredictiveAlert",
    entityId: alerta.id,
    action: "NORMALIZACION_VALIDADA",
    summary: `${alerta.title}: normalización validada (normal desde ${alerta.normalizadaEl.toISOString()})`,
    changes: {
      lecturaId: alerta.normalizacionLecturaId,
      valor: alerta.normalizacionValor,
      lecturaEl: alerta.normalizacionLecturaEl?.toISOString() ?? null,
      nota: params.nota ?? null,
    },
  });
  return { alerta: actualizada };
}

/** Indice de salud 0-100 del activo a partir del estado de sus sensores. */
export function healthScore(sensors: Array<{ lastStatus: string }>) {
  if (!sensors.length) return 100;
  const penalty = sensors.reduce((sum, s) => {
    if (s.lastStatus === "CRITICAL") return sum + 45;
    if (s.lastStatus === "WARNING") return sum + 18;
    return sum;
  }, 0);
  return Math.max(0, Math.round(100 - penalty / sensors.length));
}

/**
 * La evaluacion viva de varios puntos, para pantallas que listan alertas: la
 * fecha y el estado salen de las lecturas de hoy, no de lo que se guardo al
 * detectar.
 */
export async function evaluarPuntos(organizationId: string, sensorIds: string[], ahora = new Date()) {
  const ids = [...new Set(sensorIds)];
  if (!ids.length) return new Map<string, EvaluacionPunto>();
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const zona = org?.timezone || "America/Mexico_City";
  const sensores = await prisma.sensor.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, unit: true, warningThreshold: true, criticalThreshold: true, direction: true },
  });
  const evaluaciones = await Promise.all(
    sensores.map(async (s) => {
      const lecturas = await prisma.sensorReading.findMany({
        where: { organizationId, sensorId: s.id },
        orderBy: { readingAt: "desc" },
        select: { value: true, readingAt: true },
        take: LECTURAS_PARA_TENDENCIA,
      });
      return [s.id, evaluarPunto(lecturas, s, ahora, zona)] as const;
    }),
  );
  return new Map<string, EvaluacionPunto>(evaluaciones);
}
