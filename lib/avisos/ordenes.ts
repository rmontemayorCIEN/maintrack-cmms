/**
 * Los avisos de una orden de trabajo, en un solo lugar.
 *
 * Seis flujos crean órdenes (alta manual, armador, solicitud convertida,
 * programador, predictivo, agenda) y dos las cambian (edición y transición de
 * estado). Cada uno llama aquí con una línea; qué se avisa y a quién se decide
 * aquí. Qué queda atendido NO se decide aquí: después de cada cambio se
 * reconcilian los avisos de la orden contra su estado real
 * (lib/avisos/condiciones.ts). Así editar una OT vencida sin reprogramarla a
 * una fecha futura no la da por atendida. El proceso programado es, además,
 * red de seguridad: si algún flujo no llamó, el aviso sale en el siguiente
 * barrido.
 */
import { prisma } from "../db";
import { emitirAviso } from "./emitir";
import { avisarAsignacion, avisarOtCritica, avisarVencimiento } from "./detectores";
import { reconciliar } from "./condiciones";
import { configDe } from "./config";

const PESO: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const ETIQUETA: Record<string, string> = { LOW: "baja", MEDIUM: "media", HIGH: "alta", CRITICAL: "crítica" };

async function leer(organizationId: string, id: string) {
  return prisma.workOrder.findFirst({
    where: { id, organizationId },
    select: {
      id: true, number: true, title: true, priority: true, status: true, assignedToId: true, createdById: true, siteId: true,
      maintenanceType: true, dueDate: true, planId: true, plan: { select: { toleranceDays: true } },
      asset: { select: { code: true, criticality: true } },
      requests: { select: { requestedById: true }, take: 1 },
    },
  });
}

/** Orden recién creada: aviso al responsable y, si es crítica, a supervisión. */
export async function avisarNuevaOrden(organizationId: string, workOrderId: string) {
  try {
    const o = await leer(organizationId, workOrderId);
    if (!o) return;
    if (o.assignedToId) await avisarAsignacion(organizationId, o);
    if (o.priority === "CRITICAL") await avisarOtCritica(organizationId, o);
  } catch { /* el aviso nunca tumba la operación */ }
}

/**
 * Después de cualquier cambio: se reconcilian los avisos de la orden (se
 * atiende solo lo que se resolvió de verdad) y se revisa su vencimiento (el
 * responsable nuevo recibe el suyo; una fecha nueva ya pasada actualiza el
 * mismo aviso).
 */
async function alDia(organizationId: string, o: NonNullable<Awaited<ReturnType<typeof leer>>>, evento: string, actorId?: string | null) {
  await reconciliar({ organizationId, entidadId: o.id, origen: "FLUJO", actorId, evento });
  await avisarVencimiento(organizationId, o, await configDe(organizationId));
}

/** Cambios de la edición: responsable, prioridad y fecha. */
export async function avisarCambiosDeOrden(
  organizationId: string,
  antes: { id: string; assignedToId: string | null; priority: string },
  actorId?: string | null,
) {
  try {
    const o = await leer(organizationId, antes.id);
    if (!o) return;
    if ((o.assignedToId ?? null) !== (antes.assignedToId ?? null)) {
      if (o.assignedToId) await avisarAsignacion(organizationId, o);
      if (antes.assignedToId) {
        await emitirAviso({
          organizationId, tipo: "OT_REASIGNADA", entidad: "WorkOrder", entidadId: o.id, version: `${antes.assignedToId}->${o.assignedToId ?? "nadie"}`,
          titulo: `${o.number} ya no está a su cargo`, cuerpo: o.title, enlace: `/work-orders/${o.id}`,
          contexto: { responsableAnteriorId: antes.assignedToId }, tag: o.number, datos: { folio: o.number },
        });
      }
    }
    const salto = (PESO[o.priority] ?? 1) - (PESO[antes.priority] ?? 1);
    // Importante: cruza a alta/crítica, sale de crítica, o salta dos niveles.
    const importante = salto !== 0 && (Math.abs(salto) >= 2 || o.priority === "CRITICAL" || antes.priority === "CRITICAL" || o.priority === "HIGH");
    if (importante) {
      await emitirAviso({
        organizationId, tipo: "OT_PRIORIDAD_CAMBIADA", entidad: "WorkOrder", entidadId: o.id, version: `${antes.priority}->${o.priority}`,
        prioridad: o.priority === "CRITICAL" ? "ALTA" : "MEDIA",
        titulo: `${o.number}: prioridad ${ETIQUETA[antes.priority]} → ${ETIQUETA[o.priority]}`, cuerpo: o.title, enlace: `/work-orders/${o.id}`,
        porQue: salto > 0 ? "Subió de prioridad: puede cambiar el orden de su día." : "Bajó de prioridad.",
        contexto: { responsableId: o.assignedToId, siteId: o.siteId }, tag: o.number,
        datos: { folio: o.number, antes: antes.priority, ahora: o.priority },
      });
      if (o.priority === "CRITICAL") await avisarOtCritica(organizationId, o);
    }
    await alDia(organizationId, o, "Edición de la OT", actorId);
  } catch { /* el aviso nunca tumba la operación */ }
}

