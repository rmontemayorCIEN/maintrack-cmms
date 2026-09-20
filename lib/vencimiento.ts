/**
 * Como se dice si una orden esta a tiempo, en TODAS las pantallas.
 *
 * Antes cada listado usaba `dueLabel(dueDate)`, que solo miraba la fecha
 * compromiso contra hoy y no sabia en que estado estaba la orden: una orden
 * terminada hace semanas seguia diciendo "Vencida 19d", y una cancelada
 * tambien. La etiqueta mentia sobre trabajo ya hecho.
 *
 * ── Que fecha cuenta como cumplimiento ──
 *
 * La de FINALIZACION OPERATIVA (`completedAt`): cuando el trabajo quedo hecho.
 * El cierre administrativo (`closedAt`) es posterior —alguien reviso costos y
 * cerro— y se conserva aparte; medir el cumplimiento con el cierre castigaria
 * al tecnico por la demora de la oficina.
 *
 * ── Dias, no horas ──
 *
 * El compromiso es un dia de calendario. Se compara el dia del compromiso con
 * el dia en que se termino (o con hoy), en la zona horaria de la empresa. Una
 * orden que vencia el 15 y se termino el 15 a las 11 pm esta en fecha.
 *
 * Un compromiso guardado a medianoche UTC exacta es un dia calculado en el
 * servidor y se lee como ese dia; cualquier otra hora es un momento real y se
 * lee en la zona de la empresa (mismo criterio que `formatDia`).
 */
import { claveDiaEnZona, medianocheEnZona, ZONA_POR_OMISION } from "./periodos";

