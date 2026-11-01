import { z } from "../zod";
import { prisma } from "../db";
import { can } from "../rbac";
import { logAudit } from "../audit";
import { AYUDA } from "../ayuda";
import { puedeVerRuta } from "../pantallas";
import { analizarConIa, iaConfigurada, motivoLegible, textoIa } from "../ia/cliente";
import { puedeUsarIa, type OrgConIa } from "../ia/consumo";
import { consultar, type PuertaIA } from "@/consultor/consultar";
import { CLAVES_CLASE, CLAVES_NOTA, DESCRIPCION } from "@/consultor/esquema";
import { limiteDeMensajes, LIMITES, notasDeEntrevista, revisarNota } from "@/consultor/reglas/memoria";
import { sinDatosPersonales } from "@/consultor/reglas/privacidad";
import type { Contestacion, FichaConsultor, Memoria, MensajeConsultor, Nota, PasoPlan, R, TipoNota } from "@/consultor/tipos";
import { planDe } from "./plan";
import { PERFIL } from "./perfil";

/**
 * El Consultor del Sistema en Maintrack: activacion, preguntas, notas y
 * limpieza. Las reglas viven en `consultor/` (copia de ~/Proyectos/consultor-sistema);
 * aqui van el plan, la base y los permisos.
 *
 * Todo se acota por empresa, en el servidor: el `orgId` sale de la sesion
 * (`withAuth`), nunca del navegador. La pregunta se limpia de datos personales
 * ANTES de ir a la IA y antes de guardarse: lo que se guarda es lo que vio la IA.
 *
 * Las rutas (`app/api/consultor/`) solo validan y llaman a estas funciones, y la
 * prueba llama a las mismas: una prueba que copia los pasos no prueba nada.
 */

export { PERFIL };

/** Quien pregunta. Sale de la sesion. */
export type Quien = {
  userId: string;
  nombre: string;
  orgId: string;
  rol: string;
  /** El operador de la plataforma dentro de la empresa de un cliente. */
  esOperador: boolean;
  /** Prueba vencida o cuenta suspendida: se consulta, no se cambia. */
  soloLectura: boolean;
};

export const FICHAS: FichaConsultor[] = Object.entries(AYUDA).map(([ruta, f]) => ({
  ruta, titulo: f.titulo, que: f.que ?? "", hacer: f.hacer ?? [], flujo: f.flujo ?? [], noPuedo: f.noPuedo,
}));

/** Solo las fichas de lo que esta persona puede abrir: la IA no sugiere pantallas cerradas. */
export const fichasPara = (q: Pick<Quien, "rol" | "esOperador">) => FICHAS.filter((f) => puedeVerRuta(q.rol, f.ruta, { esSuperAdmin: q.esOperador }));

export const SIN_IA = "La conversación no está disponible: la IA no está configurada en este servidor. El plan y su avance sí están al día.";

/** Clasificar es escoger de cuatro: no necesita el modelo grande. */
export const MODELO_CLASIFICAR = "claude-haiku-4-5";

const administra = (q: Quien) => q.esOperador || can(q.rol, "settings:write");

/** El inicio del dia en la zona de la empresa: el tope de preguntas es por dia, no por 24 horas corridas. */
export function inicioDelDia(ahora: Date, zona = "America/Mexico_City"): Date {
  const dia = ahora.toLocaleDateString("en-CA", { timeZone: zona });
  // El desfase de esa zona a esa hora (Mexico ya no cambia de horario, otras zonas si).
  const enZona = new Date(ahora.toLocaleString("en-US", { timeZone: zona }));
  const enUtc = new Date(ahora.toLocaleString("en-US", { timeZone: "UTC" }));
  const desfase = enUtc.getTime() - enZona.getTime();
  return new Date(new Date(`${dia}T00:00:00Z`).getTime() + desfase);
}

async function empresa(orgId: string) {
  return prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { id: true, plan: true, iaComplemento: true, iaExtra: true, consultorActivo: true, timezone: true },
  });
}

async function gente(orgId: string): Promise<Map<string, string>> {
  const us = await prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  return new Map(us.map((u) => [u.id, u.name]));
}

const limpiar = (texto: string, nombres: Map<string, string>) => sinDatosPersonales(texto, [...nombres.values()]);

async function notasDe(orgId: string, nombres: Map<string, string>): Promise<Nota[]> {
  const ns = await prisma.consultorNota.findMany({ where: { organizationId: orgId, activa: true }, orderBy: { creadaEn: "asc" } });
  return ns.map((n) => ({ id: n.id, tipo: n.tipo as TipoNota, texto: n.texto, autor: nombres.get(n.userId) ?? "Alguien de la empresa", creadaEn: n.creadaEn.toISOString() }));
}

