import { prisma } from "./db";

/**
 * Refacciones que parecen ser la misma.
 *
 * "Balero 6205", "BALERO 6205 2RS" y "balero 6205-2rs skf" son tres registros
 * de una sola pieza, y ese es el asesino silencioso del inventario: los
 * minimos no disparan porque la existencia esta repartida, la rotacion miente,
 * y el tecnico pide una y el almacenista surte otra.
 *
 * Aqui SOLO se encuentran candidatos, por parecido de texto. Decidir si dos
 * registros son de verdad la misma pieza —o dos medidas distintas del mismo
 * modelo, que es lo peligroso— requiere criterio, y eso se le pide al modelo.
 */

/** Sin acentos, sin puntuacion y en minusculas: como se compara de verdad. */
export function normalizar(t: string) {
  return t
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Parecido entre dos textos, de 0 a 1.
 *
 * Se usa distancia de edicion sobre el texto normalizado. Es deliberadamente
 * simple: solo tiene que ser lo bastante buena para juntar candidatos, no para
 * decidir. Lo que decide es el juicio, despues.
 */
export function parecido(a: string, b: string): number {
  const x = normalizar(a);
  const y = normalizar(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const largo = Math.max(x.length, y.length);
  // Levenshtein por filas: no hace falta la matriz completa.
  let anterior = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const actual = [i];
    for (let j = 1; j <= y.length; j++) {
      actual[j] = Math.min(
        anterior[j] + 1,
        actual[j - 1] + 1,
        anterior[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    anterior = actual;
  }
  return 1 - anterior[y.length] / largo;
}

/**
 * Las palabras y numeros que comparten dos textos.
 *
 * Importa mas que el parecido general: dos baleros que comparten "6205" son
 * candidatos fuertes aunque el resto del nombre difiera, y dos que comparten
 * "balero" pero uno dice 6205 y otro 6206 son piezas distintas.
 */
function medidas(t: string) {
  return new Set(normalizar(t).split(" ").filter((p) => /\d/.test(p)));
}

/**
 * Si dos refacciones son candidatas a ser la misma.
 *
 * Aqui vive la regla que de verdad decide, y esta separada para poder
 * probarla: el parecido de texto NO alcanza. "Balero 6205" y "Balero 6206" se
 * parecen 96% y son piezas distintas; fusionarlas seria un daño que nadie nota
 * hasta que el tecnico baja por la refaccion equivocada.
 *
 * Por eso las medidas mandan sobre el parecido: si ambas traen numeros y
 * ninguno coincide, no son candidatas por mucho que se lean igual.
 */
export function sonCandidatas(
  a: { code: string; name: string },
  b: { code: string; name: string },
  umbral = 0.72,
): { candidatas: boolean; puntaje: number; compartenMedida: boolean } {
  const ma = medidas(`${a.code} ${a.name}`);
  const mb = medidas(`${b.code} ${b.name}`);
  const compartenMedida = [...ma].some((m) => mb.has(m));
  if (ma.size > 0 && mb.size > 0 && !compartenMedida) {
    return { candidatas: false, puntaje: 0, compartenMedida: false };
  }

  const puntaje = Math.max(parecido(a.name, b.name), parecido(a.code, b.code)) + (compartenMedida ? 0.12 : 0);
  return { candidatas: puntaje >= umbral, puntaje, compartenMedida };
}

export type Candidato = {
  puntaje: number;
  motivo: string;
  refacciones: Array<{
    id: string; code: string; name: string; unit: string;
    existencia: number; costo: number; movimientos: number;
  }>;
};

export async function candidatosDuplicados(organizationId: string, umbral = 0.72) {
  const partes = await prisma.part.findMany({
    where: { organizationId, active: true },
    select: {
      id: true, code: true, name: true, unit: true, description: true,
      quantityOnHand: true, unitCost: true,
      _count: { select: { movements: true } },
    },
    orderBy: { code: "asc" },
  });

  const candidatos: Candidato[] = [];
  const yaAgrupada = new Set<string>();

  for (let i = 0; i < partes.length; i++) {
    if (yaAgrupada.has(partes[i].id)) continue;
    const grupo = [partes[i]];
    const razones: string[] = [];

    for (let j = i + 1; j < partes.length; j++) {
      if (yaAgrupada.has(partes[j].id)) continue;
      const a = partes[i];
      const b = partes[j];

      const veredicto = sonCandidatas(a, b, umbral);
      if (veredicto.candidatas) {
        const { compartenMedida } = veredicto;
        const porNombre = parecido(a.name, b.name);
        grupo.push(b);
        yaAgrupada.add(b.id);
        razones.push(
          compartenMedida
            ? `«${a.name}» y «${b.name}» comparten medida`
            : `«${a.name}» y «${b.name}» se parecen ${Math.round(porNombre * 100)}%`,
        );
      }
    }

    if (grupo.length > 1) {
      yaAgrupada.add(partes[i].id);
      candidatos.push({
        puntaje: Math.round(
          (grupo.slice(1).reduce((s, g) => s + parecido(partes[i].name, g.name), 0) / (grupo.length - 1)) * 100,
        ),
        motivo: razones[0],
        refacciones: grupo.map((g) => ({
          id: g.id, code: g.code, name: g.name, unit: g.unit,
          existencia: g.quantityOnHand, costo: g.unitCost, movimientos: g._count.movements,
        })),
      });
    }
  }

  return candidatos.sort((a, b) => b.puntaje - a.puntaje);
}

export class ErrorDeFusion extends Error {}

/**
 * Fusiona refacciones duplicadas en una sola.
 *
 * Es la operacion mas delicada del sistema y no se puede deshacer: toda la
 * historia de las absorbidas pasa a la que sobrevive. Por eso corre en una
 * sola transaccion —o se mueve todo, o no se mueve nada— y queda en bitacora
 * con el detalle de que se fusiono con que.
 *
 * Las doce relaciones que cuelgan de una refaccion se repuntan explicitamente.
 * No se usa un borrado en cascada a proposito: cascada BORRARIA el historial,
 * y lo que se quiere es conservarlo bajo otro dueño.
 */
export async function fusionarRefacciones(params: {
  organizationId: string;
  userId: string;
  sobrevivienteId: string;
  absorbidasIds: string[];
}) {
  const { organizationId, sobrevivienteId } = params;
  const absorbidas = params.absorbidasIds.filter((id) => id !== sobrevivienteId);
  if (!absorbidas.length) throw new ErrorDeFusion("No hay refacciones que fusionar");

  const partes = await prisma.part.findMany({
    where: { organizationId, id: { in: [sobrevivienteId, ...absorbidas] } },
    select: { id: true, code: true, name: true, unit: true, quantityOnHand: true, unitCost: true },
  });
  const sobreviviente = partes.find((p) => p.id === sobrevivienteId);
  if (!sobreviviente) throw new ErrorDeFusion("La refacción que sobrevive no existe");
  if (partes.length !== absorbidas.length + 1) {
    throw new ErrorDeFusion("Alguna de las refacciones no pertenece a esta organización");
  }

  const otras = partes.filter((p) => p.id !== sobrevivienteId);

  // La unidad tiene que coincidir: fusionar piezas con metros produce una
  // existencia que no significa nada.
  const distinta = otras.find((p) => normalizar(p.unit) !== normalizar(sobreviviente.unit));
  if (distinta) {
    throw new ErrorDeFusion(
      `${distinta.code} se mide en ${distinta.unit} y ${sobreviviente.code} en ${sobreviviente.unit}. Corrija la unidad antes de fusionar.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    // El costo queda ponderado por existencia: la que tiene mas piezas pesa
    // mas, que es como se calcula un promedio de almacen.
    const totalPiezas = partes.reduce((s, p) => s + p.quantityOnHand, 0);
    const costoPonderado =
      totalPiezas > 0
        ? partes.reduce((s, p) => s + p.quantityOnHand * p.unitCost, 0) / totalPiezas
        : sobreviviente.unitCost;

    // ── La existencia se suma almacen por almacen ─────────────────────────
    const existencias = await tx.partStock.findMany({
      where: { partId: { in: absorbidas } },
      select: { id: true, partId: true, warehouseId: true, quantity: true, bin: true },
    });
    for (const e of existencias) {
      const destino = await tx.partStock.findUnique({
        where: { partId_warehouseId: { partId: sobrevivienteId, warehouseId: e.warehouseId } },
        select: { id: true, quantity: true, bin: true },
      });
      if (destino) {
        await tx.partStock.update({
          where: { id: destino.id },
          data: { quantity: destino.quantity + e.quantity, bin: destino.bin ?? e.bin },
        });
        await tx.partStock.delete({ where: { id: e.id } });
      } else {
        await tx.partStock.update({ where: { id: e.id }, data: { partId: sobrevivienteId } });
      }
    }

    // ── El historial cambia de dueño, no se borra ─────────────────────────
    const donde = { partId: { in: absorbidas } };
    const nuevo = { partId: sobrevivienteId };
    await tx.stockMovement.updateMany({ where: donde, data: nuevo });
    await tx.workOrderPart.updateMany({ where: donde, data: nuevo });
    await tx.materialRequestLine.updateMany({ where: donde, data: nuevo });
    await tx.purchaseRequestLine.updateMany({ where: donde, data: nuevo });
    await tx.goodsReceiptLine.updateMany({ where: donde, data: nuevo });
    await tx.quoteLine.updateMany({ where: donde, data: nuevo });
    await tx.stockTransferLine.updateMany({ where: donde, data: nuevo });
    await tx.planTaskPart.updateMany({ where: donde, data: nuevo });
    await tx.attachment.updateMany({ where: donde, data: nuevo });
    await tx.referenceLink.updateMany({ where: donde, data: nuevo });

    // Los conteos llevan un unico por conteo y refaccion: si la sobreviviente
    // ya estaba en ese mismo conteo, el renglon duplicado se descarta en vez
    // de romper la restriccion.
    const enConteos = await tx.inventoryCountLine.findMany({
      where: donde,
      select: { id: true, countId: true },
    });
    for (const l of enConteos) {
      const choca = await tx.inventoryCountLine.findUnique({
        where: { countId_partId: { countId: l.countId, partId: sobrevivienteId } },
        select: { id: true },
      });
      if (choca) await tx.inventoryCountLine.delete({ where: { id: l.id } });
      else await tx.inventoryCountLine.update({ where: { id: l.id }, data: nuevo });
    }

    // ── Las absorbidas desaparecen y la sobreviviente queda cuadrada ──────
    await tx.part.deleteMany({ where: { id: { in: absorbidas }, organizationId } });

    const suma = await tx.partStock.aggregate({
      where: { partId: sobrevivienteId },
      _sum: { quantity: true },
    });
    const actualizada = await tx.part.update({
      where: { id: sobrevivienteId },
      data: {
        quantityOnHand: suma._sum.quantity ?? 0,
        unitCost: Math.round(costoPonderado * 10000) / 10000,
      },
      select: { code: true, name: true, quantityOnHand: true, unitCost: true },
    });

    return {
      sobreviviente: actualizada,
      absorbidas: otras.map((p) => `${p.code} ${p.name}`),
    };
  });
}
