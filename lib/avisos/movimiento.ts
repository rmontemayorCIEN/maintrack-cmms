/**
 * Qué cuenta como movimiento de una orden de trabajo.
 *
 * El recordatorio «OT vencida sin movimiento» se detiene cuando alguien de
 * verdad movió la orden. `updatedAt` no sirve para eso: cambia al corregir un
 * título, al guardar sin cambios y cada vez que el sistema recalcula costos.
 *
 * Cuenta como movimiento:
 *  - el inicio real (startedAt);
 *  - un avance: una actividad hecha o liberada, horas de mano de obra o
 *    material cargado a la orden;
 *  - un cambio de estado (iniciar, detener, reanudar, terminar, cerrar,
 *    cancelar), salvo que se deshaga en menos de diez minutos;
 *  - una reprogramación con motivo a una fecha futura, salvo que se deshaga
 *    en menos de diez minutos.
 *
 * No cuenta: abrir la pantalla, leer o reconocer el aviso («Enterado»),
 * editar un campo que no es avance, guardar sin cambios, comentar, cambiar el
 * responsable, ni cambiar algo y regresarlo al mismo valor.
 */
import { prisma } from "../db";

const DESHACER_MS = 10 * 60_000;

export type Movimiento = { el: Date; que: string; actorId: string | null };

type Cambio = { el: Date; antes: string; despues: string; que: string; actorId: string | null; valido: boolean };

function leerCambios(texto: string): Record<string, unknown> {
  try { return JSON.parse(texto) as Record<string, unknown>; } catch { return {}; }
}

const fechaCorta = (d: Date) => d.toLocaleDateString("es-MX", { timeZone: "America/Monterrey", day: "numeric", month: "short", year: "numeric" });

/**
 * Quita los pares que se deshicieron: A→B seguido, en menos de diez minutos,
 * de B→A. Cambiar y regresar al mismo valor no es movimiento.
 */
function sinDeshechos(cambios: Cambio[]): Cambio[] {
  const quedan = [...cambios].sort((a, b) => a.el.getTime() - b.el.getTime());
  for (let i = 0; i < quedan.length - 1; i++) {
    const a = quedan[i];
    const b = quedan[i + 1];
    if (b.el.getTime() - a.el.getTime() <= DESHACER_MS && a.antes === b.despues && a.despues === b.antes) {
      quedan.splice(i, 2);
      i = Math.max(-1, i - 2);
    }
  }
  return quedan;
}

/** El último movimiento válido de cada orden, o nada si nunca se movió. */
export async function ultimosMovimientos(organizationId: string, ids: string[]): Promise<Map<string, Movimiento>> {
  const salida = new Map<string, Movimiento>();
  if (!ids.length) return salida;
  const mejor = (id: string, m: Movimiento) => {
    const actual = salida.get(id);
    if (!actual || m.el.getTime() > actual.el.getTime()) salida.set(id, m);
  };

  const [ordenes, tareas, horas, material, bitacora] = await Promise.all([
    prisma.workOrder.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, startedAt: true } }),
    prisma.workOrderTask.findMany({
      where: { workOrderId: { in: ids }, workOrder: { organizationId }, OR: [{ completedAt: { not: null } }, { liberadaAt: { not: null } }] },
      select: { workOrderId: true, completedAt: true, completedById: true, liberadaAt: true, liberadaPorId: true, title: true },
    }),
    prisma.workOrderLabor.findMany({
      where: { workOrderId: { in: ids }, workOrder: { organizationId } },
      select: { workOrderId: true, workedAt: true, userId: true, hours: true },
    }),
    prisma.stockMovement.findMany({
      where: { organizationId, workOrderId: { in: ids } },
      select: { workOrderId: true, createdAt: true, userId: true },
    }),
    prisma.auditLog.findMany({
      where: { organizationId, entity: "WorkOrder", entityId: { in: ids }, action: { in: ["STATUS_CHANGED", "RESCHEDULED"] } },
      select: { entityId: true, action: true, changes: true, createdAt: true, userId: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  for (const o of ordenes) if (o.startedAt) mejor(o.id, { el: o.startedAt, que: "la orden se inició", actorId: null });
  for (const t of tareas) {
    if (t.completedAt) mejor(t.workOrderId, { el: t.completedAt, que: `se completó la actividad «${t.title}»`, actorId: t.completedById });
    if (t.liberadaAt) mejor(t.workOrderId, { el: t.liberadaAt, que: `se liberó la actividad «${t.title}»`, actorId: t.liberadaPorId });
  }
  for (const h of horas) mejor(h.workOrderId, { el: h.workedAt, que: `se registraron ${h.hours} h de mano de obra`, actorId: h.userId });
  for (const m of material) if (m.workOrderId) mejor(m.workOrderId, { el: m.createdAt, que: "se cargó material a la orden", actorId: m.userId });

  const porOrden = new Map<string, Cambio[]>();
  for (const a of bitacora) {
    const c = leerCambios(a.changes);
    let cambio: Cambio | null = null;
    if (a.action === "STATUS_CHANGED" && typeof c.from === "string" && typeof c.to === "string") {
      cambio = { el: a.createdAt, antes: `estado:${c.from}`, despues: `estado:${c.to}`, que: `cambió de estado (${c.from} → ${c.to})`, actorId: a.userId, valido: true };
    } else if (a.action === "RESCHEDULED") {
      const antes = typeof c.antes === "string" ? c.antes : "";
      const despues = typeof c.despues === "string" ? c.despues : "";
      const nueva = despues ? new Date(despues) : null;
      // Solo cuenta si la nueva fecha era futura al momento de reprogramar y lleva motivo.
      const valido = Boolean(nueva && !Number.isNaN(nueva.getTime()) && nueva.getTime() > a.createdAt.getTime() && typeof c.motivo === "string" && c.motivo.trim());
      cambio = { el: a.createdAt, antes: `fecha:${antes}`, despues: `fecha:${despues}`, que: nueva ? `se reprogramó al ${fechaCorta(nueva)}` : "se reprogramó", actorId: a.userId, valido };
    }
    if (!cambio) continue;
    const lista = porOrden.get(a.entityId) ?? [];
    lista.push(cambio);
    porOrden.set(a.entityId, lista);
  }
  for (const [id, cambios] of porOrden) {
    for (const c of sinDeshechos(cambios)) if (c.valido) mejor(id, { el: c.el, que: c.que, actorId: c.actorId });
  }
  return salida;
}
