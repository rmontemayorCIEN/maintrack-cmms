import { prisma } from "./db";
import { proyectarActividades } from "./calendario-actividad";

/**
 * Qué refacciones va a pedir el mantenimiento preventivo, y cuándo.
 *
 * ── De dónde sale ──
 *
 * De cruzar dos cosas que el sistema ya sabía por separado y que nadie había
 * juntado: `proyectarActividades` dice qué actividad toca en qué equipo y qué
 * día, y `PlanTaskPart` dice qué refacción y cuánta consume cada actividad. El
 * calendario de lo que va a pasar, por el consumo de cada cosa.
 *
 * Se usa la MISMA proyección que pinta el calendario. Escribir una paralela
 * para compras habría sido garantizar que un día las fechas dejaran de
 * coincidir y nadie supiera cuál vale.
 *
 * ── Lo que esto NO es ──
 *
 * No es una predicción del consumo total del almacén: es lo que el PLAN
 * compromete. Lo correctivo no se puede proyectar —una falla no tiene fecha— y
 * por eso la cifra es un piso, no un pronóstico. Decirlo importa: presentado
 * como «lo que va a consumir» invita a comprar exactamente eso y quedarse
 * corto el día que algo se rompa.
 *
 * ── Por qué la cobertura viaja con el resultado ──
 *
 * Si los planes no tienen refacciones cargadas, el reporte sale en ceros y
 * parece roto —o peor, parece que no hace falta comprar nada—. La cobertura no
 * es una nota al pie: es parte de la respuesta, y va junto a ella.
 *
 * ── Y por qué se mide por PLAN y no por actividad ──
 *
 * Contarla por actividad mentía. La mayoría de las actividades de un
 * preventivo no consumen nada —revisar, medir, limpiar, probar— así que
 * «6 de 28 actividades» habría salido en rojo hasta en una empresa que lo
 * tuviera todo capturado, y el aviso se habría aprendido a ignorar.
 *
 * Un PLAN entero sin una sola refacción sí es señal: un plan de mantenimiento
 * de un equipo que no consume absolutamente nada existe, pero es raro. Eso es
 * lo que se cuenta, y aun así se dice como duda y no como acusación: el
 * sistema no puede distinguir «no consume» de «nadie lo capturó».
 */

export const PERIODOS_CONSUMO = {
  semana: { etiqueta: "Semana", dias: 7 },
  mes: { etiqueta: "Mes", dias: 30 },
  trimestre: { etiqueta: "Trimestre", dias: 90 },
} as const;
export type PeriodoConsumo = keyof typeof PERIODOS_CONSUMO;
export const esPeriodoConsumo = (v: string): v is PeriodoConsumo => v in PERIODOS_CONSUMO;

export type Cobertura = {
  /** Actividades distintas que aparecen en la proyección. */
  actividades: number;
  /** De ésas, cuántas tienen al menos una refacción cargada. */
  actividadesConRefacciones: number;
  /** Planes distintos que aparecen en la proyección. */
  planes: number;
  /** De ésos, cuántos tienen al menos una actividad con refacciones. */
  planesConRefacciones: number;
  /** Los que no tienen NINGUNA, por su nombre: es lo accionable. */
  planesSinRefacciones: string[];
  /** Equipos con trabajo proyectado en el horizonte. */
  equipos: number;
};

export type ColumnaConsumo = { clave: string; etiqueta: string; desde: Date; hasta: Date };

export type RenglonConsumo = {
  partId: string;
  code: string;
  name: string;
  unit: string;
  costoUnitario: number;
  existencia: number;
  minimo: number;
  /** Cuánto se va a consumir en cada columna, en el orden de `columnas`. */
  porPeriodo: number[];
  total: number;
  costoTotal: number;
  /** Equipos que la van a pedir, para saber a qué se debe. */
  equipos: string[];
};

/** Los tramos del horizonte, en la unidad pedida. */
function columnas(desde: Date, dias: number, periodo: PeriodoConsumo): ColumnaConsumo[] {
  const paso = PERIODOS_CONSUMO[periodo].dias;
  const cols: ColumnaConsumo[] = [];
  for (let i = 0; i * paso < dias; i++) {
    const ini = new Date(desde);
    ini.setDate(ini.getDate() + i * paso);
    const fin = new Date(ini);
    fin.setDate(fin.getDate() + paso);
    /**
     * La ULTIMA columna se estira hasta el final del horizonte.
     *
     * `proyectarActividades` incluye el ultimo dia (`f <= hasta`) y los tramos
     * son medio abiertos, asi que sin esto una visita que cayera justo ahi no
     * entraba en ninguna columna y su consumo se perdia sin decir nada. El
     * reporte habria salido con una refaccion de menos y nada lo delataria.
     */
    if ((i + 1) * paso >= dias) fin.setDate(fin.getDate() + 1);
    cols.push({
      clave: `${periodo}-${i}`,
      // La primera columna es «ahora», que es la que decide si hay que pedir
      // hoy. Las demás se nombran por su fecha de inicio.
      etiqueta: i === 0
        ? `${PERIODOS_CONSUMO[periodo].etiqueta} 1`
        : ini.toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
      desde: ini,
      hasta: fin,
    });
  }
  return cols;
}

