/**
 * Vigencias: garantias, polizas, fianzas, contratos, calibraciones, permisos,
 * licencias y certificados. Un solo objeto (ver el comentario del modelo).
 *
 * ── Un solo punto de escritura ──
 *
 * `guardarVigencia()` es el UNICO lugar donde nace o cambia una vigencia.
 * Valida que cuelgue de exactamente una cosa, que esa cosa sea de la misma
 * empresa, y —cuando es la garantia de un activo— refresca
 * `Asset.warrantyExpiry`.
 *
 * ── Por que `Asset.warrantyExpiry` sigue existiendo ──
 *
 * Esa columna ya estaba, y la leen la lista de activos, la ficha, la
 * exportacion, la importacion y el dialogo de alta. Quitarla habria sido
 * tocar cinco pantallas para no ganar nada, y dejarla como segunda verdad
 * habria sido peor: dos fechas de garantia que se separan.
 *
 * Queda como CACHE, igual que `Part.quantityOnHand` es cache de `PartStock`:
 * la verdad es la Vigencia, y la columna se refresca aqui. Escribirla directo
 * deja la vigencia mintiendo. Si necesita cambiar la garantia de un equipo,
 * pase por aqui.
 */
import { prisma } from "./db";
import { logAudit } from "./audit";
import {
  ANCLAJES, TIPOS_VIGENCIA, diasDeAviso, esTipoVigencia, estadoDeVigencia,
  nombreDeTipo, type Anclaje, type TipoVigencia,
} from "./vigencias-tipos";

/** Regla de vigencias incumplida: es del usuario, no del sistema. */
export class ErrorDeVigencia extends Error {}

export const MAXIMO_TITULO = 160;
const MAXIMO_TEXTO = 2000;

type Anclas = Partial<Record<Anclaje, string | null>>;

/** El modelo de Prisma que corresponde a cada anclaje, para comprobar que existe. */
const DUENO: Record<Anclaje, "asset" | "part" | "user" | "externalService"> = {
  assetId: "asset", partId: "part", userId: "user", serviceId: "externalService",
};

/**
 * De que cuelga, comprobado.
 *
 * Exige exactamente una: ninguna deja una vigencia que no aparece en ningun
 * expediente —viva y sin que nadie la vea—, y dos la harian aparecer en dos,
 * con la duda de cual manda al renovar.
 */
async function anclaValida(orgId: string, anclas: Anclas): Promise<{ campo: Anclaje; id: string }> {
  const puestas = ANCLAJES.filter((a) => anclas[a]);
  if (!puestas.length) {
    throw new ErrorDeVigencia("Diga de qué cuelga: un equipo, una refacción, una persona o un servicio externo.");
  }
  if (puestas.length > 1) {
    throw new ErrorDeVigencia("Una vigencia cuelga de una sola cosa. Si cubre varias, registre una por cada una.");
  }
  const campo = puestas[0];
  const id = anclas[campo]!;
  const modelo = DUENO[campo];
  // La pertenencia a la empresa se comprueba aqui y no en la ruta: un id de
  // otra organizacion tiene que responder «no existe», igual que uno inventado.
  const existe = await (prisma[modelo] as { count: (a: unknown) => Promise<number> })
    .count({ where: { id, organizationId: orgId } });
  if (!existe) throw new ErrorDeVigencia("Eso de lo que quiere colgarla no existe en esta empresa.");
  return { campo, id };
}

function fechasValidas(desde: Date | null, hasta: Date | null) {
  if (desde && hasta && hasta.getTime() < desde.getTime()) {
    throw new ErrorDeVigencia("La fecha de fin no puede ser anterior a la de inicio.");
  }
}

const texto = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
};

/**
 * La garantia que MainTrack ya guardaba en el activo, reflejada.
 *
 * Se toma la garantia activa que cubre mas lejos: un equipo puede tener la de
 * fabrica y la extendida, y la que importa es la que todavia protege.
 */
