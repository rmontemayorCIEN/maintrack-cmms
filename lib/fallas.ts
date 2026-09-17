import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Un solo lugar decide que cuenta como falla.
 *
 * Antes cada consumidor lo decidia por su cuenta y se desalinearon: el analisis
 * de recurrencia filtraba a correctivo y seguridad, mientras el Pareto de
 * Reportes contaba cualquier OT que trajera codigo. Un preventivo codificado
 * por error aparecia en un lado y no en el otro, y nadie podia decir cual de
 * los dos numeros era el bueno.
 */
export const TIPOS_DE_FALLA = ["CORRECTIVE", "SAFETY"] as const;

/**
 * Si un TIPO de actividad es de falla. Solo decide que actividades piden
 * codigo, causa y paro al cerrar la orden. NO decide si la orden cuenta como
 * falla en los indicadores: eso lo decide `clasificarFalla`.
 */
export function esFalla(maintenanceType: string | null | undefined): boolean {
  return !!maintenanceType && (TIPOS_DE_FALLA as readonly string[]).includes(maintenanceType);
}

/**
 * El tipo que manda para una actividad.
 *
 * La actividad puede traer el suyo —un correctivo colado en una OT preventiva—
 * y ese gana. Si no lo trae, hereda el del encabezado.
 */
export function tipoDeActividad(
  tipoActividad: string | null | undefined,
  tipoOrden: string,
): string {
  return tipoActividad ?? tipoOrden;
}

// ─────────────────────────────────────── Que orden ES una falla ───

/**
 * La regla UNICA de si una orden cuenta como falla (MTBF, MTTR, tiempo de
 * respuesta, recurrencia, calidad de datos y Diagnostico IA).
 *
 * Una orden es falla solo con una condicion operativa explicita:
 *
 *   1. Es una orden CORRECTIVA.
 *   2. Es de SEGURIDAD y trae codigo (modo) de falla registrado.
 *   3. Una actividad de tipo falla (correctiva o de seguridad, propia o
 *      heredada del encabezado) trae codigo de falla: la falla se registro
 *      durante la intervencion (una falla encontrada en un preventivo).
 *   4. Una de sus actividades viene de una solicitud que quien la reviso
 *      clasifico como FALLA.
 *
 * NO basta:
 *   - El tipo de una actividad por si solo. Antes una actividad marcada como
 *     correctiva convertia en falla a toda la orden preventiva, aunque nadie
 *     hubiera registrado falla alguna.
 *   - El tipo SEGURIDAD sin codigo de falla.
 *   - Un codigo puesto en una actividad preventiva, de mejora o de apoyo: el
 *     cierre solo pide codigo en actividades de falla, asi que ahi es un error
 *     de captura. Un preventivo bien ejecutado no es una falla (CLAUDE.md).
 *   - El titulo de la orden.
 * Una orden cancelada nunca es falla.
 */
export type ClasificacionFalla = { esFalla: boolean; razon: string | null };

type OrdenParaClasificar = {
  status: string;
  maintenanceType: string;
  failureCodeId?: string | null;
  tasks: Array<{ title?: string | null; maintenanceType?: string | null; failureCodeId?: string | null; origenRequestId?: string | null }>;
};

export function clasificarFalla(orden: OrdenParaClasificar, solicitudesDeFalla: ReadonlySet<string>): ClasificacionFalla {
  if (orden.status === "CANCELLED") return { esFalla: false, razon: null };
  if (orden.maintenanceType === "CORRECTIVE") return { esFalla: true, razon: "Orden correctiva" };
  if (orden.maintenanceType === "SAFETY" && orden.failureCodeId) {
    return { esFalla: true, razon: "Orden de seguridad con código de falla" };
  }
  const conCodigo = orden.tasks.find((t) => t.failureCodeId && esFalla(tipoDeActividad(t.maintenanceType, orden.maintenanceType)));
  if (conCodigo) return { esFalla: true, razon: `Falla registrada en la actividad «${conCodigo.title ?? "sin título"}»` };
  const deSolicitud = orden.tasks.find((t) => t.origenRequestId && solicitudesDeFalla.has(t.origenRequestId));
  if (deSolicitud) return { esFalla: true, razon: `Actividad «${deSolicitud.title ?? "sin título"}» de una solicitud clasificada como falla` };
  return { esFalla: false, razon: null };
}

/** Las solicitudes de la empresa que quien las reviso clasifico como FALLA. */
export async function solicitudesDeFalla(organizationId: string): Promise<Set<string>> {
  const filas = await prisma.workRequest.findMany({
    where: { organizationId, tipo: "FALLA" },
    select: { id: true },
  });
  return new Set(filas.map((f) => f.id));
}

/** La misma regla como filtro de Prisma, para consultas que cuentan en la base. */
export async function filtroDeFalla(organizationId: string): Promise<Prisma.WorkOrderWhereInput> {
  const ids = [...(await solicitudesDeFalla(organizationId))];
  return {
    status: { not: "CANCELLED" },
    OR: [
      { maintenanceType: "CORRECTIVE" },
      { maintenanceType: "SAFETY", failureCodeId: { not: null } },
      { tasks: { some: { failureCodeId: { not: null }, maintenanceType: { in: [...TIPOS_DE_FALLA] } } } },
      // Actividad sin tipo propio: hereda el del encabezado.
      { maintenanceType: "SAFETY", tasks: { some: { failureCodeId: { not: null }, maintenanceType: null } } },
      ...(ids.length ? [{ tasks: { some: { origenRequestId: { in: ids } } } }] : []),
    ],
  };
}

