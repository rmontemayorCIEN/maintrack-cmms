/**
 * Refacciones que pueden usarse una por otra.
 *
 * El par se guarda una sola vez, con los ids en orden canonico, y se lee en
 * los dos sentidos. Guardar los dos renglones invita a que uno se actualice y
 * el otro no, y entonces el almacen contesta distinto segun por donde se
 * pregunte.
 */
import { prisma } from "./db";

export const TIPOS_EQUIVALENCIA = {
  EQUIVALENTE: "La misma pieza, otra marca",
  SUSTITUTO: "Sirve como sustituto",
} as const;

export type TipoEquivalencia = keyof typeof TIPOS_EQUIVALENCIA;
export const esTipoValido = (t: string): t is TipoEquivalencia => t in TIPOS_EQUIVALENCIA;

/** El par siempre en el mismo orden: asi la llave unica impide duplicarlo al reves. */
export const parCanonico = (a: string, b: string): [string, string] =>
  a < b ? [a, b] : [b, a];

export class ErrorDeEquivalencia extends Error {
  constructor(mensaje: string, readonly codigo = 422) {
    super(mensaje);
    this.name = "ErrorDeEquivalencia";
  }
}

const seleccionRefaccion = {
  id: true, code: true, name: true, unit: true,
  quantityOnHand: true, unitCost: true, active: true,
} as const;

/**
 * Las equivalentes de una refaccion, con su existencia actual.
 *
 * Se consulta hacia los dos lados y se devuelve siempre "la otra": a quien
 * pregunta por BAL-001 no le sirve que le contesten BAL-001.
 */
export async function equivalentesDe(organizationId: string, partId: string) {
  const filas = await prisma.equivalenciaRefaccion.findMany({
    where: { organizationId, OR: [{ partAId: partId }, { partBId: partId }] },
    select: {
      id: true, tipo: true, nota: true, partAId: true, partBId: true,
      partA: { select: seleccionRefaccion },
      partB: { select: seleccionRefaccion },
    },
    orderBy: { createdAt: "asc" },
  });

  return filas
    .map((f) => {
      const otra = f.partAId === partId ? f.partB : f.partA;
      return {
        id: f.id,
        tipo: f.tipo as TipoEquivalencia,
        nota: f.nota,
        refaccion: otra,
        hay: otra.quantityOnHand,
      };
    })
    .filter((e) => e.refaccion.active)
    .sort((a, b) => b.hay - a.hay);
}

/**
 * Si hay con que resolver, contando equivalentes.
 *
 * Es lo que convierte el backlog de una lista de pendientes en algo que
 * empuja: una actividad trabada por un balero que no llego se puede hacer hoy
 * si el equivalente de otra marca si esta en el almacen.
 */
export async function hayConQue(
  organizationId: string,
  partId: string,
): Promise<{ propia: number; conEquivalentes: number; alternativas: Awaited<ReturnType<typeof equivalentesDe>> }> {
  const [propia, equivalentes] = await Promise.all([
    prisma.part.findFirst({
      where: { id: partId, organizationId },
      select: { quantityOnHand: true },
    }),
    equivalentesDe(organizationId, partId),
  ]);
  const conExistencia = equivalentes.filter((e) => e.hay > 0);
  return {
    propia: propia?.quantityOnHand ?? 0,
    conEquivalentes: (propia?.quantityOnHand ?? 0) + conExistencia.reduce((s, e) => s + e.hay, 0),
    alternativas: conExistencia,
  };
}

export async function registrarEquivalencia(params: {
  organizationId: string;
  partId: string;
  equivalenteId: string;
  tipo: TipoEquivalencia;
  nota?: string | null;
  userId?: string | null;
}) {
  if (params.partId === params.equivalenteId) {
    throw new ErrorDeEquivalencia("Una refaccion no puede ser equivalente de si misma.");
  }

  const refacciones = await prisma.part.findMany({
    where: { id: { in: [params.partId, params.equivalenteId] }, organizationId: params.organizationId },
    select: { id: true, code: true, name: true },
  });
  if (refacciones.length !== 2) {
    throw new ErrorDeEquivalencia("Alguna de las dos refacciones no existe en su catalogo.", 404);
  }

  const [a, b] = parCanonico(params.partId, params.equivalenteId);
  const ya = await prisma.equivalenciaRefaccion.findUnique({
    where: { partAId_partBId: { partAId: a, partBId: b } },
    select: { id: true },
  });
  if (ya) throw new ErrorDeEquivalencia("Esas dos refacciones ya estan relacionadas.", 409);

  return prisma.equivalenciaRefaccion.create({
    data: {
      organizationId: params.organizationId,
      partAId: a,
      partBId: b,
      tipo: params.tipo,
      nota: params.nota?.trim() || null,
      createdById: params.userId ?? null,
    },
  });
}

export async function quitarEquivalencia(organizationId: string, id: string) {
  const fila = await prisma.equivalenciaRefaccion.findFirst({
    where: { id, organizationId },
    select: { id: true },
  });
  if (!fila) throw new ErrorDeEquivalencia("Equivalencia no encontrada", 404);
  await prisma.equivalenciaRefaccion.delete({ where: { id: fila.id } });
}
