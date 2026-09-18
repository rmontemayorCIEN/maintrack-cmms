/**
 * Webhooks salientes: a dónde le avisa MainTrack a los sistemas de la empresa.
 *
 * Cada webhook elige qué eventos recibe (los marcados en el catálogo como
 * aptos para webhook) y tiene su propio secreto de firma. Los envíos van por
 * la misma cola que los demás avisos (`EntregaAviso`, canal WEBHOOK): con
 * reintentos, historial y suspensión automática tras fallas seguidas.
 *
 * Todo cambio queda en la bitácora; el secreto nunca.
 */
import { prisma } from "../db";
import { logAudit } from "../audit";
import { aleatorio, cifrar } from "./cifrado";
import { DestinoNoPermitido, urlEnmascarada, validarDestino } from "./destino";
import { EVENTOS_WEBHOOK, type TipoEvento } from "../avisos/catalogo";
import { transportes } from "../avisos/canales";
import { idDeEvento } from "../avisos/entrega";
import { leerJson } from "../avisos/config";

export class ErrorDeWebhook extends Error {
  constructor(message: string, readonly codigo = 422) {
    super(message);
  }
}

const MAXIMO_POR_EMPRESA = 10;

function eventosValidos(eventos: string[]): TipoEvento[] {
  const v = [...new Set(eventos)].filter((e): e is TipoEvento => (EVENTOS_WEBHOOK as string[]).includes(e));
  if (!v.length) throw new ErrorDeWebhook("Elija al menos un evento.");
  return v;
}

async function destinoValido(url: string) {
  try {
    return await validarDestino(url);
  } catch (e) {
    throw new ErrorDeWebhook(e instanceof DestinoNoPermitido ? e.message : "La dirección no es válida.");
  }
}

export async function crearWebhook(p: { organizationId: string; userId: string; nombre: string; url: string; eventos: string[] }) {
  const nombre = p.nombre.trim().slice(0, 80);
  if (nombre.length < 3) throw new ErrorDeWebhook("Póngale un nombre que diga qué sistema lo recibe.");
  if ((await prisma.webhook.count({ where: { organizationId: p.organizationId } })) >= MAXIMO_POR_EMPRESA) {
    throw new ErrorDeWebhook(`Se permiten hasta ${MAXIMO_POR_EMPRESA} webhooks por empresa.`, 409);
  }
  const url = await destinoValido(p.url);
  const eventos = eventosValidos(p.eventos);
  const secreto = `whsec_${aleatorio(32)}`;
  const w = await prisma.webhook.create({
    data: {
      organizationId: p.organizationId, nombre, url, eventos: JSON.stringify(eventos),
      secretoCifrado: cifrar(secreto), secretoPista: secreto.slice(-4), creadoPorId: p.userId,
    },
    select: { id: true, nombre: true, estado: true, createdAt: true },
  });
  await logAudit({
    organizationId: p.organizationId, userId: p.userId, entity: "Webhook", entityId: w.id, action: "WEBHOOK_CREATED",
    summary: `Webhook «${nombre}» hacia ${urlEnmascarada(url)}`, changes: { eventos },
  });
  return { webhook: w, secreto };
}

export async function modificarWebhook(p: {
  organizationId: string; userId: string; id: string;
  cambios: { nombre?: string; url?: string; eventos?: string[]; estado?: "ACTIVO" | "PAUSADO" };
}) {
  const w = await prisma.webhook.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!w) throw new ErrorDeWebhook("Webhook no encontrado", 404);
  const data: Record<string, unknown> = {};
  const resumen: string[] = [];
  if (p.cambios.nombre !== undefined) { data.nombre = p.cambios.nombre.trim().slice(0, 80); resumen.push("nombre"); }
  if (p.cambios.url !== undefined) { data.url = await destinoValido(p.cambios.url); resumen.push(`dirección → ${urlEnmascarada(data.url as string)}`); }
  if (p.cambios.eventos !== undefined) { data.eventos = JSON.stringify(eventosValidos(p.cambios.eventos)); resumen.push("eventos"); }
  if (p.cambios.estado !== undefined && p.cambios.estado !== w.estado) {
    data.estado = p.cambios.estado;
    // Reactivar después de una suspensión empieza la cuenta de fallas de cero.
    if (p.cambios.estado === "ACTIVO") { data.fallasConsecutivas = 0; data.suspendidoEl = null; }
    resumen.push(p.cambios.estado === "ACTIVO" ? (w.estado === "SUSPENDIDO" ? "reactivado tras suspensión" : "activado") : "pausado");
  }
  if (!resumen.length) return w;
  const r = await prisma.webhook.update({ where: { id: w.id }, data });
  await logAudit({
    organizationId: p.organizationId, userId: p.userId, entity: "Webhook", entityId: w.id, action: "WEBHOOK_UPDATED",
    summary: `Webhook «${r.nombre}»: ${resumen.join(", ")}`,
  });
  return r;
}

