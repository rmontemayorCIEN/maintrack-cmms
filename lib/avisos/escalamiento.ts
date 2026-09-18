/**
 * Recordar y escalar lo que nadie atiende.
 *
 * Cada regla (lib/avisos/reglas.ts) busca los registros que cumplen su
 * condición y lleva, por registro, un renglón de `Escalamiento`:
 *
 *   nivel 0 → recordatorio al primer nivel cada `esperaMin`, hasta
 *             `maxRecordatorios` veces;
 *   nivel 1 → sube al siguiente nivel (queda en la bitácora) y le recuerda
 *             con la misma cadencia;
 *   agotado → ya no se insiste más; sigue apareciendo en los resúmenes.
 *
 * Se detiene cuando la condición deja de existir (se atendió, se cerró, se
 * canceló) o cuando se reconoce, en las reglas donde reconocer basta. Si cambia
 * el responsable, vuelve a empezar para la persona nueva: el recordatorio no
 * le llega a quien ya no le toca.
 *
 * Con `soloJornada`, el tiempo fuera de la jornada de la empresa no cuenta.
 * Un recordatorio es la misma notificación que se vuelve a entregar, no una
 * nueva: la persona ve «recordatorio 2» en un solo aviso.
 */
import { prisma } from "../db";
import { logAudit } from "../audit";
import { emitirAviso } from "./emitir";
import { reglasDeEmpresa, ventanaDe, type ConfigEmpresa } from "./config";
import { sumarEspera } from "./horario";
import { tiempoPendiente } from "./prioridad";
import type { ClaveRegla, ReglaEscalamiento } from "./reglas";
import { refaccionesCriticasAgotadas } from "./detectores";
import type { Contexto } from "./destinatarios";

type Candidato = {
  entidad: string;
  entidadId: string;
  /** Desde cuándo existe la condición. */
  desde: Date;
  /** Quién debía actuar: si cambia, empieza de nuevo. */
  responsableId?: string | null;
  titulo: string;
  enlace: string;
  contexto: Contexto;
  /** Si hubo movimiento reciente que reinicia la espera (OT vencida que alguien actualizó). */
  movimientoEl?: Date;
  /** Otra espera para este registro (una compra con equipo parado espera menos). */
  esperaMin?: number;
};

const HORA = 3_600_000;

