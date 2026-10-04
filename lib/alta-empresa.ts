import { prisma } from "./db";
import { hashPassword } from "./auth";
import { iniciarEmpresa } from "./demo";
import { logAudit } from "./audit";
import { slugify } from "./utils";
import type { ModoDeInicio } from "./modos-inicio";
import type { ClavePlan } from "./planes";
import { VERSION_DOCUMENTOS } from "./legal";

/**
 * Dar de alta una empresa: la única vía.
 *
 * La usan el registro público (contratación), el alta que hace el operador
 * desde Empresas cliente y la empresa demostrativa. Antes cada ruta repetía
 * el slug, la prueba, el responsable y el arranque, y ya se habían separado:
 * el registro daba 30 días fijos y el operador otro número.
 */
export class ErrorDeAlta extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}

export type DatosDeAlta = {
  nombre: string;
  giro?: string | null;
  tipoInstalacion?: string | null;
  plan: ClavePlan;
  /** 0 = activa desde el inicio (sin prueba). */
  diasPrueba: number;
  responsable: { nombre: string; correo: string; contrasena: string; puesto?: string };
  modo: ModoDeInicio;
  origen: "REGISTRO" | "OPERADOR" | "DEMO";
  /** Quien ejecuta el arranque (queda en la auditoría). Si falta, el responsable. */
  iniciadoPor?: string;
  /** Aceptación de los documentos: obligatoria en el registro público. */
  aceptoDocumentos?: boolean;
  slug?: string;
  esDemo?: boolean;
};

/** Si la contratación en línea crea la cuenta o solo registra la solicitud. */
export const altaAbierta = () => process.env.ALLOW_PUBLIC_SIGNUP === "true";

export async function slugDisponible(nombre: string) {
  const base = slugify(nombre) || "empresa";
  let slug = base;
  for (let intento = 1; await prisma.organization.findUnique({ where: { slug } }); intento++) slug = `${base}-${intento}`;
  return slug;
}

export async function darDeAltaEmpresa(d: DatosDeAlta) {
  const correo = d.responsable.correo.toLowerCase().trim();
  if (d.origen === "REGISTRO" && !d.aceptoDocumentos) {
    throw new ErrorDeAlta("Para crear la cuenta hay que aceptar los términos y el aviso de privacidad.");
  }
  if (await prisma.user.findUnique({ where: { email: correo } })) {
    throw new ErrorDeAlta("Ese correo ya está registrado en MainTrack.", 409);
  }
  const ahora = new Date();
  const org = await prisma.organization.create({
    data: {
      name: d.nombre.trim(),
      slug: d.slug ?? await slugDisponible(d.nombre),
      industry: d.giro || null,
      tipoInstalacion: d.tipoInstalacion || null,
      plan: d.plan,
      status: d.diasPrueba > 0 ? "TRIAL" : "ACTIVE",
      trialEndsAt: d.diasPrueba > 0 ? new Date(ahora.getTime() + d.diasPrueba * 86_400_000) : null,
      origenAlta: d.origen,
      esDemo: d.esDemo ?? false,
      ...(d.aceptoDocumentos ? { terminosVersion: VERSION_DOCUMENTOS, terminosAceptadosAt: ahora, terminosAceptadosPor: correo } : {}),
    },
  });
  const responsable = await prisma.user.create({
    data: {
      organizationId: org.id, email: correo, name: d.responsable.nombre.trim(),
      passwordHash: await hashPassword(d.responsable.contrasena),
      role: "OWNER", jobTitle: d.responsable.puesto ?? "Dirección",
    },
  });
  await iniciarEmpresa({ organizationId: org.id, userId: d.iniciadoPor ?? responsable.id, modo: d.modo });
  await logAudit({
    organizationId: org.id, userId: d.iniciadoPor ?? responsable.id,
    entity: "Organization", entityId: org.id, action: "ORG_CREATED",
    summary: `Empresa creada (${d.origen === "REGISTRO" ? "contratación en línea" : d.origen === "DEMO" ? "empresa demostrativa" : "alta por MainTrack"})`,
    changes: { modo: d.modo, plan: d.plan, diasPrueba: d.diasPrueba, responsable: responsable.id, documentos: d.aceptoDocumentos ? VERSION_DOCUMENTOS : null },
  });
  return { org, responsable };
}
