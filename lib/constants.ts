/** Catalogos de dominio. Se usan strings (no enums nativos) para mantener el
 *  esquema portable entre SQLite (dev) y PostgreSQL/Cloud SQL (produccion). */

export const ROLES = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  SUPERVISOR: "SUPERVISOR",
  TECHNICIAN: "TECHNICIAN",
  REQUESTER: "REQUESTER",
  COMPRAS: "COMPRAS",
  VIEWER: "VIEWER",
} as const;
export type Role = keyof typeof ROLES;

/**
 * Los roles que la administración puede dar (el de propietario no se asigna:
 * es de quien abrió la cuenta). Una sola lista para el alta, el cambio de rol
 * y la validación de la API: antes «Compras» existía en permisos pero no se
 * podía elegir al crear un usuario.
 */
export const ROLES_ASIGNABLES = ["ADMIN", "SUPERVISOR", "TECHNICIAN", "COMPRAS", "REQUESTER", "VIEWER"] as const;

export const ROLE_LABELS: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  TECHNICIAN: "Técnico",
  REQUESTER: "Solicitante",
  COMPRAS: "Compras",
  VIEWER: "Consulta",
};

export const MAINTENANCE_TYPES = {
  PREVENTIVE: "PREVENTIVE",
  CORRECTIVE: "CORRECTIVE",
  PREDICTIVE: "PREDICTIVE",
  INSPECTION: "INSPECTION",
  SAFETY: "SAFETY",
  IMPROVEMENT: "IMPROVEMENT",
} as const;

export const MAINTENANCE_TYPE_LABELS: Record<string, string> = {
  PREVENTIVE: "Preventivo",
  CORRECTIVE: "Correctivo",
  PREDICTIVE: "Predictivo",
  INSPECTION: "Inspeccion",
  SAFETY: "Seguridad",
  IMPROVEMENT: "Mejora",
  /**
   * Apoyo: prestar manos a produccion, mover un equipo, una maniobra.
   *
   * Consume horas y cuesta dinero, asi que se registra —si el equipo se va la
   * mitad del tiempo en apoyos, la capacidad tiene que reflejarlo. Pero NO es
   * una falla del equipo: queda fuera del Pareto, del MTBF y del indicador de
   * preventivo contra correctivo. Contarlo como correctivo diria que las
   * maquinas fallan mas de lo que fallan.
   */
  SUPPORT: "Apoyo",
};

export const MAINTENANCE_TYPE_COLORS: Record<string, string> = {
  PREVENTIVE: "bg-sky-100 text-sky-700 border-sky-200",
  CORRECTIVE: "bg-orange-100 text-orange-700 border-orange-200",
  PREDICTIVE: "bg-violet-100 text-violet-700 border-violet-200",
  INSPECTION: "bg-emerald-100 text-emerald-700 border-emerald-200",
  SAFETY: "bg-red-100 text-red-700 border-red-200",
  IMPROVEMENT: "bg-teal-100 text-teal-700 border-teal-200",
  SUPPORT: "bg-slate-100 text-slate-700 border-slate-200",
};

export const WO_STATUS = {
  DRAFT: "DRAFT",
  OPEN: "OPEN",
  ASSIGNED: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  ON_HOLD: "ON_HOLD",
  COMPLETED: "COMPLETED",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
} as const;

export const WO_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  OPEN: "Abierta",
  ASSIGNED: "Asignada",
  IN_PROGRESS: "En proceso",
  ON_HOLD: "En espera",
  COMPLETED: "Completada",
  CLOSED: "Cerrada",
  CANCELLED: "Cancelada",
};

export const WO_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 border-slate-200",
  OPEN: "bg-blue-100 text-blue-700 border-blue-200",
  ASSIGNED: "bg-indigo-100 text-indigo-700 border-indigo-200",
  IN_PROGRESS: "bg-amber-100 text-amber-700 border-amber-200",
  ON_HOLD: "bg-orange-100 text-orange-700 border-orange-200",
  COMPLETED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  CLOSED: "bg-teal-100 text-teal-700 border-teal-200",
  CANCELLED: "bg-rose-100 text-rose-700 border-rose-200",
};

