/**
 * Programar una orden: validar y advertir, sin optimizar.
 *
 * El calendario ya pintaba la sobrecarga pero no ayudaba a resolverla, y la
 * edicion de la orden dejaba poner cualquier fecha y cualquier numero de
 * horas sin decir nada. Aqui se revisa lo que se quiere programar contra la
 * jornada y la carga ya asignada, y se propone lo mas simple que funciona:
 * otros dias en que esa persona tiene lugar, u otras personas libres ese dia.
 *
 * No bloquea: advierte, y quien programa (supervisor en adelante) puede
 * aceptar la advertencia. Todo es aritmetica sobre `lib/agenda.ts`, la misma
 * que pinta el calendario, para que la advertencia y la pantalla coincidan.
 */
import { prisma } from "./db";
import { cargaPorDia, esHabil, festivoDe, jornada } from "./agenda";
import { OPEN_STATUSES } from "./constants";

/** Horas estimadas razonables para una orden. */
export const HORAS_MAXIMAS_ORDEN = 500;

export class ErrorDeProgramacion extends Error {
  constructor(mensaje: string, readonly codigo: number = 422, readonly detalles?: unknown) {
    super(mensaje);
    this.name = "ErrorDeProgramacion";
  }
}

/** Validacion dura: datos que no pueden ser. */
export function validarDatosDeProgramacion(d: { estimatedHours?: number; dueDate?: Date | null; scheduledStart?: Date | null }) {
  if (d.estimatedHours !== undefined && (!(d.estimatedHours > 0) || d.estimatedHours > HORAS_MAXIMAS_ORDEN)) {
    throw new ErrorDeProgramacion(
      `Las horas estimadas deben ser mayores a cero y no más de ${HORAS_MAXIMAS_ORDEN}. ` +
        "Sin estimado no se puede medir la carga ni el backlog.",
    );
  }
  if (d.scheduledStart && d.dueDate && d.scheduledStart > d.dueDate) {
    throw new ErrorDeProgramacion("El inicio programado no puede ser posterior a la fecha compromiso.");
  }
}

/**
 * Mover la fecha compromiso de una orden abierta que ya tenia fecha pide motivo.
 * Programar por primera vez, o tocar una orden terminada, no. Se compara el
 * dia, no la hora: guardar el mismo dia otra vez no es reprogramar.
 */
export function esReprogramacion(p: { status: string; fechaAnterior: Date | null; fechaNueva: Date | null }) {
  const dia = (d: Date | null) => (d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : null);
  return OPEN_STATUSES.includes(p.status) && p.fechaAnterior !== null && dia(p.fechaAnterior) !== dia(p.fechaNueva);
}

const clave = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export type RevisionDeProgramacion = {
  advertencias: string[];
  /** Dias cercanos en que el responsable si tiene capacidad para estas horas. */
  diasConCapacidad: Array<{ fecha: string; libres: number }>;
  /** Personas con capacidad ese mismo dia. */
  personasConCapacidad: Array<{ id: string; nombre: string; libres: number }>;
};

/**
 * Revisa una programacion propuesta: dia laborable y capacidad del
 * responsable ese dia, sin contar la propia orden (si ya estaba ahi).
 */
export async function revisarProgramacion(p: {
  organizationId: string;
  fecha: Date | null;
  responsableId: string | null;
  horas: number;
  /** La orden que se esta programando, para no contarla dos veces. */
  ordenId?: string;
}): Promise<RevisionDeProgramacion> {
  const vacio: RevisionDeProgramacion = { advertencias: [], diasConCapacidad: [], personasConCapacidad: [] };
  if (!p.fecha) return vacio;

  const inicio = new Date(p.fecha.getFullYear(), p.fecha.getMonth(), p.fecha.getDate());
  const HORIZONTE = 14;
  const fin = new Date(inicio);
  fin.setDate(inicio.getDate() + HORIZONTE);
  fin.setHours(23, 59, 59);

  const [j, ordenes, personas] = await Promise.all([
    jornada(p.organizationId, inicio, fin),
    prisma.workOrder.findMany({
      where: {
        organizationId: p.organizationId,
        status: { in: OPEN_STATUSES },
        dueDate: { gte: inicio, lte: fin },
        ...(p.ordenId ? { id: { not: p.ordenId } } : {}),
      },
      select: {
        dueDate: true, estimatedHours: true, status: true,
        assignedTo: { select: { id: true, name: true, color: true, horasDisponibles: true } },
      },
    }),
    prisma.user.findMany({
      where: { organizationId: p.organizationId, active: true, role: { in: ["TECHNICIAN", "SUPERVISOR"] } },
      select: { id: true, name: true, horasDisponibles: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const dias = Array.from({ length: HORIZONTE + 1 }, (_, i) => {
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    return d;
  });
  const carga = cargaPorDia(dias, ordenes, j);
  const cargaDe = (dia: number, userId: string) =>
    carga[dia].personas.find((x) => x.userId === userId)?.horas ?? 0;
  const capacidadDe = (dia: number, persona: { horasDisponibles: number | null }) =>
    carga[dia].habil ? (persona.horasDisponibles ?? j.horasJornada) : 0;

  const r: RevisionDeProgramacion = { advertencias: [], diasConCapacidad: [], personasConCapacidad: [] };
  const fechaTexto = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "short" }).format(inicio);

  if (!esHabil(inicio, j)) {
    const festivo = festivoDe(inicio, j);
    r.advertencias.push(`El ${fechaTexto} no es día laborable${festivo ? ` (${festivo})` : ""}.`);
  }

  const responsable = p.responsableId ? personas.find((x) => x.id === p.responsableId)
    ?? await prisma.user.findFirst({
      where: { id: p.responsableId, organizationId: p.organizationId },
      select: { id: true, name: true, horasDisponibles: true },
    }) : null;

  if (responsable) {
    const capacidad = capacidadDe(0, responsable);
    const yaTiene = cargaDe(0, responsable.id);
    if (capacidad > 0 && yaTiene + p.horas > capacidad) {
      r.advertencias.push(
        `${responsable.name} ya tiene ${yaTiene} h ese día; con estas ${p.horas} h serían ${yaTiene + p.horas} h de ${capacidad} h disponibles.`,
      );
    }
    if (r.advertencias.length) {
      for (let i = 1; i < dias.length && r.diasConCapacidad.length < 3; i++) {
        const libres = capacidadDe(i, responsable) - cargaDe(i, responsable.id);
        if (libres >= p.horas) r.diasConCapacidad.push({ fecha: clave(dias[i]), libres });
      }
    }
  }

  // Propuesta de personas: cuando la de hoy no cabe, o cuando todavia no hay
  // responsable (no es una advertencia: es normal crearla sin asignar).
  if ((r.advertencias.length || !responsable) && carga[0].habil) {
    for (const persona of personas) {
      if (persona.id === p.responsableId) continue;
      const libres = capacidadDe(0, persona) - cargaDe(0, persona.id);
      if (libres >= p.horas) r.personasConCapacidad.push({ id: persona.id, nombre: persona.name, libres });
      if (r.personasConCapacidad.length >= 3) break;
    }
  }
  return r;
}
