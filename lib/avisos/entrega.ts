/**
 * Registrar un aviso y llevarlo por sus canales, con historial y reintentos.
 *
 * `notify()` (lib/audit.ts) es la puerta; aquí está lo que hace detrás. Cada
 * intento por cada canal es un renglón de `EntregaAviso`: el historial técnico
 * que dice si el aviso llegó, cuántas veces se intentó y por qué falló. No va
 * a la bitácora de auditoría —la llenaría de ruido— y no guarda el contenido
 * completo ni secretos.
 *
 * Reintentos: espera progresiva (1, 5, 30 minutos, 2 y 6 horas) y máximo cinco
 * intentos. Una falla permanente (buzón inexistente, receptor que rechaza, sin
 * dispositivos) no se reintenta. Lo que se agota queda «fallida» y un
 * administrador puede reintentarlo a mano.
 *
 * Quién procesa la cola: el proceso programado (`/api/cron/avisos`, cada
 * pocos minutos). Los avisos al navegador se intentan además en el momento,
 * como antes, para que lleguen sin esperar al proceso.
 */
import { createHash } from "node:crypto";
import { prisma } from "../db";
import { logAudit } from "../audit";
import {
  EVENTOS, esTipoEvento, kindDePrioridad, prioridadDeKind, PESO_PRIORIDAD, PRIORIDADES,
  type Canal, type Prioridad,
} from "./catalogo";
import { configDe, leerJson, ventanaDe } from "./config";
import { dentroDeVentana, siguienteMomentoHabil } from "./horario";
import { proveedorDeCorreo, transportes, type Resultado } from "./canales";
import { consumirLimite } from "../integraciones/limites";
import { descifrar } from "../integraciones/cifrado";

export const MAXIMO_INTENTOS = 5;
const ESPERAS_MIN = [1, 5, 30, 120, 360];
/** Correos por empresa por hora. Lo que pase espera a la siguiente hora; no se pierde. */
export const LIMITE_CORREOS_HORA = 300;
/** Fallas seguidas con que un webhook se suspende solo. */
export const FALLAS_PARA_SUSPENDER = 10;

type Params = Parameters<typeof import("../audit").notify>[0];

export const idDeEvento = (...partes: Array<string | null | undefined>) =>
  `evt_${createHash("sha256").update(partes.map((p) => p ?? "-").join("|")).digest("hex").slice(0, 24)}`;

const recortar = (t: string | null | undefined, n: number) => (t ? (t.length > n ? `${t.slice(0, n - 1)}…` : t) : null);

/** Un renglón de historial sin notificación: sin destinatario, omitido. Idempotente por clave. */
async function asentar(d: {
  organizationId: string; userId?: string | null; tipo: string; eventoId: string; canal: Canal;
  estado: string; clave: string; categoria?: string; detalle?: string; resumen?: string | null;
}) {
  await prisma.entregaAviso.upsert({
    where: { claveDedup: d.clave },
    update: {},
    create: {
      organizationId: d.organizationId, userId: d.userId ?? null, tipo: d.tipo, eventoId: d.eventoId,
      canal: d.canal, estado: d.estado, errorCategoria: d.categoria ?? null, errorDetalle: d.detalle ?? null,
      claveDedup: d.clave, resumen: recortar(d.resumen, 100),
    },
  }).catch(() => undefined);
}

/**
 * Lo que hace `notify()`: validar a la persona, respetar sus preferencias,
 * deduplicar, guardar la notificación y encolar sus entregas.
 */
