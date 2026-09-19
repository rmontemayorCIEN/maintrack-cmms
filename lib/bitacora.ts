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
import { medianocheEnZona } from "./periodos";

/** Los grupos con los que se filtra, en lenguaje de negocio. */
export const MODULOS_BITACORA: Record<string, { titulo: string; entidades: string[] }> = {
  ACCESO: { titulo: "Acceso y usuarios", entidades: ["User"] },
  ORDENES: { titulo: "Órdenes de trabajo", entidades: ["WorkOrder", "WorkOrderTask", "WorkRequest"] },
  ACTIVOS: { titulo: "Activos y planes", entidades: ["Asset", "MaintenancePlan", "PlanAsset", "Meter", "MeterReading", "Sensor", "PredictiveAlert", "PlanRequest", "Conjunto"] },
  ALMACEN: { titulo: "Almacén y compras", entidades: ["Part", "MaterialRequest", "PurchaseRequest", "GoodsReceipt", "StockTransfer", "InventoryCount", "Supplier"] },
  CONFIGURACION: { titulo: "Configuración", entidades: ["Organization", "Catalog", "Catalogo", "ReportPoint", "Attachment", "ReferenceLink"] },
  IMPORTACION: { titulo: "Importaciones y puesta en marcha", entidades: ["Importacion", "ImportBatch"] },
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

/**
 * La medianoche de un «aaaa-mm-dd» en la zona de la EMPRESA.
 *
 * `new Date("2026-09-17T00:00:00")` se lee en la zona del servidor, y Cloud Run
 * corre en UTC: en produccion «hoy» empezaba a las 6 de la tarde de ayer, hora
 * de Monterrey, y se comia la noche. Pasaba las pruebas en la Mac, que esta en
 * hora de Mexico, y fallaba justo donde se usa.
 */
function medianocheDe(dia: string, zona: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return null;
  return medianocheEnZona(Number(m[1]), Number(m[2]), Number(m[3]), zona);
}

export async function consultarBitacora(organizationId: string, filtro: FiltroBitacora, zona: string) {
  const desde = filtro.desde ? medianocheDe(filtro.desde, zona) : null;
  // «Hasta» incluye el dia completo: quien escribe el 17 espera ver lo del 17.
  // Es la medianoche del dia siguiente, menos un milisegundo.
  const finDelDia = filtro.hasta ? medianocheDe(filtro.hasta, zona) : null;
  const hasta = finDelDia ? new Date(finDelDia.getTime() + 86_400_000 - 1) : null;
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