export const ESTADOS_ABIERTOS = ["DRAFT", "OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] as const;
export const ESTADOS_TERMINADOS = ["COMPLETED", "CLOSED"] as const;

export type ClaveVencimiento =
  | "VENCIDA"
  | "VENCE_HOY"
  | "POR_VENCER"
  | "CUMPLIDA_EN_FECHA"
  | "TERMINADA_TARDE"
  | "CANCELADA"
  | "SIN_FECHA"
  /** Terminada pero sin fecha de finalizacion: no se puede juzgar si fue a tiempo. */
  | "TERMINADA_SIN_FECHA";

export type EstadoDeVencimiento = {
  clave: ClaveVencimiento;
  texto: string;
  tono: "danger" | "warning" | "info" | "success" | "muted";
  /** Dias de atraso (vencida o terminada tarde); cero en los demas casos. */
  diasAtraso: number;
  /** Dias que faltan para una orden abierta futura; nulo en los demas casos. */
  diasFaltan: number | null;
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** "aaaa-mm-dd" del dia de un compromiso (ver criterio en la cabecera). */
export function diaDelCompromiso(fecha: Date, zona: string): string {
  const esMedianocheUtc =
    fecha.getUTCHours() === 0 && fecha.getUTCMinutes() === 0 &&
    fecha.getUTCSeconds() === 0 && fecha.getUTCMilliseconds() === 0;
  return esMedianocheUtc ? fecha.toISOString().slice(0, 10) : claveDiaEnZona(fecha, zona);
}

/**
 * El filtro de «vencidas» PARA LA BASE, en un solo lugar.
 *
 * Existia dos veces y decia dos cosas distintas: el inicio contaba
 * `dueDate < ahora` (al instante) y la lista traia 200 ordenes y despues
 * filtraba en memoria por dia. Dos numeros para la misma pregunta, y ademas
 * la lista mentia: si habia 500 vencidas, la pantalla a la que lleva el
 * indicador del inicio no las tenia todas, porque el tope se aplicaba antes
 * del filtro.
 *
 * El limite se calcula con los dos criterios de `diaDelCompromiso` —una fecha
 * guardada a medianoche UTC es un dia de calendario; cualquier otra hora es
 * un momento real que se lee en la zona de la empresa— y se toma el mayor.
 * Eso deja un sobrante de, a lo sumo, el desfase de la zona: las pocas filas
 * que caigan ahi las descarta `estadoDeVencimiento`, que sigue siendo la
 * autoridad para lo que se DIBUJA.
 */
export function filtroDeVencidas(zona: string, ahora = new Date()) {
  const hoy = claveDiaEnZona(ahora, zona);
  const [anio, mes, dia] = hoy.split("-").map(Number);
  const medianocheUtc = new Date(`${hoy}T00:00:00.000Z`);
  const medianocheLocal = medianocheEnZona(anio, mes, dia, zona);
  const limite = medianocheUtc > medianocheLocal ? medianocheUtc : medianocheLocal;
  return { status: { in: [...ESTADOS_ABIERTOS] }, dueDate: { lt: limite } };
}

/** Dias de `a` a `b` entre dos claves "aaaa-mm-dd" (positivo si `b` es posterior). */
export function diasEntreClaves(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function estadoDeVencimiento(
  orden: {
    status: string;
    dueDate: Date | string | null | undefined;
    completedAt?: Date | string | null;
  },
  opciones: { zona?: string; ahora?: Date } = {},
): EstadoDeVencimiento {
  const zona = opciones.zona ?? ZONA_POR_OMISION;
  const ahora = opciones.ahora ?? new Date();
  const aFecha = (v: Date | string | null | undefined) => (v ? (typeof v === "string" ? new Date(v) : v) : null);
  const compromiso = aFecha(orden.dueDate);
  const terminada = aFecha(orden.completedAt);

  // Cancelada: nunca vencida, tenga o no fecha.
  if (orden.status === "CANCELLED") {
    return { clave: "CANCELADA", texto: "Cancelada", tono: "muted", diasAtraso: 0, diasFaltan: null };
  }

  const esTerminada = (ESTADOS_TERMINADOS as readonly string[]).includes(orden.status);

  if (!compromiso) {
    return {
      clave: "SIN_FECHA",
      texto: esTerminada ? "Sin fecha compromiso" : "Sin programar",
      tono: "muted",
      diasAtraso: 0,
      diasFaltan: null,
    };
  }

  const diaCompromiso = diaDelCompromiso(compromiso, zona);

  if (esTerminada) {
    // Una orden terminada sin fecha de finalizacion (dato viejo o incompleto) no
    // se puede juzgar: ni en fecha ni tarde. Se dice asi, sin inventar un atraso.
    if (!terminada) {
      return { clave: "TERMINADA_SIN_FECHA", texto: "Terminada (sin fecha de finalización)", tono: "muted", diasAtraso: 0, diasFaltan: null };
    }
    const atraso = diasEntreClaves(diaCompromiso, claveDiaEnZona(terminada, zona));
    return atraso > 0
      ? {
          clave: "TERMINADA_TARDE",
          texto: `Terminada con ${plural(atraso, "día", "días")} de atraso`,
          tono: "warning",
          diasAtraso: atraso,
          diasFaltan: null,
        }
      : { clave: "CUMPLIDA_EN_FECHA", texto: "Cumplida en fecha", tono: "success", diasAtraso: 0, diasFaltan: null };
  }

  const faltan = diasEntreClaves(claveDiaEnZona(ahora, zona), diaCompromiso);
  if (faltan < 0) {
    return {
      clave: "VENCIDA",
      texto: `Vencida hace ${plural(-faltan, "día", "días")}`,
      tono: "danger",
      diasAtraso: -faltan,
      diasFaltan: null,
    };
  }
  if (faltan === 0) {
    return { clave: "VENCE_HOY", texto: "Vence hoy", tono: "warning", diasAtraso: 0, diasFaltan: 0 };
  }
  return {
    clave: "POR_VENCER",
    texto: `Vence en ${plural(faltan, "día", "días")}`,
    tono: faltan <= 7 ? "info" : "muted",
    diasAtraso: 0,
    diasFaltan: faltan,
  };
}

/** Si la orden esta HOY vencida: abierta y con el compromiso ya pasado. */
export function estaVencida(
  orden: { status: string; dueDate: Date | string | null | undefined },
  opciones: { zona?: string; ahora?: Date } = {},
): boolean {
  return estadoDeVencimiento(orden, opciones).clave === "VENCIDA";
}
