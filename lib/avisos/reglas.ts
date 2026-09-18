/**
 * Recordatorios y escalamiento: los valores recomendados.
 *
 * Una empresa nueva no tiene que entender estas reglas para empezar: rigen
 * tal cual. Desde Configuración → Avisos puede cambiar esperas, número de
 * recordatorios, si cuentan solo en jornada, o apagar una regla. Lo que no
 * cambie sigue el valor de aquí.
 *
 * Sin dependencias: lo lee también la pantalla.
 */
import type { Grupo, TipoEvento } from "./catalogo";

export type ReglaEscalamiento = {
  titulo: string;
  /** Qué la dispara, en palabras. */
  cuando: string;
  /** El aviso con que se recuerda y se escala. */
  evento: TipoEvento;
  /** Minutos desde que empieza la condición hasta el primer recordatorio, y entre recordatorios. */
  esperaMin: number;
  /** Si el tiempo fuera de jornada cuenta o no. */
  soloJornada: boolean;
  /** A quién se le recuerda primero. */
  primerNivel: Grupo[];
  /** A quién se sube cuando se agotan los recordatorios del primer nivel. */
  siguienteNivel: Grupo[];
  /** Recordatorios por nivel antes de subir (o de callar, en el último). */
  maxRecordatorios: number;
  /** Qué la detiene, en palabras. */
  seDetiene: string;
  /** Si reconocer el aviso basta para detenerla. */
  reconocerDetiene: boolean;
  activa: boolean;
};

const r = (x: ReglaEscalamiento) => x;

export const REGLAS_RECOMENDADAS = {
  OT_CRITICA_SIN_ACEPTAR: r({
    titulo: "OT crítica sin aceptar",
    cuando: "Una orden crítica asignada no se inicia ni se reconoce.",
    evento: "OT_SIN_ACEPTAR", esperaMin: 30, soloJornada: false,
    primerNivel: ["RESPONSABLE"], siguienteNivel: ["SUPERVISORES", "ADMINISTRADORES"], maxRecordatorios: 2,
    seDetiene: "Al iniciarse, reconocerse, reasignarse, cancelarse o cerrarse.", reconocerDetiene: true, activa: true,
  }),
  OT_ALTA_SIN_ACEPTAR: r({
    titulo: "OT alta sin aceptar",
    cuando: "Una orden de prioridad alta asignada no se inicia ni se reconoce.",
    evento: "OT_SIN_ACEPTAR", esperaMin: 240, soloJornada: true,
    primerNivel: ["RESPONSABLE"], siguienteNivel: ["SUPERVISORES"], maxRecordatorios: 1,
    seDetiene: "Al iniciarse, reconocerse, reasignarse, cancelarse o cerrarse.", reconocerDetiene: true, activa: true,
  }),
  OT_VENCIDA_SIN_ACTUALIZAR: r({
    titulo: "OT vencida sin movimiento",
    cuando: "Una orden vencida no tiene movimiento válido (inicio, avance, cambio de estado o reprogramación a fecha futura) en un día de trabajo.",
    evento: "OT_VENCIDA", esperaMin: 480, soloJornada: true,
    primerNivel: ["RESPONSABLE"], siguienteNivel: ["SUPERVISORES"], maxRecordatorios: 2,
    seDetiene: "Al reprogramarse a una fecha futura, terminarse o cancelarse. Un movimiento válido reinicia la espera; si se reasigna, empieza de nuevo para la persona nueva.", reconocerDetiene: false, activa: true,
  }),
  SOLICITUD_CRITICA_SIN_CLASIFICAR: r({
    titulo: "Solicitud crítica sin revisar",
    cuando: "Una solicitud crítica o de riesgo alto sigue pendiente de revisión.",
    evento: "SOLICITUD_CRITICA_SIN_ATENDER", esperaMin: 30, soloJornada: false,
    primerNivel: ["REVISORES"], siguienteNivel: ["ADMINISTRADORES"], maxRecordatorios: 2,
    seDetiene: "Al aprobarse, convertirse o rechazarse.", reconocerDetiene: false, activa: true,
  }),
  REQUISICION_SIN_AUTORIZAR: r({
    titulo: "Compra sin autorizar",
    cuando: "Una solicitud de compra espera firma.",
    evento: "REQUISICION_POR_AUTORIZAR", esperaMin: 480, soloJornada: true,
    primerNivel: ["AUTORIZADORES"], siguienteNivel: ["PROPIETARIO"], maxRecordatorios: 2,
    seDetiene: "Al autorizarse, rechazarse o cancelarse.", reconocerDetiene: false, activa: true,
  }),
  ALERTA_CRITICA_SIN_RECONOCER: r({
    titulo: "Alerta predictiva crítica sin reconocer",
    cuando: "Una alerta crítica sigue abierta sin que nadie la reconozca.",
    evento: "ALERTA_CRITICA_SIN_ATENDER", esperaMin: 60, soloJornada: false,
    primerNivel: ["SUPERVISORES"], siguienteNivel: ["ADMINISTRADORES"], maxRecordatorios: 2,
    seDetiene: "Al reconocerse, resolverse o descartarse la alerta.", reconocerDetiene: true, activa: true,
  }),
  REFACCION_CRITICA_AGOTADA: r({
    titulo: "Refacción crítica agotada",
    cuando: "Una refacción crítica sigue en cero.",
    evento: "REFACCION_CRITICA_AGOTADA", esperaMin: 480, soloJornada: true,
    primerNivel: ["ALMACEN"], siguienteNivel: ["SUPERVISORES"], maxRecordatorios: 1,
    seDetiene: "Al reponerse la existencia.", reconocerDetiene: false, activa: true,
  }),
  COMPRA_VENCIDA_SIN_RECEPCION: r({
    titulo: "Compra vencida sin recibir",
    cuando: "Una orden de compra pasó su fecha prometida y no se ha recibido completa.",
    evento: "ENTREGA_VENCIDA", esperaMin: 480, soloJornada: true,
    primerNivel: ["COMPRAS"], siguienteNivel: ["AUTORIZADORES"], maxRecordatorios: 2,
    seDetiene: "Al recibirse completa o cancelarse.", reconocerDetiene: false, activa: true,
  }),
} as const satisfies Record<string, ReglaEscalamiento>;

export type ClaveRegla = keyof typeof REGLAS_RECOMENDADAS;

/** Lo que una empresa puede cambiar de cada regla. */
export type AjusteRegla = Partial<Pick<ReglaEscalamiento, "esperaMin" | "soloJornada" | "maxRecordatorios" | "activa">>;

export function reglasDe(ajustes: Record<string, AjusteRegla>): Record<ClaveRegla, ReglaEscalamiento> {
  const salida = {} as Record<ClaveRegla, ReglaEscalamiento>;
  for (const clave of Object.keys(REGLAS_RECOMENDADAS) as ClaveRegla[]) {
    const a = ajustes[clave] ?? {};
    const base = REGLAS_RECOMENDADAS[clave];
    salida[clave] = {
      ...base,
      esperaMin: a.esperaMin !== undefined && a.esperaMin >= 5 && a.esperaMin <= 10_080 ? Math.round(a.esperaMin) : base.esperaMin,
      soloJornada: a.soloJornada ?? base.soloJornada,
      maxRecordatorios: a.maxRecordatorios !== undefined && a.maxRecordatorios >= 0 && a.maxRecordatorios <= 10 ? Math.round(a.maxRecordatorios) : base.maxRecordatorios,
      activa: a.activa ?? base.activa,
    };
  }
  return salida;
}
