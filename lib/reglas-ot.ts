/**
 * Las reglas del ciclo de una orden de trabajo, en UN solo lugar.
 *
 * Las leen el servidor (`transitionWorkOrder`, que es quien decide) y las
 * pantallas (detalle de la OT y tablero), que solo las usan para no ofrecer un
 * boton que el servidor va a rechazar. Por eso este archivo no toca la base:
 * se importa tambien desde el navegador.
 *
 * El flujo no cambia —Borrador → Abierta → Asignada → En proceso → En espera →
 * Completada → Cerrada, mas Cancelada—. Lo que se corrige es que cada paso
 * pida lo suyo y solo lo pueda dar quien corresponde:
 *
 *   Completada  el tecnico termino el trabajo (cierre tecnico).
 *   Cerrada     el supervisor valido la informacion tecnica y administrativa.
 *
 * Antes cualquiera con permiso de ejecutar podia cerrar; una orden completada
 * ofrecia «Iniciar»; pausar y cancelar no pedian motivo, y una orden cerrada no
 * se podia reabrir por ningun camino, asi que un error de captura se quedaba
 * para siempre en los indicadores.
 */
import { can, type Permission } from "./rbac";

/** Transiciones posibles. Asignada/Abierta tambien se alcanzan al asignar o quitar responsable. */
export const TRANSICIONES_OT: Record<string, string[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  // Reanudar regresa a donde estaba: en proceso si ya se habia iniciado, o
  // asignada/abierta si se puso en espera antes de empezar.
  ON_HOLD: ["IN_PROGRESS", "ASSIGNED", "OPEN", "CANCELLED"],
  // El supervisor valida y cierra, o la devuelve a proceso con motivo.
  COMPLETED: ["CLOSED", "IN_PROGRESS"],
  // Reabrir regresa a Completada: se corrige lo que falto y se vuelve a cerrar.
  CLOSED: ["COMPLETED"],
  CANCELLED: ["OPEN", "ASSIGNED"],
};

/** Largo minimo de un motivo o de la solucion: evita «.» y «x» como justificacion. */
export const MOTIVO_MINIMO = 5;

export const motivoValido = (m: string | null | undefined) => (m ?? "").trim().length >= MOTIVO_MINIMO;

export function esTransicionPosible(de: string, a: string) {
  return TRANSICIONES_OT[de]?.includes(a) ?? false;
}

/**
 * Que permiso pide cada paso.
 *
 *   Ejecutar (tecnico en adelante): iniciar, poner en espera, reanudar, completar.
 *   Cerrar (supervisor en adelante): cerrar y devolver una completada a proceso.
 *   Reabrir (administrador y propietario): reabrir una orden ya cerrada.
 *   Escribir (supervisor en adelante): liberar un borrador, cancelar y reactivar.
 */
export function permisoDeTransicion(de: string, a: string): Permission {
  if (a === "CLOSED") return "workorder:close";
  if (de === "CLOSED") return "workorder:reopen";
  if (de === "COMPLETED") return "workorder:close";
  if (a === "CANCELLED" || de === "CANCELLED" || de === "DRAFT") return "workorder:write";
  return "workorder:execute";
}

/** Pasos que exigen decir por que. */
export function pideMotivo(de: string, a: string): boolean {
  return a === "ON_HOLD" || a === "CANCELLED" || de === "CLOSED" || de === "CANCELLED" ||
    (de === "COMPLETED" && a !== "CLOSED");
}

export type AccionOt = {
  a: string;
  etiqueta: string;
  tono: "primary" | "secondary" | "success" | "danger";
  pideMotivo: boolean;
  /** Pregunta que se le hace a la persona al pedir el motivo. */
  preguntaMotivo?: string;
};

/**
 * Las acciones que se le ofrecen a esta persona para esta orden.
 *
 * Una por destino, con su etiqueta en lenguaje de piso. Nunca aparece «Iniciar»
 * en una orden completada: ahi la accion es «Devolver a proceso», que pide
 * motivo y solo la da un supervisor.
 */
