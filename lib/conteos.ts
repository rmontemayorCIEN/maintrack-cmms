import { prisma } from "./db";
import { aplicarMovimiento } from "./almacen";
import { siguienteFolio } from "./numbering";

/**
 * Conteo ciclico de almacen.
 *
 * La regla que define el modulo: la DIFERENCIA se mide contra lo que el
 * sistema decia al abrir, pero el AJUSTE se aplica contra lo que hay al
 * cerrar. Si entre una cosa y otra alguien surtio una requisicion, ese
 * movimiento es legitimo y no debe desaparecer; lo que hace el sistema es
 * avisarlo, no borrarlo.
 */

export class ErrorDeConteo extends Error {}

export const ESTADOS_CONTEO = {
  ABIERTO: "Abierto",
  CERRADO: "Cerrado",
  CANCELADO: "Cancelado",
} as const;

/** Abre un conteo tomando la foto de lo que el sistema cree que hay. */
export async function abrirConteo(params: {
  organizationId: string;
  warehouseId: string;
  userId: string;
  /** Familia de refaccion. Sin ella, todo el almacen. */
  familia?: string | null;
  /** Incluir las que el sistema dice que estan en cero. */
  incluirEnCero?: boolean;
  nota?: string | null;
}) {
  const abierto = await prisma.inventoryCount.findFirst({
    where: { organizationId: params.organizationId, warehouseId: params.warehouseId, estado: "ABIERTO" },
    select: { folio: true },
  });
  if (abierto) {
    throw new ErrorDeConteo(`Ya hay un conteo abierto en este almacen (${abierto.folio}). Cierrelo antes de abrir otro.`);
  }

  const existencias = await prisma.partStock.findMany({
    where: {
      organizationId: params.organizationId,
      warehouseId: params.warehouseId,
      part: { active: true, ...(params.familia ? { category: params.familia } : {}) },
      ...(params.incluirEnCero ? {} : { quantity: { gt: 0 } }),
    },
    select: { partId: true, quantity: true },
  });
  if (!existencias.length) throw new ErrorDeConteo("No hay refacciones que contar con ese alcance");

  const folio = await siguienteFolio(params.organizationId, "conteo");
  return prisma.inventoryCount.create({
    data: {
      organizationId: params.organizationId,
      folio,
      warehouseId: params.warehouseId,
      responsableId: params.userId,
      alcance: params.familia ? `Familia ${params.familia}` : "Todo el almacen",
      nota: params.nota || null,
      renglones: {
        create: existencias.map((e) => ({ partId: e.partId, cantidadSistema: e.quantity })),
      },
    },
    select: { id: true, folio: true },
  });
}

/** Guarda lo contado. Se puede capturar en varias sesiones. */
export async function capturarConteo(params: {
  organizationId: string;
  countId: string;
  renglones: Array<{ lineId: string; cantidadContada: number | null; nota?: string | null }>;
}) {
  const conteo = await prisma.inventoryCount.findFirst({
    where: { id: params.countId, organizationId: params.organizationId },
    select: { id: true, estado: true },
  });
  if (!conteo) throw new ErrorDeConteo("Conteo no encontrado");
  if (conteo.estado !== "ABIERTO") throw new ErrorDeConteo("El conteo ya esta cerrado");

  await prisma.$transaction(
    params.renglones.map((r) =>
      prisma.inventoryCountLine.updateMany({
        where: { id: r.lineId, countId: conteo.id },
        data: { cantidadContada: r.cantidadContada, nota: r.nota ?? undefined },
      }),
    ),
  );
  return { capturados: params.renglones.length };
}

/**
 * Cierra el conteo y ajusta lo que no cuadra.
 *
 * Cada diferencia produce un ajuste en el kardex, con el folio del conteo como
 * referencia. Un ajuste sin rastro es lo que convierte un inventario en una
 * cifra que nadie puede defender.
 */
export async function cerrarConteo(params: {
  organizationId: string;
  countId: string;
  userId: string;
}) {
  const conteo = await prisma.inventoryCount.findFirst({
    where: { id: params.countId, organizationId: params.organizationId },
    include: { renglones: true },
  });
  if (!conteo) throw new ErrorDeConteo("Conteo no encontrado");
  if (conteo.estado !== "ABIERTO") throw new ErrorDeConteo("El conteo ya esta cerrado");

  const contados = conteo.renglones.filter((r) => r.cantidadContada !== null);
  if (!contados.length) throw new ErrorDeConteo("No se capturo ningun conteo todavia");

  let ajustados = 0;
  let movidosDuranteElConteo = 0;

  await prisma.$transaction(async (tx) => {
    for (const r of contados) {
      const actual = await tx.partStock.findUnique({
        where: { partId_warehouseId: { partId: r.partId, warehouseId: conteo.warehouseId } },
        select: { quantity: true },
      });
      const alCerrar = actual?.quantity ?? 0;
      if (Math.abs(alCerrar - r.cantidadSistema) > 0.0001) movidosDuranteElConteo += 1;

      await tx.inventoryCountLine.update({
        where: { id: r.id },
        data: { cantidadAlCerrar: alCerrar },
      });

      if (Math.abs(alCerrar - r.cantidadContada!) > 0.0001) {
        await aplicarMovimiento(
          {
            organizationId: params.organizationId,
            partId: r.partId,
            warehouseId: conteo.warehouseId,
            tipo: "ADJUST",
            cantidad: r.cantidadContada!,
            userId: params.userId,
            referencia: `Conteo ${conteo.folio}`,
          },
          tx,
        );
        ajustados += 1;
      }
    }

    await tx.inventoryCount.update({
      where: { id: conteo.id },
      data: { estado: "CERRADO", cerradoEl: new Date() },
    });
  });

  return { folio: conteo.folio, contados: contados.length, ajustados, movidosDuranteElConteo };
}

export async function cancelarConteo(organizationId: string, countId: string) {
  const conteo = await prisma.inventoryCount.findFirst({
    where: { id: countId, organizationId },
    select: { id: true, estado: true },
  });
  if (!conteo) throw new ErrorDeConteo("Conteo no encontrado");
  if (conteo.estado !== "ABIERTO") throw new ErrorDeConteo("El conteo ya esta cerrado");
  return prisma.inventoryCount.update({ where: { id: conteo.id }, data: { estado: "CANCELADO" } });
}

/**
 * Exactitud del conteo: cuantos renglones cuadraron.
 *
 * Se compara contra lo que el sistema decia AL CERRAR, no contra la foto de
 * apertura. Si durante el conteo salio material por una requisicion legitima,
 * el anaquel bajo con razon y el almacenista conto bien; medirlo contra la
 * foto vieja lo castigaria por un movimiento que no es suyo.
 *
 * Antes de cerrar todavia no existe ese dato y se usa la foto, que es lo unico
 * que hay.
 */
export function exactitud(
  renglones: Array<{ cantidadSistema: number; cantidadContada: number | null; cantidadAlCerrar?: number | null }>,
) {
  const contados = renglones.filter((r) => r.cantidadContada !== null);
  if (!contados.length) return null;
  const exactos = contados.filter((r) => {
    const referencia = r.cantidadAlCerrar ?? r.cantidadSistema;
    return Math.abs(r.cantidadContada! - referencia) < 0.0001;
  }).length;
  return { contados: contados.length, exactos, porcentaje: Math.round((exactos / contados.length) * 100) };
}
