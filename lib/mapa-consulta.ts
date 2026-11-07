/**
 * La consulta del mapa de activos. La usan la ruta y la prueba: la misma
 * función, para que la prueba diga lo que la pantalla hace.
 *
 * Siempre filtra por empresa. Lo que manda el navegador (la zona, los filtros)
 * solo acota; nunca decide de quién son los datos.
 */
import { prisma } from "./db";
import { TOPE_LECTURA, TOPE_PUNTOS, agruparEnCeldas, type Limites, type RespuestaMapa } from "./mapa";

export type FiltrosMapa = { siteId?: string; categoryId?: string; status?: string };
/** Cuántas celdas tiene la rejilla de grupos. Las pone el navegador según el tamaño del mapa en pantalla. */
export type Rejilla = { columnas: number; filas: number };

export async function consultarMapa(
  orgId: string, limites: Limites, filtros: FiltrosMapa = {}, rejilla: Rejilla = { columnas: 10, filas: 8 },
): Promise<RespuestaMapa> {
  const where = {
    organizationId: orgId,
    active: true,
    latitud: { gte: limites.sur, lte: limites.norte },
    longitud: { gte: limites.oeste, lte: limites.este },
    ...(filtros.siteId ? { siteId: filtros.siteId } : {}),
    ...(filtros.categoryId ? { categoryId: filtros.categoryId } : {}),
    ...(filtros.status ? { status: filtros.status } : {}),
  };

  const total = await prisma.asset.count({ where });

  if (total <= TOPE_PUNTOS) {
    const filas = await prisma.asset.findMany({
      where,
      select: { id: true, code: true, name: true, latitud: true, longitud: true, status: true, criticality: true },
      orderBy: { code: "asc" },
      take: TOPE_PUNTOS,
    });
    return {
      modo: "puntos", total, incompleto: false,
      // latitud y longitud no son nulas: el filtro de rango las excluye.
      puntos: filas.map((f) => ({ ...f, latitud: f.latitud as number, longitud: f.longitud as number })),
      grupos: [],
    };
  }

  const filas = await prisma.asset.findMany({
    where,
    select: { latitud: true, longitud: true, status: true },
    take: TOPE_LECTURA,
  });
  return {
    modo: "grupos", total, incompleto: total > TOPE_LECTURA, puntos: [],
    grupos: agruparEnCeldas(
      filas.map((f) => ({ latitud: f.latitud as number, longitud: f.longitud as number, status: f.status })),
      limites, rejilla.columnas, rejilla.filas,
    ),
  };
}
