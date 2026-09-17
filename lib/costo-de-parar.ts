import { prisma } from "./db";
import { ZONA_POR_OMISION, periodoAnterior, periodoIndicadores } from "./periodos";
import { zonaDeLaEmpresa } from "./indicadores";

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
  /** Donde queda en el croquis. Nulo en X/Y = sin colocar. */
  planoX: number | null;
  planoY: number | null;
  planoAncho: number;
  planoAlto: number;
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
        ? { startedAt: { ...(opciones.desde ? { gte: opciones.desde } : {}), ...(opciones.hasta ? { lt: opciones.hasta } : {}) } }
        : {}),
    },
    select: {
      minutes: true,
      planned: true,
      asset: {
        select: {
          id: true, code: true, name: true, detieneLinea: true,
          location: {
            select: {
              id: true, name: true, margenPorHora: true,
              planoX: true, planoY: true, planoAncho: true, planoAlto: true,
            },
          },
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
      planoX: loc?.planoX ?? null,
      planoY: loc?.planoY ?? null,
      planoAncho: loc?.planoAncho ?? 3,
      planoAlto: loc?.planoAlto ?? 2,
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

  // Los totales salen de los MINUTOS, no de sumar horas ya redondeadas por
  // area: asi se sumaban 28.8 h de planeado donde los indicadores daban 28.9
  // con los mismos eventos. Redondear una sola vez, al final.
  const minutos = (clave: "horasQueDetienen" | "horasPlaneadas") =>
    [...porArea.values()].reduce((s, a) => s + a[clave], 0);
  return {
    areas,
    perdida: areas.reduce((s, a) => s + a.perdida, 0),
    horasQueDetienen: h(minutos("horasQueDetienen")),
    horasPlaneadas: h(minutos("horasPlaneadas")),
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

/**
 * La ventana actual y la inmediata anterior, del mismo largo.
 *
 * Dias completos en la zona de la empresa y semiabiertas `[desde, hasta)`, con
 * la misma regla que los indicadores (`lib/periodos`): el paro de "90 dias"
 * aqui es el mismo que el del Panel y Reportes.
 */
export function ventanas(periodo: ClavePeriodo, ahora = new Date(), zona: string = ZONA_POR_OMISION) {
  const actual = periodoIndicadores(PERIODOS[periodo].dias, zona, ahora);
  const anterior = periodoAnterior(actual);
  return {
    dias: actual.dias,
    actual: { desde: actual.desde, hasta: actual.hasta },
    anterior: { desde: anterior.desde, hasta: anterior.hasta },
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
  /**
   * Ventana delimitada a mano. Si viene, manda sobre el periodo y se compara
   * contra el tramo inmediatamente anterior DEL MISMO LARGO — que es lo unico
   * que hace honesta la flecha, sea la ventana de 90 dias o de tres semanas.
   */
  propia?: { desde: Date; hasta: Date } | null,
): Promise<Comparado> {
  const v = ventanas(periodo, ahora, await zonaDeLaEmpresa(organizationId));
  const actualRango = propia ?? v.actual;
  const largo = actualRango.hasta.getTime() - actualRango.desde.getTime();
  const anteriorRango = propia
    ? { desde: new Date(actualRango.desde.getTime() - largo), hasta: actualRango.desde }
    : v.anterior;
  const [actual, previo] = await Promise.all([
    costoDeParar(organizationId, actualRango),
    costoDeParar(organizationId, anteriorRango),
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


// ───────────────────────────────────────────── El latido de la planta ───

export type EventoDeParo = {
  id: string;
  /** Milisegundos desde epoch: el cliente los posiciona sin volver a parsear. */
  inicio: number;
  minutos: number;
  planeado: boolean;
  assetId: string;
  code: string;
  name: string;
  area: string;
  locationId: string | null;
  detieneLinea: boolean | null;
  /** Lo que costo ESTE paro. Cero si el equipo no detiene o el area no tiene tarifa. */
  perdida: number;
  folio: string | null;
  queSeHizo: string | null;
};

/**
 * Cada paro, uno por uno, con su lugar en el tiempo.
 *
 * Una barra mensual destruye justo lo que hace falta ver. "45 horas en julio"
 * no dice si fue un paro largo o doce cortos, y esa diferencia ES el
 * diagnostico: un equipo que para cada tres semanas como reloj tiene un
 * patron; uno que paro dos veces tuvo dos accidentes. Se atienden distinto.
 *
 * Por eso viajan los eventos crudos y no un agregado: el ritmo solo se ve
 * cuando cada paro ocupa su lugar en la linea del tiempo.
 */
export async function eventosDeParo(
  organizationId: string,
  rango: { desde: Date; hasta: Date },
): Promise<EventoDeParo[]> {
  const eventos = await prisma.downtimeEvent.findMany({
    where: { asset: { organizationId }, startedAt: { gte: rango.desde, lt: rango.hasta } },
    orderBy: { startedAt: "asc" },
    select: {
      id: true, startedAt: true, minutes: true, planned: true,
      workOrder: { select: { number: true, resolution: true } },
      asset: {
        select: {
          id: true, code: true, name: true, detieneLinea: true,
          location: { select: { id: true, name: true, margenPorHora: true } },
        },
      },
    },
  });

  return eventos.map((e) => ({
    id: e.id,
    inicio: e.startedAt.getTime(),
    minutos: e.minutes,
    planeado: e.planned,
    assetId: e.asset.id,
    code: e.asset.code,
    name: e.asset.name,
    area: e.asset.location?.name ?? "Sin ubicación",
    locationId: e.asset.location?.id ?? null,
    detieneLinea: e.asset.detieneLinea,
    // Mismo criterio que costoDeParar: solo cuesta el paro no planeado de un
    // equipo que detiene la linea. Repetir la regla aqui seria arriesgar que
    // se separen; se calcula igual y con los mismos datos.
    perdida:
      !e.planned && e.asset.detieneLinea === true
        ? Math.round((e.minutes / HORA) * (e.asset.location?.margenPorHora ?? 0))
        : 0,
    folio: e.workOrder?.number ?? null,
    queSeHizo: e.workOrder?.resolution ?? null,
  }));
}
