/**
 * Cuanto se puede gastar, contra cuanto se lleva gastado.
 *
 * ── Por que existe ──
 *
 * El sistema ya sabia decir lo que se va a gastar —el planificador de
 * compras— y lo que se gasto —el costo por centro de costo—, pero no habia
 * contra que compararlo. Sin presupuesto, «llevamos 340 mil» no es ni bueno ni
 * malo: es un numero suelto.
 *
 * ── Dos decisiones, y por que ──
 *
 * **Mensual.** De los meses sale el trimestre y el año sumando; de un anual no
 * sale el mes. Repartir un anual entre doce miente en cuanto hay un paro
 * programado o una temporada alta.
 *
 * **Un solo monto por centro**, sin desglosar en mano de obra, refacciones y
 * servicios. El gasto real SI se muestra desglosado, asi que se ve en que se
 * fue sin obligar a nadie a mantener cuatro cifras al dia. Un presupuesto
 * desglosado que nadie actualiza es peor que uno solo que si se cuida.
 *
 * ── Que cuenta como gastado ──
 *
 * Lo mismo que cuenta en el costo por centro de costo: ordenes TERMINADAS en
 * el mes, por su fecha de termino. Ni una definicion nueva ni una parecida:
 * dos respuestas distintas a «cuanto llevamos» no sirven para decidir. Lo
 * comprometido —lo que ya se pidio y no ha llegado— NO se suma aqui: es otra
 * pregunta y mezclarla haria que el ejercido pareciera mayor de lo que es.
 */
import { prisma } from "./db";
import { ESTADOS_TERMINADOS } from "./vencimiento";
import { medianocheEnZona } from "./periodos";

/** Error de captura: es del usuario, no del sistema. */
export class ErrorDePresupuesto extends Error {
  constructor(mensaje: string, readonly codigo = 422) { super(mensaje); }
}

/** Los limites de un mes, en la zona de la empresa. */
export function limitesDelMes(anio: number, mes: number, zona: string) {
  const desde = medianocheEnZona(anio, mes, 1, zona);
  const siguiente = mes === 12 ? { a: anio + 1, m: 1 } : { a: anio, m: mes + 1 };
  return { desde, hasta: medianocheEnZona(siguiente.a, siguiente.m, 1, zona) };
}

export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Deja un presupuesto en un valor. Es el UNICO punto de escritura.
 *
 * Un monto en cero es valido y significa «este centro no gasta este mes»;
 * borrarlo significa «no se ha presupuestado», que es distinto. Por eso cero y
 * ausencia no se confunden: la pantalla los muestra diferente.
 */
export async function guardarPresupuesto(params: {
  organizationId: string;
  userId: string;
  centroDeCostoId: string;
  anio: number;
  mes: number;
  monto: number;
  nota?: string | null;
}) {
  const { organizationId, centroDeCostoId, anio, mes } = params;
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new ErrorDePresupuesto("El mes tiene que estar entre 1 y 12");
  }
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    throw new ErrorDePresupuesto("El año no es válido");
  }
  if (!Number.isFinite(params.monto) || params.monto < 0) {
    throw new ErrorDePresupuesto("El monto no puede ser negativo");
  }
  // Acotado por empresa: sin esto se podria presupuestar el centro de otra.
  const centro = await prisma.centroDeCosto.findFirst({
    where: { id: centroDeCostoId, organizationId },
    select: { id: true },
  });
  if (!centro) throw new ErrorDePresupuesto("Ese centro de costo no existe en esta empresa", 404);

  return prisma.presupuesto.upsert({
    where: { centroDeCostoId_anio_mes: { centroDeCostoId, anio, mes } },
    create: {
      organizationId, centroDeCostoId, anio, mes,
      monto: params.monto, nota: params.nota?.trim() || null, capturadoPorId: params.userId,
    },
    update: {
      monto: params.monto, nota: params.nota?.trim() || null, capturadoPorId: params.userId,
    },
    select: { id: true, monto: true, anio: true, mes: true },
  });
}

/**
 * Quita el presupuesto de un mes: no es lo mismo que dejarlo en cero.
 *
 * Se borra por centro y mes, no por id: es lo que la pantalla tiene a la mano
 * al vaciar una casilla, y asi quitar dos veces lo mismo no truena.
 */
export async function borrarPresupuesto(params: {
  organizationId: string; centroDeCostoId: string; anio: number; mes: number;
}) {
  const { count } = await prisma.presupuesto.deleteMany({
    where: {
      organizationId: params.organizationId,
      centroDeCostoId: params.centroDeCostoId,
      anio: params.anio,
      mes: params.mes,
    },
  });
  return { quitados: count };
}

export type RenglonPresupuesto = {
  centroDeCostoId: string;
  code: string;
  name: string;
  /** Null cuando NO se ha presupuestado. Cero es un presupuesto de cero. */
  presupuesto: number | null;
  gastado: number;
  manoDeObra: number;
  refacciones: number;
  servicios: number;
  otros: number;
  ordenes: number;
  /** Null cuando no hay presupuesto: sin contra que comparar no hay sobrante. */
  diferencia: number | null;
  /** Porcentaje ejercido. Null sin presupuesto; null tambien si el presupuesto es 0. */
  ejercido: number | null;
  /** Lo presupuestado mes por mes, para ver la curva del año. */
  porMes: Array<{ mes: number; presupuesto: number | null; gastado: number }>;
};

