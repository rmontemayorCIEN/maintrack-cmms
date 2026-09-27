/**
 * Las herramientas del servidor MCP del operador.
 *
 * ── Tres reglas que no se rompen aqui ──
 *
 * 1. **Solo lectura.** Cada herramienta recibe `db`, el cliente de
 *    `lib/mcp/lectura.ts`, que truena ante cualquier escritura. Este archivo
 *    NO importa `prisma`; la prueba lo revisa.
 * 2. **Solo agregados.** Conteos, fechas y sumas por empresa. Nada del
 *    contenido operativo de las plantas: ni descripciones de fallas, ni
 *    nombres de equipos, ni nombres o correos de la gente del cliente.
 * 3. **Los numeros los calcula el codigo.** El agente recibe cifras resueltas
 *    y el criterio con que se calcularon, para que no tenga que suponerlo.
 *
 * Y la regla de la casa: lo que no se puede saber se dice. Cada respuesta que
 * mide algo trae `loQueNoSeVe`.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ClienteLectura } from "./lectura";
import { actividadPorModulo, DIAS_EN_USO, MODULOS, nivelDeAdopcion, NIVELES_ADOPCION } from "./adopcion";
import { buscarEnAyuda } from "./documentacion";
import { claveDiaEnZona, diaEnZona, medianocheEnZona } from "../periodos";
import { FUNCIONES_IA } from "../ia/funciones";
import { planDe } from "../planes";

export type Contexto = {
  db: ClienteLectura;
  /** Zona del operador: «hoy» y «este mes» son los suyos. */
  zona: string;
  ahora: Date;
};

// ──────────────────────────────────────────────────────────── utilidades ───

const DIA = 86_400_000;
const MAX_DIAS_RANGO = 366;

const fechaDia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use el formato AAAA-MM-DD")
  .refine((v) => {
    const [a, m, d] = v.split("-").map(Number);
    const f = new Date(Date.UTC(a, m - 1, d));
    return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d && a >= 2020 && a <= 2100;
  }, "no es una fecha válida");

/**
 * Un rango de dias completos en la zona del operador. `hasta` incluye el dia
 * entero: quien pide «hasta el 30» espera ver lo del 30.
 */
export function rango(desde: string | undefined, hasta: string | undefined, ctx: Contexto, diasPorOmision = 30) {
  const hoy = claveDiaEnZona(ctx.ahora, ctx.zona);
  const h = hasta ?? hoy;
  const d = desde ?? (() => {
    const [a, m, dd] = h.split("-").map(Number);
    return claveDiaEnZona(new Date(medianocheEnZona(a, m, dd - diasPorOmision + 1, ctx.zona).getTime() + DIA / 2), ctx.zona);
  })();
  if (d > hoy) throw new ErrorDeHerramienta(`«desde» (${d}) está en el futuro; hoy es ${hoy}.`);
  if (h < d) throw new ErrorDeHerramienta(`«hasta» (${h}) es anterior a «desde» (${d}).`);
  const [a1, m1, d1] = d.split("-").map(Number);
  const [a2, m2, d2] = h.split("-").map(Number);
  const inicio = medianocheEnZona(a1, m1, d1, ctx.zona);
  const fin = medianocheEnZona(a2, m2, d2 + 1, ctx.zona);
  const dias = Math.round((fin.getTime() - inicio.getTime()) / DIA);
  if (dias > MAX_DIAS_RANGO) throw new ErrorDeHerramienta(`El rango es de ${dias} días; el máximo es ${MAX_DIAS_RANGO}.`);
  return { inicio, fin, desde: d, hasta: h, dias };
}

/** Un error que el agente debe leer: parametros fuera de rango, empresa que no existe. */
export class ErrorDeHerramienta extends Error {}

const fecha = (f: Date | null | undefined) => (f ? f.toISOString() : null);

/**
 * Lo que NO es un cliente: la demostrativa y las cuentas internas del
 * operador (Organization.cuentaInterna). Un solo criterio para las cinco
 * herramientas; si cada una lo decidiera, alguna se quedaria contando la demo.
 */