export async function registrarAviso(p: Params): Promise<import("../audit").ResultadoAviso> {
  const tipo = p.tipo && esTipoEvento(p.tipo) ? p.tipo : "GENERAL";
  const def = tipo !== "GENERAL" ? EVENTOS[tipo as keyof typeof EVENTOS] : null;
  const prioridad: Prioridad = p.prioridad && (PRIORIDADES as string[]).includes(p.prioridad)
    ? (p.prioridad as Prioridad)
    : def ? def.prioridad : prioridadDeKind(p.kind);
  // El tono explícito manda (una compra rechazada es «advertencia» aunque su
  // prioridad sea media); si no viene, sale de la prioridad.
  const kind = p.kind ?? (p.prioridad || def ? kindDePrioridad(prioridad) : "INFO");
  const eventoId = p.eventoId ?? (p.claveDedup ? idDeEvento(p.organizationId, p.claveDedup) : null);

  // 1. La persona: de esta organización y activa.
  const persona = await prisma.user.findFirst({
    where: { id: p.userId, organizationId: p.organizationId },
    select: { id: true, active: true, email: true, preferenciaAvisos: true },
  });
  if (!persona) return { notificationId: null, estado: "DESCARTADA" };
  if (!persona.active) {
    await asentar({
      organizationId: p.organizationId, userId: persona.id, tipo, eventoId: eventoId ?? idDeEvento(p.organizationId, tipo, p.entidadId, p.title),
      canal: "CAMPANA", estado: "SIN_DESTINATARIO", categoria: "USUARIO_INACTIVO", detalle: "la persona está desactivada",
      clave: `${eventoId ?? idDeEvento(p.organizationId, tipo, p.entidadId, p.title)}:${persona.id}:inactivo`, resumen: p.title,
    });
    return { notificationId: null, estado: "SIN_DESTINATARIO" };
  }

  // 2. Preferencias. Lo obligatorio no se puede apagar.
  const pref = persona.preferenciaAvisos;
  const apagados = leerJson<string[]>(pref?.tiposApagados, []);
  const obligatorio = p.obligatorio || def?.categoria === "OBLIGATORIO";
  if (!obligatorio && apagados.includes(tipo)) {
    const id = eventoId ?? idDeEvento(p.organizationId, tipo, p.entidadId, p.title);
    await asentar({
      organizationId: p.organizationId, userId: persona.id, tipo, eventoId: id, canal: "CAMPANA",
      estado: "OMITIDA_PREFERENCIA", clave: `${id}:${persona.id}:preferencia`, resumen: p.title,
    });
    return { notificationId: null, estado: "OMITIDA" };
  }

  // 3. Deduplicación.
  const datos = {
    title: p.title, body: p.body ?? null, link: p.link ?? null, kind, tipo, prioridad,
    modulo: p.modulo ?? def?.modulo ?? null, entidad: p.entidad ?? null, entidadId: p.entidadId ?? null,
    requiereAccion: p.requiereAccion ?? def?.requiereAccion ?? false, porQue: p.porQue ?? null, accion: p.accion ?? null,
  };
  let notificacion: { id: string; veces: number } | null = null;
  let estado: import("../audit").ResultadoAviso["estado"] = "CREADA";
  const ahora = new Date();

  if (p.claveDedup) {
    const previa = await prisma.notification.findUnique({
      where: { userId_claveDedup: { userId: persona.id, claveDedup: p.claveDedup } },
      select: { id: true, veces: true, atendidaEl: true, prioridad: true, title: true, body: true },
    });
    if (previa) {
      const regreso = previa.atendidaEl !== null;
      const subio = PESO_PRIORIDAD[prioridad] > PESO_PRIORIDAD[previa.prioridad as Prioridad];
      if (!regreso && !p.recordar && !subio) {
        // Mismo problema, sin cambio relevante: se actualiza el texto y ya.
        if (previa.title !== p.title || (previa.body ?? null) !== (p.body ?? null)) {
          await prisma.notification.update({ where: { id: previa.id }, data: { title: p.title, body: p.body ?? null, actualizadaEl: ahora } });
        }
        return { notificationId: previa.id, estado: "SIN_CAMBIO" };
      }
      const act = await prisma.notification.update({
        where: { id: previa.id },
        data: { ...datos, read: false, leidaEl: null, atendidaEl: null, atendidaMotivo: null, veces: { increment: 1 }, actualizadaEl: ahora },
        select: { id: true, veces: true },
      });
      // La condición había quedado resuelta y volvió: es un ciclo nuevo del mismo aviso, y queda dicho.
      if (regreso) {
        await prisma.historialAviso.create({
          data: {
            organizationId: p.organizationId, notificationId: previa.id, userId: persona.id, tipo, entidadId: p.entidadId ?? null,
            cambio: "REABIERTA", condicionActual: recortar(p.title, 180), evento: "La condición volvió a presentarse",
            origen: "RECONCILIACION", motivo: recortar(p.porQue ?? p.title, 180),
          },
        }).catch(() => undefined);
      }
      notificacion = act;
      estado = "ACTUALIZADA";
    }
  }
  if (!notificacion) {
    try {
      notificacion = await prisma.notification.create({
        data: { ...datos, organizationId: p.organizationId, userId: persona.id, claveDedup: p.claveDedup ?? null, eventoId },
        select: { id: true, veces: true },
      });
    } catch {
      // Otro proceso la creó en el mismo instante: es la misma.
      if (!p.claveDedup) return { notificationId: null, estado: "DESCARTADA" };
      const otra = await prisma.notification.findUnique({ where: { userId_claveDedup: { userId: persona.id, claveDedup: p.claveDedup } }, select: { id: true } });
      return { notificationId: otra?.id ?? null, estado: "SIN_CAMBIO" };
    }
  }
  const idEvento = eventoId ?? `evt_${notificacion.id}`;
  if (!eventoId) await prisma.notification.update({ where: { id: notificacion.id }, data: { eventoId: idEvento } });

  // 4. Entregas. La campana ya quedó: se asienta como entregada.
  const base = { organizationId: p.organizationId, notificationId: notificacion.id, userId: persona.id, tipo, eventoId: idEvento, resumen: recortar(p.title, 100) };
  await prisma.entregaAviso.create({
    data: { ...base, canal: "CAMPANA", estado: "ENTREGADA", intentos: 1, intentadaEl: ahora, entregadaEl: ahora, proveedor: "maintrack", claveDedup: `${notificacion.id}:CAMPANA:${notificacion.veces}` },
  }).catch(() => undefined);

  const cfg = await configDe(p.organizationId, ahora);
  const permitidos = leerJson<Canal[]>(pref?.canales, ["NAVEGADOR", "CORREO"]);
  const canales: Canal[] = [];
  if (cfg.canales.includes("NAVEGADOR") && cfg.avisosPush && permitidos.includes("NAVEGADOR") && !pref?.navegadorRechazado) {
    const dispositivos = await prisma.pushSubscription.count({ where: { userId: persona.id } });
    if (dispositivos) canales.push("NAVEGADOR");
  }
  if (cfg.canales.includes("CORREO") && proveedorDeCorreo() && permitidos.includes("CORREO") && persona.email) canales.push("CORREO");

  // Lo no crítico espera a la ventana de la persona (o de la empresa).
  const ventana = ventanaDe(cfg, pref ?? undefined);
  const cuando = prioridad === "CRITICA" || dentroDeVentana(ahora, ventana) ? ahora : siguienteMomentoHabil(ahora, ventana);

  const creadas: string[] = [];
  for (const canal of canales) {
    const e = await prisma.entregaAviso.create({
      data: { ...base, canal, estado: "PENDIENTE", programadaPara: cuando, claveDedup: `${notificacion.id}:${canal}:${notificacion.veces}` },
      select: { id: true, canal: true },
    }).catch(() => null);
    if (e && e.canal === "NAVEGADOR" && cuando.getTime() <= ahora.getTime()) creadas.push(e.id);
  }
  // Al celular, de inmediato (como siempre ha sido). Si falla, lo reintenta el proceso.
  for (const id of creadas) await procesarEntrega(id, ahora).catch(() => undefined);

  return { notificationId: notificacion.id, estado };
}

