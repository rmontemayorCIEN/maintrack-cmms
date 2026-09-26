import { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * A que centro de costo se carga el trabajo de un equipo.
 *
 * ── Por que vive aqui y no repetido en cada lugar ──
 *
 * Siete sitios distintos crean ordenes de trabajo: el programador de
 * preventivos (dos), el armado manual, la conversion de una solicitud, la
 * alerta predictiva (dos) y la creacion a mano por la API. Escribir la
 * herencia en los siete era garantizar que un dia uno de ellos se quedara
 * atras y sus ordenes nacieran sin centro —y el reporte de contabilidad
 * mostraria un hueco que nadie sabria explicar, porque el hueco dependeria de
 * COMO se creo la orden, no de nada que se vea en pantalla—.
 *
 * ── Por que se copia y no se consulta ──
 *
 * Lo que esta funcion devuelve se GUARDA en la orden. No se resuelve al leer.
 * Si el equipo cambia de centro el año que viene, lo ya gastado se queda donde
 * se gasto; de otro modo los reportes del año pasado cambiarian solos y quien
 * lleva la contabilidad dejaria de confiar en el sistema.
 */
export async function centroDeCostoDelActivo(
  organizationId: string,
  assetId: string | null | undefined,
  /** La transaccion, cuando la orden se crea dentro de una (conversion de solicitud). */
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string | null> {
  if (!assetId) return null;
  const a = await db.asset.findFirst({
    where: { id: assetId, organizationId },
    select: { centroDeCostoId: true },
  });
  return a?.centroDeCostoId ?? null;
}