const noEsCliente = (o: { esDemo: boolean; cuentaInterna: boolean }) => o.esDemo || o.cuentaInterna;
const SOLO_CLIENTES = { esDemo: false, cuentaInterna: false };
const marcas = (o: { esDemo: boolean; cuentaInterna: boolean }) => ({
  ...(o.esDemo ? { esDemostrativa: true } : {}),
  ...(o.cuentaInterna ? { esCuentaInterna: true } : {}),
});
const redondear = (n: number, dec = 4) => Math.round(n * 10 ** dec) / 10 ** dec;

async function idsDeOperadores(db: ClienteLectura) {
  return (await db.user.findMany({ where: { isSuperAdmin: true }, select: { id: true } })).map((u) => u.id);
}

/**
 * Personas del cliente con actividad desde una fecha, por empresa.
 *
 * «Activa» es: dejo huella en la bitacora o inicio sesion en la ventana. La
 * sesion dura siete dias, asi que alguien que solo consulta sin volver a
 * entrar puede no aparecer; se dice en `loQueNoSeVe`.
 */
async function personasActivas(db: ClienteLectura, desde: Date, operadores: string[], orgs?: string[]) {
  const porOrg = new Map<string, Set<string>>();
  const sumar = (org: string, user: string | null) => {
    if (!user) return;
    const s = porOrg.get(org) ?? new Set<string>();
    s.add(user);
    porOrg.set(org, s);
  };
  // Las empresas se filtran aqui y no en la consulta: un `IN` con todas las
  // empresas choca con el limite de parametros de la base en cuanto hay
  // cientos (ya paso en desarrollo). Una sola empresa si va en la consulta.
  const dondeOrg = orgs?.length === 1 ? { organizationId: orgs[0] } : {};
  const incluida = orgs && orgs.length > 1 ? new Set(orgs) : null;
  const huellas = await db.auditLog.findMany({
    where: { ...dondeOrg, createdAt: { gte: desde }, userId: { not: null, notIn: operadores } },
    distinct: ["organizationId", "userId"],
    select: { organizationId: true, userId: true },
  });
  for (const h of huellas) if (!incluida || incluida.has(h.organizationId)) sumar(h.organizationId, h.userId);
  const entradas = await db.user.findMany({
    where: { ...dondeOrg, isSuperAdmin: false, lastLoginAt: { gte: desde } },
    select: { organizationId: true, id: true },
  });
  for (const e of entradas) if (!incluida || incluida.has(e.organizationId)) sumar(e.organizationId, e.id);
  return porOrg;
}

const PERSONAS_ACTIVAS = "Persona del cliente que dejó un registro en la bitácora o inició sesión en la ventana. No cuenta al operador.";

// ─────────────────────────────────────────────────────────── herramientas ───

const resumenEntrada = z.object({
  desde: fechaDia.optional().describe("Inicio del periodo para contar órdenes creadas (AAAA-MM-DD). Por omisión, hace 30 días."),
  hasta: fechaDia.optional().describe("Fin del periodo, incluido (AAAA-MM-DD). Por omisión, hoy."),
}).strict();