/**
 * Intenta una entrega. Primero la «toma» (PENDIENTE/EN_REINTENTO → EN_PROCESO)
 * con una actualización condicional: si dos procesos coinciden, solo uno la
 * manda. Devuelve el estado final.
 */
export async function procesarEntrega(id: string, ahora = new Date()): Promise<string> {
  const tomada = await prisma.entregaAviso.updateMany({
    where: { id, estado: { in: ["PENDIENTE", "EN_REINTENTO"] } },
    data: { estado: "EN_PROCESO", intentadaEl: ahora },
  });
  if (!tomada.count) return "OMITIDA";
  const e = await prisma.entregaAviso.findUniqueOrThrow({
    where: { id },
    include: {
      notification: { select: { title: true, body: true, link: true, porQue: true, accion: true, prioridad: true, atendidaEl: true, requiereAccion: true } },
      webhook: true,
    },
  });

  // Se atendió mientras esperaba: ya no hace falta avisar.
  if (e.notification?.requiereAccion && e.notification.atendidaEl) {
    await prisma.entregaAviso.update({ where: { id }, data: { estado: "CANCELADA", errorCategoria: "RESUELTO", errorDetalle: "se atendió antes de enviarse" } });
    return "CANCELADA";
  }

  let r: Resultado;
  if (e.canal === "CORREO") {
    // Límite por empresa y hora: lo que no cabe, espera; no cuenta como intento.
    const cupo = await consumirLimite(`correo:${e.organizationId}`, LIMITE_CORREOS_HORA, 3600, ahora);
    if (!cupo.permitido) {
      await prisma.entregaAviso.update({ where: { id }, data: { estado: "EN_REINTENTO", errorCategoria: "LIMITE", errorDetalle: "límite de correos por hora", programadaPara: cupo.reintentarEl, proximoIntento: cupo.reintentarEl } });
      return "EN_REINTENTO";
    }
    const u = e.userId ? await prisma.user.findUnique({ where: { id: e.userId }, select: { email: true, active: true } }) : null;
    if (!u?.active) {
      await prisma.entregaAviso.update({ where: { id }, data: { estado: "CANCELADA", errorCategoria: "USUARIO_INACTIVO" } });
      return "CANCELADA";
    }
    const cfg = await prisma.configAvisos.findUnique({ where: { organizationId: e.organizationId }, select: { remitente: true } });
    const n = e.notification;
    const liga = n?.link ? `${(process.env.APP_URL ?? "").replace(/\/$/, "")}${n.link}` : null;
    r = await transportes().correo({
      para: u.email,
      asunto: n?.title ?? e.resumen ?? "Aviso de MainTrack",
      texto: [n?.body, n?.porQue && `Por qué importa: ${n.porQue}`, n?.accion && `Qué hacer: ${n.accion}`, liga && `Abrir: ${liga}`].filter(Boolean).join("\n\n"),
      remitente: cfg?.remitente,
    });
  } else if (e.canal === "NAVEGADOR") {
    const n = e.notification;
    r = await transportes().navegador({
      userId: e.userId!, title: n?.title ?? e.resumen ?? "MainTrack", body: n?.body ?? undefined, link: n?.link ?? undefined,
      importante: n?.prioridad === "CRITICA",
    });
  } else if (e.canal === "WEBHOOK") {
    if (!e.webhook || e.webhook.estado !== "ACTIVO") {
      await prisma.entregaAviso.update({ where: { id }, data: { estado: "CANCELADA", errorCategoria: "WEBHOOK_INACTIVO", errorDetalle: "el webhook está pausado, suspendido o se borró" } });
      return "CANCELADA";
    }
    r = await transportes().webhook({
      url: e.webhook.url, secreto: descifrar(e.webhook.secretoCifrado), eventoId: e.eventoId, tipo: e.tipo, cuerpo: e.carga ?? "{}",
    });
  } else {
    await prisma.entregaAviso.update({ where: { id }, data: { estado: "ENTREGADA", entregadaEl: ahora } });
    return "ENTREGADA";
  }

  const intentos = e.intentos + 1;
  if (r.ok) {
    await prisma.entregaAviso.update({
      where: { id },
      data: { estado: "ENTREGADA", intentos, entregadaEl: new Date(), proveedor: r.proveedor, errorCategoria: null, errorDetalle: r.detalle ?? null, proximoIntento: null },
    });
    if (e.webhook) {
      await prisma.webhook.update({ where: { id: e.webhook.id }, data: { ultimoEnvioEl: new Date(), ultimoResultado: r.detalle ?? "ok", fallasConsecutivas: 0 } });
    }
    return "ENTREGADA";
  }

  const agotado = r.permanente || intentos >= MAXIMO_INTENTOS;
  const proximo = agotado ? null : new Date(ahora.getTime() + ESPERAS_MIN[Math.min(intentos - 1, ESPERAS_MIN.length - 1)] * 60_000);
  await prisma.entregaAviso.update({
    where: { id },
    data: {
      estado: agotado ? "FALLIDA" : "EN_REINTENTO", intentos, proveedor: r.proveedor, errorCategoria: r.categoria,
      errorDetalle: recortar(agotado && !r.permanente ? `${r.detalle} · agotó ${MAXIMO_INTENTOS} intentos` : r.detalle, 180),
      proximoIntento: proximo, ...(proximo ? { programadaPara: proximo } : {}),
    },
  });
  if (e.webhook) await registrarFallaWebhook(e.webhook.id, e.organizationId, r.detalle);
  return agotado ? "FALLIDA" : "EN_REINTENTO";
}