async function refrescarGarantiaDelActivo(assetId: string) {
  const v = await prisma.vigencia.findFirst({
    where: { assetId, tipo: "GARANTIA", activa: true, hasta: { not: null } },
    orderBy: { hasta: "desc" },
    select: { hasta: true },
  });
  await prisma.asset.update({ where: { id: assetId }, data: { warrantyExpiry: v?.hasta ?? null } });
}

export async function guardarVigencia(params: {
  organizationId: string;
  /** Quien la captura. */
  userId: string;
  /** Nulo para crear una nueva. */
  id?: string | null;
  tipo: string;
  titulo: string;
  folio?: string | null;
  desde?: Date | null;
  hasta?: Date | null;
  avisarDias?: number | null;
  cubre?: string | null;
  nota?: string | null;
  supplierId?: string | null;
  /**
   * De que cuelga, en su propio objeto y NO al nivel de los demas campos.
   *
   * Estuvo plano —`{ ...params, assetId }`— y con eso ninguna vigencia se
   * podia crear: `userId` es quien captura Y tambien el anclaje a una
   * persona, asi que toda alta llegaba con dos anclas y se rechazaba sola.
   * Lo atrapo la primera comprobacion de la prueba. Separado no se puede
   * volver a confundir, y ademas se lee que es ancla y que no.
   */
  cuelgaDe?: Anclas;
}) {
  if (!esTipoVigencia(params.tipo)) throw new ErrorDeVigencia(`Tipo de vigencia desconocido: «${params.tipo}».`);
  const titulo = texto(params.titulo, MAXIMO_TITULO);
  if (!titulo) throw new ErrorDeVigencia("Póngale un nombre: cómo la llaman ustedes.");
  const desde = params.desde ?? null;
  const hasta = params.hasta ?? null;
  fechasValidas(desde, hasta);
  if (params.avisarDias != null && (params.avisarDias < 0 || params.avisarDias > 365)) {
    throw new ErrorDeVigencia("Los días de anticipación van de 0 a 365.");
  }
  if (params.supplierId) {
    const hay = await prisma.supplier.count({ where: { id: params.supplierId, organizationId: params.organizationId } });
    if (!hay) throw new ErrorDeVigencia("Ese proveedor no existe en esta empresa.");
  }

  const datos = {
    tipo: params.tipo,
    titulo,
    folio: texto(params.folio, 60),
    desde, hasta,
    avisarDias: params.avisarDias ?? null,
    cubre: texto(params.cubre, MAXIMO_TEXTO),
    nota: texto(params.nota, MAXIMO_TEXTO),
    supplierId: params.supplierId || null,
  };

  if (params.id) {
    const previa = await prisma.vigencia.findFirst({
      where: { id: params.id, organizationId: params.organizationId },
      select: { id: true, assetId: true, tipo: true, titulo: true, hasta: true },
    });
    if (!previa) throw new ErrorDeVigencia("Esa vigencia no existe en esta empresa.");
    // El anclaje NO se cambia al editar: mover una garantia de un equipo a
    // otro deja el expediente del primero sin explicacion de por que dejo de
    // estar cubierto. Se cancela y se registra donde va.
    const v = await prisma.vigencia.update({ where: { id: previa.id }, data: datos });
    if (previa.assetId && (previa.tipo === "GARANTIA" || params.tipo === "GARANTIA")) {
      await refrescarGarantiaDelActivo(previa.assetId);
    }
    await logAudit({
      organizationId: params.organizationId, userId: params.userId, action: "vigencia.update",
      entity: "Vigencia", entityId: v.id,
      changes: { tipo: v.tipo, titulo: v.titulo, hasta: v.hasta?.toISOString() ?? null, antes: previa.hasta?.toISOString() ?? null },
    });
    return v;
  }

  const ancla = await anclaValida(params.organizationId, params.cuelgaDe ?? {});
  const v = await prisma.vigencia.create({
    data: {
      organizationId: params.organizationId,
      creadoPorId: params.userId,
      [ancla.campo]: ancla.id,
      ...datos,
    },
  });
  if (v.assetId && v.tipo === "GARANTIA") await refrescarGarantiaDelActivo(v.assetId);
  await logAudit({
    organizationId: params.organizationId, userId: params.userId, action: "vigencia.create",
    entity: "Vigencia", entityId: v.id,
    changes: { tipo: v.tipo, titulo: v.titulo, hasta: v.hasta?.toISOString() ?? null, cuelgaDe: ancla.campo },
  });
  return v;
}