async function resumenPlataforma(p: z.infer<typeof resumenEntrada>, ctx: Contexto) {
  const { db } = ctx;
  const periodo = rango(p.desde, p.hasta, ctx);
  const orgs = await db.organization.findMany({ select: { id: true, status: true, esDemo: true, cuentaInterna: true, createdAt: true } });
  const clientes = orgs.filter((o) => !noEsCliente(o));
  const ids = clientes.map((o) => o.id);
  const operadores = await idsDeOperadores(db);

  const porEstado: Record<string, number> = {};
  for (const o of clientes) porEstado[o.status] = (porEstado[o.status] ?? 0) + 1;

  const hoy = diaEnZona(ctx.ahora, ctx.zona);
  const inicioMes = medianocheEnZona(hoy.anio, hoy.mes, 1, ctx.zona);

  const activos = async (dias: number) => {
    const m = await personasActivas(db, new Date(ctx.ahora.getTime() - dias * DIA), operadores, ids);
    return [...m.values()].reduce((s, x) => s + x.size, 0);
  };

  const esCliente = new Set(ids);
  const ordenes = (await db.workOrder.groupBy({
    by: ["organizationId"],
    where: { createdAt: { gte: periodo.inicio, lt: periodo.fin } },
    _count: { _all: true },
  })).filter((o) => esCliente.has(o.organizationId));

  return {
    generadoEl: ctx.ahora.toISOString(),
    zonaHoraria: ctx.zona,
    organizaciones: {
      activas: (porEstado.ACTIVE ?? 0) + (porEstado.TRIAL ?? 0),
      porEstado,
      nuevasEsteMes: clientes.filter((o) => o.createdAt >= inicioMes).length,
      mes: `${hoy.anio}-${String(hoy.mes).padStart(2, "0")}`,
      empresasDemostrativasExcluidas: orgs.filter((o) => o.esDemo).length,
      cuentasInternasExcluidas: orgs.filter((o) => o.cuentaInterna && !o.esDemo).length,
    },
    usuariosActivos: {
      ultimos7Dias: await activos(7),
      ultimos30Dias: await activos(30),
      criterio: PERSONAS_ACTIVAS,
    },
    ordenesCreadas: {
      periodo: { desde: periodo.desde, hasta: periodo.hasta, dias: periodo.dias },
      total: ordenes.reduce((s, o) => s + o._count._all, 0),
      empresasQueCrearonOrdenes: ordenes.length,
    },
    criterios: {
      activas: "Estado ACTIVE (pagando) o TRIAL (en prueba). No incluye SUSPENDED ni CANCELLED.",
      demostrativas: "La empresa demostrativa y las cuentas internas del operador no entran en ninguna cifra de este resumen.",
    },
    loQueNoSeVe: [
      "Quien solo consulta pantallas con una sesión abierta de días anteriores no deja huella y no cuenta como activo.",
      "Las órdenes incluyen las que creó el operador durante una implementación.",
    ],
  };
}

const listarEntrada = z.object({
  estado: z.enum(["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED"]).optional().describe("Filtrar por estado comercial."),
  incluir_demo: z.boolean().default(false).describe("Incluir la empresa demostrativa y las cuentas internas del operador."),
  orden: z.enum(["ultima_actividad", "alta", "nombre"]).default("ultima_actividad"),
  limite: z.number().int().min(1).max(200).default(50).describe("Máximo de empresas (1 a 200)."),
}).strict();