async function memoriaDe(q: Quien, nombres: Map<string, string>): Promise<Memoria> {
  const [e, notas] = await Promise.all([
    prisma.consultorEstado.findUnique({ where: { organizationId_userId: { organizationId: q.orgId, userId: q.userId } } }),
    notasDe(q.orgId, nombres),
  ]);
  return { pasoActual: e?.pasoActual ?? null, resumen: e?.resumen ?? "", ultimaVez: e?.ultimaVez?.toISOString() ?? null, notas };
}

async function mensajesDe(q: Quien, cuantos = 30): Promise<MensajeConsultor[]> {
  const ms = await prisma.consultorMensaje.findMany({ where: { organizationId: q.orgId, userId: q.userId }, orderBy: { creadoEn: "desc" }, take: cuantos });
  return ms.reverse().map((m) => {
    let enlace: MensajeConsultor["enlace"] = null;
    try { enlace = m.enlace ? JSON.parse(m.enlace) : null; } catch { /* sin enlace */ }
    return { id: m.id, de: m.de === "USUARIO" ? "USUARIO" : "CONSULTOR", texto: m.texto, fecha: m.creadoEn.toISOString(), enlace };
  });
}

async function quedanHoy(q: Quien, ahora: Date, zona: string): Promise<number> {
  const usadas = await prisma.consultorMensaje.count({ where: { organizationId: q.orgId, userId: q.userId, de: "USUARIO", creadoEn: { gte: inicioDelDia(ahora, zona) } } });
  return Math.max(0, LIMITES.preguntasPorDia - usadas);
}

/** La IA disponible para esta empresa: llave, plan y bolsa del mes. */
async function iaPara(q: Quien, org: OrgConIa): Promise<{ disponible: boolean; motivo: string }> {
  if (!iaConfigurada()) return { disponible: false, motivo: SIN_IA };
  const v = await puedeUsarIa(org, "CONSULTOR", { operador: q.esOperador });
  return v.permitido ? { disponible: true, motivo: "" } : { disponible: false, motivo: v.motivo };
}

export type DatosConsultor =
  | { activo: false; puedeActivar: boolean }
  | {
    activo: true; pasos: PasoPlan[]; porcentaje: number; memoria: Memoria; mensajes: MensajeConsultor[]; quedanHoy: number;
    ia: { disponible: boolean; motivo: string }; puedeAdministrar: boolean; soloLectura: boolean;
  };

export async function datosConsultor(q: Quien, ahora: Date): Promise<DatosConsultor> {
  const org = await empresa(q.orgId);
  if (!org.consultorActivo) return { activo: false, puedeActivar: administra(q) && !q.soloLectura };
  const nombres = await gente(q.orgId);
  const [plan, memoria, mensajes, quedan, ia] = await Promise.all([
    planDe(q.orgId, q.rol, { esSuperAdmin: q.esOperador }), memoriaDe(q, nombres), mensajesDe(q), quedanHoy(q, ahora, org.timezone), iaPara(q, org),
  ]);
  return {
    activo: true, pasos: plan.pasos, porcentaje: plan.porcentaje, memoria, mensajes, quedanHoy: quedan, ia,
    puedeAdministrar: administra(q), soloLectura: q.soloLectura || !can(q.rol, "consultor:use") && !q.esOperador,
  };
}

/** Lo que se puede hacer: activo, con escritura y con el permiso. */
async function puedeUsar(q: Quien): Promise<string | null> {
  if (q.soloLectura) return "La cuenta está en solo lectura.";
  if (!q.esOperador && !can(q.rol, "consultor:use")) return "Su rol puede ver el plan, pero no conversar con el Consultor.";
  const org = await empresa(q.orgId);
  if (!org.consultorActivo) return "El Consultor está apagado en esta empresa.";
  return null;
}

// Sin limites dentro del esquema: el largo va en la descripcion (textoIa) y se valida al escribir.
const Clase = z.object({ clase: z.enum(CLAVES_CLASE as [string, ...string[]]).describe(DESCRIPCION.clase) });
const Redaccion = z.object({
  respuesta: textoIa(LIMITES.respuesta, DESCRIPCION.respuesta),
  enlace: z.string().describe(DESCRIPCION.enlace),
  pasoClave: z.string().describe(DESCRIPCION.pasoClave),
  notasPropuestas: z.array(z.object({
    tipo: z.enum(CLAVES_NOTA as [string, ...string[]]).describe(DESCRIPCION.notaTipo),
    texto: textoIa(LIMITES.nota, DESCRIPCION.notaTexto),
  })).describe(DESCRIPCION.notasPropuestas),
  resumen: textoIa(LIMITES.resumen, DESCRIPCION.resumen),
});

