/**
 * A quién le toca cada aviso. La matriz, en un solo lugar.
 *
 * Los eventos del catálogo declaran grupos en orden de preferencia
 * (`[["RESPONSABLE"], ["SUPERVISORES"]]`): recibe el primer grupo que tenga a
 * alguien activo. Los siguientes son respaldo, no copia. Así una OT asignada
 * le llega a su responsable y solo si no lo hay —o está desactivado— a los
 * supervisores; y el administrador no termina recibiendo todo.
 *
 * Reglas que valen para todos:
 *
 *  - Solo personas activas de la misma empresa. Nunca de otra.
 *  - Las personas son siempre de la empresa del aviso: el operador de la
 *    plataforma solo es miembro de la suya, y el grupo OPERADORES se usa
 *    únicamente para el estado técnico de la plataforma.
 *  - Quien pidió una compra no la autoriza: no se le avisa como autorizador.
 *  - Los supervisores con sitios de interés reciben lo de sus sitios; si el
 *    filtro deja a nadie, reciben todos (un aviso no se pierde por un filtro).
 *  - Si nadie califica, se devuelve qué falta configurar. El emisor lo
 *    registra y lo convierte en pendiente administrativo: no se descarta.
 */
import { prisma } from "../db";
import { can, type Permission } from "../rbac";
import type { Grupo } from "./catalogo";
import { leerJson } from "./config";

export type Contexto = {
  responsableId?: string | null;
  responsableAnteriorId?: string | null;
  solicitanteId?: string | null;
  usuarioAfectadoId?: string | null;
  warehouseId?: string | null;
  siteId?: string | null;
  /** Personas que no deben recibirlo aunque califiquen (quien pidió no autoriza). */
  excluir?: string[];
};

export type Destinatario = {
  userId: string;
  grupo: Grupo;
  /** Es la única persona que puede actuar: su aviso no se puede apagar. */
  unico: boolean;
};

export type Resolucion = { destinatarios: Destinatario[]; faltante: string | null };

type Persona = { id: string; role: string; sitios: string[] };

const QUE_FALTA: Record<Grupo, string> = {
  RESPONSABLE: "la orden no tiene responsable activo",
  RESPONSABLE_ANTERIOR: "no hay responsable anterior",
  SOLICITANTE: "no se sabe quién lo pidió",
  SUPERVISORES: "no hay ningún supervisor activo",
  REVISORES: "nadie activo puede revisar solicitudes",
  AUTORIZADORES: "nadie activo, distinto de quien pidió, puede autorizar compras",
  ALMACEN: "el almacén no tiene responsable y no hay nadie con rol de compras",
  COMPRAS: "no hay nadie activo con rol de compras",
  ADMINISTRADORES: "no hay destinatarios administrativos activos",
  PROPIETARIO: "la cuenta no tiene dueño activo",
  USUARIO_AFECTADO: "la persona no está activa",
  OPERADORES: "no hay operador de la plataforma",
};

/** Las personas activas de la empresa, con lo que hace falta para decidir. */
async function personasDe(organizationId: string): Promise<Persona[]> {
  const [usuarios, prefs] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId, active: true },
      select: { id: true, role: true },
    }),
    prisma.preferenciaAvisos.findMany({ where: { organizationId }, select: { userId: true, sitios: true } }),
  ]);
  const sitios = new Map(prefs.map((p) => [p.userId, leerJson<string[]>(p.sitios, [])]));
  return usuarios.map((u) => ({ ...u, sitios: sitios.get(u.id) ?? [] }));
}

const conPermiso = (personas: Persona[], permiso: Permission) => personas.filter((p) => can(p.role, permiso));

/** Primero el rol preferido; si no hay nadie con él, cualquiera con la facultad. */
function preferir(personas: Persona[], rol: string, permiso: Permission) {
  const facultados = conPermiso(personas, permiso);
  const preferidos = facultados.filter((p) => p.role === rol);
  return preferidos.length ? preferidos : facultados;
}

