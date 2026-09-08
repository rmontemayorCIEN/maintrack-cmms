import { prisma } from "./db";

/**
 * Cuanto costo que la planta se detuviera.
 *
 * Traduce horas de paro a dinero, que es el idioma en el que un dueno decide.
 * "155 horas" no le dice nada a quien firma los cheques; "esto vale tanto" si.
 *
 * ── La regla que hace honesto el numero ──
 *
 * Solo cuenta el paro de los equipos MARCADOS como que detienen la linea, a la
 * tarifa de SU ubicacion. Sin eso, al extractor de humos se le cargaria la
 * tarifa completa de la nave y el total seria una mentira con apariencia de
 * precision — la clase de numero que alguien tumba en una junta y que de paso
 * desacredita todo lo demas.
 *
 * ── El paro planeado no vale lo mismo ──
 *
 * Se reporta aparte y NO se suma a la perdida. El mantenimiento programado en
 * domingo sin produccion no costo produccion; contarlo como perdida haria ver
 * caro justamente lo que se quiere fomentar.
 *
 * ── El total viene con su propia confianza ──
 *
 * Si faltan equipos por definir o areas sin tarifa, lo que se devuelve es un
 * PISO, no un dato. La pantalla debe decir "al menos $X". Un numero presentado
 * como exacto cuando media planta esta sin capturar es peor que no darlo.
 */

export type CostoPorArea = {
  locationId: string | null;
  area: string;
  /** Lo que deja de ganarse por hora en esta area. Cero = sin capturar. */
  margenPorHora: number;
  /** Horas de paro de equipos que SI detienen la linea. */
  horasQueDetienen: number;
  /** Horas de paro de equipos que no detienen, o que nadie ha definido. */
  horasQueNoDetienen: number;
  horasPlaneadas: number;
  /** Horas por dinero. Cero si el area no tiene tarifa. */
  perdida: number;
  equipos: Array<{
    assetId: string;
    code: string;
    name: string;
    detieneLinea: boolean | null;
    horas: number;
    perdida: number;
  }>;
};

export type Cobertura = {
  equiposConParo: number;
  equiposDefinidos: number;
  areasConParo: number;
  areasConTarifa: number;
  /** Si falta algo por capturar, el total es un piso y hay que decirlo. */
  completa: boolean;
};

export type ResumenCosto = {
  areas: CostoPorArea[];
  /** Suma de las perdidas. Con cobertura incompleta es un PISO. */
  perdida: number;
  horasQueDetienen: number;
  horasPlaneadas: number;
  cobertura: Cobertura;
};

const HORA = 60;

/** Redondea a un decimal, que es toda la precision que tiene sentido en horas. */
const h = (minutos: number) => Math.round((minutos / HORA) * 10) / 10;