/**
 * Cancelar o reactivar. No hay borrado: los avisos que ya salieron quedarian
 * sin explicacion, y una poliza cancelada sigue siendo historia de la planta.
 */
export async function cambiarActivaVigencia(params: {
  organizationId: string; userId: string; id: string; activa: boolean;
}) {
  const previa = await prisma.vigencia.findFirst({
    where: { id: params.id, organizationId: params.organizationId },
    select: { id: true, assetId: true, tipo: true, activa: true },
  });
  if (!previa) throw new ErrorDeVigencia("Esa vigencia no existe en esta empresa.");
  const v = await prisma.vigencia.update({
    where: { id: previa.id },
    data: { activa: params.activa, canceladaEl: params.activa ? null : new Date() },
  });
  if (previa.assetId && previa.tipo === "GARANTIA") await refrescarGarantiaDelActivo(previa.assetId);
  await logAudit({
    organizationId: params.organizationId, userId: params.userId,
    action: params.activa ? "vigencia.reactivar" : "vigencia.cancelar",
    entity: "Vigencia", entityId: v.id, changes: { activa: params.activa },
  });
  return v;
}

const SELECCION = {
  id: true, tipo: true, titulo: true, folio: true, desde: true, hasta: true,
  avisarDias: true, cubre: true, nota: true, activa: true, canceladaEl: true, createdAt: true,
  supplier: { select: { id: true, name: true } },
  asset: { select: { id: true, code: true, name: true } },
  part: { select: { id: true, code: true, name: true } },
  user: { select: { id: true, name: true } },
  service: { select: { id: true, code: true, name: true } },
} as const;

/** Las vigencias de algo, para su expediente. Las canceladas al final. */
export async function vigenciasDe(orgId: string, anclas: Anclas) {
  const campo = ANCLAJES.find((a) => anclas[a]);
  if (!campo) return [];
  const filas = await prisma.vigencia.findMany({
    where: { organizationId: orgId, [campo]: anclas[campo] },
    orderBy: [{ activa: "desc" }, { hasta: "asc" }],
    select: SELECCION,
  });
  return filas;
}

/** Todas las de la empresa, para la pantalla de vigencias. */
export async function listarVigencias(orgId: string, filtro: { tipo?: string; soloActivas?: boolean } = {}) {
  return prisma.vigencia.findMany({
    where: {
      organizationId: orgId,
      ...(filtro.tipo && esTipoVigencia(filtro.tipo) ? { tipo: filtro.tipo } : {}),
      ...(filtro.soloActivas ? { activa: true } : {}),
    },
    orderBy: [{ activa: "desc" }, { hasta: "asc" }],
    select: SELECCION,
  });
}

/**
 * La garantia que cubre a un equipo ahora mismo, si hay.
 *
 * Es la pregunta que vale dinero: cuando llega una falla de un equipo en
 * garantia y nadie la hace, se repara con gente y refacciones propias algo
 * que el proveedor tenia que cubrir. Se contesta con la Vigencia, no con
 * `Asset.warrantyExpiry`, porque la vigencia ademas dice a quien reclamarle y
 * que cubre.
 */
