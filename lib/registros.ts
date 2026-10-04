/**
 * Registros propios: las tablas que arma el cliente.
 *
 * Un solo lugar decide que es una tabla valida, quien puede capturar en ella y
 * como se lee lo capturado. Las pantallas y la API llaman aqui; ninguna de las
 * dos arma consultas por su cuenta.
 *
 * Lo que este modulo cuida y no se puede saltar:
 *
 * - **Cada empresa ve solo lo suyo.** Toda consulta filtra por
 *   `organizationId`, incluidas las que resuelven una referencia: un `refId`
 *   que llega en el cuerpo de una peticion es texto que manda el navegador, y
 *   sin acotar por empresa apuntaria al equipo de otra cuenta. Ese defecto ya
 *   ocurrio en este proyecto (`recuperarSeguimiento`) y era una fuga real.
 * - **El permiso de captura es de la tabla, no de la ruta.** `withAuth` recibe
 *   un permiso fijo en el codigo y aqui es un dato, asi que las rutas de
 *   escritura pasan `null` y llaman a `revisarCaptura()`. Eso obliga a
 *   repetir aqui el control comercial que `withAuth` hace cuando el permiso no
 *   es nulo: sin el, una cuenta suspendida podria seguir capturando por esta
 *   puerta. Es la unica razon por la que este modulo sabe de suscripciones.
 * - **Los limites.** Doce tablas por empresa, veinticuatro campos por tabla.
 *   Estan en `lib/registros-tipos.ts` y se revisan al crear, no al pintar.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { can, type Permission } from "./rbac";
import { estadoSuscripcion } from "./planes";
import { logAudit } from "./audit";
import { plantillaDe } from "./registros-plantillas";
import {
  LIMITES, claveDesde, claveLibre, esNumerico, esPermisoDeTabla, interpretarValor,
  llaveDeCampo, opcionesDe, problemasDeDefinicion, puedeVerTabla, textoDeOpciones,
  textoDeRoles, valorCrudo, type Llave, type ValorTipado,
} from "./registros-tipos";

/**
 * Se reexportan desde aqui lo que vive en `registros-tipos.ts`.
 *
 * Quien trabaja en este modulo busca «los permisos de una tabla» aqui, no en
 * el archivo de tipos; y lo que de verdad importa es que los COMPONENTES DE
 * CLIENTE los importen del archivo de tipos, porque importarlos de aqui
 * arrastraria prisma al navegador.
 */
export {
  PERMISOS_DE_TABLA, SEPARADOR_ROLES, esPermisoDeTabla, puedeVerTabla, rolesDe, textoDeRoles,
} from "./registros-tipos";

/**
 * Cuantos renglones se traen de un golpe.
 *
 * Los valores viven en renglones propios (un renglon por campo), asi que una
 * tabla de doce campos son doce veces mas filas de las que se ven. Mil
 * renglones son doce mil filas: es el punto donde todavia se arma la pantalla
 * de un jalon. Pasando de ahi se avisa en pantalla en vez de tardar y no
 * decir por que.
 */
export const LIMITE_RENGLONES = 1000;

/**
 * Transacciones con limite explicito.
 *
 * El limite por omision de Prisma son 5 segundos, que alcanzan de sobra en el
 * SQLite local y NO alcanzan contra PostgreSQL con latencia de red. Se
 * aprendio dejando una demo a medias: la misma operacion corrio bien por la
 * mañana y murio por la tarde. Mismo criterio que `lib/medidores.ts`,
 * `lib/lotes.ts` e `importacion-motor.ts`.
 */
const LIMITE_TRANSACCION = { timeout: 60_000, maxWait: 20_000 };

// ─────────────────────────────────────────── Quien ve y quien captura

/**
 * ¿Puede capturar aqui? Devuelve el motivo en español cuando no.
 *
 * Revisa las tres cosas, en el orden en que importan: que la tabla este viva,
 * que el rol tenga el permiso que ELLA pide, y que la cuenta no este en solo
 * lectura por asunto comercial.
 */
export function revisarCaptura(
  user: { role?: string; isSuperAdmin?: boolean; organization: { status: string; plan: string; trialEndsAt: Date | null } },
  tabla: { nombre: string; permiso: string; activa: boolean },
): { ok: true } | { ok: false; motivo: string; estado: number } {
  if (!tabla.activa) {
    return { ok: false, motivo: `«${tabla.nombre}» está apagada: se puede consultar, no capturar.`, estado: 409 };
  }
  if (!user.isSuperAdmin && !can(user.role, tabla.permiso as Permission)) {
    return { ok: false, motivo: "Sin permisos suficientes para capturar en esta tabla.", estado: 403 };
  }
  if (!user.isSuperAdmin) {
    const suscripcion = estadoSuscripcion(user.organization);
    if (suscripcion.soloLectura) return { ok: false, motivo: suscripcion.motivo!, estado: 402 };
  }
  return { ok: true };
}

// ─────────────────────────────────────────── Los catalogos a los que se apunta

type Catalogo = {
  titulo: string;
  /** Devuelve etiqueta legible por id, SIEMPRE acotado a la empresa. */
  buscar: (orgId: string, ids: string[]) => Promise<Array<{ id: string; etiqueta: string }>>;
  /** Para ofrecer opciones al capturar. */
  listar: (orgId: string) => Promise<Array<{ id: string; etiqueta: string }>>;
};

