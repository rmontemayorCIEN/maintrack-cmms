import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db";
import { notify } from "./audit";
import { CLAVES_INSTALACION } from "./instalaciones";
import { VERSION_DOCUMENTOS } from "./legal";

/**
 * Solicitudes de demostración y de contratación que llegan del sitio.
 *
 * Lo mínimo para dar seguimiento (no es un CRM): quién, qué empresa, qué le
 * duele, de dónde llegó y en qué quedó. Se pide solo lo necesario; el
 * teléfono es opcional.
 */

import { RANGOS_ACTIVOS } from "./prospectos-catalogo";
export { ESTADOS_PROSPECTO, MOTIVOS_PERDIDA, RANGOS_ACTIVOS, type EstadoProspecto } from "./prospectos-catalogo";

const texto = (min: number, max: number, mensaje: string) => z.string().trim().min(min, mensaje).max(max, `Máximo ${max} caracteres`);

export const esquemaProspecto = z.object({
  tipo: z.enum(["DEMO", "CONTRATACION"]).default("DEMO"),
  nombre: texto(2, 120, "Escriba su nombre"),
  empresa: texto(2, 160, "Escriba el nombre de su empresa"),
  correo: z.string().trim().toLowerCase().email("Escriba un correo válido").max(160),
  telefono: z.string().trim().max(25).regex(/^[\d\s()+-]*$/, "El teléfono solo lleva números").optional().or(z.literal("")),
  tipoInstalacion: z.enum(CLAVES_INSTALACION as [string, ...string[]]).optional().or(z.literal("")),
  rangoActivos: z.enum(RANGOS_ACTIVOS).optional().or(z.literal("")),
  problema: z.string().trim().max(1000, "Máximo 1000 caracteres").optional().or(z.literal("")),
  planInteres: z.enum(["PROFESSIONAL", "ENTERPRISE"]).optional().or(z.literal("")),
  origen: z.string().trim().max(40).regex(/^[\w.-]*$/).optional().or(z.literal("")),
  aceptaPrivacidad: z.literal(true, { errorMap: () => ({ message: "Para enviar hay que aceptar el aviso de privacidad" }) }),
  /** Campo trampa: invisible para una persona; los robots lo llenan. */
  sitioWeb: z.string().max(0).optional().or(z.literal("")),
});
export type DatosProspecto = z.infer<typeof esquemaProspecto>;

/** Tipo + correo + día (hora de México): la misma solicitud repetida el mismo día es un duplicado. */
export function huellaDe(tipo: string, correo: string, cuando = new Date()) {
  const dia = cuando.toLocaleDateString("en-CA", { timeZone: "America/Monterrey" });
  return createHash("sha256").update(`${tipo}|${correo.trim().toLowerCase()}|${dia}`).digest("hex");
}

// Límite por dirección: 5 solicitudes por hora. En memoria: basta contra un
// robot que insiste; el duplicado por huella ya lo cuida la base.
const porIp = new Map<string, number[]>();
export function demasiadas(ip: string, ahora = Date.now()) {
  const recientes = (porIp.get(ip) ?? []).filter((t) => ahora - t < 3_600_000);
  recientes.push(ahora);
  porIp.set(ip, recientes);
  return recientes.length > 5;
}

export async function registrarProspecto(d: DatosProspecto, extra: { organizationId?: string } = {}) {
  const huella = huellaDe(d.tipo, d.correo);
  const ya = await prisma.prospecto.findUnique({ where: { huella } });
  if (ya) return { prospecto: ya, duplicado: true };
  const prospecto = await prisma.prospecto.create({
    data: {
      tipo: d.tipo, nombre: d.nombre, empresa: d.empresa, correo: d.correo,
      telefono: d.telefono || null, tipoInstalacion: d.tipoInstalacion || null, rangoActivos: d.rangoActivos || null,
      problema: d.problema || null, planInteres: d.planInteres || null,
      origen: d.origen || (d.tipo === "CONTRATACION" ? "CONTRATAR" : "SITIO"),
      avisoPrivacidad: VERSION_DOCUMENTOS, huella, organizationId: extra.organizationId ?? null,
    },
  });
  // Aviso al operador de la plataforma, por el canal de siempre.
  const operadores = await prisma.user.findMany({ where: { isSuperAdmin: true, active: true }, select: { id: true, organizationId: true } });
  for (const o of operadores) {
    await notify({
      organizationId: o.organizationId, userId: o.id,
      title: d.tipo === "CONTRATACION" ? `Solicitud de contratación: ${d.empresa}` : `Solicitud de demostración: ${d.empresa}`,
      body: `${d.nombre}${d.rangoActivos ? ` · ${d.rangoActivos} activos` : ""}`,
      link: "/clients/prospectos", kind: "INFO", modulo: "ADMINISTRACION", claveDedup: `prospecto:${prospecto.id}`,
    });
  }
  return { prospecto, duplicado: false };
}