export async function costoDeParar(
  organizationId: string,
  opciones?: { desde?: Date; hasta?: Date },
): Promise<ResumenCosto> {
  const eventos = await prisma.downtimeEvent.findMany({
    where: {
      asset: { organizationId },
      ...(opciones?.desde || opciones?.hasta
        ? { startedAt: { ...(opciones.desde ? { gte: opciones.desde } : {}), ...(opciones.hasta ? { lte: opciones.hasta } : {}) } }
        : {}),
    },
    select: {
      minutes: true,
      planned: true,
      asset: {
        select: {
          id: true, code: true, name: true, detieneLinea: true,
          location: { select: { id: true, name: true, margenPorHora: true } },
        },
      },
    },
  });

  type Acumulado = Omit<CostoPorArea, "equipos"> & { equipos: Map<string, CostoPorArea["equipos"][number]> };
  const porArea = new Map<string, Acumulado>();

  for (const e of eventos) {
    const loc = e.asset.location;
    const clave = loc?.id ?? "__sin_ubicacion__";
    const area = porArea.get(clave) ?? {
      locationId: loc?.id ?? null,
      area: loc?.name ?? "Sin ubicación",
      margenPorHora: loc?.margenPorHora ?? 0,
      horasQueDetienen: 0,
      horasQueNoDetienen: 0,
      horasPlaneadas: 0,
      perdida: 0,
      equipos: new Map(),
    };

    const eq = area.equipos.get(e.asset.id) ?? {
      assetId: e.asset.id, code: e.asset.code, name: e.asset.name,
      detieneLinea: e.asset.detieneLinea, horas: 0, perdida: 0,
    };

    if (e.planned) {
      // El paro planeado se reporta, pero no se cobra como perdida.
      area.horasPlaneadas += e.minutes;
    } else if (e.asset.detieneLinea === true) {
      area.horasQueDetienen += e.minutes;
      eq.horas += e.minutes;
    } else {
      // Incluye los que nadie ha definido: en la duda no se cobra, y la
      // cobertura de abajo se encarga de que el hueco se vea.
      area.horasQueNoDetienen += e.minutes;
      eq.horas += e.minutes;
    }

    area.equipos.set(e.asset.id, eq);
    porArea.set(clave, area);
  }

  const areas: CostoPorArea[] = [...porArea.values()].map((a) => {
    const horasQueDetienen = h(a.horasQueDetienen);
    const perdida = Math.round(horasQueDetienen * a.margenPorHora);
    return {
      ...a,
      horasQueDetienen,
      horasQueNoDetienen: h(a.horasQueNoDetienen),
      horasPlaneadas: h(a.horasPlaneadas),
      perdida,
      equipos: [...a.equipos.values()]
        .map((e) => ({
          ...e,
          horas: h(e.horas),
          perdida: e.detieneLinea === true ? Math.round(h(e.horas) * a.margenPorHora) : 0,
        }))
        .sort((x, y) => y.horas - x.horas),
    };
  }).sort((x, y) => y.perdida - x.perdida || y.horasQueDetienen - x.horasQueDetienen);

  const equipos = areas.flatMap((a) => a.equipos);
  const cobertura: Cobertura = {
    equiposConParo: equipos.length,
    equiposDefinidos: equipos.filter((e) => e.detieneLinea !== null).length,
    /**
     * Solo cuentan las areas que DETIENEN produccion.
     *
     * Un area cuyos paros no detienen nada no necesita tarifa, y pedirsela al
     * usuario lo manda a capturar un dato que no cambia ningun resultado. Que
     * el almacen no tenga tarifa no es un hueco: es que ahi no se pierde
     * produccion.
     */
    areasConParo: areas.filter((a) => a.horasQueDetienen > 0).length,
    areasConTarifa: areas.filter((a) => a.horasQueDetienen > 0 && a.margenPorHora > 0).length,
    completa: false,
  };
  cobertura.completa =
    cobertura.equiposConParo === cobertura.equiposDefinidos &&
    cobertura.areasConParo === cobertura.areasConTarifa;

  return {
    areas,
    perdida: areas.reduce((s, a) => s + a.perdida, 0),
    horasQueDetienen: Math.round(areas.reduce((s, a) => s + a.horasQueDetienen, 0) * 10) / 10,
    horasPlaneadas: Math.round(areas.reduce((s, a) => s + a.horasPlaneadas, 0) * 10) / 10,
    cobertura,
  };
}

/**
 * Como presentar el total sin mentir.
 *
 * Con cobertura incompleta dice "al menos": el numero es un piso. Decirlo
 * exacto cuando falta la mitad por capturar es lo que hace que despues nadie
 * le crea al tablero.
 */
export function comoDecirlo(r: ResumenCosto): { prefijo: string; falta: string | null } {
  if (r.cobertura.completa) return { prefijo: "", falta: null };
  const pendientes: string[] = [];
  const eqFaltan = r.cobertura.equiposConParo - r.cobertura.equiposDefinidos;
  const arFaltan = r.cobertura.areasConParo - r.cobertura.areasConTarifa;
  if (eqFaltan > 0) {
    pendientes.push(`${eqFaltan} equipo${eqFaltan === 1 ? "" : "s"} sin definir si detiene${eqFaltan === 1 ? "" : "n"} la línea`);
  }
  if (arFaltan > 0) {
    pendientes.push(`${arFaltan} área${arFaltan === 1 ? "" : "s"} sin tarifa por hora`);
  }
  return { prefijo: "al menos ", falta: pendientes.join(" y ") };
}

// ─────────────────────────────────────────────────────────── Periodos ───