const conCodigo = (x: { id: string; code: string | null; name: string }) => ({
  id: x.id,
  etiqueta: x.code ? `${x.code} — ${x.name}` : x.name,
});

/**
 * Como se resuelve cada llave. El `where` lleva `organizationId` sin
 * excepcion: el `refId` llega del navegador y sin acotar apuntaria al equipo
 * de otra empresa.
 */
export const CATALOGOS: Record<Llave, Catalogo> = {
  asset: {
    titulo: "Equipos",
    buscar: async (orgId, ids) =>
      (await prisma.asset.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, code: true, name: true } })).map(conCodigo),
    listar: async (orgId) =>
      (await prisma.asset.findMany({ where: { organizationId: orgId, active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } })).map(conCodigo),
  },
  part: {
    titulo: "Refacciones",
    buscar: async (orgId, ids) =>
      (await prisma.part.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, code: true, name: true } })).map(conCodigo),
    listar: async (orgId) =>
      (await prisma.part.findMany({ where: { organizationId: orgId, active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } })).map(conCodigo),
  },
  user: {
    titulo: "Personal",
    buscar: async (orgId, ids) =>
      (await prisma.user.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, name: true } })).map((u) => ({ id: u.id, etiqueta: u.name })),
    listar: async (orgId) =>
      (await prisma.user.findMany({ where: { organizationId: orgId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })).map((u) => ({ id: u.id, etiqueta: u.name })),
  },
  location: {
    titulo: "Ubicaciones",
    buscar: async (orgId, ids) =>
      (await prisma.location.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, code: true, name: true } })).map(conCodigo),
    listar: async (orgId) =>
      (await prisma.location.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } })).map(conCodigo),
  },
  site: {
    titulo: "Sitios",
    buscar: async (orgId, ids) =>
      (await prisma.site.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, code: true, name: true } })).map(conCodigo),
    listar: async (orgId) =>
      (await prisma.site.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } })).map(conCodigo),
  },
  supplier: {
    titulo: "Proveedores",
    buscar: async (orgId, ids) =>
      (await prisma.supplier.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, name: true } })).map((s) => ({ id: s.id, etiqueta: s.name })),
    listar: async (orgId) =>
      (await prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } })).map((s) => ({ id: s.id, etiqueta: s.name })),
  },
  centroDeCosto: {
    titulo: "Centros de costo",
    buscar: async (orgId, ids) =>
      (await prisma.centroDeCosto.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, code: true, name: true } })).map(conCodigo),
    listar: async (orgId) =>
      (await prisma.centroDeCosto.findMany({ where: { organizationId: orgId, active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } })).map(conCodigo),
  },
  workOrder: {
    titulo: "Órdenes de trabajo",
    buscar: async (orgId, ids) =>
      (await prisma.workOrder.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, number: true, title: true } }))
        .map((o) => ({ id: o.id, etiqueta: `${o.number} — ${o.title}` })),
    listar: async (orgId) =>
      (await prisma.workOrder.findMany({ where: { organizationId: orgId }, select: { id: true, number: true, title: true }, orderBy: { createdAt: "desc" }, take: 300 }))
        .map((o) => ({ id: o.id, etiqueta: `${o.number} — ${o.title}` })),
  },
};

/** Las opciones de cada campo llave de una tabla, para los selectores. */
export async function opcionesDeLlaves(orgId: string, campos: Array<{ tipo: string }>) {
  const llaves = [...new Set(campos.map((c) => llaveDeCampo(c.tipo)).filter((l): l is Llave => Boolean(l)))];
  const pares = await Promise.all(llaves.map(async (l) => [l, await CATALOGOS[l].listar(orgId)] as const));
  return Object.fromEntries(pares) as Partial<Record<Llave, Array<{ id: string; etiqueta: string }>>>;
}

/** Resuelve muchos ids de varias llaves en una sola pasada por catalogo. */
async function resolverReferencias(orgId: string, pares: Array<{ llave: Llave; refId: string }>) {
  const porLlave = new Map<Llave, Set<string>>();
  for (const { llave, refId } of pares) {
    if (!refId) continue;
    if (!porLlave.has(llave)) porLlave.set(llave, new Set());
    porLlave.get(llave)!.add(refId);
  }
  const mapa = new Map<string, string>();
  await Promise.all(
    [...porLlave].map(async ([llave, ids]) => {
      const filas = await CATALOGOS[llave].buscar(orgId, [...ids]);
      for (const f of filas) mapa.set(`${llave}:${f.id}`, f.etiqueta);
    }),
  );
  return mapa;
}

// ─────────────────────────────────────────── Leer la definicion

/** Los campos vivos de una tabla, en el orden en que se armaron. */
const CAMPOS_ORDENADOS = {
  where: { activo: true },
  orderBy: [{ orden: "asc" as const }, { createdAt: "asc" as const }],
};

export type CampoDeTabla = {
  id: string;
  clave: string;
  etiqueta: string;
  tipo: string;
  descripcion: string | null;
  requerido: boolean;
  opciones: string | null;
  enLista: boolean;
  orden: number;
};

export type TablaConCampos = {
  id: string;
  clave: string;
  nombre: string;
  descripcion: string;
  icono: string | null;
  permiso: string;
  rolesVer: string;
  plantilla: string | null;
  activa: boolean;
  orden: number;
  campos: CampoDeTabla[];
};