/** Cuenta fallas seguidas; con demasiadas, suspende el webhook y avisa. */
async function registrarFallaWebhook(webhookId: string, organizationId: string, detalle: string) {
  const w = await prisma.webhook.update({
    where: { id: webhookId },
    data: { ultimoEnvioEl: new Date(), ultimoResultado: recortar(detalle, 120), fallasConsecutivas: { increment: 1 } },
    select: { id: true, nombre: true, fallasConsecutivas: true, estado: true },
  });
  if (w.estado === "ACTIVO" && w.fallasConsecutivas >= FALLAS_PARA_SUSPENDER) {
    await prisma.webhook.update({ where: { id: w.id }, data: { estado: "SUSPENDIDO", suspendidoEl: new Date() } });
    await logAudit({
      organizationId, entity: "Webhook", entityId: w.id, action: "INTEGRATION_SUSPENDED",
      summary: `Webhook «${w.nombre}» suspendido tras ${w.fallasConsecutivas} fallas seguidas`,
    });
    const { emitirAviso } = await import("./emitir");
    await emitirAviso({
      organizationId, tipo: "INTEGRACION_CON_ERRORES", entidad: "Webhook", entidadId: w.id, version: "suspendido",
      titulo: `Webhook suspendido: ${w.nombre}`,
      cuerpo: `Falló ${w.fallasConsecutivas} veces seguidas (${detalle}). Dejó de recibir eventos.`,
      porQue: "El sistema que depende de este webhook ya no se está enterando de nada.",
      accion: "Revise que la dirección responda y reactívelo en Configuración → Integración.",
      enlace: "/settings?s=integracion",
    });
  }
}

