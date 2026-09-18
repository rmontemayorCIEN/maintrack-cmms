/**
 * Cómo sale un aviso por cada canal externo. Nada más.
 *
 * Qué se avisa y a quién ya se decidió antes (`notify()` y
 * `lib/avisos/emitir.ts`); cuándo reintentar lo decide `lib/avisos/entrega.ts`.
 * Aquí solo se intenta una vez y se devuelve un resultado clasificado:
 * entregado, falla temporal (se reintenta) o falla permanente (no).
 *
 * Correo: no hay proveedor contratado. El canal existe completo —cola,
 * reintentos, historial— y el transporte se elige con `AVISOS_CORREO`:
 *
 *  - sin valor: el canal no está disponible y no se crean entregas de correo.
 *  - `prueba`: simula el envío sin mandar nada. Los destinos que terminan en
 *    `@falla-temporal.invalid` fallan dos veces y luego pasan; los de
 *    `@falla-permanente.invalid` fallan siempre. Lo "enviado" queda en
 *    `bandejaDePrueba`, en memoria.
 *
 * Conectar un proveedor real (SMTP de Google Workspace, un servicio de
 * correo) es agregar un transporte aquí, con autorización.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { enviarPush } from "../push";
import { validarDestino, DestinoNoPermitido } from "../integraciones/destino";

export type Resultado =
  | { ok: true; proveedor: string; detalle?: string }
  | { ok: false; proveedor: string; permanente: boolean; categoria: string; detalle: string };

export type MensajeCorreo = { para: string; asunto: string; texto: string; remitente?: string | null };
export type MensajeNavegador = { userId: string; title: string; body?: string; link?: string; tag?: string; importante?: boolean };
export type MensajeWebhook = { url: string; secreto: string; eventoId: string; tipo: string; cuerpo: string };

// ───────────────────────────────────────────── Correo

export const bandejaDePrueba: Array<MensajeCorreo & { el: Date }> = [];
const intentosDePrueba = new Map<string, number>();

export function proveedorDeCorreo(): string | null {
  const p = process.env.AVISOS_CORREO?.trim().toLowerCase();
  // El de prueba marca como entregado lo que no salió: jamás en producción.
  return p === "prueba" && process.env.NODE_ENV !== "production" ? "prueba" : null;
}

async function correoDePrueba(m: MensajeCorreo): Promise<Resultado> {
  const destino = m.para.toLowerCase();
  if (destino.endsWith("@falla-permanente.invalid")) {
    return { ok: false, proveedor: "prueba", permanente: true, categoria: "DESTINO_INVALIDO", detalle: "550 buzón inexistente (simulado)" };
  }
  if (destino.endsWith("@falla-temporal.invalid")) {
    const n = (intentosDePrueba.get(destino) ?? 0) + 1;
    intentosDePrueba.set(destino, n);
    if (n <= 2) return { ok: false, proveedor: "prueba", permanente: false, categoria: "TEMPORAL", detalle: "421 servicio no disponible (simulado)" };
  }
  bandejaDePrueba.push({ ...m, el: new Date() });
  return { ok: true, proveedor: "prueba" };
}

// ───────────────────────────────────────────── Navegador

async function navegador(m: MensajeNavegador): Promise<Resultado> {
  const r = await enviarPush(m.userId, { title: m.title, body: m.body, link: m.link, tag: m.tag, importante: m.importante });
  if (r.entregados > 0) return { ok: true, proveedor: "web-push", detalle: `${r.entregados} dispositivo(s)` };
  if (r.motivo === "SIN_LLAVES") return { ok: false, proveedor: "web-push", permanente: true, categoria: "SIN_PROVEEDOR", detalle: "sin llaves VAPID" };
  if (r.motivo === "APAGADO") return { ok: false, proveedor: "web-push", permanente: true, categoria: "CANAL_APAGADO", detalle: "avisos al celular apagados en la empresa" };
  if (r.motivo === "SIN_DISPOSITIVOS" || (r.dadasDeBaja > 0 && r.fallidos === 0)) {
    return { ok: false, proveedor: "web-push", permanente: true, categoria: "SIN_DISPOSITIVOS", detalle: "sin dispositivos dados de alta" };
  }
  return { ok: false, proveedor: "web-push", permanente: false, categoria: "TEMPORAL", detalle: `${r.fallidos} dispositivo(s) no respondieron` };
}

// ───────────────────────────────────────────── Webhook

export const ESPERA_WEBHOOK_MS = 8_000;

/**
 * La firma: HMAC-SHA256 de `marca.cuerpo` con el secreto del webhook. El
 * receptor la recalcula; la marca (segundos) le deja rechazar repeticiones
 * viejas y el identificador del evento, repeticiones recientes.
 */