/**
 * Las tablas de la empresa. `rol` las filtra a lo que esa persona ve; sin rol
 * devuelve todas, que es lo que necesita la pantalla de configuracion.
 */
export async function listarTablas(
  orgId: string,
  opciones: { rol?: string; esSuperAdmin?: boolean; incluirApagadas?: boolean } = {},
) {
  const filas = await prisma.tablaPropia.findMany({
    where: { organizationId: orgId, ...(opciones.incluirApagadas ? {} : { activa: true }) },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    include: {
      campos: CAMPOS_ORDENADOS,
      _count: { select: { renglones: { where: { activo: true } } } },
    },
  });
  const visibles = opciones.rol || opciones.esSuperAdmin
    ? filas.filter((t) => puedeVerTabla(opciones.rol, t, { esSuperAdmin: opciones.esSuperAdmin }))
    : filas;
  return visibles.map((t) => ({ ...t, renglones: t._count.renglones }));
}

export async function tablaPorClave(orgId: string, clave: string): Promise<TablaConCampos | null> {
  return prisma.tablaPropia.findFirst({
    where: { organizationId: orgId, clave },
    include: { campos: CAMPOS_ORDENADOS },
  });
}

export async function tablaPorId(orgId: string, id: string): Promise<TablaConCampos | null> {
  // Acotado por empresa aunque el id sea unico: un id que llega del navegador
  // no prueba de quien es.
  return prisma.tablaPropia.findFirst({
    where: { organizationId: orgId, id },
    include: { campos: CAMPOS_ORDENADOS },
  });
}

// ─────────────────────────────────────────── Armar una tabla

export type CampoNuevo = {
  etiqueta: string;
  tipo: string;
  descripcion?: string | null;
  requerido?: boolean;
  opciones?: string[] | string | null;
  enLista?: boolean;
};

export type TablaNueva = {
  nombre: string;
  descripcion: string;
  icono?: string | null;
  permiso?: string;
  rolesVer?: string[] | string;
  plantilla?: string | null;
  campos: CampoNuevo[];
};

const comoTexto = (v: string[] | string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? textoDeOpciones(v) : v;
};

export type Resultado<T> = { ok: true; dato: T } | { ok: false; motivos: string[] };

/**
 * Da de alta una tabla con sus campos.
 *
 * Devuelve TODOS los problemas juntos y no el primero: quien arma una tabla de
 * doce campos no merece descubrir los errores de uno en uno.
 */
export async function crearTabla(orgId: string, datos: TablaNueva, userId?: string | null): Promise<Resultado<TablaConCampos>> {
  const problemas = problemasDeDefinicion({
    nombre: datos.nombre,
    descripcion: datos.descripcion,
    campos: datos.campos.map((c) => ({ etiqueta: c.etiqueta, tipo: c.tipo, opciones: comoTexto(c.opciones) })),
  });

  const permiso = datos.permiso ?? "workorder:execute";
  if (!esPermisoDeTabla(permiso)) problemas.push("El permiso elegido no es uno de los que puede gobernar una tabla.");

  const vivas = await prisma.tablaPropia.count({ where: { organizationId: orgId, activa: true } });
  if (vivas >= LIMITES.tablasPorEmpresa) {
    problemas.push(
      `Ya hay ${vivas} tablas activas y el límite es ${LIMITES.tablasPorEmpresa}. Apague una que ya no use: lo capturado en ella se conserva.`,
    );
  }
  if (problemas.length) return { ok: false, motivos: problemas };

  const usadas = (await prisma.tablaPropia.findMany({ where: { organizationId: orgId }, select: { clave: true } })).map((t) => t.clave);
  const clave = claveLibre(claveDesde(datos.nombre), usadas);

  const claves = new Set<string>();
  const campos = datos.campos.map((c, i) => {
    const claveCampo = claveLibre(claveDesde(c.etiqueta), claves);
    claves.add(claveCampo);
    return {
      clave: claveCampo,
      etiqueta: c.etiqueta.trim(),
      tipo: c.tipo,
      descripcion: c.descripcion?.trim() || null,
      requerido: Boolean(c.requerido),
      opciones: comoTexto(c.opciones),
      enLista: c.enLista ?? true,
      orden: i,
    };
  });

  const tabla = await prisma.tablaPropia.create({
    data: {
      organizationId: orgId,
      clave,
      nombre: datos.nombre.trim(),
      descripcion: datos.descripcion.trim(),
      icono: datos.icono ?? null,
      permiso,
      rolesVer: Array.isArray(datos.rolesVer) ? textoDeRoles(datos.rolesVer) : (datos.rolesVer ?? "OWNER,ADMIN,SUPERVISOR,TECHNICIAN,VIEWER"),
      plantilla: datos.plantilla ?? null,
      creadoPorId: userId ?? null,
      campos: { create: campos },
    },
    include: { campos: CAMPOS_ORDENADOS },
  });

  await logAudit({
    organizationId: orgId, userId: userId ?? undefined, action: "CREATE",
    entity: "TablaPropia", entityId: tabla.id,
    changes: { nombre: tabla.nombre, campos: campos.length, plantilla: tabla.plantilla },
  });

  return { ok: true, dato: tabla };
}

