/**
 * Credenciales de API por empresa.
 *
 * El secreto tiene la forma `mt_<prefijo>_<secreto>`. El prefijo se guarda
 * tal cual (sirve para reconocerla en la lista y para buscarla); del secreto
 * completo solo se guarda su huella SHA-256. Se muestra UNA vez, al crearla o
 * rotarla; después nadie —ni el administrador, ni el operador— puede verlo.
 *
 * La empresa sale de la credencial. Ningún parámetro de la petición la cambia.
 * Revocar corta el acceso en la siguiente petición: cada llamada consulta el
 * estado en la base, no hay caché.
 */
import { prisma } from "../db";
import { logAudit } from "../audit";
import { aleatorio, huella, mismasHuellas } from "./cifrado";
import { ALCANCES, esAlcance, type Alcance } from "./alcances";
import { leerJson } from "../avisos/config";

export class ErrorDeCredencial extends Error {
  constructor(message: string, readonly codigo = 422) {
    super(message);
  }
}

const FORMATO = /^mt_([a-z0-9]{10})_([A-Za-z0-9_-]{32,64})$/;

function nuevoSecreto() {
  const prefijo = aleatorio(12).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10).padEnd(10, "0");
  const secreto = `mt_${prefijo}_${aleatorio(32)}`;
  return { prefijo, secreto, huella: huella(secreto) };
}

export async function crearCredencial(p: {
  organizationId: string; userId: string; nombre: string; alcances: string[]; expiraDias?: number | null; rotadaDeId?: string;
}) {
  const nombre = p.nombre.trim().slice(0, 80);
  if (nombre.length < 3) throw new ErrorDeCredencial("Póngale un nombre que diga qué sistema la usa.");
  const alcances = [...new Set(p.alcances)].filter(esAlcance);
  if (!alcances.length) throw new ErrorDeCredencial("Elija al menos un permiso.");
  const expiraEl = p.expiraDias ? new Date(Date.now() + Math.min(730, Math.max(1, p.expiraDias)) * 86_400_000) : null;
  const s = nuevoSecreto();
  const c = await prisma.credencialApi.create({
    data: {
      organizationId: p.organizationId, nombre, prefijo: s.prefijo, huella: s.huella, alcances: JSON.stringify(alcances),
      expiraEl, creadaPorId: p.userId, rotadaDeId: p.rotadaDeId ?? null,
    },
    select: { id: true, nombre: true, prefijo: true, alcances: true, expiraEl: true, createdAt: true },
  });
  await logAudit({
    organizationId: p.organizationId, userId: p.userId, entity: "CredencialApi", entityId: c.id,
    action: p.rotadaDeId ? "API_KEY_ROTATED" : "API_KEY_CREATED",
    // El secreto nunca va a la bitácora: solo el prefijo y los permisos.
    summary: `${p.rotadaDeId ? "Rotación" : "Alta"} de la credencial «${nombre}» (mt_${s.prefijo}_…)`,
    changes: { alcances, expira: expiraEl?.toISOString() ?? null },
  });
  return { credencial: c, secreto: s.secreto };
}

export async function revocarCredencial(p: { organizationId: string; userId: string; id: string; motivo?: string }) {
  const c = await prisma.credencialApi.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!c) throw new ErrorDeCredencial("Credencial no encontrada", 404);
  if (c.estado === "REVOCADA") return c;
  const r = await prisma.credencialApi.update({
    where: { id: c.id }, data: { estado: "REVOCADA", revocadaEl: new Date(), revocadaPorId: p.userId },
  });
  await logAudit({
    organizationId: p.organizationId, userId: p.userId, entity: "CredencialApi", entityId: c.id, action: "API_KEY_REVOKED",
    summary: `Credencial «${c.nombre}» (mt_${c.prefijo}_…) revocada${p.motivo ? `: ${p.motivo}` : ""}`,
  });
  return r;
}

/** Rotar: una credencial nueva con los mismos permisos; la anterior queda revocada al instante. */
export async function rotarCredencial(p: { organizationId: string; userId: string; id: string }) {
  const c = await prisma.credencialApi.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!c) throw new ErrorDeCredencial("Credencial no encontrada", 404);
  if (c.estado !== "ACTIVA") throw new ErrorDeCredencial("Solo se rota una credencial activa", 409);
  const nueva = await crearCredencial({
    organizationId: p.organizationId, userId: p.userId, nombre: c.nombre, alcances: leerJson<string[]>(c.alcances, []),
    expiraDias: c.expiraEl ? Math.ceil((c.expiraEl.getTime() - c.createdAt.getTime()) / 86_400_000) : null, rotadaDeId: c.id,
  });
  await revocarCredencial({ organizationId: p.organizationId, userId: p.userId, id: c.id, motivo: "rotada" });
  return nueva;
}

export type Identidad = { organizationId: string; credencialId: string; nombre: string; alcances: Alcance[] };

export type Rechazo = { estado: number; codigo: string; mensaje: string; credencialId?: string; organizationId?: string };

/**
 * Quién llama. Revisa formato, huella en tiempo constante, estado, vigencia
 * y que la empresa siga activa. No revisa el alcance: eso depende de la ruta.
 */
export async function identificar(autorizacion: string | null): Promise<Identidad | Rechazo> {
  const token = autorizacion?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return { estado: 401, codigo: "SIN_CREDENCIAL", mensaje: "Falta el encabezado Authorization: Bearer <credencial>." };
  const m = token.match(FORMATO);
  if (!m) return { estado: 401, codigo: "CREDENCIAL_INVALIDA", mensaje: "La credencial no es válida." };
  const c = await prisma.credencialApi.findUnique({
    where: { prefijo: m[1] },
    include: { organization: { select: { status: true } } },
  });
  if (!c || !mismasHuellas(c.huella, huella(token))) {
    return { estado: 401, codigo: "CREDENCIAL_INVALIDA", mensaje: "La credencial no es válida." };
  }
  const base = { credencialId: c.id, organizationId: c.organizationId };
  if (c.estado !== "ACTIVA") return { ...base, estado: 401, codigo: "CREDENCIAL_REVOCADA", mensaje: "La credencial fue revocada." };
  if (c.expiraEl && c.expiraEl.getTime() < Date.now()) return { ...base, estado: 401, codigo: "CREDENCIAL_VENCIDA", mensaje: "La credencial venció." };
  if (!["ACTIVE", "TRIAL"].includes(c.organization.status)) {
    return { ...base, estado: 403, codigo: "EMPRESA_SUSPENDIDA", mensaje: "La cuenta de la empresa no está activa." };
  }
  return { organizationId: c.organizationId, credencialId: c.id, nombre: c.nombre, alcances: leerJson<string[]>(c.alcances, []).filter(esAlcance) };
}

export const nombresDeAlcances = (a: string[]) => a.filter(esAlcance).map((x) => ALCANCES[x]);