export function accionesDisponibles(
  orden: { status: string; iniciada: boolean; conResponsable: boolean },
  rol: string | undefined,
): AccionOt[] {
  const acciones: AccionOt[] = [];
  const de = orden.status;
  const agregar = (a: string, etiqueta: string, tono: AccionOt["tono"], preguntaMotivo?: string) => {
    if (!esTransicionPosible(de, a) || !can(rol, permisoDeTransicion(de, a))) return;
    acciones.push({ a, etiqueta, tono, pideMotivo: pideMotivo(de, a), preguntaMotivo });
  };

  switch (de) {
    case "DRAFT":
      agregar("OPEN", "Liberar", "primary");
      break;
    case "OPEN":
    case "ASSIGNED":
      agregar("IN_PROGRESS", "Iniciar", "primary");
      agregar("ON_HOLD", "Poner en espera", "secondary", "¿Qué se está esperando?");
      break;
    case "IN_PROGRESS":
      agregar("ON_HOLD", "Pausar", "secondary", "¿Por qué se pausa?");
      agregar("COMPLETED", "Completar", "success");
      break;
    case "ON_HOLD":
      agregar(orden.iniciada ? "IN_PROGRESS" : orden.conResponsable ? "ASSIGNED" : "OPEN", "Reanudar", "primary");
      break;
    case "COMPLETED":
      agregar("CLOSED", "Validar y cerrar", "success");
      agregar("IN_PROGRESS", "Devolver a proceso", "secondary", "¿Qué falta o qué hay que corregir?");
      break;
    case "CLOSED":
      agregar("COMPLETED", "Reabrir", "secondary", "¿Por qué se reabre una orden ya cerrada?");
      break;
    case "CANCELLED":
      agregar(orden.conResponsable ? "ASSIGNED" : "OPEN", "Reactivar", "secondary", "¿Por qué se reactiva?");
      break;
  }
  if (!["COMPLETED", "CLOSED", "CANCELLED"].includes(de)) {
    agregar("CANCELLED", "Cancelar", "danger", "¿Por qué se cancela?");
  }
  return acciones;
}

// ─────────────────────────────────────────────────── Cierre tecnico ───

export type DatosDeCierre = {
  resolucion: string | null;
  /** Horas reales registradas en la orden. */
  horas: number;
  motivoSinHoras: string | null;
  requiereParo: boolean;
  /** Minutos de paro capturados (encabezado mas actividades). */
  minutosParo: number;
  sinParoConfirmado: boolean;
  /** Una entrada por falla a diagnosticar (actividad correctiva o encabezado). */
  fallas: Array<{ etiqueta: string; failureCodeId: string | null; rootCauseId: string | null }>;
  motivoSinDiagnostico: string | null;
  actividadesSinResolver: number;
  evidenciaRequerida: boolean;
  archivos: number;
};

/**
 * Lo que le falta a una orden para darse por completada (o para cerrarse, que
 * vuelve a revisar lo mismo: entre completar y cerrar se pudo editar).
 *
 * Solo pide lo que aporta valor en ESTA orden: una preventiva no pide codigo de
 * falla, una orden sin paro no pide minutos, y la evidencia solo cuando la
 * empresa la exige para ese tipo de equipo.
 */
