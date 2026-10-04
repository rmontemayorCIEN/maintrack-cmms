/**
 * Que le falta a cada orden para poder cerrarse, todas de un golpe.
 *
 * ── Por que existe ──
 *
 * La ficha de la orden ya dice que le falta a ESA orden. Pero quien valida no
 * trabaja de una en una: tiene treinta completadas y necesita saber cuales
 * estan listas y cuales no, sin abrir las treinta. Ese es el cierre
 * administrativo, y es donde se atora el mes.
 *
 * ── Es el MISMO criterio, no uno parecido ──
 *
 * Cada renglon sale de `datosDeCierre` + `faltantesDeCierre`, las mismas
 * funciones que usa la ficha y las mismas que el servidor aplica al cerrar. Si
 * el tablero dijera «lista» y al cerrar el sistema pidiera algo mas, el
 * tablero no serviria para nada: seria un semaforo que hay que verificar.
 *
 * ── Que NO entra ──
 *
 * Las ordenes que no han empezado. El semaforo de una recien abierta es todo
 * ambar y no informa: claro que le falta todo. El valor esta en el trabajo ya
 * hecho o en curso.
 */
import { prisma } from "./db";
import { faltantesDeCierre, type SeccionDeOrden } from "./reglas-ot";
import { datosDeCierre, requiereEvidencia } from "./workorders";
import { motivoValido } from "./reglas-ot";
import { BLOQUES, type ClaveBloque, type EstadoDeBloque, type FilaCierre } from "./cierre-tipos";

export { BLOQUES };
export type { ClaveBloque, EstadoDeBloque, FilaCierre };

/** El tablero completo: una orden por renglon, con su semaforo. */
export async function tableroDeCierre(
  organizationId: string,
  opciones: { estados?: string[]; ahora?: Date } = {},
): Promise<{ filas: FilaCierre[]; listas: number; conPendientes: number }> {
  const ahora = opciones.ahora ?? new Date();
  // Trabajo que ya empezo: lo demas no informa.
  const estados = opciones.estados ?? ["COMPLETED", "IN_PROGRESS", "ON_HOLD"];

  const ordenes = await prisma.workOrder.findMany({
    where: { organizationId, status: { in: estados } },
    include: {
      tasks: true,
      asset: { select: { code: true, name: true, criticality: true } },
      assignedTo: { select: { name: true } },
      organization: { select: { otEvidenciaCriticas: true } },
      _count: { select: { attachments: true } },
    },
    // Lo que lleva mas tiempo esperando validacion, primero.
    orderBy: [{ completedAt: "asc" }, { updatedAt: "asc" }],
    take: 200,
  });

  // Las horas de todas, en UNA consulta: preguntarlas orden por orden serian
  // doscientas idas a la base para pintar una pantalla.
  const horasPorOrden = new Map<string, number>(
    (await prisma.workOrderLabor.groupBy({
      by: ["workOrderId"],
      where: { workOrderId: { in: ordenes.map((o) => o.id) } },
      _sum: { hours: true },
    })).map((h) => [h.workOrderId, h._sum.hours ?? 0]),
  );

  const filas: FilaCierre[] = ordenes.map((wo) => {
    const horas = horasPorOrden.get(wo.id) ?? 0;
    const datos = datosDeCierre(wo, {
      horas,
      archivos: wo._count.attachments,
      evidenciaRequerida: requiereEvidencia(wo.organization, wo),
    });
    const faltantes = faltantesDeCierre(datos);
    const detiene = new Set(faltantes.map((f) => f.seccion));

    const seña = (id: SeccionDeOrden, hecho: boolean): EstadoDeBloque =>
      detiene.has(id) ? "falta" : hecho ? "hecho" : "neutro";

    const bloques: Record<ClaveBloque, EstadoDeBloque> = {
      actividades: seña("actividades", wo.tasks.length > 0 && datos.actividadesSinResolver === 0),
      tiempo: seña("tiempo", horas > 0),
      // Materiales no detiene el cierre: se marca verde si se cargo algo, y
      // gris si no, porque hay trabajos que legitimamente no consumen nada.
      materiales: wo.partsCost > 0 || wo.serviceCost > 0 ? "hecho" : "neutro",
      evidencias: seña("evidencias", wo._count.attachments > 0),
      resultado: seña("resultado", motivoValido(wo.resolution)),
    };

    const diasEsperando = wo.completedAt
      ? Math.floor((ahora.getTime() - wo.completedAt.getTime()) / 86_400_000)
      : null;

    return {
      id: wo.id, number: wo.number, title: wo.title, status: wo.status,
      prioridad: wo.priority,
      activo: wo.asset ? `${wo.asset.code} · ${wo.asset.name}` : null,
      responsable: wo.assignedTo?.name ?? null,
      completadaEl: wo.completedAt?.toISOString() ?? null,
      diasEsperando,
      bloques,
      faltan: faltantes.length,
      motivos: faltantes.map((f) => f.texto),
    };
  });

  return {
    filas,
    listas: filas.filter((f) => f.faltan === 0).length,
    conPendientes: filas.filter((f) => f.faltan > 0).length,
  };
}
