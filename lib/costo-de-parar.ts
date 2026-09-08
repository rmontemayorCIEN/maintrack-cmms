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
    areasConParo: areas.length,
    areasConTarifa: areas.filter((a) => a.margenPorHora > 0).length,
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
