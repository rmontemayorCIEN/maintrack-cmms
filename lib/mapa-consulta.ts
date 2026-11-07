/**
 * La consulta del mapa de activos. La usan la ruta y la prueba: la misma
 * función, para que la prueba diga lo que la pantalla hace.
 *
 * Siempre filtra por empresa. Lo que manda el navegador (la zona, los filtros,
 * la capa) solo acota; nunca decide de quién son los datos.
 *
 * Dos criterios que no se repiten aquí sino que se piden a su lugar:
 *  - qué cuenta como FALLA: `filtroDeFalla` (lib/fallas.ts), el mismo de MTBF,
 *    recurrencia y el Pareto;
 *  - qué órdenes están abiertas: `OPEN_STATUSES` (lib/constants.ts).
 */
import { prisma } from "./db";
import { OPEN_STATUSES } from "./constants";
import { filtroDeFalla } from "./fallas";
import {
  PERIODO_POR_OMISION, TOPE_LECTURA, TOPE_PUNTOS, agruparEnCeldas, estadoMasGrave,
  type Capa, type Limites, type PuntoMapa, type RespuestaMapa,
} from "./mapa";

export type FiltrosMapa = { siteId?: string; categoryId?: string; status?: string };
/** Cuántas celdas tiene la rejilla de grupos. Las pone el navegador según el tamaño del mapa en pantalla. */
export type Rejilla = { columnas: number; filas: number };
export type OpcionesMapa = {
  capa?: Capa;
  /** Período de las capas numéricas, en días. */
  dias?: number;
  /** Quien no ve costos no puede pedir la capa de costo: se exige aquí, no solo en pantalla. */
  puedeVerCostos?: boolean;
  /** «Ahora», para que la prueba fije el reloj. */
  hoy?: Date;
};

/** Se pidió una capa que el rol no puede ver. La ruta la vuelve un 403. */
export class CapaNoPermitida extends Error {}

/** Los activos que cuentan para el mapa: de la empresa, vigentes y ubicados. */
const UBICADO = { active: true, latitud: { not: null }, longitud: { not: null } } as const;

/** Lo que pasa AHORA con cada activo: paro abierto y orden de falla abierta. */
async function senales(orgId: string) {
  const [paros, ordenes] = await Promise.all([
    prisma.downtimeEvent.findMany({
      where: { organizationId: orgId, endedAt: null, planned: false, asset: UBICADO },
      select: { assetId: true, startedAt: true },
    }),
    prisma.workOrder.findMany({
      where: {
        organizationId: orgId, status: { in: OPEN_STATUSES }, assetId: { not: null },
        asset: UBICADO, AND: [await filtroDeFalla(orgId)],
      },
      select: { assetId: true, number: true },
    }),
  ]);
  const paro = new Map<string, Date>();
  for (const p of paros) if (!paro.has(p.assetId)) paro.set(p.assetId, p.startedAt);
  const orden = new Map<string, string>();
  for (const o of ordenes) if (o.assetId && !orden.has(o.assetId)) orden.set(o.assetId, o.number);
  return { paro, orden };
}

/**
 * El estado de este momento: el MÁS GRAVE entre el que está registrado y lo que
 * está pasando. Un paro abierto lo vuelve «fuera de servicio» y una orden de
 * falla abierta lo vuelve «degradado», aunque nadie haya cambiado el campo.
 * Lo que está en reserva o dado de baja se queda así: no está en servicio.
 */
export function estadoEfectivo(
  registrado: string, paroDesde: Date | undefined, ordenAbierta: string | undefined,
): { status: string; motivo: string | null } {
  if (registrado === "STANDBY" || registrado === "RETIRED") return { status: registrado, motivo: null };
  let status = registrado;
  let motivo: string | null = null;
  if (paroDesde) {
    const e = estadoMasGrave(status, "DOWN");
    if (e !== status) motivo = `Paro abierto desde ${paroDesde.toISOString().slice(0, 10)}`;
    status = e;
  }
  if (ordenAbierta && status !== "DOWN") {
    const e = estadoMasGrave(status, "DEGRADED");
    if (e !== status) motivo = `Orden de falla abierta ${ordenAbierta}`;
    status = e;
  }
  return { status, motivo };
}