async function listarClientes(p: z.infer<typeof listarEntrada>, ctx: Contexto) {
  const { db } = ctx;
  const orgs = await db.organization.findMany({
    where: { ...(p.estado ? { status: p.estado } : {}), ...(p.incluir_demo ? {} : SOLO_CLIENTES) },
    select: {
      id: true, name: true, plan: true, status: true, esDemo: true, cuentaInterna: true, createdAt: true, trialEndsAt: true, operandoDesde: true,
      iaComplemento: true, registrosPropios: true, cumplimientoNormas: true,
      _count: { select: { users: { where: { active: true, isSuperAdmin: false } } } },
    },
  });
  const ids = orgs.map((o) => o.id);
  const operadores = await idsDeOperadores(db);
  const hace30 = new Date(ctx.ahora.getTime() - DIAS_EN_USO * DIA);

  // Sin lista de empresas en las consultas (ver personasActivas): se traen
  // todas y cada fila busca la suya.
  const actividad = await actividadPorModulo(db, hace30);
  const activas30 = await personasActivas(db, hace30, operadores, ids);
  const ultimaBitacora = await db.auditLog.groupBy({
    by: ["organizationId"],
    where: { userId: { not: null, notIn: operadores } },
    _max: { createdAt: true },
  });
  const ultimaEntrada = await db.user.groupBy({
    by: ["organizationId"],
    where: { isSuperAdmin: false },
    _max: { lastLoginAt: true },
  });
  const delOperador = await db.auditLog.groupBy({
    by: ["organizationId"],
    where: { userId: { in: operadores }, createdAt: { gte: hace30 } },
    _count: { _all: true },
  });
  const mapa = <T extends { organizationId: string }>(xs: T[]) => new Map(xs.map((x) => [x.organizationId, x]));
  const [mB, mE, mO] = [mapa(ultimaBitacora), mapa(ultimaEntrada), mapa(delOperador)];

  const filas = orgs.map((o) => {
    const mods = actividad.get(o.id) ?? new Map();
    const enUso = MODULOS.filter((m) => (mods.get(m.clave)?.recientes ?? 0) > 0).map((m) => m.nombre);
    const candidatas = [mB.get(o.id)?._max.createdAt, mE.get(o.id)?._max.lastLoginAt].filter((f): f is Date => !!f);
    const ultima = candidatas.length ? new Date(Math.max(...candidatas.map((f) => f.getTime()))) : null;
    const complementos = [o.iaComplemento && "IA Avanzada", o.registrosPropios && "Registros propios", o.cumplimientoNormas && "Cumplimiento normativo"].filter(Boolean);
    return {
      organizacion_id: o.id,
      nombre: o.name,
      fechaAlta: fecha(o.createdAt),
      plan: planDe(o.plan).nombre,
      complementos,
      estado: o.status,
      ...(o.status === "TRIAL" ? { pruebaVence: fecha(o.trialEndsAt) } : {}),
      operandoDesde: fecha(o.operandoDesde),
      ...marcas(o),
      ultimaActividad: fecha(ultima),
      usuarios: { activos: o._count.users, conActividad30Dias: activas30.get(o.id)?.size ?? 0 },
      modulosEnUso: enUso,
      nivelAdopcion: nivelDeAdopcion(enUso.length, o.createdAt, ctx.ahora),
      movimientosDelOperador30Dias: mO.get(o.id)?._count._all ?? 0,
    };
  });

  const orden: Record<typeof p.orden, (a: (typeof filas)[number], b: (typeof filas)[number]) => number> = {
    // Sin actividad al final, no al principio: null no es «muy antiguo».
    ultima_actividad: (a, b) => (b.ultimaActividad ?? "").localeCompare(a.ultimaActividad ?? ""),
    alta: (a, b) => (b.fechaAlta ?? "").localeCompare(a.fechaAlta ?? ""),
    nombre: (a, b) => a.nombre.localeCompare(b.nombre, "es"),
  };
  filas.sort(orden[p.orden]);

  return {
    total: filas.length,
    mostradas: Math.min(filas.length, p.limite),
    clientes: filas.slice(0, p.limite),
    criterios: {
      moduloEnUso: `Se crearon registros de ese módulo en los últimos ${DIAS_EN_USO} días.`,
      nivelAdopcion: NIVELES_ADOPCION,
      ultimaActividad: "Lo más reciente entre la bitácora y el último inicio de sesión de la gente del cliente. No cuenta al operador.",
      conActividad30Dias: PERSONAS_ACTIVAS,
    },
    loQueNoSeVe: [
      "Un módulo en uso puede serlo por trabajo del operador durante la implementación: compare con movimientosDelOperador30Dias.",
      "Lo que entra por la API de integración o por el formulario público del QR cuenta como actividad del módulo, aunque nadie del cliente haya entrado.",
    ],
  };
}

const detalleEntrada = z.object({
  organizacion_id: z.string().min(10).max(40).regex(/^[A-Za-z0-9_-]+$/, "identificador mal formado")
    .describe("El organizacion_id que devuelve listar_clientes."),
}).strict();

const SEMANAS = 12;