export async function garantiaVigenteDe(orgId: string, assetId: string, ahora: Date = new Date()) {
  const v = await prisma.vigencia.findFirst({
    where: {
      organizationId: orgId, assetId, tipo: "GARANTIA", activa: true,
      hasta: { gte: ahora },
    },
    orderBy: { hasta: "desc" },
    select: { id: true, titulo: true, folio: true, hasta: true, cubre: true, supplier: { select: { id: true, name: true } } },
  });
  return v;
}

/**
 * La advertencia que se le pone enfrente a quien abre una orden correctiva de
 * un equipo en garantia.
 *
 * Se avisa en correctiva, en seguridad y en mejora, no en preventivo: un
 * engrasado programado no se le reclama al proveedor, y avisar ahi habria
 * convertido la advertencia en ruido que se aprende a ignorar —y entonces no
 * sirve el dia que importa—.
 */
export const TIPOS_QUE_SE_RECLAMAN = ["CORRECTIVE", "SAFETY", "IMPROVEMENT"];

export async function advertenciaDeGarantia(
  orgId: string,
  assetId: string | null | undefined,
  tipoMantenimiento: string,
  ahora: Date = new Date(),
): Promise<{ texto: string; vigenciaId: string; hasta: Date | null; proveedor: string | null } | null> {
  if (!assetId || !TIPOS_QUE_SE_RECLAMAN.includes(tipoMantenimiento)) return null;
  const g = await garantiaVigenteDe(orgId, assetId, ahora);
  if (!g) return null;
  const hasta = g.hasta ? g.hasta.toISOString().slice(0, 10) : null;
  const quien = g.supplier?.name ?? null;
  return {
    texto:
      `Este equipo está en garantía${hasta ? ` hasta el ${hasta}` : ""}` +
      `${quien ? ` con ${quien}` : ""}. Antes de repararlo con gente propia, revise si le toca al proveedor` +
      `${g.folio ? ` (${g.folio})` : ""}.`,
    vigenciaId: g.id,
    hasta: g.hasta,
    proveedor: quien,
  };
}

/** Lo que vence pronto o ya vencio, para el proceso de avisos y el inicio. */
export async function vigenciasQueVencen(orgId: string, ahora: Date = new Date()) {
  const filas = await prisma.vigencia.findMany({
    where: { organizationId: orgId, activa: true, hasta: { not: null } },
    select: {
      id: true, tipo: true, titulo: true, folio: true, hasta: true, avisarDias: true,
      supplier: { select: { name: true } },
      // El sitio va para que el aviso llegue a la supervision de esa planta y
      // no a la de todas: `Contexto.siteId` de `lib/avisos/destinatarios.ts`.
      asset: { select: { id: true, code: true, name: true, siteId: true } },
      part: { select: { code: true, name: true } },
      user: { select: { name: true } },
      service: { select: { code: true, name: true } },
    },
  });
  return filas
    .map((v) => ({ ...v, estado: estadoDeVigencia(v, ahora) }))
    .filter((v) => v.estado === "POR_VENCER" || v.estado === "VENCIDA");
}

/** De que cuelga, en una linea, para el texto de un aviso. */
export function deQueCuelga(v: {
  asset?: { code: string; name: string } | null;
  part?: { code: string; name: string } | null;
  user?: { name: string | null } | null;
  service?: { code: string; name: string } | null;
}): string {
  if (v.asset) return `${v.asset.code} · ${v.asset.name}`;
  if (v.part) return `${v.part.code} · ${v.part.name}`;
  if (v.user) return v.user.name ?? "una persona";
  if (v.service) return `${v.service.code} · ${v.service.name}`;
  return "la empresa";
}

/** El nombre completo para un aviso: «Garantía · Garantía de fábrica». */
export const comoSeLlama = (v: { tipo: string; titulo: string }) => `${nombreDeTipo(v.tipo)} · ${v.titulo}`;

export { TIPOS_VIGENCIA, diasDeAviso, estadoDeVigencia, nombreDeTipo };