async function candidatos(organizationId: string, clave: ClaveRegla, ahora: Date): Promise<Candidato[]> {
  switch (clave) {
    case "OT_CRITICA_SIN_ACEPTAR":
    case "OT_ALTA_SIN_ACEPTAR": {
      const ots = await prisma.workOrder.findMany({
        where: {
          organizationId, priority: clave === "OT_CRITICA_SIN_ACEPTAR" ? "CRITICAL" : "HIGH",
          status: { in: ["OPEN", "ASSIGNED"] }, startedAt: null, assignedToId: { not: null },
        },
        select: { id: true, number: true, title: true, assignedToId: true, siteId: true, createdAt: true },
        take: 500,
      });
      // La espera cuenta desde que se le avisó a ESTA persona, no desde que se creó la orden.
      const avisos = await prisma.notification.findMany({
        where: { organizationId, tipo: "OT_ASIGNADA", entidadId: { in: ots.map((o) => o.id) } },
        select: { entidadId: true, userId: true, createdAt: true },
      });
      return ots.map((o) => ({
        entidad: "WorkOrder", entidadId: o.id, responsableId: o.assignedToId,
        desde: avisos.find((a) => a.entidadId === o.id && a.userId === o.assignedToId)?.createdAt ?? o.createdAt,
        titulo: `${o.number} sin aceptar: ${o.title}`, enlace: `/work-orders/${o.id}`,
        contexto: { responsableId: o.assignedToId, siteId: o.siteId },
      }));
    }
    case "OT_VENCIDA_SIN_ACTUALIZAR": {
      const ots = await prisma.workOrder.findMany({
        where: { organizationId, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] }, dueDate: { lt: ahora } },
        select: { id: true, number: true, title: true, assignedToId: true, siteId: true, dueDate: true, updatedAt: true },
        take: 1000,
      });
      return ots.map((o) => ({
        entidad: "WorkOrder", entidadId: o.id, responsableId: o.assignedToId, desde: o.dueDate!, movimientoEl: o.updatedAt,
        titulo: `${o.number} vencida sin movimiento: ${o.title}`, enlace: `/work-orders/${o.id}`,
        contexto: { responsableId: o.assignedToId, siteId: o.siteId },
      }));
    }
    case "SOLICITUD_CRITICA_SIN_CLASIFICAR": {
      const s = await prisma.workRequest.findMany({
        where: { organizationId, status: "PENDING", OR: [{ priority: "CRITICAL" }, { riesgo: "ALTO" }] },
        select: { id: true, number: true, title: true, siteId: true, createdAt: true, requestedById: true },
        take: 500,
      });
      return s.map((x) => ({
        entidad: "WorkRequest", entidadId: x.id, desde: x.createdAt,
        titulo: `Solicitud crítica ${x.number} sin revisar: ${x.title}`, enlace: "/requests",
        contexto: { siteId: x.siteId, excluir: x.requestedById ? [x.requestedById] : [] },
      }));
    }
    case "REQUISICION_SIN_AUTORIZAR": {
      const c = await prisma.purchaseRequest.findMany({
        where: { organizationId, estado: "SOLICITADA" },
        select: { id: true, folio: true, urgencia: true, solicitanteId: true, createdAt: true, warehouseId: true },
        take: 500,
      });
      return c.map((x) => ({
        entidad: "PurchaseRequest", entidadId: x.id, desde: x.createdAt,
        titulo: `Compra ${x.folio} sigue sin autorizar${x.urgencia === "PARO" ? " (equipo parado)" : ""}`, enlace: `/compras/${x.id}`,
        contexto: { solicitanteId: x.solicitanteId, excluir: x.solicitanteId ? [x.solicitanteId] : [], warehouseId: x.warehouseId },
        // Con equipo parado no se espera una jornada: una hora.
        esperaMin: x.urgencia === "PARO" ? 60 : undefined,
      }));
    }
    case "ALERTA_CRITICA_SIN_RECONOCER": {
      const a = await prisma.predictiveAlert.findMany({
        where: { organizationId, severity: "CRITICAL", status: "OPEN" },
        select: { id: true, title: true, createdAt: true, asset: { select: { code: true, siteId: true } } },
        take: 500,
      });
      return a.map((x) => ({
        entidad: "PredictiveAlert", entidadId: x.id, desde: x.createdAt,
        titulo: `Alerta crítica sin reconocer: ${x.asset.code} · ${x.title}`, enlace: "/predictive",
        contexto: { siteId: x.asset.siteId },
      }));
    }
    case "REFACCION_CRITICA_AGOTADA": {
      const partes = await refaccionesCriticasAgotadas(organizationId);
      const almacen = await prisma.warehouse.findFirst({ where: { organizationId, active: true }, orderBy: [{ esGeneral: "desc" }], select: { id: true } });
      const desde = await prisma.stockMovement.groupBy({
        by: ["partId"], where: { organizationId, partId: { in: partes.map((p) => p.id) } }, _max: { createdAt: true },
      });
      return partes.map((p) => ({
        entidad: "Part", entidadId: p.id, desde: desde.find((d) => d.partId === p.id)?._max.createdAt ?? ahora,
        titulo: `Sigue agotada: ${p.code} · ${p.name}`, enlace: `/inventory/${p.id}`,
        contexto: { warehouseId: almacen?.id },
      }));
    }
    case "COMPRA_VENCIDA_SIN_RECEPCION": {
      const ocs = await prisma.purchaseOrder.findMany({
        where: { organizationId, estado: { in: ["ABIERTA", "RECIBIDA_PARCIAL"] }, fechaPrometida: { lt: ahora } },
        select: { id: true, folio: true, fechaPrometida: true, warehouseId: true, purchaseRequestId: true, supplier: { select: { name: true } } },
        take: 500,
      });
      return ocs.map((o) => ({
        entidad: "PurchaseOrder", entidadId: o.id, desde: o.fechaPrometida!,
        titulo: `${o.folio} sigue sin recibirse (${o.supplier.name})`, enlace: `/compras/${o.purchaseRequestId}`,
        contexto: { warehouseId: o.warehouseId },
      }));
    }
  }
}

export type ResultadoEscalamiento = { recordatorios: number; escalados: number; detenidos: number; iniciados: number };