async function detalleCliente(p: z.infer<typeof detalleEntrada>, ctx: Contexto) {
  const { db } = ctx;
  const o = await db.organization.findUnique({
    where: { id: p.organizacion_id },
    select: {
      id: true, name: true, plan: true, status: true, esDemo: true, cuentaInterna: true, createdAt: true, trialEndsAt: true,
      operandoDesde: true, industry: true, tipoInstalacion: true,
      iaComplemento: true, registrosPropios: true, cumplimientoNormas: true,
    },
  });
  if (!o) throw new ErrorDeHerramienta(`No existe una empresa con organizacion_id ${p.organizacion_id}. Use listar_clientes para ver los identificadores.`);

  const operadores = await idsDeOperadores(db);
  const orgs = [o.id];
  const hace = (d: number) => new Date(ctx.ahora.getTime() - d * DIA);

  const usuariosPorRol = await db.user.groupBy({
    by: ["role"], where: { organizationId: o.id, active: true, isSuperAdmin: false }, _count: { _all: true },
  });

  // Por modulo: total historico, 90 y 30 dias, y la ultima fecha.
  const modulos = [];
  for (const m of MODULOS) {
    const [total, en90, en30, ultimo] = [
      await m.contar(db, new Date(0), orgs), await m.contar(db, hace(90), orgs),
      await m.contar(db, hace(30), orgs), await m.ultimo(db, orgs),
    ];
    const n = (x: typeof total) => x[0]?._count._all ?? 0;
    modulos.push({
      modulo: m.nombre, clave: m.clave, enUso: n(en30) > 0,
      registros30Dias: n(en30), registros90Dias: n(en90), registrosTotales: n(total),
      ultimoRegistro: fecha(ultimo[0]?._max.fecha),
    });
  }

  // Tendencia semanal: bloques de 7 dias hacia atras desde hoy.
  const inicio = hace(SEMANAS * 7);
  const huellas = await db.auditLog.findMany({
    where: { organizationId: o.id, createdAt: { gte: inicio }, userId: { not: null, notIn: operadores } },
    select: { createdAt: true, userId: true },
  });
  const ordenes = await db.workOrder.findMany({
    where: { organizationId: o.id, createdAt: { gte: inicio } }, select: { createdAt: true },
  });
  const semanas = Array.from({ length: SEMANAS }, (_, i) => {
    const hasta = hace(i * 7);
    const desde = hace((i + 1) * 7);
    const dentro = (f: Date) => f >= desde && f < hasta;
    const h = huellas.filter((x) => dentro(x.createdAt));
    return {
      semanaQueTermina: claveDiaEnZona(new Date(hasta.getTime() - 1), ctx.zona),
      movimientos: h.length,
      personasActivas: new Set(h.map((x) => x.userId)).size,
      ordenesCreadas: ordenes.filter((x) => dentro(x.createdAt)).length,
    };
  }).reverse();

  const suma = (xs: typeof semanas) => xs.reduce((s, x) => s + x.movimientos, 0);
  const ultimas4 = suma(semanas.slice(-4));
  const previas4 = suma(semanas.slice(-8, -4));
  const direccion =
    ultimas4 === 0 && previas4 === 0 ? "SIN_ACTIVIDAD"
      : previas4 === 0 ? "SIN_BASE"
        : ultimas4 > previas4 * 1.2 ? "SUBE"
          : ultimas4 < previas4 * 0.8 ? "BAJA" : "ESTABLE";

  const delOperador = await db.auditLog.count({
    where: { organizationId: o.id, userId: { in: operadores }, createdAt: { gte: hace(30) } },
  });
  const enUso = modulos.filter((m) => m.enUso).length;

  return {
    organizacion_id: o.id,
    nombre: o.name,
    giro: o.industry,
    tipoInstalacion: o.tipoInstalacion,
    plan: planDe(o.plan).nombre,
    complementos: [o.iaComplemento && "IA Avanzada", o.registrosPropios && "Registros propios", o.cumplimientoNormas && "Cumplimiento normativo"].filter(Boolean),
    estado: o.status,
    ...(o.status === "TRIAL" ? { pruebaVence: fecha(o.trialEndsAt) } : {}),
    ...marcas(o),
    fechaAlta: fecha(o.createdAt),
    operandoDesde: fecha(o.operandoDesde),
    usuariosActivosPorRol: Object.fromEntries(usuariosPorRol.map((u) => [u.role, u._count._all])),
    adopcion: {
      nivel: nivelDeAdopcion(enUso, o.createdAt, ctx.ahora),
      modulosEnUso: enUso,
      modulos,
    },
    tendencia: {
      direccion,
      movimientosUltimas4Semanas: ultimas4,
      movimientos4SemanasPrevias: previas4,
      semanas,
    },
    movimientosDelOperador30Dias: delOperador,
    criterios: {
      enUso: `Registros creados en los últimos ${DIAS_EN_USO} días.`,
      nivel: NIVELES_ADOPCION,
      movimientos: "Registros en la bitácora hechos por gente del cliente (no por el operador).",
      direccion: "Últimas 4 semanas contra las 4 anteriores: SUBE (+20 %), BAJA (−20 %), ESTABLE, SIN_BASE (no había actividad antes: no hay contra qué comparar) o SIN_ACTIVIDAD.",
    },
    loQueNoSeVe: [
      "No se incluye el contenido de ningún registro: ni descripciones, ni equipos, ni personas.",
      "Consultar pantallas no deja huella: una cuenta que solo mira reportes se ve con poca actividad.",
      "Los registros por módulo incluyen los que creó el operador durante la implementación.",
    ],
  };
}