export async function rotarSecretoWebhook(p: { organizationId: string; userId: string; id: string }) {
  const w = await prisma.webhook.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!w) throw new ErrorDeWebhook("Webhook no encontrado", 404);
  const secreto = `whsec_${aleatorio(32)}`;
  await prisma.webhook.update({ where: { id: w.id }, data: { secretoCifrado: cifrar(secreto), secretoPista: secreto.slice(-4) } });
  await logAudit({
    organizationId: p.organizationId, userId: p.userId, entity: "Webhook", entityId: w.id, action: "WEBHOOK_SECRET_ROTATED",
    summary: `Se cambió el secreto de firma del webhook «${w.nombre}»`,
  });
  return { secreto };
}

/**
 * Prueba de conexión: un evento PRUEBA con datos inventados, firmado igual
 * que los reales. No manda ningún dato de la empresa. Queda en el historial
 * de entregas y en la bitácora.
 */
export async function probarWebhook(p: { organizationId: string; userId: string; id: string }) {
  const w = await prisma.webhook.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!w) throw new ErrorDeWebhook("Webhook no encontrado", 404);
  const eventoId = idDeEvento(p.organizationId, "PRUEBA", w.id, new Date().toISOString());
  const cuerpo = JSON.stringify({
    id: eventoId, tipo: "PRUEBA", ocurrio: new Date().toISOString(), prioridad: "INFORMATIVA",
    registro: null, titulo: "Prueba de conexión de MainTrack", datos: { mensaje: "Si recibe esto, la firma y la dirección funcionan." },
  });
  const { descifrar } = await import("./cifrado");
  const r = await transportes().webhook({ url: w.url, secreto: descifrar(w.secretoCifrado), eventoId, tipo: "PRUEBA", cuerpo });
  await prisma.entregaAviso.create({
    data: {
      organizationId: p.organizationId, webhookId: w.id, tipo: "PRUEBA", eventoId, canal: "WEBHOOK",
      estado: r.ok ? "ENTREGADA" : "FALLIDA", intentos: 1, intentadaEl: new Date(), entregadaEl: r.ok ? new Date() : null,
      proveedor: r.proveedor, errorCategoria: r.ok ? null : r.categoria, errorDetalle: r.ok ? (r.detalle ?? null) : r.detalle,
      claveDedup: `${eventoId}:prueba`, resumen: "Prueba de conexión",
    },
  });
  await prisma.webhook.update({ where: { id: w.id }, data: { ultimoEnvioEl: new Date(), ultimoResultado: r.ok ? `prueba ok (${r.detalle ?? ""})` : `prueba falló: ${r.detalle}` } });
  await logAudit({
    organizationId: p.organizationId, userId: p.userId, entity: "Webhook", entityId: w.id, action: "WEBHOOK_TESTED",
    summary: `Prueba del webhook «${w.nombre}»: ${r.ok ? "respondió bien" : `falló (${r.detalle})`}`,
  });
  return r.ok ? { ok: true as const, detalle: r.detalle ?? null } : { ok: false as const, detalle: r.detalle };
}

/** Lo que se muestra de un webhook: sin secreto, con la dirección completa solo para administradores. */
export function vistaDeWebhook(w: { id: string; nombre: string; url: string; eventos: string; estado: string; secretoPista: string; ultimoEnvioEl: Date | null; ultimoResultado: string | null; fallasConsecutivas: number; suspendidoEl: Date | null; createdAt: Date }) {
  return {
    id: w.id, nombre: w.nombre, url: w.url, eventos: leerJson<string[]>(w.eventos, []), estado: w.estado,
    secreto: `whsec_…${w.secretoPista}`, ultimoEnvioEl: w.ultimoEnvioEl, ultimoResultado: w.ultimoResultado,
    fallasConsecutivas: w.fallasConsecutivas, suspendidoEl: w.suspendidoEl, createdAt: w.createdAt,
  };
}
