/**
 * Emitir un evento del catálogo: resolver a quién le toca, avisar a cada uno
 * por `notify()`, mandar el evento a los webhooks de la empresa y, si nadie
 * califica, dejarlo registrado como pendiente de configuración.
 *
 * Lo llaman los flujos del sistema (asignar una orden, pedir una compra) y
 * los detectores del proceso programado (vencimientos, bajo mínimo). Nunca
 * lanza: un aviso que falla no puede tumbar la operación que lo originó.
 *
 * Deduplicación: la clave es tipo + registro + versión. Mientras el problema
 * sea el mismo (misma versión), la persona tiene UNA notificación que se
 * actualiza; cuando cambia lo relevante (otro responsable, otro nivel), la
 * versión cambia y es un aviso nuevo.
 */
import { prisma } from "../db";
import { logAudit, notify } from "../audit";
import { EVENTOS, PESO_PRIORIDAD, type Grupo, type Prioridad, type TipoEvento } from "./catalogo";
import { resolverDestinatarios, type Contexto } from "./destinatarios";
import { idDeEvento } from "./entrega";
import { leerJson } from "./config";
import { consumirLimite } from "../integraciones/limites";

export type Evento = {
  organizationId: string;
  tipo: TipoEvento;
  entidad?: string;
  entidadId?: string;
  /** Lo que, si cambia, hace que sea un aviso nuevo: el responsable, el nivel, la fecha. */
  version?: string;
  titulo: string;
  cuerpo?: string;
  enlace?: string;
  porQue?: string;
  accion?: string;
  /** Si no se da, la del catálogo. */
  prioridad?: Prioridad;
  contexto?: Contexto;
  /** Otra cadena de destinatarios (el escalamiento sube de nivel así). */
  grupos?: Grupo[][];
  /** Es un recordatorio: vuelve a entregar aunque ya exista. */
  recordar?: boolean;
  tag?: string;
  /** Tono en la campana (SUCCESS, WARNING…), si no basta con la prioridad. */
  kind?: string;
  /** Datos no sensibles para el webhook: folio, estado, prioridad. */
  datos?: Record<string, string | number | boolean | null>;
};

export type ResultadoEmision = {
  eventoId: string;
  avisados: string[];
  omitidos: number;
  sinDestinatario: string | null;
  webhooks: number;
};

/** Eventos por webhook por empresa por minuto. */
export const LIMITE_WEBHOOK_MINUTO = 120;

export async function emitirAviso(e: Evento): Promise<ResultadoEmision> {
  const eventoId = idDeEvento(e.organizationId, e.tipo, e.entidadId, e.version);
  const vacio: ResultadoEmision = { eventoId, avisados: [], omitidos: 0, sinDestinatario: null, webhooks: 0 };
  try {
    const def = EVENTOS[e.tipo];
    const prioridad = e.prioridad ?? def.prioridad;
    const claveDedup = `${e.tipo}:${e.entidadId ?? "-"}:${e.version ?? "-"}`;
    const r = await resolverDestinatarios(e.organizationId, e.grupos ?? def.destinatarios.map((g) => [...g]), e.contexto);

    const salida: ResultadoEmision = { ...vacio };
    for (const d of r.destinatarios) {
      // Obligatorio: por catálogo; por ser el único que puede actuar; o por
      // ser el responsable directo de algo alto o crítico.
      const obligatorio = def.categoria === "OBLIGATORIO" ||
        (d.unico && def.requiereAccion) ||
        (d.grupo === "RESPONSABLE" && PESO_PRIORIDAD[prioridad] >= PESO_PRIORIDAD.ALTA);
      const res = await notify({
        organizationId: e.organizationId, userId: d.userId, title: e.titulo, body: e.cuerpo, link: e.enlace,
        tipo: e.tipo, prioridad, modulo: def.modulo, entidad: e.entidad, entidadId: e.entidadId,
        requiereAccion: def.requiereAccion, porQue: e.porQue, accion: e.accion, claveDedup, eventoId,
        obligatorio, recordar: e.recordar, tag: e.tag, kind: e.kind,
      });
      if (res.estado === "OMITIDA") salida.omitidos++;
      else if (res.notificationId) salida.avisados.push(d.userId);
    }

    if (!r.destinatarios.length && def.destinatarios.length) {
      salida.sinDestinatario = r.faltante ?? "nadie califica para recibirlo";
      await registrarSinDestinatario(e, eventoId, salida.sinDestinatario);
    }

    if (def.webhook) salida.webhooks = await encolarWebhooks(e, eventoId, prioridad);
    return salida;
  } catch {
    return vacio;
  }
}

/**
 * Nadie a quién decirle. No se descarta: queda en el historial técnico como
 * «sin destinatario válido» y se vuelve un pendiente administrativo que dice
 * qué configuración falta. Uno por tipo de evento y faltante, no uno por
 * registro: diez órdenes sin supervisor son un solo problema de configuración.
 */
