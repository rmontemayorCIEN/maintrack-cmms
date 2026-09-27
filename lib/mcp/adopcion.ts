/**
 * Adopcion: que modulos usa de verdad cada empresa cliente.
 *
 * ── Que se mide y que no ──
 *
 * «En uso» es que se hayan creado registros del modulo en los ultimos 30 dias.
 * Tener cien activos cargados hace un año no es usar el sistema; crear una
 * orden la semana pasada si. Se cuenta la ACTIVIDAD, no el inventario.
 *
 * Solo se cuentan registros, nunca su contenido: ni descripciones de fallas,
 * ni nombres de equipos, ni quien hizo que. Esto alimenta al agente del
 * operador y no tiene por que ver lo que pasa dentro de la planta del cliente.
 *
 * Lo que esto NO distingue, y se dice en la respuesta: si un registro lo creo
 * el cliente o el operador durante la implementacion. Por eso se reporta
 * aparte cuanta actividad del operador hubo en la cuenta; una adopcion «alta»
 * hecha a mano por nosotros no es adopcion.
 */
import type { ClienteLectura } from "./lectura";

type Conteo = { organizationId: string; _count: { _all: number } };
type Maximo = { organizationId: string; _max: Record<string, Date | null> };

export type Modulo = {
  clave: string;
  nombre: string;
  /** Registros por organizacion desde una fecha. */
  contar: (db: ClienteLectura, desde: Date, orgs?: string[]) => Promise<Conteo[]>;
  /** El registro mas reciente por organizacion. */
  ultimo: (db: ClienteLectura, orgs?: string[]) => Promise<Maximo[]>;
};

/**
 * Arma un modulo a partir del modelo y su campo de fecha.
 *
 * Los modelos de Prisma no comparten tipo, asi que se trata al delegado como
 * «algo con groupBy». El nombre del modelo y del campo se escriben una sola
 * vez, en la tabla de abajo.
 */
function modulo(clave: string, nombre: string, modelo: string, campo: string, extra: Record<string, unknown> = {}): Modulo {
  type ConGroupBy = { groupBy: (a: unknown) => Promise<unknown[]> };
  const delegado = (db: ClienteLectura) => (db as unknown as Record<string, ConGroupBy>)[modelo];
  const dondeOrg = (orgs?: string[]) => (orgs ? { organizationId: { in: orgs } } : {});
  return {
    clave, nombre,
    contar: async (db, desde, orgs) =>
      (await delegado(db).groupBy({
        by: ["organizationId"],
        where: { ...extra, ...dondeOrg(orgs), [campo]: { gte: desde } },
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
  modulo("ordenes", "Órdenes de trabajo", "workOrder", "createdAt"),
  modulo("preventivo", "Preventivo (órdenes generadas por planes)", "workOrder", "createdAt", { planId: { not: null } }),
  modulo("solicitudes", "Solicitudes de trabajo", "workRequest", "createdAt"),
  modulo("activos", "Alta de activos", "asset", "createdAt"),
  modulo("medidores", "Lecturas de medidores", "meterReading", "readingAt"),
  modulo("almacen", "Almacén (movimientos)", "stockMovement", "createdAt"),
  modulo("compras", "Compras (requisiciones)", "purchaseRequest", "createdAt"),
  modulo("rondines", "Rondines", "rondin", "createdAt"),
  modulo("vigencias", "Garantías y vigencias", "vigencia", "createdAt"),
  modulo("registros_propios", "Registros propios", "renglonPropio", "createdAt"),
  modulo("normas", "Cumplimiento normativo", "normaAdoptada", "createdAt"),
  modulo("colaboracion", "Comentarios", "comentario", "createdAt"),
  modulo("ia", "Funciones de IA", "aiUsage", "createdAt"),
];

export const DIAS_EN_USO = 30;

export const NIVELES_ADOPCION = {
  EN_ARRANQUE: "Cuenta de menos de 14 días con poca actividad: todavía no se puede juzgar.",
  SIN_USO: "Ningún módulo con actividad en 30 días.",
  BAJA: "1 o 2 módulos en uso.",
  MEDIA: "3 o 4 módulos en uso.",
  ALTA: "5 o más módulos en uso.",
} as const;
export type NivelAdopcion = keyof typeof NIVELES_ADOPCION;

/**
 * El nivel, con su tercer estado.
 *
 * Una cuenta de cinco dias sin actividad no esta «sin uso»: todavia no se
 * sabe. Ponerla junto a la cuenta de un año que dejo de entrar haria que el
 * operador le hablara a la equivocada.
 */
export function nivelDeAdopcion(modulosEnUso: number, altaEl: Date, ahora = new Date()): NivelAdopcion {
  const dias = (ahora.getTime() - altaEl.getTime()) / 86_400_000;
  if (dias < 14 && modulosEnUso < 3) return "EN_ARRANQUE";
  if (modulosEnUso === 0) return "SIN_USO";
  if (modulosEnUso <= 2) return "BAJA";
  if (modulosEnUso <= 4) return "MEDIA";
  return "ALTA";
}

/** Conteo por modulo y organizacion en una ventana, mas la ultima fecha de cada modulo. */
export async function actividadPorModulo(db: ClienteLectura, desde: Date, orgs?: string[]) {
  const resultado = new Map<string, Map<string, { recientes: number; ultima: Date | null }>>();
  // En serie a proposito: Cloud SQL admite pocas conexiones y son 26 consultas
  // agrupadas, no una por empresa.
  for (const m of MODULOS) {
    const conteos = await m.contar(db, desde, orgs);
    const ultimos = await m.ultimo(db, orgs);
    for (const u of ultimos) {
      const porOrg = resultado.get(u.organizationId) ?? new Map();
      porOrg.set(m.clave, { recientes: 0, ultima: u._max.fecha ?? null });
      resultado.set(u.organizationId, porOrg);
    }
    for (const c of conteos) {
      const porOrg = resultado.get(c.organizationId) ?? new Map();
      const previo = porOrg.get(m.clave) ?? { recientes: 0, ultima: null };
      porOrg.set(m.clave, { ...previo, recientes: c._count._all });
      resultado.set(c.organizationId, porOrg);
    }
  }
  return resultado;
}