/** Arma una tabla a partir de una plantilla, tal cual o ya ajustada. */
export async function crearDePlantilla(orgId: string, clavePlantilla: string, userId?: string | null): Promise<Resultado<TablaConCampos>> {
  const plantilla = plantillaDe(clavePlantilla);
  if (!plantilla) return { ok: false, motivos: [`No existe la plantilla «${clavePlantilla}».`] };
  return crearTabla(orgId, {
    nombre: plantilla.nombre,
    descripcion: plantilla.descripcion,
    icono: plantilla.icono,
    plantilla: plantilla.clave,
    campos: plantilla.campos.map((c) => ({
      etiqueta: c.etiqueta, tipo: c.tipo, requerido: c.requerido,
      opciones: c.opciones ?? null, enLista: c.enLista ?? true,
    })),
  }, userId);
}

export async function actualizarTabla(
  orgId: string,
  tablaId: string,
  cambios: { nombre?: string; descripcion?: string; permiso?: string; rolesVer?: string[] | string; icono?: string | null; orden?: number; activa?: boolean },
  userId?: string | null,
): Promise<Resultado<TablaConCampos>> {
  const tabla = await tablaPorId(orgId, tablaId);
  if (!tabla) return { ok: false, motivos: ["Esa tabla no existe en esta empresa."] };

  const problemas: string[] = [];
  const nombre = cambios.nombre?.trim();
  const descripcion = cambios.descripcion?.trim();
  if (cambios.nombre !== undefined && !nombre) problemas.push("El nombre no puede quedar vacío.");
  if (nombre && nombre.length > LIMITES.largoNombre) problemas.push(`El nombre admite hasta ${LIMITES.largoNombre} caracteres.`);
  if (cambios.descripcion !== undefined && !descripcion) problemas.push("La explicación de para qué es la tabla no puede quedar vacía: la lee la ayuda y la IA.");
  if (descripcion && descripcion.length > LIMITES.largoDescripcion) problemas.push(`La explicación admite hasta ${LIMITES.largoDescripcion} caracteres.`);
  if (cambios.permiso !== undefined && !esPermisoDeTabla(cambios.permiso)) problemas.push("El permiso elegido no es uno de los que puede gobernar una tabla.");
  if (problemas.length) return { ok: false, motivos: problemas };

  // La CLAVE no se toca al renombrar: es la direccion de la pantalla y la
  // referencia de lo ya capturado. Renombrar «Bitacora de diesel» a
  // «Combustible» cambia el titulo, no la liga que alguien ya guardo.
  const dato = await prisma.tablaPropia.update({
    where: { id: tabla.id },
    data: {
      ...(nombre ? { nombre } : {}),
      ...(descripcion ? { descripcion } : {}),
      ...(cambios.permiso ? { permiso: cambios.permiso } : {}),
      ...(cambios.rolesVer !== undefined ? { rolesVer: Array.isArray(cambios.rolesVer) ? textoDeRoles(cambios.rolesVer) : cambios.rolesVer } : {}),
      ...(cambios.icono !== undefined ? { icono: cambios.icono } : {}),
      ...(cambios.orden !== undefined ? { orden: cambios.orden } : {}),
      ...(cambios.activa !== undefined ? { activa: cambios.activa } : {}),
    },
    include: { campos: CAMPOS_ORDENADOS },
  });

  await logAudit({
    organizationId: orgId, userId: userId ?? undefined,
    action: cambios.activa === false ? "DELETE" : "UPDATE",
    entity: "TablaPropia", entityId: tabla.id, changes: cambios as Record<string, unknown>,
  });
  return { ok: true, dato };
}

export async function agregarCampo(orgId: string, tablaId: string, campo: CampoNuevo, userId?: string | null): Promise<Resultado<CampoDeTabla>> {
  const tabla = await tablaPorId(orgId, tablaId);
  if (!tabla) return { ok: false, motivos: ["Esa tabla no existe en esta empresa."] };

  const problemas = problemasDeDefinicion({
    nombre: tabla.nombre, descripcion: tabla.descripcion,
    campos: [...tabla.campos, { etiqueta: campo.etiqueta, tipo: campo.tipo, opciones: comoTexto(campo.opciones) }],
  });
  if (tabla.campos.length + 1 > LIMITES.camposPorTabla) {
    problemas.push(`«${tabla.nombre}» ya tiene ${tabla.campos.length} campos y el límite es ${LIMITES.camposPorTabla}.`);
  }
  if (problemas.length) return { ok: false, motivos: problemas };

  // Las claves apagadas tambien cuentan: su columna guarda valores y reusar la
  // clave los mezclaria con los del campo nuevo.
  const usadas = (await prisma.campoPropio.findMany({ where: { tablaId: tabla.id }, select: { clave: true } })).map((c) => c.clave);
  const dato = await prisma.campoPropio.create({
    data: {
      tablaId: tabla.id,
      clave: claveLibre(claveDesde(campo.etiqueta), usadas),
      etiqueta: campo.etiqueta.trim(),
      tipo: campo.tipo,
      descripcion: campo.descripcion?.trim() || null,
      requerido: Boolean(campo.requerido),
      opciones: comoTexto(campo.opciones),
      enLista: campo.enLista ?? true,
      orden: tabla.campos.length,
    },
  });

  await logAudit({
    organizationId: orgId, userId: userId ?? undefined, action: "CREATE",
    entity: "CampoPropio", entityId: dato.id, changes: { tabla: tabla.nombre, etiqueta: dato.etiqueta, tipo: dato.tipo },
  });
  return { ok: true, dato };
}

