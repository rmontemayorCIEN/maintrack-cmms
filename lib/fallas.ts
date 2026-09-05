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

/** True cuando ese tipo de mantenimiento representa una falla real. */
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
  const rango = { gte: desde, ...(hasta ? { lte: hasta } : {}) };

  const [actividades, encabezados] = await Promise.all([
    prisma.workOrderTask.findMany({
      where: {
        failureCodeId: { not: null },
        workOrder: { organizationId, completedAt: rango },
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