/** Cambios de estado: iniciar, detener, terminar, devolver, cerrar, cancelar. */
export async function avisarTransicion(
  organizationId: string, workOrderId: string, de: string, a: string, motivo?: string | null, actorId?: string | null,
) {
  try {
    const o = await leer(organizationId, workOrderId);
    if (!o) return;
    const ctx = { responsableId: o.assignedToId, siteId: o.siteId };
    if (a === "ON_HOLD") {
      await emitirAviso({
        organizationId, tipo: "OT_DETENIDA", entidad: "WorkOrder", entidadId: o.id, version: new Date().toISOString().slice(0, 16),
        titulo: `${o.number} en espera${o.asset ? ` · ${o.asset.code}` : ""}`, cuerpo: motivo ? `Motivo: ${motivo}` : o.title,
        porQue: "El trabajo se detuvo: si espera material o una decisión, alguien tiene que destrabarlo.",
        accion: "Resuelva lo que la detiene o reprográmela.", enlace: `/work-orders/${o.id}`, contexto: ctx, tag: o.number,
        prioridad: o.priority === "CRITICAL" ? "ALTA" : undefined, datos: { folio: o.number },
      });
    }
    if (a === "COMPLETED") {
      await emitirAviso({
        organizationId, tipo: "OT_LISTA_REVISION", entidad: "WorkOrder", entidadId: o.id, version: new Date().toISOString().slice(0, 16),
        titulo: `${o.number} terminada: lista para revisión`, cuerpo: o.title,
        porQue: "El técnico la dio por terminada; falta revisar y cerrar para que cuente en indicadores y costos.",
        accion: "Revísela y ciérrela, o devuélvala con el motivo.", enlace: `/work-orders/${o.id}`,
        contexto: { siteId: o.siteId, excluir: o.assignedToId ? [o.assignedToId] : [] }, tag: o.number, datos: { folio: o.number },
      });
    }
    if (de === "COMPLETED" && a === "IN_PROGRESS") {
      await emitirAviso({
        organizationId, tipo: "OT_DEVUELTA", entidad: "WorkOrder", entidadId: o.id, version: new Date().toISOString().slice(0, 16),
        titulo: `${o.number} devuelta en revisión`, cuerpo: motivo ? `Motivo: ${motivo}` : o.title,
        porQue: "Falta información, evidencia o trabajo para poder cerrarla.",
        accion: "Complete lo que se pide y vuelva a terminarla.", enlace: `/work-orders/${o.id}`, contexto: ctx, tag: o.number,
        datos: { folio: o.number },
      });
    }
    if (a === "CLOSED") {
      const solicitante = o.requests[0]?.requestedById ?? o.createdById;
      await emitirAviso({
        organizationId, tipo: "OT_CERRADA", entidad: "WorkOrder", entidadId: o.id,
        titulo: `${o.number} cerrada`, cuerpo: o.title, enlace: `/work-orders/${o.id}`,
        contexto: { solicitanteId: solicitante }, tag: o.number, datos: { folio: o.number },
      });
    }
    await alDia(organizationId, o, `Cambio de estado ${de} → ${a}`, actorId);
  } catch { /* el aviso nunca tumba la operación */ }
}