const consumoEntrada = z.object({
  desde: fechaDia.describe("Inicio del periodo (AAAA-MM-DD)."),
  hasta: fechaDia.describe("Fin del periodo, incluido (AAAA-MM-DD). Máximo 366 días de rango."),
  organizacion_id: z.string().min(10).max(40).regex(/^[A-Za-z0-9_-]+$/).optional().describe("Solo esta empresa."),
  limite: z.number().int().min(1).max(200).default(50).describe("Máximo de empresas, las de mayor costo primero."),
}).strict();

/**
 * La unidad de `inputTokens` depende de que se registro.
 *
 * La tabla AiUsage presta ese campo: la voz guarda CARACTERES sintetizados y
 * el dictado por voz guarda SEGUNDOS de audio (lib/ia/consumo.ts). Sumarlos
 * como tokens daria un numero preciso y falso.
 */
function unidadDe(funcion: string, modelo: string): "tokens" | "caracteres" | "segundos" {
  if (funcion === "VOZ") return "caracteres";
  if (modelo.startsWith("speech")) return "segundos";
  return "tokens";
}

const NOMBRES_EXTRA: Record<string, string> = { VOZ: "Lectura en voz alta" };
const nombreFuncion = (f: string) => (FUNCIONES_IA as Record<string, { nombre: string }>)[f]?.nombre ?? NOMBRES_EXTRA[f] ?? f;

