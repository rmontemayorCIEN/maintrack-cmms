/**
 * La bitácora, filtrable.
 *
 * Una lista de los últimos 60 movimientos sirve para mirar; no sirve para
 * investigar. Investigar es «qué hizo esta persona el martes», «quién tocó esta
 * orden», «quién exportó información este mes». Eso pide filtros, y los filtros
 * piden un solo lugar donde se arme la consulta —con su tope— en vez de cada
 * pantalla armándola a su manera.
 *
 * La bitácora es de solo lectura: no hay función que la edite ni que la borre,
 * y por eso aquí solo se lee.
 */
import { prisma } from "./db";

/** Los grupos con los que se filtra, en lenguaje de negocio. */
export const MODULOS_BITACORA: Record<string, { titulo: string; entidades: string[] }> = {
  ACCESO: { titulo: "Acceso y usuarios", entidades: ["User"] },
  ORDENES: { titulo: "Órdenes de trabajo", entidades: ["WorkOrder", "WorkOrderTask", "WorkRequest"] },
  ACTIVOS: { titulo: "Activos y planes", entidades: ["Asset", "MaintenancePlan", "PlanAsset", "Meter", "MeterReading", "Sensor", "PlanRequest", "Conjunto"] },
  ALMACEN: { titulo: "Almacén y compras", entidades: ["Part", "MaterialRequest", "PurchaseRequest", "GoodsReceipt", "StockTransfer", "InventoryCount", "Supplier"] },
  CONFIGURACION: { titulo: "Configuración", entidades: ["Organization", "Catalog", "ReportPoint", "Attachment", "ReferenceLink"] },
};

/** Acciones que vale la pena poder aislar de un vistazo. */
export const ACCIONES_SENSIBLES = [
  "LOGIN", "LOGIN_FAILED", "LOGOUT", "SESSIONS_REVOKED",
  "USER_CREATED", "USER_ROLE_CHANGED", "USER_DEACTIVATED", "USER_UPDATED",
  "PASSWORD_CHANGED", "PASSWORD_RESET", "PASSWORD_RESET_ISSUED", "PASSWORD_RESET_USED",
  "EXPORTED", "FILE_ACCESSED", "CLIENT_UPDATED",
];

export type FiltroBitacora = {
  desde?: string | null;
  hasta?: string | null;
  usuarioId?: string | null;
  modulo?: string | null;
  accion?: string | null;
};

/** Cuántos renglones se traen. Más que esto se filtra, no se hojea. */
export const TOPE_BITACORA = 200;

export async function consultarBitacora(organizationId: string, filtro: FiltroBitacora) {
  const desde = filtro.desde ? new Date(`${filtro.desde}T00:00:00`) : null;
  // «Hasta» incluye el día completo: quien escribe el 17 espera ver lo del 17.
  const hasta = filtro.hasta ? new Date(`${filtro.hasta}T23:59:59.999`) : null;
  const entidades = filtro.modulo ? MODULOS_BITACORA[filtro.modulo]?.entidades : undefined;

  return prisma.auditLog.findMany({
    where: {
      organizationId,
      ...(filtro.usuarioId ? { userId: filtro.usuarioId } : {}),
      ...(filtro.accion ? { action: filtro.accion } : {}),
      ...(entidades?.length ? { entity: { in: entidades } } : {}),
      ...(desde || hasta
        ? { createdAt: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } }
        : {}),
    },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: TOPE_BITACORA,
  });
}

/** Si el filtro trae algo, para poder decir «sin resultados con estos filtros». */
export function hayFiltro(f: FiltroBitacora) {
  return Boolean(f.desde || f.hasta || f.usuarioId || f.modulo || f.accion);
}
