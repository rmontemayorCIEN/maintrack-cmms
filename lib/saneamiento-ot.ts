/**
 * Los huecos del proceso de ordenes, definidos UNA vez.
 *
 * Los usan la calidad de captura (`lib/calidad-datos.ts`, que los convierte en
 * reglas con peso) y la lista de saneamiento (`scripts/lista-saneamiento-ot.ts`,
 * que los enumera completos para revisarlos a mano). Si cada uno tuviera su
 * filtro, el indice y la lista dirian cifras distintas para la misma pregunta.
 *
 * Nada de aqui corrige datos. Un hueco historico se revisa con la persona que
 * sabe que paso: inventar horas, causas, responsables o paros para «limpiar»
 * el indice seria esconder el problema detras de un numero bonito.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { filtroDeFalla } from "./fallas";
import { motivoSinOtActiva, TITULO_SOLICITUDES_SIN_OT } from "./reglas-ot";

export const ESTADOS_ACTIVOS_OT = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"];
/** Dias que puede esperar una orden completada su cierre administrativo antes de contarse como pendiente. */
export const DIAS_PARA_CERRAR = 7;

const DIA = 86_400_000;

export async function filtrosDelProceso(organizationId: string, ahora = new Date()) {
  const terminadas = { organizationId, status: { in: ["COMPLETED", "CLOSED"] } };
  const { status: _sinCanceladas, ...esFalla } = await filtroDeFalla(organizationId);

  const f = {
    terminadas: terminadas satisfies Prisma.WorkOrderWhereInput,

    /** Terminadas sin una sola hora de mano de obra y sin excepcion justificada. */
    sinHoras: {
      ...terminadas, actualHours: { lte: 0 }, labor: { none: {} }, motivoSinHoras: null,
    } satisfies Prisma.WorkOrderWhereInput,

    fallasTerminadas: { ...terminadas, ...esFalla } satisfies Prisma.WorkOrderWhereInput,

    /** Fallas terminadas sin codigo o sin causa raiz, ni en la orden ni en sus actividades, y sin justificar. */
    fallasSinDiagnostico: {
      ...terminadas,
      motivoSinDiagnostico: null,
      AND: [
        { OR: esFalla.OR },
        {
          OR: [
            { rootCauseId: null, tasks: { none: { rootCauseId: { not: null } } } },
            { failureCodeId: null, tasks: { none: { failureCodeId: { not: null } } } },
          ],
        },
      ],
    } satisfies Prisma.WorkOrderWhereInput,

    conParo: { ...terminadas, requiresShutdown: true } satisfies Prisma.WorkOrderWhereInput,

    /** Requirio paro, no registra minutos y nadie confirmo que no hubo paro. */
    paroSinDuracion: {
      ...terminadas, requiresShutdown: true, sinParoConfirmado: false, downtimeMinutes: { lte: 0 },
      downtimes: { none: { minutes: { gt: 0 } } }, tasks: { none: { downtimeMinutes: { gt: 0 } } },
    } satisfies Prisma.WorkOrderWhereInput,

    completadas: { organizationId, status: "COMPLETED" } satisfies Prisma.WorkOrderWhereInput,

    /** Completadas hace mas de DIAS_PARA_CERRAR dias que nadie ha validado y cerrado. */
    completadasSinCerrar: {
      organizationId, status: "COMPLETED", completedAt: { lt: new Date(ahora.getTime() - DIAS_PARA_CERRAR * DIA) },
    } satisfies Prisma.WorkOrderWhereInput,

    activas: { organizationId, status: { in: ESTADOS_ACTIVOS_OT } } satisfies Prisma.WorkOrderWhereInput,
    activasSinResponsable: {
      organizationId, status: { in: ESTADOS_ACTIVOS_OT }, assignedToId: null,
    } satisfies Prisma.WorkOrderWhereInput,

    convertidas: { organizationId, status: "CONVERTED" } satisfies Prisma.WorkRequestWhereInput,
    /** Convertidas sin OT activa: sin orden ligada, o con su orden cancelada. */
    solicitudesHuerfanas: {
      organizationId, status: "CONVERTED",
      OR: [{ workOrderId: null }, { workOrder: { status: "CANCELLED" } }],
    } satisfies Prisma.WorkRequestWhereInput,

    actividadesDeTerminadas: {
      workOrder: terminadas,
    } satisfies Prisma.WorkOrderTaskWhereInput,
    /** Actividades de una orden terminada que ni se hicieron ni se enviaron al backlog. */
    actividadesSinResolver: {
      done: false, liberadaAt: null, workOrder: terminadas,
    } satisfies Prisma.WorkOrderTaskWhereInput,
  };
  return f;
}

export type RenglonSaneamiento = { folio: string; titulo: string; detalle: string; enlace: string };
export type ListaSaneamiento = Record<
  | "terminadasSinHoras" | "fallasSinDiagnostico" | "parosSinDuracion" | "completadasSinCerrar"
  | "activasSinResponsable" | "solicitudesHuerfanas" | "actividadesSinResolver",
  RenglonSaneamiento[]