async function consumoIa(p: z.infer<typeof consumoEntrada>, ctx: Contexto) {
  const { db } = ctx;
  const periodo = rango(p.desde, p.hasta, ctx);
  const where = {
    createdAt: { gte: periodo.inicio, lt: periodo.fin },
    ...(p.organizacion_id ? { organizationId: p.organizacion_id } : {}),
  };
  const filas = await db.aiUsage.groupBy({
    by: ["organizationId", "funcion", "modelo"],
    where,
    _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, costoUsd: true, operaciones: true },
    _count: { _all: true },
  });
  const fallidas = await db.aiUsage.groupBy({
    by: ["organizationId", "funcion"], where: { ...where, ok: false }, _count: { _all: true },
  });
  const nombres = new Map(
    (await db.organization.findMany({ select: { id: true, name: true, esDemo: true, cuentaInterna: true } }))
      .map((o) => [o.id, o]),
  );
  const fallas = new Map(fallidas.map((f) => [`${f.organizationId}|${f.funcion}`, f._count._all]));

  type PorFuncion = {
    funcion: string; nombre: string; llamadas: number; fallidas: number; operaciones: number; costoUsd: number;
    tokens: { entrada: number; salida: number; cacheLeido: number; cacheEscrito: number };
    caracteresDeVoz?: number; segundosDeAudio?: number;
  };
  const porOrg = new Map<string, Map<string, PorFuncion>>();
  for (const f of filas) {
    const fs = porOrg.get(f.organizationId) ?? new Map<string, PorFuncion>();
    const x = fs.get(f.funcion) ?? {
      funcion: f.funcion, nombre: nombreFuncion(f.funcion), llamadas: 0,
      fallidas: fallas.get(`${f.organizationId}|${f.funcion}`) ?? 0, operaciones: 0, costoUsd: 0,
      tokens: { entrada: 0, salida: 0, cacheLeido: 0, cacheEscrito: 0 },
    };
    x.llamadas += f._count._all;
    x.operaciones += f._sum.operaciones ?? 0;
    x.costoUsd += f._sum.costoUsd ?? 0;
    const unidad = unidadDe(f.funcion, f.modelo);
    if (unidad === "caracteres") x.caracteresDeVoz = (x.caracteresDeVoz ?? 0) + (f._sum.inputTokens ?? 0);
    else if (unidad === "segundos") x.segundosDeAudio = (x.segundosDeAudio ?? 0) + (f._sum.inputTokens ?? 0);
    else {
      x.tokens.entrada += f._sum.inputTokens ?? 0;
      x.tokens.salida += f._sum.outputTokens ?? 0;
      x.tokens.cacheLeido += f._sum.cacheReadTokens ?? 0;
      x.tokens.cacheEscrito += f._sum.cacheWriteTokens ?? 0;
    }
    fs.set(f.funcion, x);
    porOrg.set(f.organizationId, fs);
  }

  const tokensDe = (t: PorFuncion["tokens"]) => t.entrada + t.salida + t.cacheLeido + t.cacheEscrito;
  const organizaciones = [...porOrg.entries()].map(([id, fs]) => {
    const funciones = [...fs.values()].map((x) => ({ ...x, costoUsd: redondear(x.costoUsd) })).sort((a, b) => b.costoUsd - a.costoUsd);
    return {
      organizacion_id: id,
      nombre: nombres.get(id)?.name ?? "(empresa eliminada)",
      ...(nombres.get(id) ? marcas(nombres.get(id)!) : {}),
      costoUsd: redondear(funciones.reduce((s, x) => s + x.costoUsd, 0)),
      tokens: funciones.reduce((s, x) => s + tokensDe(x.tokens), 0),
      llamadas: funciones.reduce((s, x) => s + x.llamadas, 0),
      fallidas: funciones.reduce((s, x) => s + x.fallidas, 0),
      porFuncion: funciones,
    };
  }).sort((a, b) => b.costoUsd - a.costoUsd);

  // Por funcion, sumando todas las empresas.
  const global = new Map<string, { funcion: string; nombre: string; llamadas: number; costoUsd: number; tokens: number }>();
  for (const o of organizaciones) for (const f of o.porFuncion) {
    const g = global.get(f.funcion) ?? { funcion: f.funcion, nombre: f.nombre, llamadas: 0, costoUsd: 0, tokens: 0 };
    g.llamadas += f.llamadas; g.costoUsd += f.costoUsd; g.tokens += tokensDe(f.tokens);
    global.set(f.funcion, g);
  }

  return {
    periodo: { desde: periodo.desde, hasta: periodo.hasta, dias: periodo.dias, zonaHoraria: ctx.zona },
    totales: {
      costoUsd: redondear(organizaciones.reduce((s, o) => s + o.costoUsd, 0)),
      tokens: organizaciones.reduce((s, o) => s + o.tokens, 0),
      llamadas: organizaciones.reduce((s, o) => s + o.llamadas, 0),
      fallidas: organizaciones.reduce((s, o) => s + o.fallidas, 0),
      empresas: organizaciones.length,
    },
    porFuncion: [...global.values()].map((g) => ({ ...g, costoUsd: redondear(g.costoUsd) })).sort((a, b) => b.costoUsd - a.costoUsd),
    mostradas: Math.min(organizaciones.length, p.limite),
    organizaciones: organizaciones.slice(0, p.limite),
    criterios: {
      costoUsd: "Costo real ante los proveedores (Anthropic y Google), en dólares, tal como se registró en cada llamada.",
      tokens: "Entrada + salida + caché leído + caché escrito, solo de funciones de modelo de lenguaje.",
      unidades: "La voz se mide en caracteres sintetizados y el dictado en segundos de audio; van aparte y no se suman a los tokens.",
      operaciones: "Lo que se descuenta de la bolsa del cliente; no es lo mismo que el costo.",
    },
    loQueNoSeVe: [
      "Las llamadas fallidas también cuestan y están incluidas en el costo.",
      "El consumo del operador trabajando dentro de una empresa cliente se registra a nombre de esa empresa.",
      "La demostrativa y las cuentas internas SÍ se incluyen aquí, marcadas: su consumo de IA se paga igual.",
    ],
  };
}

