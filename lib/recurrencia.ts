import { prisma } from "./db";
import { filtroDeFalla } from "./fallas";
import { periodoDeLaEmpresa } from "./indicadores";
import { claveDiaEnZona, dentroDe } from "./periodos";

/**
 * El expediente de fallas de un equipo, calculado en codigo.
 *
 * Todo lo que sea contar, medir o promediar se hace aqui: cuantas veces fallo,
 * cada cuanto, cuanto costo, que se le cambio. Son las cifras que despues se
 * pueden defender renglon por renglon frente a un gerente.
 *
 * Lo que el codigo NO puede hacer es leer cinco resoluciones escritas por tres
 * tecnicos distintos y notar que las cinco hablan de vibracion aunque ninguna
 * use esa palabra. Eso es lo unico que se le pide al modelo.
 */

const DIA = 86_400_000;

export type Expediente = Awaited<ReturnType<typeof expedienteDeFallas>>;

export async function expedienteDeFallas(organizationId: string, assetId: string, dias = 365) {
  // El mismo periodo que los indicadores: dias completos en la zona de la
  // empresa. Antes eran 365 dias al milisegundo desde este instante.
  const periodo = await periodoDeLaEmpresa(organizationId, dias);
  const zona = periodo.zonaHoraria;

  const deFalla = await filtroDeFalla(organizationId);
  const [activo, ordenes, paros] = await Promise.all([
    prisma.asset.findFirst({
      where: { id: assetId, organizationId },
      select: {
        id: true, code: true, name: true, criticality: true, status: true,
        manufacturer: true, model: true, commissionedAt: true, replacementCost: true,
        category: { select: { name: true } },
        location: { select: { name: true } },
        site: { select: { name: true } },
      },
    }),
    prisma.workOrder.findMany({
      where: {
        organizationId, assetId,
        // La regla unica de falla (`lib/fallas`), sin canceladas.
        ...deFalla,
        createdAt: dentroDe(periodo),
      },
      orderBy: { createdAt: "asc" },
      select: {
        number: true, title: true, description: true, resolution: true,
        createdAt: true, completedAt: true, status: true,
        downtimeMinutes: true, totalCost: true, laborCost: true, partsCost: true,
        failureCode: { select: { code: true, description: true } },
        rootCause: { select: { code: true, description: true } },
        partsUsed: { select: { quantity: true, cost: true, part: { select: { code: true, name: true } } } },
      },
    }),
    // El paro sale de los eventos de paro no planeados, como en los indicadores.
    prisma.downtimeEvent.findMany({
      where: { assetId, organizationId, planned: false, startedAt: dentroDe(periodo) },
      select: { minutes: true },
    }),
  ]);
  if (!activo) return null;

  // Dias entre falla y falla. Con menos de dos fallas no hay intervalo que
  // medir, y decir "cada 0 días" seria peor que no decir nada.
  const fechas = ordenes.map((o) => o.createdAt.getTime()).sort((a, b) => a - b);
  const intervalos: number[] = [];
  for (let i = 1; i < fechas.length; i++) intervalos.push(Math.round((fechas[i] - fechas[i - 1]) / DIA));
  const promedio = intervalos.length
    ? Math.round(intervalos.reduce((a, b) => a + b, 0) / intervalos.length)
    : null;

  /**
   * Si las fallas se estan acercando.
   *
   * Se comparan la primera mitad de los intervalos contra la segunda. Un
   * equipo que fallaba cada 90 dias y ahora falla cada 20 esta empeorando, y
   * esa tendencia importa mas que el promedio: el promedio la esconde.
   */
  let tendencia: "ACELERANDO" | "ESTABLE" | "ESPACIANDO" | null = null;
  if (intervalos.length >= 4) {
    const mitad = Math.floor(intervalos.length / 2);
    const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const antes = media(intervalos.slice(0, mitad));
    const despues = media(intervalos.slice(mitad));
    tendencia = despues < antes * 0.7 ? "ACELERANDO" : despues > antes * 1.3 ? "ESPACIANDO" : "ESTABLE";
  }

  const contar = <T extends string>(valores: Array<T | null | undefined>) => {
    const m = new Map<T, number>();
    for (const v of valores) if (v) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([que, veces]) => ({ que, veces }));
  };

  const refacciones = new Map<string, { code: string; name: string; veces: number; cantidad: number; costo: number }>();
  for (const o of ordenes) {
    for (const p of o.partsUsed) {
      const previo = refacciones.get(p.part.code) ?? { code: p.part.code, name: p.part.name, veces: 0, cantidad: 0, costo: 0 };
      previo.veces += 1;
      previo.cantidad += p.quantity;
      previo.costo += p.cost;
      refacciones.set(p.part.code, previo);
    }
  }

  const costo = ordenes.reduce((s, o) => s + o.totalCost, 0);
  const paroHoras = Math.round(paros.reduce((s, e) => s + e.minutes, 0) / 60);

  return {
    activo,
    periodoDias: dias,
    fallas: ordenes.length,
    primera: fechas.length ? new Date(fechas[0]) : null,
    ultima: fechas.length ? new Date(fechas[fechas.length - 1]) : null,
    diasEntreFallas: promedio,
    intervalos,
    tendencia,
    costoTotal: costo,
    /// Lo que llevaria de gasto anual al ritmo del periodo analizado.
    costoAnualizado: dias > 0 ? Math.round((costo / dias) * 365) : 0,
    /// Cuanto representa ese gasto contra reponer el equipo.
    porcentajeDeReposicion:
      activo.replacementCost > 0 ? Math.round((costo / activo.replacementCost) * 100) : null,
    paroHoras,
    modosDeFalla: contar(ordenes.map((o) => o.failureCode?.description)),
    causasRaiz: contar(ordenes.map((o) => o.rootCause?.description)),
    sinCausaRaiz: ordenes.filter((o) => !o.rootCause).length,
    refaccionesMasUsadas: [...refacciones.values()].sort((a, b) => b.veces - a.veces).slice(0, 8),
    ordenes: ordenes.map((o) => ({
      folio: o.number,
      cuando: claveDiaEnZona(o.createdAt, zona),
      titulo: o.title,
      descripcion: o.description,
      resolucion: o.resolution,
      modoFalla: o.failureCode?.description ?? null,
      causaRaiz: o.rootCause?.description ?? null,
      paroMinutos: o.downtimeMinutes,
      costo: o.totalCost,
      refacciones: o.partsUsed.map((p) => `${p.quantity} × ${p.part.code} ${p.part.name}`),
    })),
  };
}