/**
 * Cambia un campo. El TIPO no se cambia, y no es pereza.
 *
 * Los valores viven en la columna que corresponde al tipo: un numero en
 * `numero`, una fecha en `fecha`. Cambiar el tipo de un campo con datos deja
 * todo lo capturado en la columna de antes, o sea invisible, y la columna se
 * ve vacia sin un solo mensaje de error. Es exactamente el defecto que calla.
 * Quien necesita otro tipo agrega un campo nuevo: lo viejo sigue legible.
 */
export async function actualizarCampo(
  orgId: string,
  campoId: string,
  cambios: { etiqueta?: string; descripcion?: string | null; requerido?: boolean; opciones?: string[] | string | null; enLista?: boolean; orden?: number; activo?: boolean },
  userId?: string | null,
  /** La tabla a la que tiene que pertenecer el campo. Ver `actualizarRenglon`. */
  tablaId?: string,
): Promise<Resultado<CampoDeTabla>> {
  const campo = await prisma.campoPropio.findFirst({
    where: { id: campoId, tabla: { organizationId: orgId }, ...(tablaId ? { tablaId } : {}) },
    include: { tabla: { select: { id: true, nombre: true } } },
  });
  if (!campo) return { ok: false, motivos: ["Ese campo no existe en esta tabla."] };

  const problemas: string[] = [];
  const etiqueta = cambios.etiqueta?.trim();
  if (cambios.etiqueta !== undefined && !etiqueta) problemas.push("El campo necesita nombre.");
  if (etiqueta && etiqueta.length > LIMITES.largoNombre) problemas.push(`«${etiqueta}» admite hasta ${LIMITES.largoNombre} caracteres.`);

  if (cambios.opciones !== undefined && campo.tipo === "LISTA") {
    const nuevas = opcionesDe(comoTexto(cambios.opciones));
    if (nuevas.length < 2) problemas.push("Una lista necesita al menos dos opciones.");
    if (nuevas.length > LIMITES.opcionesPorLista) problemas.push(`Una lista admite hasta ${LIMITES.opcionesPorLista} opciones.`);

    // Quitar una opcion que ya se uso deja renglones con un valor que la lista
    // ya no ofrece. No se prohibe —las operaciones cambian— pero se avisa,
    // porque el efecto es que esos renglones ya no se pueden reeditar igual.
    const enUso = await prisma.valorPropio.findMany({
      where: { campoId: campo.id, texto: { not: null } },
      select: { texto: true }, distinct: ["texto"],
    });
    const perdidas = enUso.map((v) => v.texto!).filter((t) => !nuevas.includes(t));
    if (perdidas.length) {
      problemas.push(
        `Estas opciones ya están capturadas en algún renglón y no vienen en la lista nueva: ${perdidas.join(", ")}. Déjelas en la lista, o renombre el campo y arme uno nuevo.`,
      );
    }
  }
  if (problemas.length) return { ok: false, motivos: problemas };

  const dato = await prisma.campoPropio.update({
    where: { id: campo.id },
    data: {
      ...(etiqueta ? { etiqueta } : {}),
      ...(cambios.descripcion !== undefined ? { descripcion: cambios.descripcion?.trim() || null } : {}),
      ...(cambios.requerido !== undefined ? { requerido: cambios.requerido } : {}),
      ...(cambios.opciones !== undefined ? { opciones: comoTexto(cambios.opciones) } : {}),
      ...(cambios.enLista !== undefined ? { enLista: cambios.enLista } : {}),
      ...(cambios.orden !== undefined ? { orden: cambios.orden } : {}),
      ...(cambios.activo !== undefined ? { activo: cambios.activo } : {}),
    },
  });

  await logAudit({
    organizationId: orgId, userId: userId ?? undefined,
    action: cambios.activo === false ? "DELETE" : "UPDATE",
    entity: "CampoPropio", entityId: campo.id,
    changes: { tabla: campo.tabla.nombre, ...cambios } as Record<string, unknown>,
  });
  return { ok: true, dato };
}

// ─────────────────────────────────────────── Capturar

/**
 * Interpreta lo que llego del formulario y valida las referencias.
 *
 * Las referencias se comprueban CONTRA LA BASE y acotadas a la empresa: un
 * `refId` es texto que manda el navegador, y sin esta revision un id de otra
 * cuenta entraria sin ruido y la pantalla pintaria «ya no existe» sin que
 * nadie entendiera por que.
 */
async function prepararValores(
  orgId: string,
  campos: CampoDeTabla[],
  crudos: Record<string, unknown>,
): Promise<Resultado<Array<{ campoId: string; valor: ValorTipado }>>> {
  const motivos: string[] = [];
  const listos: Array<{ campoId: string; valor: ValorTipado }> = [];
  const aVerificar: Array<{ llave: Llave; refId: string; etiqueta: string }> = [];

  for (const campo of campos) {
    const r = interpretarValor(campo, crudos[campo.clave]);
    if (!r.ok) { motivos.push(r.motivo); continue; }
    listos.push({ campoId: campo.id, valor: r.valor });
    const llave = llaveDeCampo(campo.tipo);
    if (llave && r.valor.refId) aVerificar.push({ llave, refId: r.valor.refId, etiqueta: campo.etiqueta });
  }

  if (aVerificar.length) {
    const mapa = await resolverReferencias(orgId, aVerificar);
    for (const v of aVerificar) {
      if (!mapa.has(`${v.llave}:${v.refId}`)) {
        motivos.push(`Lo que se eligió en «${v.etiqueta}» no existe en esta empresa.`);
      }
    }
  }

  if (motivos.length) return { ok: false, motivos };
  return { ok: true, dato: listos };
}

