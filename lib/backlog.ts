/**
 * El backlog: trabajo que se libero de una OT y sigue pendiente.
 *
 * NO es una tabla. Es una consulta sobre las actividades marcadas como
 * liberadas que nadie ha retomado todavia. La actividad se queda en la OT
 * donde se libero —con su motivo y su fecha— para que esa orden siga contando
 * lo que de verdad ocurrio ese dia. Copiarla a un almacen aparte duplicaria el
 * dato y le quitaria a la OT su historia.
 *
 * Retomar una actividad crea una nueva que apunta a la liberada. Esa cadena es
 * el historial completo, y de ahi sale cuantas veces se ha trabado un trabajo
 * sin llevar contadores que se desincronizan.
 */
import { prisma } from "./db";
import { equivalentesDe } from "./equivalencias";

export const MOTIVOS_LIBERACION = {
  SIN_REFACCION: "No había la refacción",
  SIN_MANO_DE_OBRA: "No hubo quien lo hiciera",
  SERVICIO_EXTERNO: "Requiere servicio externo",
  SIN_ACCESO: "No se pudo parar o entrar al equipo",
  OTRO: "Otro motivo",
} as const;

export type MotivoLiberacion = keyof typeof MOTIVOS_LIBERACION;

export const esMotivoValido = (m: string): m is MotivoLiberacion => m in MOTIVOS_LIBERACION;

/** Cuantas veces se ha liberado este trabajo, recorriendo la cadena hacia atras. */
export async function vecesLiberada(taskId: string): Promise<number> {
  let n = 0;
  let actual: string | null = taskId;
  // La cadena es corta por naturaleza; el tope evita un ciclo por dato corrupto.
  for (let i = 0; actual && i < 50; i++) {
    // El tipo va explicito: sin el, TypeScript no puede inferirlo porque `t`
    // alimenta a `actual`, que es lo que consulta a `t`.
    const t: { retomaDeTaskId: string | null; liberadaAt: Date | null } | null =
      await prisma.workOrderTask.findUnique({
        where: { id: actual },
        select: { retomaDeTaskId: true, liberadaAt: true },
      });
    if (!t) break;
    if (t.liberadaAt) n++;
    actual = t.retomaDeTaskId;
  }
  return n;
}

/**
 * El backlog de una organizacion, opcionalmente de un activo.
 *
 * Devuelve cada actividad liberada con lo que hace falta para decidir: de
 * donde venia, por que se trabo, cuanto lleva esperando y —si fue por
 * refaccion— si hoy ya hay existencia para hacerla.
 */
export async function backlog(organizationId: string, opciones?: { assetId?: string }) {
  const tareas = await prisma.workOrderTask.findMany({
    where: {
      liberadaAt: { not: null },
      // Nadie la ha retomado: eso es lo que la mantiene en el backlog.
      retomadaPor: null,
      workOrder: {
        organizationId,
        ...(opciones?.assetId ? { assetId: opciones.assetId } : {}),
      },
    },
    orderBy: { liberadaAt: "asc" },
    select: {
      id: true, title: true, description: true, taskType: true,
      unit: true, minValue: true, maxValue: true, required: true,
      origen: true, origenPlanId: true, origenRequestId: true, maintenanceType: true,
      // De que actividad del plan salio. Sin esto, al retomarla la orden nueva
      // no sabria que reloj avanzar al cerrarse, y la actividad se quedaria
      // marcada como atrasada para siempre aunque ya se hubiera hecho.
      planTaskId: true,
      liberadaAt: true, motivoLiberacion: true, motivoDetalle: true,
      bloqueadaPorPartId: true,
      // El id va ademas del nombre: sin el no se le puede avisar a esa persona
      // cuando la refaccion que la trabo por fin llega.
      avisoDisponibleAt: true,
      liberadaPorId: true,
      liberadaPor: { select: { name: true } },
      bloqueadaPor: { select: { id: true, code: true, name: true, quantityOnHand: true, unit: true } },
      workOrder: {
        select: {
          id: true, number: true, closedAt: true, completedAt: true,
          asset: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });

  // Las equivalentes de las refacciones que trabaron trabajo. Se consultan de
  // una vez y no una por tarea: dos actividades trabadas por el mismo balero
  // no tienen por que preguntar dos veces.
  const bloqueantes = [...new Set(tareas.map((t) => t.bloqueadaPorPartId).filter(Boolean))] as string[];
  const alternativas = new Map<string, Awaited<ReturnType<typeof equivalentesDe>>>();
  for (const partId of bloqueantes) {
    alternativas.set(partId, (await equivalentesDe(organizationId, partId)).filter((e) => e.hay > 0));
  }

  const ahora = Date.now();
  return tareas.map((t) => {
    const equivalentes = t.bloqueadaPorPartId ? alternativas.get(t.bloqueadaPorPartId) ?? [] : [];
    const hayPropia = (t.bloqueadaPor?.quantityOnHand ?? 0) > 0;
    return {
      ...t,
      diasEsperando: t.liberadaAt
        ? Math.floor((ahora - t.liberadaAt.getTime()) / 86_400_000)
        : 0,
      // Con equivalentes: una actividad trabada por un balero que no llego se
      // puede hacer hoy si el equivalente de otra marca si esta en el almacen.
      // Deterministico, contra la existencia de hoy.
      yaSePuede:
        t.motivoLiberacion === "SIN_REFACCION"
          ? hayPropia || equivalentes.length > 0
          : null,
      /** Con que se puede resolver si la original sigue sin llegar. */
      conEquivalente: hayPropia ? null : (equivalentes[0] ?? null),
    };
  });
}

export type ItemBacklog = Awaited<ReturnType<typeof backlog>>[number];
