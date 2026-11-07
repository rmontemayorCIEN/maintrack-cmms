/**
 * Mapa de activos: lo que comparten el servidor y el navegador.
 *
 * Aquí NO se importa la base de datos: este archivo viaja al navegador. La
 * consulta vive en `mapa-consulta.ts`.
 *
 * De dónde salen las calles (los «mosaicos») es UN solo ajuste. Por omisión,
 * OpenStreetMap: gratis y sin llave, bueno para empezar y para la demostración,
 * pero su política pide uso ligero y no es para un SaaS con mucho tráfico. Para
 * producción se pasa a un proveedor con llave cambiando estas dos variables, sin
 * tocar código. Una llave de mosaicos va en la URL y por eso es visible en el
 * navegador: se protege restringiéndola por dominio con el proveedor, no
 * escondiéndola.
 *
 * Lo que el proveedor de mosaicos recibe: la IP de quien abre el mapa y la zona
 * que mira. Nunca los datos de los activos.
 */

export const MOSAICOS_URL =
  process.env.NEXT_PUBLIC_MAPA_MOSAICOS || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MOSAICOS_ATRIBUCION =
  process.env.NEXT_PUBLIC_MAPA_ATRIBUCION ||
  '© colaboradores de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

/** Hasta aquí se dibuja cada activo; más allá, se agrupan en celdas. */
export const TOPE_PUNTOS = 1500;
/** Cuántos activos se leen como máximo para agrupar. Si hay más, se avisa que es una muestra. */
export const TOPE_LECTURA = 100_000;

export type Limites = { norte: number; sur: number; este: number; oeste: number };

export type PuntoMapa = {
  id: string; code: string; name: string;
  latitud: number; longitud: number;
  status: string; criticality: string;
};

export type GrupoMapa = {
  latitud: number; longitud: number; cantidad: number;
  /** El estado más grave dentro del grupo: un grupo con una luminaria apagada no se ve «todo bien». */
  peor: string;
};

/** De más a menos grave. Un estado desconocido cuenta como el menos grave. */
const GRAVEDAD = ["DOWN", "DEGRADED", "OPERATIONAL", "STANDBY", "RETIRED"];
const gravedad = (estado: string) => {
  const i = GRAVEDAD.indexOf(estado);
  return i === -1 ? GRAVEDAD.length : i;
};
export const estadoMasGrave = (a: string, b: string) => (gravedad(a) <= gravedad(b) ? a : b);

/**
 * Agrupa puntos en una rejilla de celdas del tamaño de la vista. El centro de
 * cada grupo es el promedio de sus puntos, no el de la celda, para que el
 * círculo caiga donde está la gente y no en una esquina vacía.
 */
export function agruparEnCeldas(
  puntos: Array<{ latitud: number; longitud: number; status: string }>,
  limites: Limites,
  columnas = 10,
  filas = 8,
): GrupoMapa[] {
  const alto = (limites.norte - limites.sur) / filas;
  const ancho = (limites.este - limites.oeste) / columnas;
  const celdas = new Map<string, { sumaLat: number; sumaLon: number; n: number; peor: string }>();
  for (const p of puntos) {
    // Un punto sobre el borde exacto cae en la última celda, no en una inexistente.
    const f = Math.min(filas - 1, Math.max(0, Math.floor((p.latitud - limites.sur) / alto)));
    const c = Math.min(columnas - 1, Math.max(0, Math.floor((p.longitud - limites.oeste) / ancho)));
    const clave = `${f}:${c}`;
    const celda = celdas.get(clave);
    if (celda) {
      celda.sumaLat += p.latitud; celda.sumaLon += p.longitud; celda.n += 1;
      celda.peor = estadoMasGrave(celda.peor, p.status);
    } else {
      celdas.set(clave, { sumaLat: p.latitud, sumaLon: p.longitud, n: 1, peor: p.status });
    }
  }
  return [...celdas.values()].map((c) => ({
    latitud: c.sumaLat / c.n, longitud: c.sumaLon / c.n, cantidad: c.n, peor: c.peor,
  }));
}

/** Respuesta de /api/assets/mapa. */
export type RespuestaMapa = {
  modo: "puntos" | "grupos";
  /** Cuántos activos con coordenadas hay en la zona visible y con los filtros puestos. */
  total: number;
  /** En modo «grupos», true si había más de TOPE_LECTURA y lo mostrado es una muestra. */
  incompleto: boolean;
  puntos: PuntoMapa[];
  grupos: GrupoMapa[];
};