/**
 * Ventanas moviles, no trimestres de calendario.
 *
 * "Este trimestre" a cinco dias de empezado compara cinco dias contra noventa,
 * y el tablero mostraria un desplome que no ocurrio. Una ventana movil siempre
 * compara periodos del mismo largo, que es lo unico que hace honesta la flecha.
 */
export const PERIODOS = {
  MES: { etiqueta: "Últimos 30 días", dias: 30 },
  TRIMESTRE: { etiqueta: "Últimos 90 días", dias: 90 },
  SEMESTRE: { etiqueta: "Últimos 6 meses", dias: 180 },
  ANO: { etiqueta: "Último año", dias: 365 },
} as const;

export type ClavePeriodo = keyof typeof PERIODOS;

export function esPeriodo(v: string | undefined): v is ClavePeriodo {
  return Boolean(v && v in PERIODOS);
}

/** La ventana actual y la inmediata anterior, del mismo largo. */
export function ventanas(periodo: ClavePeriodo, ahora = new Date()) {
  const dias = PERIODOS[periodo].dias;
  const ms = dias * 86_400_000;
  const hasta = ahora;
  const desde = new Date(ahora.getTime() - ms);
  return {
    dias,
    actual: { desde, hasta },
    anterior: { desde: new Date(desde.getTime() - ms), hasta: desde },
  };
}

export type Comparado = ResumenCosto & {
  /** El mismo calculo en la ventana anterior, para poder decir si va peor. */
  anterior: { perdida: number; horasQueDetienen: number; horasPlaneadas: number };
  /**
   * Cambio porcentual de la perdida. Nulo cuando antes no habia nada: de cero
   * a algo no es "infinito por ciento", es que empezo a medirse.
   */
  cambio: number | null;
};

export async function costoComparado(
  organizationId: string,
  periodo: ClavePeriodo,
  ahora = new Date(),
): Promise<Comparado> {
  const v = ventanas(periodo, ahora);
  const [actual, previo] = await Promise.all([
    costoDeParar(organizationId, v.actual),
    costoDeParar(organizationId, v.anterior),
  ]);
  return {
    ...actual,
    anterior: {
      perdida: previo.perdida,
      horasQueDetienen: previo.horasQueDetienen,
      horasPlaneadas: previo.horasPlaneadas,
    },
    cambio: previo.perdida > 0
      ? Math.round(((actual.perdida - previo.perdida) / previo.perdida) * 100)
      : null,
  };
}

// ────────────────────────────────────────────────────── Serie mensual ───

export type Mes = {
  /** "2026-09", para ordenar sin ambiguedad. */
  clave: string;
  etiqueta: string;
  horas: number;
  perdida: number;
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Los ultimos N meses, para la franja que se arrastra.
 *
 * Se devuelven TODOS los meses del rango, incluidos los que no tuvieron ningun
 * paro. Saltarselos deformaria la franja: un hueco de tres meses buenos se
 * veria como si fueran consecutivos y la tendencia mentiria.
 */
export async function serieMensual(
  organizationId: string,
  meses = 12,
  ahora = new Date(),
): Promise<Mes[]> {
  const desde = new Date(ahora.getFullYear(), ahora.getMonth() - (meses - 1), 1);
  const eventos = await prisma.downtimeEvent.findMany({
    where: { asset: { organizationId }, planned: false, startedAt: { gte: desde, lte: ahora } },
    select: {
      minutes: true, startedAt: true,
      asset: { select: { detieneLinea: true, location: { select: { margenPorHora: true } } } },
    },
  });

  const porMes = new Map<string, { minutos: number; perdida: number }>();
  for (let i = 0; i < meses; i += 1) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - (meses - 1) + i, 1);
    porMes.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, { minutos: 0, perdida: 0 });
  }

  for (const e of eventos) {
    if (e.asset.detieneLinea !== true) continue;
    const d = e.startedAt;
    const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const acc = porMes.get(clave);
    if (!acc) continue;
    acc.minutos += e.minutes;
    acc.perdida += (e.minutes / HORA) * (e.asset.location?.margenPorHora ?? 0);
  }

  return [...porMes.entries()].map(([clave, v]) => {
    const [ano, mes] = clave.split("-");
    return {
      clave,
      etiqueta: `${MESES[Number(mes) - 1]} ${ano.slice(2)}`,
      horas: h(v.minutos),
      perdida: Math.round(v.perdida),
    };
  });
}