export function firmar(secreto: string, marca: number, cuerpo: string): string {
  return `v1=${createHmac("sha256", secreto).update(`${marca}.${cuerpo}`).digest("hex")}`;
}

/**
 * Cómo verifica el receptor. Es la misma receta que va en la documentación:
 * recalcular la firma, compararla en tiempo constante y rechazar marcas de
 * más de cinco minutos. El identificador del evento, además, deja descartar
 * una repetición dentro de esa ventana.
 */
export function verificarFirma(secreto: string, marca: string, cuerpo: string, firma: string, ahora = Date.now(), toleranciaSeg = 300): boolean {
  const m = Number(marca);
  if (!Number.isFinite(m) || Math.abs(ahora / 1000 - m) > toleranciaSeg) return false;
  const esperada = Buffer.from(firmar(secreto, m, cuerpo));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

async function webhook(m: MensajeWebhook): Promise<Resultado> {
  try {
    await validarDestino(m.url);
  } catch (e) {
    const detalle = e instanceof DestinoNoPermitido ? e.message : "destino no válido";
    return { ok: false, proveedor: "http", permanente: true, categoria: "DESTINO_INVALIDO", detalle };
  }
  const marca = Math.floor(Date.now() / 1000);
  try {
    const r = await fetch(m.url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "MainTrack-Webhooks/1",
        "MainTrack-Evento-Id": m.eventoId,
        "MainTrack-Evento": m.tipo,
        "MainTrack-Marca": String(marca),
        "MainTrack-Firma": firmar(m.secreto, marca, m.cuerpo),
      },
      body: m.cuerpo,
      signal: AbortSignal.timeout(ESPERA_WEBHOOK_MS),
    });
    if (r.status >= 200 && r.status < 300) return { ok: true, proveedor: "http", detalle: `HTTP ${r.status}` };
    // 4xx salvo 408 y 429 es rechazo del receptor: repetir lo mismo no lo arregla.
    const permanente = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429;
    return { ok: false, proveedor: "http", permanente, categoria: permanente ? "RECHAZADO" : "TEMPORAL", detalle: `HTTP ${r.status}` };
  } catch (e) {
    const agotado = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, proveedor: "http", permanente: false, categoria: agotado ? "TIEMPO_AGOTADO" : "TEMPORAL", detalle: agotado ? `sin respuesta en ${ESPERA_WEBHOOK_MS / 1000} s` : "no se pudo conectar" };
  }
}

// ───────────────────────────────────────────── Selección

type Transportes = {
  correo: (m: MensajeCorreo) => Promise<Resultado>;
  navegador: (m: MensajeNavegador) => Promise<Resultado>;
  webhook: (m: MensajeWebhook) => Promise<Resultado>;
};

const reales: Transportes = {
  correo: async (m) => {
    if (proveedorDeCorreo() === "prueba") return correoDePrueba(m);
    return { ok: false, proveedor: "ninguno", permanente: true, categoria: "SIN_PROVEEDOR", detalle: "no hay proveedor de correo configurado" };
  },
  navegador,
  webhook,
};

let actuales: Transportes = { ...reales };

export const transportes = (): Transportes => actuales;

/**
 * Solo para pruebas: reemplaza un transporte (por ejemplo, simular que el
 * navegador aceptó el permiso). Sin argumento, regresa a los reales.
 */
export function usarTransportes(cambios?: Partial<Transportes>) {
  actuales = cambios ? { ...actuales, ...cambios } : { ...reales };
}
