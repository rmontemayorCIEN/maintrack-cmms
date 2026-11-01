// La memoria del Consultor: notas de lo que necesita la persona, dónde se quedó
// y cuánto se guarda la conversación.
//
// Las notas las PROPONE la IA y las CONFIRMA la persona; nada se guarda solo.
// Se apagan, no se borran (con Deshacer). Los mensajes se guardan
// DIAS_MENSAJES días y después los borra el trabajo programado de cada app.

import type { Nota, PropuestaNota, TipoNota } from "../tipos";
import { plano } from "./texto";
import { textos, type Trato } from "../textos";

export const LIMITES = {
  nota: 280,
  notas: 40,
  resumen: 600,
  pregunta: 1000,
  respuesta: 2500,
  /// Preguntas por persona al día: el freno del costo.
  preguntasPorDia: 40,
  /// Mensajes en contexto: los últimos de la conversación.
  mensajesEnContexto: 8,
  diasMensajes: 180,
} as const;

export const TIPOS_NOTA: Record<TipoNota, string> = {
  META: "Lo que quiere lograr",
  FECHA: "Fecha meta",
  NECESIDAD: "Lo que necesita",
  EQUIPO: "Quién lo usa",
  COMPROMISO: "Lo que quedó de hacer",
};

export const esTipoNota = (x: unknown): x is TipoNota => typeof x === "string" && x in TIPOS_NOTA;

/// Una nota lista para guardar, o todos sus errores juntos.
export function revisarNota(tipo: unknown, texto: unknown, actuales: Pick<Nota, "texto">[], trato?: Trato): { ok: true; nota: PropuestaNota } | { ok: false; error: string } {
  const errores: string[] = [];
  if (!esTipoNota(tipo)) errores.push("El tipo de nota no existe.");
  const t = typeof texto === "string" ? texto.replace(/\s+/g, " ").trim() : "";
  if (t.length < 3) errores.push("La nota está vacía.");
  if (t.length > LIMITES.nota) errores.push(`La nota pasa de ${LIMITES.nota} caracteres.`);
  if (t && actuales.some((n) => plano(n.texto) === plano(t))) errores.push("Esa nota ya está guardada.");
  if (actuales.length >= LIMITES.notas) errores.push(textos(trato).apagaAlguna(LIMITES.notas));
  if (errores.length) return { ok: false, error: errores.join(" ") };
  return { ok: true, nota: { tipo: tipo as TipoNota, texto: t } };
}

/// Las propuestas de la IA que sí se le pueden ofrecer a la persona: válidas, sin
/// repetir las guardadas ni entre sí, y a lo mucho tres.
export function propuestasValidas(propuestas: unknown, actuales: Pick<Nota, "texto">[]): PropuestaNota[] {
  if (!Array.isArray(propuestas)) return [];
  const salida: PropuestaNota[] = [];
  for (const p of propuestas as { tipo?: unknown; texto?: unknown }[]) {
    const r = revisarNota(p?.tipo, p?.texto, [...actuales, ...salida]);
    if (r.ok) salida.push(r.nota);
    if (salida.length === 3) break;
  }
  return salida;
}

/// La entrevista de arranque: tres preguntas sin IA. Lo contestado se vuelve nota.
/// (De tú; `entrevista(trato)` da las del trato de cada app.)
export const ENTREVISTA = [
  { clave: "fecha", tipo: "FECHA", pregunta: "¿Para cuándo quieres estar operando?", ejemplo: "Para el 15 de noviembre" },
  { clave: "meta", tipo: "META", pregunta: "¿Qué quieres lograr primero con el sistema?", ejemplo: "Dejar de perder los pagos de mis clientes" },
  { clave: "equipo", tipo: "EQUIPO", pregunta: "¿Quién más lo va a usar?", ejemplo: "Yo y mi asistente" },
] as const satisfies readonly { clave: string; tipo: TipoNota; pregunta: string; ejemplo: string }[];

export function entrevista(trato?: Trato): { clave: string; tipo: TipoNota; pregunta: string; ejemplo: string }[] {
  const T = textos(trato);
  return ENTREVISTA.map((e) => ({ ...e, pregunta: e.clave === "fecha" ? T.entrevistaFecha : e.clave === "meta" ? T.entrevistaMeta : e.pregunta }));
}

export function notasDeEntrevista(respuestas: Record<string, unknown>, actuales: Pick<Nota, "texto">[], trato?: Trato): { ok: true; notas: PropuestaNota[] } | { ok: false; error: string } {
  const notas: PropuestaNota[] = [];
  const errores: string[] = [];
  for (const e of entrevista(trato)) {
    const v = respuestas[e.clave];
    if (typeof v !== "string" || !v.trim()) continue;
    const r = revisarNota(e.tipo, v, [...actuales, ...notas], trato);
    if (r.ok) notas.push(r.nota);
    else errores.push(`${e.pregunta} ${r.error}`);
  }
  if (errores.length) return { ok: false, error: errores.join(" ") };
  if (!notas.length) return { ok: false, error: textos(trato).contestaUna };
  return { ok: true, notas };
}

/// Desde cuándo se borran los mensajes. Recibe `hoy`: no lee el reloj.
export function limiteDeMensajes(hoy: Date, dias: number = LIMITES.diasMensajes): Date {
  return new Date(hoy.getTime() - dias * 86_400_000);
}

/// «Hace 3 días», calculado al mostrar; nunca se guarda.
export function haceCuanto(fechaIso: string | null, ahora: Date): string {
  if (!fechaIso) return "nunca";
  const ms = ahora.getTime() - new Date(fechaIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "hace un momento";
  const min = Math.floor(ms / 60_000);
  if (min < 2) return "hace un momento";
  if (min < 60) return `hace ${min} minutos`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? "hace una hora" : `hace ${h} horas`;
  const d = Math.floor(h / 24);
  if (d < 30) return d === 1 ? "ayer" : `hace ${d} días`;
  const m = Math.floor(d / 30);
  return m === 1 ? "hace un mes" : `hace ${m} meses`;
}