/** La cobertura, contada por plan y por actividad. Ver el comentario de arriba. */
function coberturaDe(
  idsDeActividad: string[],
  porActividad: Map<string, unknown[]>,
  planDeActividad: Map<string, string>,
  equipos: number,
): Cobertura {
  const planes = new Map<string, boolean>();
  for (const id of idsDeActividad) {
    const plan = planDeActividad.get(id) ?? "—";
    planes.set(plan, (planes.get(plan) ?? false) || porActividad.has(id));
  }
  return {
    actividades: idsDeActividad.length,
    actividadesConRefacciones: idsDeActividad.filter((id) => porActividad.has(id)).length,
    planes: planes.size,
    planesConRefacciones: [...planes.values()].filter(Boolean).length,
    planesSinRefacciones: [...planes.entries()].filter(([, tiene]) => !tiene).map(([n]) => n),
    equipos,
  };
}

export async function consumoProyectado(
  organizationId: string,
  opciones: { dias?: number; periodo?: PeriodoConsumo } = {},
) {
  const dias = opciones.dias ?? 90;
  const periodo = opciones.periodo ?? "mes";
  const desde = new Date();
  desde.setHours(0, 0, 0, 0);
  const cols = columnas(desde, dias, periodo);

  const visitas = await proyectarActividades(organizationId, dias);

  const idsDeActividad = [...new Set(visitas.flatMap((v) => v.actividadIds))];
  const equiposConTrabajo = new Set(visitas.map((v) => v.assetId));
  // Nombre del plan por cada actividad, para poder decir cuál se quedó sin nada.
  const planDeActividad = new Map<string, string>();
  for (const v of visitas) for (const id of v.actividadIds) planDeActividad.set(id, v.planNombre);

  if (!idsDeActividad.length) {
    return {
      columnas: cols, renglones: [] as RenglonConsumo[], periodo, dias,
      cobertura: {
        actividades: 0, actividadesConRefacciones: 0,
        planes: 0, planesConRefacciones: 0, planesSinRefacciones: [],
        equipos: equiposConTrabajo.size,
      } satisfies Cobertura,
      total: 0, costoTotal: 0,
    };
  }

  const recursos = await prisma.planTaskPart.findMany({
    where: { planTaskId: { in: idsDeActividad }, part: { organizationId, active: true } },
    select: {
      planTaskId: true, quantity: true,
      part: { select: { id: true, code: true, name: true, unit: true, unitCost: true, quantityOnHand: true, minQuantity: true } },
    },
  });

  const porActividad = new Map<string, typeof recursos>();
  for (const r of recursos) {
    const lista = porActividad.get(r.planTaskId) ?? [];
    lista.push(r);
    porActividad.set(r.planTaskId, lista);
  }

  const acumulado = new Map<string, RenglonConsumo>();
  for (const v of visitas) {
    const col = cols.findIndex((c) => v.fecha >= c.desde && v.fecha < c.hasta);
    if (col < 0) continue;
    for (const actividadId of v.actividadIds) {
      for (const r of porActividad.get(actividadId) ?? []) {
        const p = r.part;
        const fila = acumulado.get(p.id) ?? {
          partId: p.id, code: p.code, name: p.name, unit: p.unit, costoUnitario: p.unitCost,
          existencia: p.quantityOnHand, minimo: p.minQuantity,
          porPeriodo: cols.map(() => 0), total: 0, costoTotal: 0, equipos: [],
        };
        fila.porPeriodo[col] += r.quantity;
        fila.total += r.quantity;
        fila.costoTotal = fila.total * p.unitCost;
        if (!fila.equipos.includes(v.assetCode)) fila.equipos.push(v.assetCode);
        acumulado.set(p.id, fila);
      }
    }
  }

  const renglones = [...acumulado.values()].sort((a, b) => b.costoTotal - a.costoTotal || b.total - a.total);
  return {
    columnas: cols,
    renglones,
    periodo,
    dias,
    cobertura: coberturaDe(idsDeActividad, porActividad, planDeActividad, equiposConTrabajo.size),
    total: renglones.reduce((a, r) => a + r.total, 0),
    costoTotal: renglones.reduce((a, r) => a + r.costoTotal, 0),
  };
}

/**
 * Lo que falta comprar de cada refacción, contra lo que hay.
 *
 * No es «cuánto se va a consumir» sino «cuánto NO alcanza»: si hay doce y el
 * plan va a pedir ocho, no hay nada que comprar por este concepto. El mínimo
 * entra porque quedarse en cero justo cuando toca el preventivo es lo mismo
 * que no tenerlo.
 */
export function faltantePara(r: RenglonConsumo, hastaColumna: number): number {
  const necesita = r.porPeriodo.slice(0, hastaColumna + 1).reduce((a, x) => a + x, 0);
  return Math.max(0, necesita + r.minimo - r.existencia);
}