function porSitio(personas: Persona[], siteId?: string | null) {
  if (!siteId) return personas;
  const filtradas = personas.filter((p) => !p.sitios.length || p.sitios.includes(siteId));
  return filtradas.length ? filtradas : personas;
}

async function miembrosDe(
  grupo: Grupo, organizationId: string, personas: Persona[], ctx: Contexto,
): Promise<string[]> {
  const activa = (id?: string | null) => (id && personas.some((p) => p.id === id) ? [id] : []);
  switch (grupo) {
    case "RESPONSABLE": return activa(ctx.responsableId);
    case "RESPONSABLE_ANTERIOR": return activa(ctx.responsableAnteriorId);
    case "SOLICITANTE": return activa(ctx.solicitanteId);
    case "USUARIO_AFECTADO": return activa(ctx.usuarioAfectadoId);
    case "SUPERVISORES":
      return porSitio(personas.filter((p) => p.role === "SUPERVISOR"), ctx.siteId).map((p) => p.id);
    case "REVISORES":
      return porSitio(preferir(personas, "SUPERVISOR", "request:review"), ctx.siteId).map((p) => p.id);
    case "AUTORIZADORES":
      return conPermiso(personas, "purchase:authorize").map((p) => p.id);
    case "COMPRAS":
      return personas.filter((p) => p.role === "COMPRAS").map((p) => p.id);
    case "ALMACEN": {
      const almacen = ctx.warehouseId
        ? await prisma.warehouse.findFirst({ where: { id: ctx.warehouseId, organizationId }, select: { responsableId: true } })
        : null;
      return [...new Set([...activa(almacen?.responsableId), ...personas.filter((p) => p.role === "COMPRAS").map((p) => p.id)])];
    }
    case "ADMINISTRADORES": {
      const cfg = await prisma.configAvisos.findUnique({ where: { organizationId }, select: { destinatariosAdmin: true } });
      const elegidos = leerJson<string[]>(cfg?.destinatariosAdmin, []).filter((id) => personas.some((p) => p.id === id));
      if (elegidos.length) return elegidos;
      return personas.filter((p) => p.role === "OWNER" || p.role === "ADMIN").map((p) => p.id);
    }
    case "PROPIETARIO":
      return personas.filter((p) => p.role === "OWNER").map((p) => p.id);
    case "OPERADORES":
      return (await prisma.user.findMany({ where: { isSuperAdmin: true, active: true }, select: { id: true } })).map((u) => u.id);
  }
}

/**
 * Resuelve la cadena de grupos: el primero con alguien recibe. `todos` junta
 * los grupos de un mismo eslabón (["SUPERVISORES","ADMINISTRADORES"] = ambos).
 */
export async function resolverDestinatarios(
  organizationId: string, cadena: Grupo[][], ctx: Contexto = {},
): Promise<Resolucion> {
  if (!cadena.length) return { destinatarios: [], faltante: null };
  const personas = await personasDe(organizationId);
  const excluir = new Set(ctx.excluir ?? []);
  const faltas: string[] = [];

  for (const eslabon of cadena) {
    const vistos = new Map<string, Destinatario>();
    for (const grupo of eslabon) {
      let ids = await miembrosDe(grupo, organizationId, personas, ctx);
      ids = ids.filter((id) => !excluir.has(id));
      if (!ids.length) { faltas.push(QUE_FALTA[grupo]); continue; }
      for (const id of ids) if (!vistos.has(id)) vistos.set(id, { userId: id, grupo, unico: false });
    }
    if (vistos.size) {
      const destinatarios = [...vistos.values()];
      // Único que puede actuar: su aviso es obligatorio aunque el tipo sea configurable.
      if (destinatarios.length === 1) destinatarios[0].unico = true;
      return { destinatarios, faltante: null };
    }
  }
  return { destinatarios: [], faltante: [...new Set(faltas)].join("; ") };
}
