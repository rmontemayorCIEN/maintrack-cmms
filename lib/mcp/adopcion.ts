/**
 * Adopcion: que modulos usa de verdad cada empresa cliente.
 *
 * ── Que se mide y que no ──
 *
 * «En uso» es que EL CLIENTE haya creado registros del modulo en los ultimos
 * 30 dias. Tener cien activos cargados hace un año no es usar el sistema;
 * crear una orden la semana pasada si. Se cuenta la ACTIVIDAD, no el
 * inventario.
 *
 * ── Del cliente, no del operador ──
 *
 * La primera version contaba cualquier registro. «Acero Industrial del Norte»
 * salia con adopcion ALTA teniendo cero usuarios: los 187 movimientos del mes
 * eran del operador implementando. Una adopcion alta hecha a mano por
 * nosotros no es adopcion, y es justo la cuenta que no va a renovar.
 *
 * Por eso cada modulo dice quien es el autor de sus registros, y lo que creo
 * un operador de la plataforma no cuenta. Un registro SIN autor si cuenta: lo
 * genero el programador, llego por un QR o por la API — es la cuenta del
 * cliente operando, aunque nadie haya entrado.
 *
 * Dos modulos no guardan autor (activos y normas): ahi no se puede distinguir,
 * y la respuesta lo dice en vez de suponer.
 *
 * Solo se cuentan registros, nunca su contenido: ni descripciones de fallas,
 * ni nombres de equipos, ni quien hizo que.
 */
import type { ClienteLectura } from "./lectura";

type Conteo = { organizationId: string; _count: { _all: number } };
type Maximo = { organizationId: string; _max: Record<string, Date | null> };

export type Modulo = {
  clave: string;
  nombre: string;
  /** El campo con el autor del registro, o null si el modelo no lo guarda. */
  autor: string | null;
  /**
   * Registros por organizacion desde una fecha. Con `sinAutores`, sin los que
   * crearon esas personas (los operadores); los que no tienen autor se quedan.
   */
  contar: (db: ClienteLectura, desde: Date, orgs?: string[], sinAutores?: string[]) => Promise<Conteo[]>;
  /** El registro mas reciente por organizacion. */
  ultimo: (db: ClienteLectura, orgs?: string[]) => Promise<Maximo[]>;
};

/**
 * Arma un modulo a partir del modelo, su campo de fecha y su campo de autor.
 *
 * Los modelos de Prisma no comparten tipo, asi que se trata al delegado como
 * «algo con groupBy». El nombre del modelo y de los campos se escriben una
 * sola vez, en la tabla de abajo.
 */
function modulo(clave: string, nombre: string, modelo: string, campo: string, autor: string | null, extra: Record<string, unknown> = {}): Modulo {
  type ConGroupBy = { groupBy: (a: unknown) => Promise<unknown[]> };
  const delegado = (db: ClienteLectura) => (db as unknown as Record<string, ConGroupBy>)[modelo];
  const dondeOrg = (orgs?: string[]) => (orgs ? { organizationId: { in: orgs } } : {});
  /**
   * `notIn` a secas deja fuera los renglones con autor vacio (en SQL,
   * `NULL NOT IN (...)` no es verdadero), y esos son justo los del
   * programador y los del QR. Por eso va con su OR explicito.
   */
  const sinEsos = (sinAutores?: string[]) =>
    autor && sinAutores?.length ? { OR: [{ [autor]: null }, { [autor]: { notIn: sinAutores } }] } : {};
  return {
    clave, nombre, autor,
    contar: async (db, desde, orgs, sinAutores) =>
      (await delegado(db).groupBy({
        by: ["organizationId"],
        where: { AND: [extra, dondeOrg(orgs), { [campo]: { gte: desde } }, sinEsos(sinAutores)] },
        _count: { _all: true },
      })) as Conteo[],
    ultimo: async (db, orgs) =>
      ((await delegado(db).groupBy({
        by: ["organizationId"],
        where: { ...extra, ...dondeOrg(orgs) },
        _max: { [campo]: true },
      })) as Array<{ organizationId: string; _max: Record<string, Date | null> }>).map((f) => ({
        organizationId: f.organizationId,
        _max: { fecha: f._max[campo] ?? null },
      })),
  };
}