/** El número de la capa para cada activo, en el período. Sin los que valen 0. */
async function valoresPorActivo(orgId: string, capa: Capa, desde: Date): Promise<Map<string, number>> {
  const valores = new Map<string, number>();
  if (capa === "FALLAS") {
    const filas = await prisma.workOrder.groupBy({
      by: ["assetId"], _count: { _all: true },
      where: { organizationId: orgId, assetId: { not: null }, createdAt: { gte: desde }, asset: UBICADO, AND: [await filtroDeFalla(orgId)] },
    });
    for (const f of filas) if (f.assetId) valores.set(f.assetId, f._count._all);
  } else if (capa === "COSTO") {
    const filas = await prisma.workOrder.groupBy({
      by: ["assetId"], _sum: { totalCost: true },
      where: { organizationId: orgId, assetId: { not: null }, createdAt: { gte: desde }, status: { not: "CANCELLED" }, asset: UBICADO },
    });
    for (const f of filas) if (f.assetId && (f._sum.totalCost ?? 0) > 0) valores.set(f.assetId, f._sum.totalCost ?? 0);
  } else if (capa === "PAROS") {
    const filas = await prisma.downtimeEvent.groupBy({
      by: ["assetId"], _sum: { minutes: true },
      where: { organizationId: orgId, planned: false, startedAt: { gte: desde }, asset: UBICADO },
    });
    for (const f of filas) if ((f._sum.minutes ?? 0) > 0) valores.set(f.assetId, Math.round(((f._sum.minutes ?? 0) / 60) * 10) / 10);
  }
  return valores;
}

export async function consultarMapa(
  orgId: string, limites: Limites, filtros: FiltrosMapa = {}, rejilla: Rejilla = { columnas: 10, filas: 8 },
  opciones: OpcionesMapa = {},
): Promise<RespuestaMapa> {
  const capa = opciones.capa ?? "ESTADO";
  const dias = opciones.dias ?? PERIODO_POR_OMISION;
  if (capa === "COSTO" && !opciones.puedeVerCostos) throw new CapaNoPermitida("Su rol no ve costos");
  const desde = new Date((opciones.hoy ?? new Date()).getTime() - dias * 86_400_000);

  const [valores, vivo] = await Promise.all([
    capa === "ESTADO" ? new Map<string, number>() : valoresPorActivo(orgId, capa, desde),
    capa === "ESTADO" || filtros.status ? senales(orgId) : Promise.resolve({ paro: new Map<string, Date>(), orden: new Map<string, string>() }),
  ]);
  // La escala es de TODA la empresa, no de lo que se ve: un tono siempre significa lo mismo.
  const maximo = Math.max(0, ...valores.values());

  const where = {
    organizationId: orgId,
    active: true,
    latitud: { gte: limites.sur, lte: limites.norte },
    longitud: { gte: limites.oeste, lte: limites.este },
    ...(filtros.siteId ? { siteId: filtros.siteId } : {}),
    ...(filtros.categoryId ? { categoryId: filtros.categoryId } : {}),
  };
  const leidos = await prisma.asset.findMany({
    where, select: { id: true, latitud: true, longitud: true, status: true, parentId: true }, take: TOPE_LECTURA,
  });
  // El filtro de estado es sobre el estado EFECTIVO: «fuera de servicio» incluye lo que está parado ahora.
  const filas = leidos
    .map((a) => {
      const e = estadoEfectivo(a.status, vivo.paro.get(a.id), vivo.orden.get(a.id));
      return { id: a.id, padreId: a.parentId, latitud: a.latitud as number, longitud: a.longitud as number, status: e.status, motivo: e.motivo, valor: valores.get(a.id) ?? 0 };
    })
    .filter((f) => !filtros.status || f.status === filtros.status);

  const total = filas.length;
  const incompleto = leidos.length >= TOPE_LECTURA && (await prisma.asset.count({ where })) > TOPE_LECTURA;
  const suma = Math.round(filas.reduce((s, f) => s + f.valor, 0) * 10) / 10;
  const base = { total, incompleto, capa, dias, maximo, suma };

  if (total <= TOPE_PUNTOS) {
    const ficha = new Map(
      (await prisma.asset.findMany({
        where: { organizationId: orgId, id: { in: filas.map((f) => f.id) } },
        select: { id: true, code: true, name: true, criticality: true },
      })).map((a) => [a.id, a]),
    );
    // Los nombres de los padres, acotados a la empresa: lo que viene en parentId no se cree.
    const idsPadre = [...new Set(filas.map((f) => f.padreId).filter((x): x is string => !!x))];
    const padres = new Map(
      (idsPadre.length ? await prisma.asset.findMany({ where: { organizationId: orgId, id: { in: idsPadre } }, select: { id: true, name: true } }) : [])
        .map((a) => [a.id, a.name]),
    );
    const puntos: PuntoMapa[] = filas
      .map(({ padreId, ...f }) => ({
        ...f, code: ficha.get(f.id)?.code ?? "", name: ficha.get(f.id)?.name ?? "", criticality: ficha.get(f.id)?.criticality ?? "B",
        padreId: padreId && padres.has(padreId) ? padreId : null, padreNombre: padreId ? padres.get(padreId) ?? null : null,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return { ...base, modo: "puntos", incompleto: false, puntos, grupos: [] };
  }

  return { ...base, modo: "grupos", puntos: [], grupos: agruparEnCeldas(filas, limites, rejilla.columnas, rejilla.filas) };
}