export function faltantesDeCierre(d: DatosDeCierre): string[] {
  const faltan: string[] = [];
  if (!motivoValido(d.resolucion)) {
    faltan.push("Escriba la solución aplicada o un resumen del trabajo realizado.");
  }
  if (d.horas <= 0 && !motivoValido(d.motivoSinHoras)) {
    faltan.push("Registre las horas de mano de obra, o indique por qué no hay horas que registrar.");
  }
  if (d.requiereParo) {
    if (d.sinParoConfirmado && d.minutosParo > 0) {
      faltan.push("Se capturaron minutos de paro y a la vez se indicó que no hubo paro: deje solo uno.");
    } else if (d.minutosParo <= 0 && !d.sinParoConfirmado) {
      faltan.push("La orden requería paro: capture cuánto duró, o confirme que finalmente no hubo paro.");
    }
  }
  const sinDiagnostico = d.fallas.filter((f) => !f.failureCodeId || !f.rootCauseId);
  if (sinDiagnostico.length && !motivoValido(d.motivoSinDiagnostico)) {
    faltan.push(
      `Falta código de falla o causa raíz en: ${sinDiagnostico.map((f) => f.etiqueta).join(", ")}. ` +
        "Captúrelos, o déjelos «Sin determinar» explicando por qué.",
    );
  }
  if (d.actividadesSinResolver > 0) {
    faltan.push(
      `Quedan ${d.actividadesSinResolver} actividad(es) sin resolver: márquelas como hechas o use «No se pudo hacer» para enviarlas al backlog con su motivo.`,
    );
  }
  if (d.evidenciaRequerida && d.archivos === 0) {
    faltan.push("Esta orden requiere evidencia: suba al menos una foto o documento.");
  }
  return faltan;
}

// ─────────────────────────────────────────── Solicitudes sin OT activa ───

export const TITULO_SOLICITUDES_SIN_OT = "Solicitudes convertidas sin OT activa";

/**
 * Por que una solicitud convertida no tiene una orden viva que la atienda, en
 * las palabras que ven la lista, el detalle, la calidad de captura y la lista
 * de saneamiento. Nulo si no aplica.
 *
 * Son dos casos distintos y el texto no debe decir lo mismo: una nunca quedo
 * ligada a una orden; la otra si tiene orden, pero esta cancelada.
 */
export function motivoSinOtActiva(
  status: string,
  orden: { number: string; status: string } | null | undefined,
): { corto: string; largo: string } | null {
  if (status !== "CONVERTED") return null;
  if (!orden) {
    return {
      corto: "Sin OT activa",
      largo: "Se marcó como convertida, pero no quedó ligada a ninguna orden de trabajo.",
    };
  }
  if (orden.status === "CANCELLED") {
    return {
      corto: "Sin OT activa (cancelada)",
      largo: `Su orden ${orden.number} está cancelada: nadie la está atendiendo.`,
    };
  }
  return null;
}

// ─────────────────────────────────────────── Inicio sin responsable ───

/**
 * Lo que una persona puede hacer para iniciar una orden sin responsable,
 * segun su rol. El mismo criterio que aplica `transitionWorkOrder`:
 *
 *   - Quien ejecuta (tecnico en adelante) puede TOMARLA: queda como responsable.
 *   - Supervisor, administracion y propietario pueden, ademas, iniciarla sin
 *     responsable como EXCEPCION, con motivo. Queda en el historial, en la
 *     bitacora, y la orden sigue contando en «activas sin responsable».
 *   - Solicitante y consulta no pueden iniciarla.
 */
export function inicioSinResponsable(rol: string | undefined): {
  puedeTomarla: boolean;
  puedeExcepcion: boolean;
  texto: string;
} {
  const puedeTomarla = can(rol, "workorder:execute");
  const puedeExcepcion = can(rol, "workorder:write");
  const texto = !puedeTomarla
    ? "Esta orden no tiene responsable. Su rol no puede iniciarla: un técnico o supervisor debe tomarla."
    : puedeExcepcion
      ? "Esta orden no tiene responsable. Para iniciarla, asígnela o tómela usted; solo como excepción puede iniciarla sin responsable, indicando el motivo (queda registrado y la orden sigue contando como «sin responsable»)."
      : "Esta orden no tiene responsable. Para iniciarla, tómela usted: quedará como responsable. Iniciarla sin responsable solo lo autoriza un supervisor.";
  return { puedeTomarla, puedeExcepcion, texto };
}
