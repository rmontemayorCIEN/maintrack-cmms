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

/**
 * Por qué se colorea el mapa. ESTADO es el estado de este momento; las demás son
 * números por activo en un período, y se pintan con una escala de una sola tinta.
 */
export const CAPAS = ["ESTADO", "FALLAS", "COSTO", "PAROS"] as const;
export type Capa = (typeof CAPAS)[number];
export const ETIQUETA_DE_CAPA: Record<Capa, string> = {
  ESTADO: "Estado de este momento",
  FALLAS: "Cantidad de fallas",
  COSTO: "Costo de mantenimiento",
  PAROS: "Horas de paro",
};
/** Los períodos que se ofrecen, en días. */
export const PERIODOS_DIAS = [30, 90, 365] as const;
export const PERIODO_POR_OMISION = 365;

/** La escala numérica tiene este número de tonos (además del «sin nada»). */
export const TONOS = 4;

/**
 * En qué tono cae un valor: 0 es «sin nada» y de ahí, cuartos del máximo. Las
 * capas numéricas casi siempre tienen muchísimos ceros y unos pocos muy altos:
 * por eso el cero se separa y el resto se reparte parejo hasta el máximo.
 */
export function tonoDe(valor: number, maximo: number): number {
  if (!(valor > 0) || !(maximo > 0)) return 0;
  return Math.min(TONOS, Math.max(1, Math.ceil((valor / maximo) * TONOS)));
}

export type PuntoMapa = {
  id: string; code: string; name: string;
  latitud: number; longitud: number;
  /** En la capa ESTADO es el estado EFECTIVO (el más grave entre el registrado y lo que pasa ahora). */
  status: string; criticality: string;
  /** La cifra de la capa para este activo (0 en ESTADO). */
  valor: number;
  /** Por qué el estado efectivo no es el registrado (paro abierto, orden correctiva abierta). Nulo si coincide. */
  motivo: string | null;
};

export type GrupoMapa = {
  latitud: number; longitud: number; cantidad: number;
  /** El estado más grave dentro del grupo: un grupo con una luminaria apagada no se ve «todo bien». */
  peor: string;
  /** El valor más alto de la capa dentro del grupo, y la suma de todos. */
  maxValor: number; sumaValor: number;
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
  puntos: Array<{ latitud: number; longitud: number; status: string; valor?: number }>,
  limites: Limites,
  columnas = 10,
  filas = 8,
): GrupoMapa[] {
  const alto = (limites.norte - limites.sur) / filas;
  const ancho = (limites.este - limites.oeste) / columnas;
  const celdas = new Map<string, { sumaLat: number; sumaLon: number; n: number; peor: string; max: number; suma: number }>();
  for (const p of puntos) {
    // Un punto sobre el borde exacto cae en la última celda, no en una inexistente.
    const f = Math.min(filas - 1, Math.max(0, Math.floor((p.latitud - limites.sur) / alto)));
    const c = Math.min(columnas - 1, Math.max(0, Math.floor((p.longitud - limites.oeste) / ancho)));
    const clave = `${f}:${c}`;
    const celda = celdas.get(clave);
    if (celda) {
      celda.sumaLat += p.latitud; celda.sumaLon += p.longitud; celda.n += 1;
      celda.peor = estadoMasGrave(celda.peor, p.status);
      celda.max = Math.max(celda.max, p.valor ?? 0);
      celda.suma += p.valor ?? 0;
    } else {
      celdas.set(clave, { sumaLat: p.latitud, sumaLon: p.longitud, n: 1, peor: p.status, max: p.valor ?? 0, suma: p.valor ?? 0 });
    }
  }
  return [...celdas.values()].map((c) => ({
    latitud: c.sumaLat / c.n, longitud: c.sumaLon / c.n, cantidad: c.n, peor: c.peor, maxValor: c.max, sumaValor: c.suma,
  }));
}

/** Respuesta de /api/assets/mapa. */
export type RespuestaMapa = {
  modo: "puntos" | "grupos";
  /** Cuántos activos con coordenadas hay en la zona visible y con los filtros puestos. */
  total: number;
  /** En modo «grupos», true si había más de TOPE_LECTURA y lo mostrado es una muestra. */
  incompleto: boolean;
  capa: Capa;
  dias: number;
  /**
   * El valor más alto de un activo en TODA la empresa (no solo en pantalla): la
   * escala no cambia al mover el mapa, y un tono siempre significa lo mismo.
   */
  maximo: number;
  /** La suma de la capa en la zona visible (0 en ESTADO). */
  suma: number;
  puntos: PuntoMapa[];
  grupos: GrupoMapa[];
};