const aDatosDeValor = (v: ValorTipado) => ({
  texto: v.texto, numero: v.numero, fecha: v.fecha, booleano: v.booleano, refId: v.refId,
});

/** Un renglon nuevo. El folio se toma dentro de la transaccion, como los demas del sistema. */
export async function guardarRenglon(
  orgId: string,
  tablaId: string,
  crudos: Record<string, unknown>,
  userId?: string | null,
): Promise<Resultado<{ id: string; folio: number }>> {
  const tabla = await tablaPorId(orgId, tablaId);
  if (!tabla) return { ok: false, motivos: ["Esa tabla no existe en esta empresa."] };
  if (!tabla.campos.length) return { ok: false, motivos: ["Esa tabla todavía no tiene campos."] };

  const preparados = await prepararValores(orgId, tabla.campos, crudos);
  if (!preparados.ok) return preparados;

  // Un renglon sin un solo dato no se guarda: seria ruido que despues alguien
  // tiene que depurar sin saber de donde salio.
  const conDato = preparados.dato.filter((v) => Object.values(aDatosDeValor(v.valor)).some((x) => x !== null));
  if (!conDato.length) return { ok: false, motivos: ["No se capturó nada en el renglón."] };

  const creado = await prisma.$transaction(async (tx) => {
    // El incremento va en el UPDATE y no en una lectura seguida de escritura:
    // dos capturas simultaneas obtendrian el mismo folio.
    const t = await tx.tablaPropia.update({
      where: { id: tabla.id },
      data: { consecutivo: { increment: 1 } },
      select: { consecutivo: true },
    });
    return tx.renglonPropio.create({
      data: {
        organizationId: orgId,
        tablaId: tabla.id,
        folio: t.consecutivo,
        creadoPorId: userId ?? null,
        valores: { create: conDato.map((v) => ({ campoId: v.campoId, ...aDatosDeValor(v.valor) })) },
      },
      select: { id: true, folio: true },
    });
  }, LIMITE_TRANSACCION);

  await logAudit({
    organizationId: orgId, userId: userId ?? undefined, action: "CREATE",
    entity: "RenglonPropio", entityId: creado.id, changes: { tabla: tabla.nombre, folio: creado.folio },
  });
  return { ok: true, dato: creado };
}

export async function actualizarRenglon(
  orgId: string,
  renglonId: string,
  crudos: Record<string, unknown>,
  userId?: string | null,
  /**
   * La tabla a la que TIENE que pertenecer el renglon.
   *
   * Obligatoria de hecho aunque el tipo la deje opcional: quien llama reviso el
   * permiso con la tabla de la direccion, y sin esta comprobacion el renglon
   * podria ser de OTRA tabla —una que ese rol no puede tocar— y el permiso
   * habria quedado revisado sobre la equivocada.
   */
  tablaId?: string,
): Promise<Resultado<{ id: string }>> {
  const renglon = await prisma.renglonPropio.findFirst({
    where: { id: renglonId, organizationId: orgId, ...(tablaId ? { tablaId } : {}) },
    select: { id: true, tablaId: true, folio: true },
  });
  if (!renglon) return { ok: false, motivos: ["Ese renglón no existe en esta tabla."] };

  const tabla = await tablaPorId(orgId, renglon.tablaId);
  if (!tabla) return { ok: false, motivos: ["Esa tabla no existe en esta empresa."] };

  // Solo se tocan los campos que vinieron: un formulario parcial no debe
  // borrar lo que no mando.
  const presentes = tabla.campos.filter((c) => Object.prototype.hasOwnProperty.call(crudos, c.clave));
  if (!presentes.length) return { ok: false, motivos: ["No llegó ningún campo que actualizar."] };

  const preparados = await prepararValores(orgId, presentes, crudos);
  if (!preparados.ok) return preparados;

  await prisma.$transaction(async (tx) => {
    for (const v of preparados.dato) {
      const datos = aDatosDeValor(v.valor);
      await tx.valorPropio.upsert({
        where: { renglonId_campoId: { renglonId: renglon.id, campoId: v.campoId } },
        create: { renglonId: renglon.id, campoId: v.campoId, ...datos },
        update: datos,
      });
    }
    await tx.renglonPropio.update({ where: { id: renglon.id }, data: { updatedAt: new Date() } });
  }, LIMITE_TRANSACCION);

  await logAudit({
    organizationId: orgId, userId: userId ?? undefined, action: "UPDATE",
    entity: "RenglonPropio", entityId: renglon.id,
    changes: { tabla: tabla.nombre, folio: renglon.folio, campos: presentes.map((c) => c.clave) },
  });
  return { ok: true, dato: { id: renglon.id } };
}