async function registrarSinDestinatario(e: Evento, eventoId: string, faltante: string) {
  await prisma.entregaAviso.upsert({
    where: { claveDedup: `${eventoId}:sin-destinatario` },
    update: {},
    create: {
      organizationId: e.organizationId, tipo: e.tipo, eventoId, canal: "CAMPANA", estado: "SIN_DESTINATARIO",
      errorCategoria: "SIN_RESPONSABLE", errorDetalle: faltante.slice(0, 180), claveDedup: `${eventoId}:sin-destinatario`,
      resumen: e.titulo.slice(0, 100),
    },
  }).catch(() => undefined);
  if (e.tipo === "CONFIGURACION_INCOMPLETA") return;
  await emitirAviso({
    organizationId: e.organizationId, tipo: "CONFIGURACION_INCOMPLETA", entidad: "TipoAviso", entidadId: e.tipo,
    version: faltante,
    titulo: `Un aviso no tuvo a quién llegar: ${EVENTOS[e.tipo].titulo}`,
    cuerpo: `Último caso: ${e.titulo}. Falta: ${faltante}.`,
    porQue: "Mientras falte, estos avisos no le llegan a nadie y el problema pasa sin que nadie se entere.",
    accion: "Asigne el rol o el responsable que falta en Configuración → Usuarios, o elija destinatarios en Configuración → Avisos.",
    enlace: "/settings?s=avisos",
  });
}

/** El evento a cada webhook activo de la empresa que lo pidió. */
async function encolarWebhooks(e: Evento, eventoId: string, prioridad: Prioridad): Promise<number> {
  const webhooks = await prisma.webhook.findMany({
    where: { organizationId: e.organizationId, estado: "ACTIVO" },
    select: { id: true, eventos: true },
  });
  let n = 0;
  for (const w of webhooks) {
    if (!leerJson<string[]>(w.eventos, []).includes(e.tipo)) continue;
    const cupo = await consumirLimite(`webhook:${w.id}`, LIMITE_WEBHOOK_MINUTO, 60);
    const carga = JSON.stringify({
      id: eventoId,
      tipo: e.tipo,
      ocurrio: new Date().toISOString(),
      prioridad,
      registro: e.entidad && e.entidadId ? { tipo: e.entidad, id: e.entidadId } : null,
      titulo: e.titulo,
      datos: e.datos ?? {},
    });
    const creada = await prisma.entregaAviso.create({
      data: {
        organizationId: e.organizationId, webhookId: w.id, tipo: e.tipo, eventoId, canal: "WEBHOOK",
        estado: "PENDIENTE", programadaPara: cupo.permitido ? new Date() : cupo.reintentarEl,
        errorCategoria: cupo.permitido ? null : "LIMITE", carga, claveDedup: `${eventoId}:${w.id}`, resumen: e.titulo.slice(0, 100),
      },
    }).catch(() => null);
    if (creada) n++;
  }
  return n;
}

/**
 * Marca como atendidos los avisos de un registro: se resolvió lo que los
 * originó. Cancela sus entregas pendientes y detiene sus escalamientos.
 * Leerlos no los atiende; esto sí.
 */
export async function atenderAvisos(p: {
  organizationId: string; entidadId: string; tipos?: TipoEvento[]; motivo: string; reglas?: string[];
}) {
  try {
    const ahora = new Date();
    const where = {
      organizationId: p.organizationId, entidadId: p.entidadId, atendidaEl: null, requiereAccion: true,
      ...(p.tipos ? { tipo: { in: p.tipos as string[] } } : {}),
    };
    const ids = (await prisma.notification.findMany({ where, select: { id: true } })).map((n) => n.id);
    if (ids.length) {
      await prisma.notification.updateMany({ where: { id: { in: ids } }, data: { atendidaEl: ahora, atendidaMotivo: p.motivo.slice(0, 180) } });
      await prisma.entregaAviso.updateMany({
        where: { notificationId: { in: ids }, estado: { in: ["PENDIENTE", "EN_REINTENTO"] } },
        data: { estado: "CANCELADA", errorCategoria: "RESUELTO", errorDetalle: p.motivo.slice(0, 180) },
      });
    }
    await prisma.escalamiento.updateMany({
      where: { organizationId: p.organizationId, entidadId: p.entidadId, estado: "ACTIVO", ...(p.reglas ? { regla: { in: p.reglas } } : {}) },
      data: { estado: "DETENIDO", detenidoEl: ahora, motivoDetencion: p.motivo.slice(0, 180) },
    });
    return ids.length;
  } catch {
    return 0;
  }
}

/**
 * «Enterado»: la persona reconoce un aviso. Lo marca leído y, si su
 * escalamiento se detiene con el reconocimiento (una alerta, una OT crítica),
 * lo detiene. No lo atiende: el problema sigue ahí hasta resolverse.
 */
export async function reconocerAviso(p: { organizationId: string; userId: string; notificationId: string }) {
  const n = await prisma.notification.findFirst({
    where: { id: p.notificationId, organizationId: p.organizationId, userId: p.userId },
    select: { id: true, entidadId: true, tipo: true },
  });
  if (!n) return null;
  await prisma.notification.update({ where: { id: n.id }, data: { read: true, leidaEl: new Date() } });
  if (n.entidadId) {
    const { REGLAS_RECOMENDADAS } = await import("./reglas");
    const reglas = Object.entries(REGLAS_RECOMENDADAS).filter(([, r]) => r.reconocerDetiene && r.evento === n.tipo).map(([k]) => k);
    if (reglas.length) {
      const detenidos = await prisma.escalamiento.updateMany({
        where: { organizationId: p.organizationId, entidadId: n.entidadId, regla: { in: reglas }, estado: "ACTIVO" },
        data: { estado: "DETENIDO", detenidoEl: new Date(), motivoDetencion: "reconocido", reconocidoPorId: p.userId },
      });
      if (detenidos.count) {
        await logAudit({
          organizationId: p.organizationId, userId: p.userId, entity: "Notification", entityId: n.id,
          action: "ESCALATION_ACKNOWLEDGED", summary: `Aviso reconocido: se detuvo su escalamiento (${n.tipo})`,
        });
      }
    }
  }
  return n.id;
}