/**
 * El comparativo de un año, centro por centro.
 *
 * Trae TODOS los centros activos, tengan o no presupuesto: uno sin presupuesto
 * y con gasto es justo lo que hay que ver, y si solo saliera lo presupuestado
 * se escondería el gasto que nadie previo.
 */
export async function comparativoDePresupuesto(
  organizationId: string,
  opciones: { anio: number; zona: string; desdeMes?: number; hastaMes?: number },
): Promise<{
  renglones: RenglonPresupuesto[];
  totales: { presupuesto: number; gastado: number; diferencia: number; ejercido: number | null };
  anio: number;
  desdeMes: number;
  hastaMes: number;
  /** Centros con gasto y sin presupuesto: el hueco que conviene cerrar. */
  sinPresupuestar: string[];
}> {
  const { anio, zona } = opciones;
  const desdeMes = Math.min(Math.max(opciones.desdeMes ?? 1, 1), 12);
  const hastaMes = Math.min(Math.max(opciones.hastaMes ?? 12, desdeMes), 12);

  const inicio = limitesDelMes(anio, desdeMes, zona).desde;
  const fin = limitesDelMes(anio, hastaMes, zona).hasta;

  const [centros, presupuestos, terminadas] = await Promise.all([
    prisma.centroDeCosto.findMany({
      where: { organizationId, active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.presupuesto.findMany({
      where: { organizationId, anio, mes: { gte: desdeMes, lte: hastaMes } },
      select: { centroDeCostoId: true, mes: true, monto: true },
    }),
    // El mismo criterio del costo por centro de costo: terminadas, por fecha
    // de termino. No se inventa una definicion nueva de «gastado».
    prisma.workOrder.findMany({
      where: {
        organizationId,
        status: { in: [...ESTADOS_TERMINADOS] },
        completedAt: { gte: inicio, lt: fin },
      },
      select: {
        centroDeCostoId: true, completedAt: true,
        totalCost: true, laborCost: true, partsCost: true, serviceCost: true, otherCost: true,
      },
    }),
  ]);

  const mesDe = (fecha: Date) => {
    // El mes de la EMPRESA: una orden cerrada a las 11 de la noche del 31 no
    // puede caer en el mes siguiente por estar el servidor en UTC.
    const texto = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit" }).format(fecha);
    return Number(texto.slice(5, 7));
  };

  const presuDe = new Map<string, number>();
  for (const p of presupuestos) presuDe.set(`${p.centroDeCostoId}:${p.mes}`, p.monto);

  const gastoDe = new Map<string, { total: number; mo: number; ref: number; serv: number; otros: number; ordenes: number }>();
  for (const o of terminadas) {
    if (!o.centroDeCostoId || !o.completedAt) continue;
    const k = `${o.centroDeCostoId}:${mesDe(o.completedAt)}`;
    const g = gastoDe.get(k) ?? { total: 0, mo: 0, ref: 0, serv: 0, otros: 0, ordenes: 0 };
    g.total += o.totalCost; g.mo += o.laborCost; g.ref += o.partsCost;
    g.serv += o.serviceCost; g.otros += o.otherCost; g.ordenes += 1;
    gastoDe.set(k, g);
  }

  const renglones: RenglonPresupuesto[] = centros.map((c) => {
    const porMes: RenglonPresupuesto["porMes"] = [];
    let presupuesto: number | null = null;
    let gastado = 0, mo = 0, ref = 0, serv = 0, otros = 0, ordenes = 0;

    for (let m = desdeMes; m <= hastaMes; m++) {
      const p = presuDe.get(`${c.id}:${m}`) ?? null;
      const g = gastoDe.get(`${c.id}:${m}`);
      if (p !== null) presupuesto = (presupuesto ?? 0) + p;
      if (g) {
        gastado += g.total; mo += g.mo; ref += g.ref; serv += g.serv; otros += g.otros; ordenes += g.ordenes;
      }
      porMes.push({ mes: m, presupuesto: p, gastado: g?.total ?? 0 });
    }

    return {
      centroDeCostoId: c.id, code: c.code, name: c.name,
      presupuesto, gastado, manoDeObra: mo, refacciones: ref, servicios: serv, otros, ordenes,
      diferencia: presupuesto === null ? null : presupuesto - gastado,
      // Sin presupuesto no hay porcentaje; con presupuesto en cero tampoco,
      // porque dividir entre cero daria infinito y no dice nada.
      ejercido: presupuesto === null || presupuesto === 0 ? null : (gastado / presupuesto) * 100,
      porMes,
    };
  });

  const presupuestoTotal = renglones.reduce((s, r) => s + (r.presupuesto ?? 0), 0);
  const gastadoTotal = renglones.reduce((s, r) => s + r.gastado, 0);

  return {
    renglones,
    totales: {
      presupuesto: presupuestoTotal,
      gastado: gastadoTotal,
      diferencia: presupuestoTotal - gastadoTotal,
      ejercido: presupuestoTotal === 0 ? null : (gastadoTotal / presupuestoTotal) * 100,
    },
    anio, desdeMes, hastaMes,
    sinPresupuestar: renglones.filter((r) => r.presupuesto === null && r.gastado > 0).map((r) => r.code),
  };
}