/** La puerta de IA real: las dos llamadas pasan por `analizarConIa`, que registra el consumo. */
export function puertaReal(q: Quien): PuertaIA {
  return {
    async clasificar({ sistema, pregunta }) {
      const r = await analizarConIa({
        organizationId: q.orgId, userId: q.userId, funcion: "CONSULTOR", modelo: MODELO_CLASIFICAR, maxTokens: 200,
        sistema, instruccion: "Clasifique la pregunta que viene en los datos. No la conteste.", contexto: { pregunta }, esquema: Clase,
      });
      return r.datos.clase;
    },
    async redactar({ sistema, contexto, pregunta }) {
      const r = await analizarConIa({
        organizationId: q.orgId, userId: q.userId, funcion: "CONSULTOR", maxTokens: 3000, esfuerzo: "low",
        sistema, instruccion: "Conteste la pregunta (campo «pregunta») con lo que dice el contexto (campo «contexto»).", contexto: { contexto, pregunta }, esquema: Redaccion,
      });
      return r.datos;
    },
  };
}

export async function preguntarDe(q: Quien, texto: unknown, ruta: unknown, o: { ahora: Date; ia?: PuertaIA }): Promise<R<{ contestacion: Contestacion; quedan: number }>> {
  const no = await puedeUsar(q);
  if (no) return { ok: false, error: no };
  const org = await empresa(q.orgId);
  if (!o.ia) {
    const ia = await iaPara(q, org);
    if (!ia.disponible) return { ok: false, error: ia.motivo };
  }
  const quedan = await quedanHoy(q, o.ahora, org.timezone);
  if (quedan <= 0) return { ok: false, error: `Llegó a las ${LIMITES.preguntasPorDia} preguntas de hoy.` };

  const nombres = await gente(q.orgId);
  const pregunta = limpiar(typeof texto === "string" ? texto.slice(0, LIMITES.pregunta * 2) : "", nombres);
  const [plan, memoria, recientes] = await Promise.all([planDe(q.orgId, q.rol, { esSuperAdmin: q.esOperador }), memoriaDe(q, nombres), mensajesDe(q, LIMITES.mensajesEnContexto)]);
  const r = await consultar({
    perfil: PERFIL, rol: q.rol, puedeAdministrar: administra(q), pasos: plan.pasos, porcentaje: plan.porcentaje, memoria, fichas: fichasPara(q), recientes,
    hoy: o.ahora.toLocaleDateString("en-CA", { timeZone: org.timezone }), pregunta,
    ruta: typeof ruta === "string" && ruta.startsWith("/") ? ruta.slice(0, 120) : null,
  }, o.ia ?? puertaReal(q), motivoLegible);
  if (!r.ok) return r;

  const c = r.contestacion;
  // La respuesta 1 ms despues de la pregunta: el orden de la conversacion no depende de la base.
  await prisma.consultorMensaje.createMany({ data: [
    { organizationId: q.orgId, userId: q.userId, de: "USUARIO", texto: pregunta.replace(/\s+/g, " ").trim(), creadoEn: o.ahora },
    { organizationId: q.orgId, userId: q.userId, de: "CONSULTOR", texto: c.respuesta, clase: c.clase, enlace: c.enlace ? JSON.stringify(c.enlace) : null, creadoEn: new Date(o.ahora.getTime() + 1) },
  ] });
  await prisma.consultorEstado.upsert({
    where: { organizationId_userId: { organizationId: q.orgId, userId: q.userId } },
    create: { organizationId: q.orgId, userId: q.userId, pasoActual: r.pasoClave, resumen: r.resumen, ultimaVez: o.ahora },
    update: { ...(r.pasoClave ? { pasoActual: r.pasoClave } : {}), resumen: r.resumen, ultimaVez: o.ahora },
  });
  return { ok: true, contestacion: c, quedan: quedan - 1 };
}

export async function guardarNotaDe(q: Quien, tipo: unknown, texto: unknown): Promise<R<{ nota: Nota }>> {
  const no = await puedeUsar(q);
  if (no) return { ok: false, error: no };
  const nombres = await gente(q.orgId);
  const r = revisarNota(tipo, typeof texto === "string" ? limpiar(texto, nombres) : texto, await notasDe(q.orgId, nombres), PERFIL.trato);
  if (!r.ok) return r;
  const n = await prisma.consultorNota.create({ data: { organizationId: q.orgId, userId: q.userId, tipo: r.nota.tipo, texto: r.nota.texto } });
  return { ok: true, nota: { id: n.id, tipo: r.nota.tipo, texto: n.texto, autor: nombres.get(q.userId) ?? q.nombre, creadaEn: n.creadaEn.toISOString() } };
}