/** Apaga un renglon. No se borra: lo capturado es historia de la planta. */
export async function apagarRenglon(
  orgId: string,
  renglonId: string,
  userId?: string | null,
  /** La tabla a la que tiene que pertenecer. Ver `actualizarRenglon`. */
  tablaId?: string,
): Promise<Resultado<{ id: string }>> {
  const renglon = await prisma.renglonPropio.findFirst({
    where: { id: renglonId, organizationId: orgId, ...(tablaId ? { tablaId } : {}) },
    select: { id: true, folio: true, tabla: { select: { nombre: true } } },
  });
  if (!renglon) return { ok: false, motivos: ["Ese renglón no existe en esta tabla."] };
  await prisma.renglonPropio.update({ where: { id: renglon.id }, data: { activo: false } });
  await logAudit({
    organizationId: orgId, userId: userId ?? undefined, action: "DELETE",
    entity: "RenglonPropio", entityId: renglon.id, changes: { tabla: renglon.tabla.nombre, folio: renglon.folio },
  });
  return { ok: true, dato: { id: renglon.id } };
}

// ─────────────────────────────────────────── Leer lo capturado

export type ValorPintado = {
  clave: string;
  /** El dato tipado, para ordenar y sumar. */
  crudo: string | number | boolean | Date | null;
  /** Como se muestra. Vacio cuando no hay dato. */
  texto: string;
  /**
   * Cierto cuando el campo apunta a un registro de MainTrack que ya no esta.
   * La pantalla dice «ya no existe» y no un guion: un dato que desaparece sin
   * decirlo es el defecto que mas caro ha salido en este proyecto.
   */
  referenciaPerdida?: boolean;
};

export type RenglonLeido = {
  id: string;
  folio: number;
  createdAt: Date;
  updatedAt: Date;
  capturoNombre: string | null;
  valores: Record<string, ValorPintado>;
};

const textoDeCrudo = (tipo: string, crudo: string | number | boolean | Date | null): string => {
  if (crudo === null) return "";
  if (typeof crudo === "boolean") return crudo ? "Si" : "No";
  if (crudo instanceof Date) return crudo.toISOString().slice(0, 10);
  if (typeof crudo === "number") {
    return tipo === "DINERO"
      ? crudo.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(crudo);
  }
  return String(crudo);
};

/**
 * Los renglones de una tabla, con las referencias ya resueltas a nombre.
 *
 * `hayMas` es cierto cuando se alcanzo el tope: la pantalla lo dice en vez de
 * mostrar una lista incompleta que se ve completa.
 */
export async function leerRenglones(
  orgId: string,
  tabla: TablaConCampos,
  opciones: { limite?: number } = {},
): Promise<{ renglones: RenglonLeido[]; hayMas: boolean; total: number }> {
  const limite = Math.min(opciones.limite ?? LIMITE_RENGLONES, LIMITE_RENGLONES);
  const [total, filas] = await Promise.all([
    prisma.renglonPropio.count({ where: { organizationId: orgId, tablaId: tabla.id, activo: true } }),
    prisma.renglonPropio.findMany({
      where: { organizationId: orgId, tablaId: tabla.id, activo: true },
      orderBy: { folio: "desc" },
      take: limite,
      include: { valores: true, creadoPor: { select: { name: true } } },
    }),
  ]);

  const porId = new Map(tabla.campos.map((c) => [c.id, c]));
  const aVerificar: Array<{ llave: Llave; refId: string }> = [];
  for (const fila of filas) {
    for (const v of fila.valores) {
      const campo = porId.get(v.campoId);
      const llave = campo && llaveDeCampo(campo.tipo);
      if (llave && v.refId) aVerificar.push({ llave, refId: v.refId });
    }
  }
  const nombres = await resolverReferencias(orgId, aVerificar);

  const renglones = filas.map((fila) => {
    const valores: Record<string, ValorPintado> = {};
    for (const campo of tabla.campos) valores[campo.clave] = { clave: campo.clave, crudo: null, texto: "" };
    for (const v of fila.valores) {
      const campo = porId.get(v.campoId);
      if (!campo) continue;
      const llave = llaveDeCampo(campo.tipo);
      if (llave) {
        if (!v.refId) continue;
        const nombre = nombres.get(`${llave}:${v.refId}`);
        valores[campo.clave] = nombre
          ? { clave: campo.clave, crudo: nombre, texto: nombre }
          : { clave: campo.clave, crudo: v.refId, texto: "ya no existe", referenciaPerdida: true };
        continue;
      }
      const crudo = valorCrudo(campo.tipo, v);
      valores[campo.clave] = { clave: campo.clave, crudo, texto: textoDeCrudo(campo.tipo, crudo) };
    }
    return {
      id: fila.id, folio: fila.folio, createdAt: fila.createdAt, updatedAt: fila.updatedAt,
      capturoNombre: fila.creadoPor?.name ?? null, valores,
    };
  });

  return { renglones, hayMas: total > renglones.length, total };
}

/**
 * Los totales de las columnas numericas.
 *
 * Los calcula TypeScript sobre lo que ya se leyo, no el modelo ni una consulta
 * aparte: un total que sale de otra consulta puede no cuadrar con la lista que
 * esta enfrente, y entonces nadie sabe cual de los dos numeros sirve.
 */
export function totalesDe(tabla: TablaConCampos, renglones: RenglonLeido[]) {
  const totales: Record<string, { suma: number; conteo: number; promedio: number }> = {};
  for (const campo of tabla.campos) {
    if (!esNumerico(campo.tipo)) continue;
    let suma = 0;
    let conteo = 0;
    for (const r of renglones) {
      const crudo = r.valores[campo.clave]?.crudo;
      if (typeof crudo === "number") { suma += crudo; conteo++; }
    }
    totales[campo.clave] = { suma, conteo, promedio: conteo ? suma / conteo : 0 };
  }
  return totales;
}

