import { prisma } from "@/lib/db";
import { conCredencial, pagina, paginacion } from "@/lib/integraciones/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/activos?limite=50&cursor=&q=&sitio=&estado= — alcance activos:leer. */
export async function GET(request: Request) {
  return conCredencial(request, { alcance: "activos:leer", ruta: "activos" }, async (quien) => {
    const url = new URL(request.url);
    const p = paginacion(url);
    const q = url.searchParams.get("q")?.trim();
    const sitio = url.searchParams.get("sitio")?.trim();
    const estado = url.searchParams.get("estado")?.trim();
    const costos = quien.alcances.includes("costos:leer");
    const filas = await prisma.asset.findMany({
      where: {
        organizationId: quien.organizationId,
        ...(q ? { OR: [{ code: { contains: q } }, { name: { contains: q } }, { serialNumber: { contains: q } }] } : {}),
        ...(sitio ? { site: { code: sitio } } : {}),
        ...(estado ? { status: estado } : {}),
      },
      orderBy: { id: "asc" }, take: p.take, ...(p.cursor ? { cursor: p.cursor, skip: p.skip } : {}),
      select: {
        id: true, code: true, name: true, criticality: true, status: true, manufacturer: true, model: true, serialNumber: true,
        purchaseCost: true, site: { select: { code: true, name: true } }, location: { select: { code: true, name: true } },
        updatedAt: true,
      },
    });
    const { datos, siguienteCursor } = pagina(filas, p.limite);
    return {
      estado: 200,
      cuerpo: {
        datos: datos.map((a) => ({
          id: a.id, codigo: a.code, nombre: a.name, criticidad: a.criticality, estado: a.status,
          fabricante: a.manufacturer, modelo: a.model, serie: a.serialNumber,
          sitio: a.site ? { codigo: a.site.code, nombre: a.site.name } : null,
          ubicacion: a.location ? { codigo: a.location.code, nombre: a.location.name } : null,
          ...(costos ? { costoAdquisicion: a.purchaseCost } : {}),
          actualizado: a.updatedAt.toISOString(),
        })),
        siguienteCursor,
      },
    };
  });
}