/** Apaga o enciende una nota: quien la escribio o quien administra. Nunca se borra. */
async function cambiarNota(q: Quien, id: unknown, activa: boolean): Promise<R<{ nota: Nota }>> {
  const no = await puedeUsar(q);
  if (no) return { ok: false, error: no };
  if (typeof id !== "string" || id.length > 40) return { ok: false, error: "Esa nota no existe." };
  const n = await prisma.consultorNota.findFirst({ where: { id, organizationId: q.orgId } });
  if (!n) return { ok: false, error: "Esa nota no existe." };
  if (n.userId !== q.userId && !administra(q)) return { ok: false, error: "Solo quien la escribió o quien administra la empresa puede cambiarla." };
  if (activa && !n.activa && (await prisma.consultorNota.count({ where: { organizationId: q.orgId, activa: true } })) >= LIMITES.notas) {
    return { ok: false, error: `Ya hay ${LIMITES.notas} notas: apague alguna antes.` };
  }
  const x = await prisma.consultorNota.update({ where: { id: n.id }, data: { activa, apagadaEn: activa ? null : new Date() } });
  const nombres = await gente(q.orgId);
  return { ok: true, nota: { id: x.id, tipo: x.tipo as TipoNota, texto: x.texto, autor: nombres.get(x.userId) ?? "Alguien de la empresa", creadaEn: x.creadaEn.toISOString() } };
}

export const apagarNotaDe = (q: Quien, id: unknown) => cambiarNota(q, id, false);
export const restaurarNotaDe = (q: Quien, id: unknown) => cambiarNota(q, id, true);

async function marcarVisto(q: Quien, ahora: Date) {
  await prisma.consultorEstado.upsert({
    where: { organizationId_userId: { organizationId: q.orgId, userId: q.userId } },
    create: { organizationId: q.orgId, userId: q.userId, ultimaVez: ahora },
    update: { ultimaVez: ahora },
  });
}

/** La entrevista de arranque: lo contestado se vuelve nota. */
export async function arrancarDe(q: Quien, respuestas: unknown, ahora: Date): Promise<R<{ notas: Nota[] }>> {
  const no = await puedeUsar(q);
  if (no) return { ok: false, error: no };
  const nombres = await gente(q.orgId);
  const crudas = respuestas && typeof respuestas === "object" ? respuestas as Record<string, unknown> : {};
  const limpias = Object.fromEntries(Object.entries(crudas).map(([k, v]) => [k, typeof v === "string" ? limpiar(v, nombres) : v]));
  const r = notasDeEntrevista(limpias, await notasDe(q.orgId, nombres), PERFIL.trato);
  if (!r.ok) return r;
  const creadas: Nota[] = [];
  for (const n of r.notas) {
    const x = await prisma.consultorNota.create({ data: { organizationId: q.orgId, userId: q.userId, tipo: n.tipo, texto: n.texto } });
    creadas.push({ id: x.id, tipo: n.tipo, texto: x.texto, autor: nombres.get(q.userId) ?? q.nombre, creadaEn: x.creadaEn.toISOString() });
  }
  await marcarVisto(q, ahora);
  return { ok: true, notas: creadas };
}

export async function saltarEntrevistaDe(q: Quien, ahora: Date): Promise<R> {
  const no = await puedeUsar(q);
  if (no) return { ok: false, error: no };
  await marcarVisto(q, ahora);
  return { ok: true };
}

/** Encender o apagar el Consultor en la empresa: solo quien administra. Apagar no borra nada. */
export async function activarConsultorDe(q: Quien, encendido: unknown): Promise<R<{ encendido: boolean }>> {
  if (!administra(q)) return { ok: false, error: "Solo quien administra la empresa puede encender el Consultor." };
  if (q.soloLectura) return { ok: false, error: "La cuenta está en solo lectura." };
  if (typeof encendido !== "boolean") return { ok: false, error: "Valor no válido." };
  await prisma.organization.update({ where: { id: q.orgId }, data: { consultorActivo: encendido } });
  await logAudit({
    organizationId: q.orgId, userId: q.userId, entity: "Organization", entityId: q.orgId, action: "UPDATE",
    summary: encendido ? "Encendió el Consultor del Sistema" : "Apagó el Consultor del Sistema", changes: { consultorActivo: encendido },
  });
  return { ok: true, encendido };
}

/** Borra los mensajes de mas de 180 dias, de todas las empresas. Lo llama Cloud Scheduler; recibe la fecha. */
export async function limpiarMensajes(ahora: Date): Promise<number> {
  const r = await prisma.consultorMensaje.deleteMany({ where: { creadoEn: { lt: limiteDeMensajes(ahora) } } });
  return r.count;
}