/**
 * Donde aparece un registro de MainTrack en las tablas propias.
 *
 * Es lo que hace que esto no sea un Excel: el expediente de un equipo puede
 * mostrar sus cargas de combustible y sus analisis de agua sin que nadie los
 * haya programado ahi.
 */
export async function registrosDelReferido(
  orgId: string,
  llave: Llave,
  refId: string,
  opciones: { rol?: string; esSuperAdmin?: boolean; limitePorTabla?: number } = {},
) {
  const tablas = await listarTablas(orgId, { rol: opciones.rol, esSuperAdmin: opciones.esSuperAdmin });
  const conEsaLlave = tablas.filter((t) => t.campos.some((c) => llaveDeCampo(c.tipo) === llave));
  if (!conEsaLlave.length) return [];

  const limite = opciones.limitePorTabla ?? 20;
  const salida = await Promise.all(
    conEsaLlave.map(async (tabla) => {
      const campos = tabla.campos.filter((c) => llaveDeCampo(c.tipo) === llave);
      const renglones = await prisma.renglonPropio.findMany({
        where: {
          organizationId: orgId, tablaId: tabla.id, activo: true,
          valores: { some: { campoId: { in: campos.map((c) => c.id) }, refId } },
        },
        orderBy: { folio: "desc" },
        take: limite,
        select: { id: true, folio: true, createdAt: true },
      });
      return { tabla: { id: tabla.id, clave: tabla.clave, nombre: tabla.nombre }, renglones };
    }),
  );
  return salida.filter((x) => x.renglones.length);
}

/**
 * Que tablas propias existen y que significan, para la IA.
 *
 * Es lo que evita que el constructor deje muda a la consulta en lenguaje
 * natural. La IA no adivina lo que es «Control 2»: lee la descripcion que
 * escribio el cliente al armar la tabla, y por eso la descripcion es
 * obligatoria.
 */
export async function resumenParaIa(orgId: string, opciones: { rol?: string } = {}) {
  // Filtrado por rol, y no es un detalle: sin esto un tecnico obtendria por
  // la IA la tabla contable que el sistema le esconde en el menu. Es el mismo
  // hallazgo del Bloque 8 —las herramientas recibian la empresa pero nunca el
  // rol— aplicado desde el primer dia.
  const tablas = await listarTablas(orgId, { rol: opciones.rol });
  return tablas.map((t) => ({
    nombre: t.nombre,
    paraQueEs: t.descripcion,
    renglones: t.renglones,
    columnas: t.campos.map((c) => ({
      nombre: c.etiqueta,
      tipo: c.tipo,
      significa: c.descripcion,
      ...(c.tipo === "LISTA" ? { opciones: opcionesDe(c.opciones) } : {}),
    })),
  }));
}

/**
 * Lo capturado en una tabla propia, listo para la IA.
 *
 * El dinero viaja aparte, bajo `costos`, y es deliberado: la depuracion por rol
 * de `lib/ia/herramientas.ts` quita cualquier clave que case con /costo/, asi
 * que agrupar ahi los importes hace que un tecnico —a quien el sistema le
 * esconde los montos en todas las pantallas— no los obtenga preguntandoselos a
 * la IA en prosa. El mecanismo ya existia; esto se acomoda para usarlo.
 */
export async function renglonesParaIa(
  orgId: string,
  clave: string,
  opciones: { rol?: string; limite?: number } = {},
) {
  const tabla = await tablaPorClave(orgId, clave);
  if (!tabla) return { error: `No existe una tabla propia con clave «${clave}».` };
  if (!puedeVerTabla(opciones.rol, tabla)) {
    return { error: "Esa tabla no está disponible para este rol. Conteste sin ella." };
  }

  const { renglones, total, hayMas } = await leerRenglones(orgId, tabla, { limite: opciones.limite ?? 200 });
  const totales = totalesDe(tabla, renglones);
  const esDinero = new Set(tabla.campos.filter((c) => c.tipo === "DINERO").map((c) => c.clave));

  const reparte = (r: RenglonLeido) => {
    const valores: Record<string, string> = {};
    const costos: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.valores)) {
      if (!v.texto) continue;
      (esDinero.has(k) ? costos : valores)[k] = v.texto;
    }
    return { folio: r.folio, valores, ...(Object.keys(costos).length ? { costos } : {}) };
  };

  return {
    tabla: tabla.nombre,
    paraQueEs: tabla.descripcion,
    total,
    // Los totales los calcula TypeScript, no el modelo: un modelo sumando
    // renglones crudos es un error silencioso esperando fecha.
    sumas: Object.fromEntries(
      tabla.campos.filter((c) => esNumerico(c.tipo) && !esDinero.has(c.clave))
        .map((c) => [c.etiqueta, totales[c.clave]]),
    ),
    costos: Object.fromEntries(
      tabla.campos.filter((c) => esDinero.has(c.clave)).map((c) => [c.etiqueta, totales[c.clave]]),
    ),
    ...(hayMas ? { nota: `Se muestran los ${renglones.length} mas recientes de ${total}.` } : {}),
    renglones: renglones.map(reparte),
  };
}
