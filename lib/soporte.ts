import { z } from "zod";
import { prisma } from "./db";
import { notify } from "./audit";
import { siguienteFolio } from "./numbering";
import { SEVERIDADES, type ClaveSeveridad } from "./comercial";

/**
 * Soporte dentro de MainTrack: el único canal (Bloque 7).
 *
 * El cliente pide ayuda con folio, ve el estado y agrega información; el
 * operador de la plataforma responde desde Empresas cliente › Soporte. Los
 * avisos van por notify(), como todo lo demás.
 */

export const ESTADOS_SOPORTE = {
  RECIBIDA: "Recibida",
  EN_REVISION: "En revisión",
  ESPERANDO_CLIENTE: "Esperando su respuesta",
  RESUELTA: "Resuelta",
  CERRADA: "Cerrada",
} as const;
export type EstadoSoporte = keyof typeof ESTADOS_SOPORTE;

export const esquemaSolicitudSoporte = z.object({
  asunto: z.string().trim().min(5, "Escriba el asunto en pocas palabras").max(140),
  descripcion: z.string().trim().min(10, "Cuente qué intentaba hacer y qué pasó").max(4000),
  severidad: z.enum(SEVERIDADES.map((s) => s.clave) as [ClaveSeveridad, ...ClaveSeveridad[]]).default("MEDIA"),
  pantalla: z.string().trim().max(200).optional().nullable(),
  /** Solo si la persona aceptó adjuntarlos. */
  datosTecnicos: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().nullable(),
});

/** El tiempo objetivo de respuesta que aplica, según severidad y plan. */
export function respuestaObjetivo(severidad: string, plan: string) {
  const s = SEVERIDADES.find((x) => x.clave === severidad) ?? SEVERIDADES[2];
  return s.respuesta[plan === "ENTERPRISE" ? "ENTERPRISE" : "PROFESSIONAL"];
}

async function operadores() {
  return prisma.user.findMany({ where: { isSuperAdmin: true, active: true }, select: { id: true, organizationId: true } });
}

export async function crearSolicitudSoporte(p: { organizationId: string; userId: string; datos: z.infer<typeof esquemaSolicitudSoporte> }) {
  const folio = await siguienteFolio(p.organizationId, "soporte");
  const s = await prisma.solicitudSoporte.create({
    data: {
      organizationId: p.organizationId, userId: p.userId, folio, asunto: p.datos.asunto, descripcion: p.datos.descripcion, severidad: p.datos.severidad,
      pantalla: p.datos.pantalla || null, datosTecnicos: p.datos.datosTecnicos ? JSON.stringify(p.datos.datosTecnicos) : null,
    },
    include: { organization: { select: { name: true, plan: true } } },
  });
  for (const o of await operadores()) {
    await notify({
      organizationId: o.organizationId, userId: o.id, title: `Soporte ${folio} (${SEVERIDADES.find((x) => x.clave === s.severidad)!.nombre}): ${s.organization.name}`,
      body: s.asunto, link: "/clients/soporte", kind: s.severidad === "CRITICA" ? "CRITICAL" : "INFO", modulo: "ADMINISTRACION", claveDedup: `soporte:${s.id}`,
    });
  }
  return { ...s, respuestaObjetivo: respuestaObjetivo(s.severidad, s.organization.plan) };
}

/** Lo que puede hacer el cliente sobre su solicitud: agregar información, subir la severidad, confirmar que se resolvió. */
export async function seguimientoCliente(p: { organizationId: string; userId: string; id: string; nota?: string | null; severidad?: ClaveSeveridad | null; confirmarResuelta?: boolean }) {
  const s = await prisma.solicitudSoporte.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!s) return null;
  if (s.estado === "CERRADA") throw Object.assign(new Error("La solicitud ya está cerrada. Abra una nueva si el problema sigue."), { codigo: 409 });
  const ahora = new Date();
  const orden = SEVERIDADES.map((x) => x.clave);
  const data: Record<string, unknown> = {};
  if (p.nota?.trim()) {
    data.descripcion = `${s.descripcion}\n\n— ${ahora.toLocaleString("es-MX", { timeZone: "America/Monterrey" })}: ${p.nota.trim().slice(0, 2000)}`;
    if (s.estado === "ESPERANDO_CLIENTE") data.estado = "EN_REVISION";
  }
  // Solo se sube (de Baja a Crítica), nunca se baja desde aquí: es el escalamiento.
  if (p.severidad && orden.indexOf(p.severidad) < orden.indexOf(s.severidad as ClaveSeveridad)) data.severidad = p.severidad;
  if (p.confirmarResuelta && s.estado === "RESUELTA") { data.estado = "CERRADA"; data.cerradaAt = ahora; }
  const nueva = await prisma.solicitudSoporte.update({ where: { id: s.id }, data });
  if (data.severidad || data.descripcion) {
    for (const o of await operadores()) {
      await notify({ organizationId: o.organizationId, userId: o.id, title: `Soporte ${s.folio}: ${data.severidad ? "subió su severidad" : "el cliente agregó información"}`, body: s.asunto, link: "/clients/soporte", kind: data.severidad === "CRITICA" ? "CRITICAL" : "INFO", modulo: "ADMINISTRACION" });
    }
  }
  return nueva;
}

/** La respuesta del operador: cambia el estado, deja el texto y avisa a quien la pidió. */
export async function responderSoporte(p: { id: string; operadorId: string; estado: EstadoSoporte; respuesta?: string | null }) {
  const s = await prisma.solicitudSoporte.findUnique({ where: { id: p.id } });
  if (!s) return null;
  const ahora = new Date();
  const nueva = await prisma.solicitudSoporte.update({
    where: { id: s.id },
    data: {
      estado: p.estado, respondidaPorId: p.operadorId,
      ...(p.respuesta?.trim() ? { respuesta: p.respuesta.trim().slice(0, 4000) } : {}),
      ...(!s.primeraRespuestaAt && p.estado !== "RECIBIDA" ? { primeraRespuestaAt: ahora } : {}),
      ...(p.estado === "CERRADA" ? { cerradaAt: ahora } : {}),
    },
  });
  if (s.userId) {
    await notify({
      organizationId: s.organizationId, userId: s.userId, title: `Soporte ${s.folio}: ${ESTADOS_SOPORTE[p.estado].toLowerCase()}`,
      body: p.respuesta?.trim() || s.asunto, link: "/soporte", kind: p.estado === "RESUELTA" ? "SUCCESS" : "INFO", modulo: "ADMINISTRACION",
    });
  }
  return nueva;
}
