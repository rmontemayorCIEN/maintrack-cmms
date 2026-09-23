import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * Folios consecutivos por organizacion.
 *
 * Cada serie apunta a su contador en la organizacion y a su prefijo. Se
 * centraliza porque el modulo de almacen y compras va a sumar varias series
 * mas —traspaso, requisicion, orden de compra— y una funcion copiada por serie
 * significa que el dia que cambie el formato hay que acordarse de todas.
 *
 * El incremento va en el UPDATE, no en una lectura seguida de escritura: dos
 * peticiones simultaneas obtendrian el mismo numero.
 */
const SERIES = {
  ordenTrabajo: { campo: "woSequence", prefijo: "OT" },
  solicitud: { campo: "wrSequence", prefijo: "SS" },
  traspaso: { campo: "tsSequence", prefijo: "TR" },
  requisicion: { campo: "rmSequence", prefijo: "RM" },
  compra: { campo: "rcSequence", prefijo: "RC" },
  recepcion: { campo: "reSequence", prefijo: "RE" },
  ordenCompra: { campo: "poSequence", prefijo: "OC" },
  conteo: { campo: "icSequence", prefijo: "CI" },
  soporte: { campo: "spSequence", prefijo: "SOP" },
  rondin: { campo: "rdSequence", prefijo: "RD" },
} as const;

export type Serie = keyof typeof SERIES;

/** `cliente`: la transaccion en curso, si el folio se pide dentro de una. */
export async function siguienteFolio(organizationId: string, serie: Serie, cliente: Prisma.TransactionClient = prisma) {
  const { campo, prefijo } = SERIES[serie];
  const org = await cliente.organization.update({
    where: { id: organizationId },
    data: { [campo]: { increment: 1 } },
    select: { [campo]: true },
  });
  const consecutivo = (org as unknown as Record<string, number>)[campo];
  return `${prefijo}-${String(consecutivo).padStart(6, "0")}`;
}

export const nextWorkOrderNumber = (organizationId: string, cliente?: Prisma.TransactionClient) =>
  siguienteFolio(organizationId, "ordenTrabajo", cliente);
export const nextRequestNumber = (organizationId: string) => siguienteFolio(organizationId, "solicitud");