/** Estados considerados "activos" (backlog abierto). */
export const OPEN_STATUSES = ["DRAFT", "OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"];
export const BOARD_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"];

/** Transiciones del flujo de una orden de trabajo: viven en `lib/reglas-ot.ts`. */
export { TRANSICIONES_OT as STATUS_TRANSITIONS } from "./reglas-ot";

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};
export const PRIORITY_COLORS: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-600 border-slate-200",
  MEDIUM: "bg-blue-100 text-blue-700 border-blue-200",
  HIGH: "bg-amber-100 text-amber-800 border-amber-200",
  CRITICAL: "bg-red-100 text-red-700 border-red-200",
};
/** Peso usado para ordenar el backlog y calcular el indice de urgencia. */
export const PRIORITY_WEIGHT: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export const ASSET_STATUS_LABELS: Record<string, string> = {
  OPERATIONAL: "Operativo",
  DEGRADED: "Degradado",
  DOWN: "Fuera de servicio",
  STANDBY: "En reserva",
  RETIRED: "Baja",
};
export const ASSET_STATUS_COLORS: Record<string, string> = {
  OPERATIONAL: "bg-emerald-100 text-emerald-700 border-emerald-200",
  DEGRADED: "bg-amber-100 text-amber-700 border-amber-200",
  DOWN: "bg-red-100 text-red-700 border-red-200",
  STANDBY: "bg-slate-100 text-slate-600 border-slate-200",
  RETIRED: "bg-slate-100 text-slate-400 border-slate-200",
};

export const CRITICALITY_LABELS: Record<string, string> = {
  A: "A - Crítico",
  B: "B - Importante",
  C: "C - Secundario",
};
export const CRITICALITY_COLORS: Record<string, string> = {
  A: "bg-red-100 text-red-700 border-red-200",
  B: "bg-amber-100 text-amber-700 border-amber-200",
  C: "bg-slate-100 text-slate-600 border-slate-200",
};

export const TRIGGER_LABELS: Record<string, string> = {
  CALENDAR: "Calendario",
  METER: "Medidor",
  CONDITION: "Condicion",
};

export const SENSOR_TYPE_LABELS: Record<string, string> = {
  VIBRATION: "Vibracion",
  TEMPERATURE: "Temperatura",
  PRESSURE: "Presion",
  CURRENT: "Corriente",
  OIL: "Análisis de aceite",
  ULTRASOUND: "Ultrasonido",
  FLOW: "Flujo",
  RPM: "Velocidad",
};

export const SENSOR_STATUS_COLORS: Record<string, string> = {
  NORMAL: "bg-emerald-100 text-emerald-700 border-emerald-200",
  WARNING: "bg-amber-100 text-amber-800 border-amber-200",
  CRITICAL: "bg-red-100 text-red-700 border-red-200",
};

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  CONVERTED: "Convertida en OT",
};
/**
 * Las solicitudes que siguen esperando algo de alguien.
 *
 * Rechazada y Convertida ya terminaron su vida: la primera porque se decidio
 * que no, la segunda porque ya es una orden de trabajo y el seguimiento pasa
 * a la orden. Vive aqui, junto a las etiquetas, para que nadie vuelva a
 * escribir la lista a mano en una consulta.
 */
export const REQUEST_OPEN_STATUSES = ["PENDING", "APPROVED"];

export const REQUEST_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 border-amber-200",
  APPROVED: "bg-blue-100 text-blue-700 border-blue-200",
  REJECTED: "bg-rose-100 text-rose-700 border-rose-200",
  CONVERTED: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

// El catalogo comercial vive en lib/planes.ts: limites, precios y funciones
// de cada plan, junto con su verificacion.


/** Tipos de medidor. Deciden que lectura es imposible o atipica (`lib/medidores`). */
export const TIPOS_MEDIDOR = {
  HOROMETRO: "Horómetro",
  ODOMETRO: "Odómetro",
  CICLOS: "Contador de ciclos",
  OTRO: "Otro",
} as const;

export const TIPOS_LECTURA = {
  LECTURA: "Lectura",
  REINICIO: "Reinicio del medidor",
  SUSTITUCION: "Sustitución del medidor",
} as const;
