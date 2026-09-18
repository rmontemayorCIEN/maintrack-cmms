import { prisma } from "@/lib/db";
import { conCredencial, ErrorApi, pagina, paginacion } from "@/lib/integraciones/api";

export const dynamic = "force-dynamic";

const ESTADOS = ["DRAFT", "OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED", "CANCELLED"];

/**
 * GET /api/v1/ordenes?estado=OPEN&desde=2026-09-01T00:00:00Z&activo=BOM-101&limite=50&cursor=
 * Alcance ordenes:leer. Sin nombres de personas; costos solo con costos:leer.
 */
export async function GET(request: Request) {
  return conCredencial(request, { alcance: "ordenes:leer", ruta: "ordenes" }, async (quien) => {
    const url = new URL(request.url);
    const p = paginacion(url);
    const estado = url.searchParams.get("estado");
    if (estado && !ESTADOS.includes(estado)) throw new ErrorApi(422, "ESTADO_INVALIDO", `Estado desconocido. Use: ${ESTADOS.join(", ")}.`);
    const desdeTexto = url.searchParams.get("desde");
    const desde = desdeTexto ? new Date(desdeTexto) : null;
    if (desde && Number.isNaN(desde.getTime())) throw new ErrorApi(422, "FECHA_INVALIDA", "«desde» debe ser una fecha ISO 8601.");
    const activo = url.searchParams.get("activo")?.trim();
    const costos = quien.alcances.includes("costos:leer");
    const filas = await prisma.workOrder.findMany({
      where: {
        organizationId: quien.organizationId,
        ...(estado ? { status: estado } : {}),
        ...(desde ? { updatedAt: { gte: desde } } : {}),
        ...(activo ? { asset: { code: activo } } : {}),
      },
      orderBy: { id: "asc" }, take: p.take, ...(p.cursor ? { cursor: p.cursor, skip: p.skip } : {}),
      select: {
        id: true, number: true, title: true, maintenanceType: true, status: true, priority: true, dueDate: true,
        createdAt: true, startedAt: true, completedAt: true, closedAt: true, updatedAt: true, totalCost: true,
        asset: { select: { code: true } }, site: { select: { code: true } },
      },
    });
    const { datos, siguienteCursor } = pagina(filas, p.limite);
    const iso = (d: Date | null) => d?.toISOString() ?? null;
    return {
      estado: 200,
      cuerpo: {
        datos: datos.map((o) => ({
          id: o.id, folio: o.number, titulo: o.title, tipo: o.maintenanceType, estado: o.status, prioridad: o.priority,
          activo: o.asset?.code ?? null, sitio: o.site?.code ?? null, vence: iso(o.dueDate), creada: iso(o.createdAt),
          iniciada: iso(o.startedAt), terminada: iso(o.completedAt), cerrada: iso(o.closedAt), actualizada: iso(o.updatedAt),
          ...(costos ? { costoTotal: o.totalCost } : {}),
        })),
        siguienteCursor,
      },
    };
  });
}