/** Procesa lo que ya toca. Lo llama el proceso programado. */
export async function procesarEntregas(opciones: { ahora?: Date; limite?: number; organizationId?: string } = {}) {
  const ahora = opciones.ahora ?? new Date();
  const pendientes = await prisma.entregaAviso.findMany({
    where: {
      estado: { in: ["PENDIENTE", "EN_REINTENTO"] }, programadaPara: { lte: ahora },
      ...(opciones.organizationId ? { organizationId: opciones.organizationId } : {}),
    },
    orderBy: { programadaPara: "asc" },
    take: opciones.limite ?? 200,
    select: { id: true },
  });
  const cuenta: Record<string, number> = {};
  for (const p of pendientes) {
    const r = await procesarEntrega(p.id, ahora).catch(() => "ERROR");
    cuenta[r] = (cuenta[r] ?? 0) + 1;
  }
  // Una entrega que quedó «en proceso» más de 15 minutos es un proceso que se cayó a la mitad: se regresa a la cola.
  await prisma.entregaAviso.updateMany({
    where: { estado: "EN_PROCESO", intentadaEl: { lt: new Date(ahora.getTime() - 15 * 60_000) } },
    data: { estado: "EN_REINTENTO", errorCategoria: "INTERRUMPIDA", programadaPara: ahora },
  });
  return { procesadas: pendientes.length, ...cuenta };
}

/**
 * Reintento manual de una entrega fallida o cancelada, por un administrador de
 * la misma empresa. Queda en la bitácora.
 */
export async function reintentarEntrega(p: { organizationId: string; entregaId: string; userId: string }) {
  const e = await prisma.entregaAviso.findFirst({ where: { id: p.entregaId, organizationId: p.organizationId } });
  if (!e) return { ok: false as const, error: "Entrega no encontrada", codigo: 404 };
  if (!["FALLIDA", "CANCELADA"].includes(e.estado) || e.canal === "CAMPANA") {
    return { ok: false as const, error: "Solo se reintentan entregas fallidas o canceladas de correo, navegador o webhook", codigo: 409 };
  }
  if (e.webhookId) {
    const w = await prisma.webhook.findUnique({ where: { id: e.webhookId }, select: { estado: true } });
    if (w?.estado !== "ACTIVO") return { ok: false as const, error: "Reactive el webhook antes de reintentar", codigo: 409 };
  }
  await prisma.entregaAviso.update({
    where: { id: e.id },
    data: { estado: "PENDIENTE", intentos: 0, programadaPara: new Date(), proximoIntento: null, errorCategoria: null, errorDetalle: null },
  });
  await logAudit({
    organizationId: p.organizationId, userId: p.userId, entity: "EntregaAviso", entityId: e.id, action: "DELIVERY_RETRIED",
    summary: `Reintento manual de una entrega por ${e.canal.toLowerCase()} (${e.tipo})`,
  });
  const estado = await procesarEntrega(e.id);
  return { ok: true as const, estado };
}