/** Texto de alcance para las fichas de los indicadores. */
export const REGLA_DE_FALLA =
  "Orden correctiva; de seguridad con código de falla; con una actividad correctiva o de seguridad con código de falla; o con una actividad de una solicitud clasificada como falla (sin canceladas)";

export type FallaContada = {
  failureCodeId: string;
  rootCauseId: string | null;
  downtimeMinutes: number;
  /**
   * Lo que costo esta falla. En las de actividad es lo que se le cargo
   * directamente; en las de encabezado, el total de la orden —esas ordenes
   * viejas atendian una sola falla, asi que todo su costo le corresponde.
   */
  costo: number;
  /** De donde salio: la actividad (lo nuevo) o el encabezado (ordenes viejas). */
  fuente: "ACTIVIDAD" | "ENCABEZADO";
  assetId: string | null;
  ocurrioEl: Date;
};

/**
 * Todas las fallas codificadas de una organizacion en un periodo.
 *
 * Junta dos origenes porque el modelo cambio a media vida del sistema:
 *
 *  - ACTIVIDAD: lo nuevo. El codigo vive en la actividad, asi una OT mezclada
 *    puede cargar varios reportes de falla y cada uno conserva su causa.
 *  - ENCABEZADO: las ordenes anteriores al cambio, que solo tienen un codigo
 *    arriba. Se siguen contando —son historia real— pero solo si la orden es
 *    de un tipo que representa falla.
 *
 * Una orden que ya tiene fallas en sus actividades NO aporta ademas la del
 * encabezado: seria contar el mismo evento dos veces.
 */
export async function fallasCodificadas(
  organizationId: string,
  desde: Date,
  hasta?: Date,
): Promise<FallaContada[]> {
  // Semiabierto `[desde, hasta)`, como todos los periodos (`lib/periodos`), y
  // solo ordenes terminadas: una reabierta conserva su fecha vieja de termino.
  const rango = { gte: desde, ...(hasta ? { lt: hasta } : {}) };
  const terminada = { in: ["COMPLETED", "CLOSED"] };

  const [actividades, encabezados] = await Promise.all([
    prisma.workOrderTask.findMany({
      where: {
        failureCodeId: { not: null },
        workOrder: { organizationId, status: terminada, completedAt: rango },
      },
      select: {
        failureCodeId: true, rootCauseId: true, downtimeMinutes: true,
        maintenanceType: true, totalCost: true,
        workOrder: { select: { id: true, assetId: true, completedAt: true, maintenanceType: true } },
      },
    }),
    prisma.workOrder.findMany({
      where: {
        organizationId,
        failureCodeId: { not: null },
        maintenanceType: { in: [...TIPOS_DE_FALLA] },
        status: terminada,
        completedAt: rango,
      },
      select: {
        id: true, failureCodeId: true, rootCauseId: true, downtimeMinutes: true,
        assetId: true, completedAt: true, totalCost: true,
      },
    }),
  ]);

  const conActividades = new Set(actividades.map((a) => a.workOrder.id));

  const deActividades: FallaContada[] = actividades
    // Misma regla que `clasificarFalla`: el codigo cuenta solo en actividades de falla.
    .filter((a) => esFalla(tipoDeActividad(a.maintenanceType, a.workOrder.maintenanceType)))
    .map((a) => ({
      failureCodeId: a.failureCodeId!,
      rootCauseId: a.rootCauseId,
      downtimeMinutes: a.downtimeMinutes,
      costo: a.totalCost,
      fuente: "ACTIVIDAD" as const,
      assetId: a.workOrder.assetId,
      ocurrioEl: a.workOrder.completedAt!,
    }));

  const deEncabezados: FallaContada[] = encabezados
    .filter((w) => !conActividades.has(w.id))
    .map((w) => ({
      failureCodeId: w.failureCodeId!,
      rootCauseId: w.rootCauseId,
      downtimeMinutes: w.downtimeMinutes,
      costo: w.totalCost,
      fuente: "ENCABEZADO" as const,
      assetId: w.assetId,
      ocurrioEl: w.completedAt!,
    }));

  return [...deActividades, ...deEncabezados];
}

/** Agrupa por codigo, de mayor a menor. Lo que alimenta el Pareto. */
export function agruparPorCodigo(fallas: FallaContada[]) {
  const mapa = new Map<string, { failureCodeId: string; eventos: number; minutosParo: number; costo: number }>();
  for (const f of fallas) {
    const acc = mapa.get(f.failureCodeId) ?? { failureCodeId: f.failureCodeId, eventos: 0, minutosParo: 0, costo: 0 };
    acc.eventos += 1;
    acc.minutosParo += f.downtimeMinutes;
    acc.costo += f.costo;
    mapa.set(f.failureCodeId, acc);
  }
  return [...mapa.values()].sort((a, b) => b.eventos - a.eventos);
}

/** Agrupa por causa raiz, de mayor a menor. */
export function agruparPorCausa(fallas: FallaContada[]) {
  const mapa = new Map<string, { rootCauseId: string; eventos: number }>();
  for (const f of fallas) {
    if (!f.rootCauseId) continue;
    const acc = mapa.get(f.rootCauseId) ?? { rootCauseId: f.rootCauseId, eventos: 0 };
    acc.eventos += 1;
    mapa.set(f.rootCauseId, acc);
  }
  return [...mapa.values()].sort((a, b) => b.eventos - a.eventos);
}