const documentacionEntrada = z.object({
  pregunta: z.string().trim().min(3).max(500).describe("La duda del cliente, en sus palabras."),
  limite: z.number().int().min(1).max(5).default(3).describe("Cuántas fichas devolver (1 a 5)."),
}).strict();

async function buscarDocumentacion(p: z.infer<typeof documentacionEntrada>) {
  return {
    ...buscarEnAyuda(p.pregunta, p.limite),
    fuente: "Fichas de ayuda de las pantallas de MainTrack (lib/ayuda.ts): el mismo texto que ve el cliente en el panel de ayuda.",
  };
}

// ──────────────────────────────────────────────────────────── el catalogo ───

type Definicion<S extends z.ZodTypeAny> = {
  nombre: string;
  titulo: string;
  descripcion: string;
  entrada: S;
  ejecutar: (p: z.infer<S>, ctx: Contexto) => Promise<unknown>;
};

const definir = <S extends z.ZodTypeAny>(d: Definicion<S>) => d as unknown as Definicion<z.ZodTypeAny>;

export const HERRAMIENTAS = [
  definir({
    nombre: "resumen_plataforma",
    titulo: "Resumen de la plataforma",
    descripcion: "Cifras generales del negocio: organizaciones activas por estado, organizaciones nuevas del mes, personas activas en 7 y 30 días y órdenes de trabajo creadas en el periodo. Sin la empresa demostrativa ni las cuentas internas del operador.",
    entrada: resumenEntrada,
    ejecutar: resumenPlataforma,
  }),
  definir({
    nombre: "listar_clientes",
    titulo: "Listar empresas cliente",
    descripcion: "Una fila por empresa cliente: nombre, fecha de alta, plan y complementos, estado, última actividad, usuarios, módulos en uso en 30 días y nivel de adopción. Devuelve organizacion_id para usar en detalle_cliente.",
    entrada: listarEntrada,
    ejecutar: listarClientes,
  }),
  definir({
    nombre: "detalle_cliente",
    titulo: "Detalle de adopción de una empresa",
    descripcion: "Adopción por módulo (registros en 30 y 90 días, totales, último registro) y tendencia semanal de uso de las últimas 12 semanas de una empresa. Solo conteos: no incluye descripciones de fallas, activos ni personas.",
    entrada: detalleEntrada,
    ejecutar: detalleCliente,
  }),
  definir({
    nombre: "consumo_ia",
    titulo: "Consumo de IA",
    descripcion: "Tokens, llamadas y costo en USD de las funciones de IA por organización y por función en un rango de fechas (máximo 366 días), a partir del registro de consumo.",
    entrada: consumoEntrada,
    ejecutar: consumoIa,
  }),
  definir({
    nombre: "buscar_documentacion",
    titulo: "Buscar en la ayuda",
    descripcion: "Busca en las fichas de ayuda de las pantallas de MainTrack y devuelve las más relevantes completas: qué es la pantalla, qué se puede hacer, cómo se conecta con las demás y por qué el sistema puede decir que no. Para contestar dudas de soporte.",
    entrada: documentacionEntrada,
    ejecutar: (p) => buscarDocumentacion(p as z.infer<typeof documentacionEntrada>),
  }),
];

/** Lo que se anuncia en tools/list. */
export function listarHerramientas() {
  return HERRAMIENTAS.map((h) => {
    const esquema = zodToJsonSchema(h.entrada, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
    delete esquema.$schema;
    return {
      name: h.nombre,
      title: h.titulo,
      description: h.descripcion,
      inputSchema: esquema,
      // Pistas para el cliente: ninguna herramienta cambia nada ni sale a
      // otros sistemas. claude.ai las usa para decidir si pide confirmacion.
      annotations: { title: h.titulo, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    };
  });
}

export function buscarHerramienta(nombre: string) {
  return HERRAMIENTAS.find((h) => h.nombre === nombre) ?? null;
}