>;

export const TITULOS_SANEAMIENTO: Record<keyof ListaSaneamiento, string> = {
  terminadasSinHoras: "Terminadas (completadas o cerradas) sin horas ni excepción justificada",
  fallasSinDiagnostico: "Correctivas / fallas sin código o sin causa raíz",
  parosSinDuracion: "Requirieron paro sin duración registrada",
  completadasSinCerrar: `Completadas pendientes de cierre administrativo (más de ${DIAS_PARA_CERRAR} días)`,
  activasSinResponsable: "Órdenes activas sin responsable",
  solicitudesHuerfanas: TITULO_SOLICITUDES_SIN_OT,
  actividadesSinResolver: "Actividades de órdenes terminadas sin resolver ni enviar al backlog",
};

/** La lista completa, sin muestra: para revisar registro por registro. Solo lectura. */
export async function listaDeSaneamientoOt(organizationId: string, ahora = new Date()): Promise<ListaSaneamiento> {
  const f = await filtrosDelProceso(organizationId, ahora);
  const selOt = { id: true, number: true, title: true, status: true, completedAt: true, closedAt: true } as const;
  const fecha = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "sin fecha");
  const ot = (o: { id: string; number: string; title: string }, detalle: string): RenglonSaneamiento => ({
    folio: o.number, titulo: o.title, detalle, enlace: `/work-orders/${o.id}`,
  });

  const [sinHoras, sinDiag, sinParo, sinCerrar, sinResp, huerfanas, actividades] = await Promise.all([
    prisma.workOrder.findMany({ where: f.sinHoras, select: selOt, orderBy: { number: "asc" } }),
    prisma.workOrder.findMany({
      where: f.fallasSinDiagnostico,
      select: { ...selOt, failureCodeId: true, rootCauseId: true, tasks: { select: { failureCodeId: true, rootCauseId: true } } },
      orderBy: { number: "asc" },
    }),
    prisma.workOrder.findMany({ where: f.paroSinDuracion, select: selOt, orderBy: { number: "asc" } }),
    prisma.workOrder.findMany({ where: f.completadasSinCerrar, select: selOt, orderBy: { completedAt: "asc" } }),
    prisma.workOrder.findMany({ where: f.activasSinResponsable, select: { ...selOt, startedAt: true }, orderBy: { number: "asc" } }),
    prisma.workRequest.findMany({
      where: f.solicitudesHuerfanas,
      select: { id: true, number: true, title: true, reviewedAt: true, workOrder: { select: { number: true, status: true } } },
      orderBy: { number: "asc" },
    }),
    prisma.workOrderTask.findMany({
      where: { ...f.actividadesSinResolver, workOrder: { ...f.terminadas } },
      select: { id: true, title: true, required: true, workOrder: { select: { id: true, number: true, status: true } } },
    }),
  ]);

  return {
    terminadasSinHoras: sinHoras.map((o) => ot(o, `${o.status === "CLOSED" ? "cerrada" : "completada"} el ${fecha(o.closedAt ?? o.completedAt)}`)),
    fallasSinDiagnostico: sinDiag.map((o) => {
      const codigo = !!o.failureCodeId || o.tasks.some((t) => t.failureCodeId);
      const causa = !!o.rootCauseId || o.tasks.some((t) => t.rootCauseId);
      return ot(o, [codigo ? null : "sin código de falla", causa ? null : "sin causa raíz"].filter(Boolean).join(" y "));
    }),
    parosSinDuracion: sinParo.map((o) => ot(o, "requirió paro; 0 minutos y sin confirmar que no hubo paro")),
    completadasSinCerrar: sinCerrar.map((o) => ot(o, `completada el ${fecha(o.completedAt)}, hace ${Math.floor((ahora.getTime() - (o.completedAt?.getTime() ?? ahora.getTime())) / DIA)} días`)),
    activasSinResponsable: sinResp.map((o) => ot(o, `${o.status}${o.startedAt ? `, iniciada el ${fecha(o.startedAt)}` : ""}`)),
    solicitudesHuerfanas: huerfanas.map((r) => ({
      folio: r.number, titulo: r.title,
      detalle: `${motivoSinOtActiva("CONVERTED", r.workOrder)?.largo ?? ""} Convertida el ${fecha(r.reviewedAt)}.`,
      enlace: `/requests/${r.id}`,
    })),
    actividadesSinResolver: actividades.map((t) => ({
      folio: t.workOrder.number, titulo: t.title,
      detalle: `${t.required ? "obligatoria" : "opcional"}, en una orden ${t.workOrder.status === "CLOSED" ? "cerrada" : "completada"}`,
      enlace: `/work-orders/${t.workOrder.id}`,
    })),
  };
}