/** Los modulos que se miden. El orden es el de la respuesta. */
export const MODULOS: Modulo[] = [
  modulo("ordenes", "Órdenes de trabajo", "workOrder", "createdAt", "createdById"),
  modulo("preventivo", "Preventivo (órdenes generadas por planes)", "workOrder", "createdAt", "createdById", { planId: { not: null } }),
  modulo("solicitudes", "Solicitudes de trabajo", "workRequest", "createdAt", "requestedById"),
  modulo("activos", "Alta de activos", "asset", "createdAt", null),
  modulo("medidores", "Lecturas de medidores", "meterReading", "readingAt", "userId"),
  modulo("almacen", "Almacén (movimientos)", "stockMovement", "createdAt", "userId"),
  modulo("compras", "Compras (requisiciones)", "purchaseRequest", "createdAt", "solicitanteId"),
  modulo("rondines", "Rondines", "rondin", "createdAt", "iniciadoPorId"),
  modulo("vigencias", "Garantías y vigencias", "vigencia", "createdAt", "creadoPorId"),
  modulo("registros_propios", "Registros propios", "renglonPropio", "createdAt", "creadoPorId"),
  modulo("normas", "Cumplimiento normativo", "normaAdoptada", "createdAt", null),
  modulo("colaboracion", "Comentarios", "comentario", "createdAt", "autorId"),
  modulo("ia", "Funciones de IA", "aiUsage", "createdAt", "userId"),
];

/** Los modulos donde no se puede separar al cliente del operador. */
export const SIN_AUTOR = MODULOS.filter((m) => !m.autor).map((m) => m.nombre);

export const DIAS_EN_USO = 30;

export const NIVELES_ADOPCION = {
  EN_ARRANQUE: "Cuenta de menos de 14 días con poca actividad: todavía no se puede juzgar.",
  NADIE_DEL_CLIENTE: "Nadie del cliente entró ni registró nada en 30 días. Lo que se mueve en la cuenta es del operador o automático (programador, QR, API).",
  SIN_USO: "Gente del cliente entró, pero no creó registros en ningún módulo en 30 días.",
  BAJA: "El cliente usa 1 o 2 módulos.",
  MEDIA: "El cliente usa 3 o 4 módulos.",
  ALTA: "El cliente usa 5 o más módulos.",
} as const;
export type NivelAdopcion = keyof typeof NIVELES_ADOPCION;

/**
 * El nivel, con sus estados de «no se sabe» y de «no es del cliente».
 *
 * Una cuenta de cinco dias sin actividad no esta «sin uso»: todavia no se
 * sabe. Y una cuenta de dos meses donde solo se mueve el operador no tiene
 * adopcion baja ni alta: no tiene cliente usandola. Juntarlas con las demas
 * haria que el operador le hablara a la equivocada.
 */
export function nivelDeAdopcion(p: {
  /** Modulos con registros DEL CLIENTE en 30 dias. */
  modulosEnUso: number;
  altaEl: Date;
  /** Personas del cliente con actividad en 30 dias (bitacora o inicio de sesion). */
  personasDelCliente: number;
  ahora?: Date;
}): NivelAdopcion {
  const ahora = p.ahora ?? new Date();
  const dias = (ahora.getTime() - p.altaEl.getTime()) / 86_400_000;
  if (dias < 14 && p.modulosEnUso < 3) return "EN_ARRANQUE";
  if (p.personasDelCliente === 0) return "NADIE_DEL_CLIENTE";
  if (p.modulosEnUso === 0) return "SIN_USO";
  if (p.modulosEnUso <= 2) return "BAJA";
  if (p.modulosEnUso <= 4) return "MEDIA";
  return "ALTA";
}

/**
 * Por modulo y organizacion, en una ventana: cuantos registros hubo en total,
 * cuantos fueron del cliente (sin los de `operadores`), y la ultima fecha.
 */
export async function actividadPorModulo(db: ClienteLectura, desde: Date, operadores: string[], orgs?: string[]) {
  const resultado = new Map<string, Map<string, { recientes: number; delCliente: number; ultima: Date | null }>>();
  const fila = (org: string, clave: string) => {
    const porOrg = resultado.get(org) ?? new Map();
    resultado.set(org, porOrg);
    const previo = porOrg.get(clave) ?? { recientes: 0, delCliente: 0, ultima: null };
    porOrg.set(clave, previo);
    return previo;
  };
  // En serie a proposito: Cloud SQL admite pocas conexiones y son pocas
  // consultas agrupadas, no una por empresa.
  for (const m of MODULOS) {
    for (const u of await m.ultimo(db, orgs)) fila(u.organizationId, m.clave).ultima = u._max.fecha ?? null;
    for (const c of await m.contar(db, desde, orgs)) fila(c.organizationId, m.clave).recientes = c._count._all;
    for (const c of await m.contar(db, desde, orgs, operadores)) fila(c.organizationId, m.clave).delCliente = c._count._all;
  }
  return resultado;
}