export async function procesarEscalamientos(organizationId: string, cfg: ConfigEmpresa, ahora = new Date()): Promise<ResultadoEscalamiento> {
  const res: ResultadoEscalamiento = { recordatorios: 0, escalados: 0, detenidos: 0, iniciados: 0 };
  const reglas = reglasDeEmpresa(cfg);
  const ventana = ventanaDe(cfg);

  for (const [clave, regla] of Object.entries(reglas) as Array<[ClaveRegla, ReglaEscalamiento]>) {
    const vigentes = regla.activa ? await candidatos(organizationId, clave, ahora) : [];
    const porEntidad = new Map(vigentes.map((c) => [c.entidadId, c]));
    const filas = await prisma.escalamiento.findMany({ where: { organizationId, regla: clave } });
    const porFila = new Map(filas.map((f) => [f.entidadId, f]));

    // Lo que ya no cumple la condición se detiene.
    for (const f of filas) {
      if (f.estado === "DETENIDO") continue;
      if (!porEntidad.has(f.entidadId)) {
        await prisma.escalamiento.update({
          where: { id: f.id },
          data: { estado: "DETENIDO", detenidoEl: ahora, motivoDetencion: regla.activa ? "se atendió o dejó de existir la condición" : "la regla está apagada" },
        });
        res.detenidos++;
      }
    }

    for (const c of vigentes) {
      const espera = c.esperaMin ?? regla.esperaMin;
      const f = porFila.get(c.entidadId);
      const primeraVez = sumarEspera(c.desde, espera, ventana, regla.soloJornada);

      if (!f) {
        await prisma.escalamiento.create({
          data: {
            organizationId, regla: clave, entidad: c.entidad, entidadId: c.entidadId, responsableId: c.responsableId ?? null,
            iniciadoEl: c.desde, proximoEl: primeraVez,
          },
        });
        res.iniciados++;
        continue;
      }
      // Cambió el responsable: empieza de nuevo, para la persona nueva.
      if ((f.responsableId ?? null) !== (c.responsableId ?? null)) {
        await prisma.escalamiento.update({
          where: { id: f.id },
          data: {
            estado: "ACTIVO", nivel: 0, recordatorios: 0, responsableId: c.responsableId ?? null, iniciadoEl: c.desde,
            proximoEl: primeraVez, ultimoAvisoEl: null, detenidoEl: null, motivoDetencion: null, reconocidoPorId: null,
          },
        });
        continue;
      }
      // Detenido por reconocimiento: se respeta. Detenido porque la condición
      // desapareció y regresó (una refacción que se repuso y se volvió a
      // agotar): empieza de nuevo.
      if (f.estado === "DETENIDO") {
        if (f.motivoDetencion === "reconocido") continue;
        await prisma.escalamiento.update({
          where: { id: f.id },
          data: { estado: "ACTIVO", nivel: 0, recordatorios: 0, iniciadoEl: c.desde, proximoEl: primeraVez, ultimoAvisoEl: null, detenidoEl: null, motivoDetencion: null },
        });
        continue;
      }
      if (f.estado === "AGOTADO") continue;

      // Hubo movimiento después del último aviso: la espera empieza de nuevo.
      if (c.movimientoEl && c.movimientoEl.getTime() > (f.ultimoAvisoEl ?? f.iniciadoEl).getTime() + 60_000) {
        const nuevo = sumarEspera(c.movimientoEl, espera, ventana, regla.soloJornada);
        if (nuevo.getTime() > f.proximoEl.getTime()) {
          await prisma.escalamiento.update({ where: { id: f.id }, data: { proximoEl: nuevo } });
          continue;
        }
      }
      if (f.proximoEl.getTime() > ahora.getTime()) continue;

      // Toca: recordar en el nivel actual, o subir.
      let nivel = f.nivel;
      let recordatorios = f.recordatorios;
      let subio = false;
      if (recordatorios >= regla.maxRecordatorios) {
        if (nivel === 0 && regla.siguienteNivel.length) {
          nivel = 1; recordatorios = 0; subio = true;
        } else {
          await prisma.escalamiento.update({ where: { id: f.id }, data: { estado: "AGOTADO" } });
          continue;
        }
      }
      const grupos = nivel === 0 ? [regla.primerNivel] : [regla.siguienteNivel];
      const n = recordatorios + 1;
      await emitirAviso({
        organizationId, tipo: regla.evento, entidad: c.entidad, entidadId: c.entidadId, version: `esc-${clave}-${nivel}`,
        titulo: `${subio || nivel > 0 ? "Escalado: " : "Recordatorio: "}${c.titulo}`,
        cuerpo: nivel > 0 ? "Se le avisó al responsable y sigue sin atenderse." : undefined,
        porQue: `${regla.cuando} Lleva ${tiempoPendiente(c.desde, ahora)} así.`,
        accion: regla.seDetiene.replace(/^Al /, "Atiéndalo: al "),
        enlace: c.enlace, grupos, contexto: c.contexto, recordar: n > 1 || subio,
      });
      await prisma.escalamiento.update({
        where: { id: f.id },
        data: { nivel, recordatorios: n, ultimoAvisoEl: ahora, proximoEl: sumarEspera(ahora, espera, ventana, regla.soloJornada) },
      });
      if (subio) {
        res.escalados++;
        await logAudit({
          organizationId, entity: c.entidad, entityId: c.entidadId, action: "ESCALATION_RAISED",
          summary: `Escalado al siguiente nivel: ${regla.titulo} — ${c.titulo}`,
          changes: { regla: clave, nivel },
        });
      } else {
        res.recordatorios++;
      }
    }
  }
  return res;
}
