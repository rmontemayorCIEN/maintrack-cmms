import { prisma } from "@/lib/db";
import { conCredencial, pagina, paginacion } from "@/lib/integraciones/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/inventario?q=&limite=&cursor= — existencias por almacén. Alcance inventario:leer. */
export async function GET(request: Request) {
  return conCredencial(request, { alcance: "inventario:leer", ruta: "inventario" }, async (quien) => {
    const url = new URL(request.url);
    const p = paginacion(url);
    const q = url.searchParams.get("q")?.trim();
    const costos = quien.alcances.includes("costos:leer");
    const filas = await prisma.part.findMany({
      where: { organizationId: quien.organizationId, active: true, ...(q ? { OR: [{ code: { contains: q } }, { name: { contains: q } }] } : {}) },
      orderBy: { id: "asc" }, take: p.take, ...(p.cursor ? { cursor: p.cursor, skip: p.skip } : {}),
      select: {
        id: true, code: true, name: true, unit: true, quantityOnHand: true, minQuantity: true, maxQuantity: true, unitCost: true,
        existencias: { select: { quantity: true, warehouse: { select: { code: true } } } },
      },
    });
    const { datos, siguienteCursor } = pagina(filas, p.limite);
    return {
      estado: 200,
      cuerpo: {
        datos: datos.map((x) => ({
          id: x.id, codigo: x.code, nombre: x.name, unidad: x.unit, existencia: x.quantityOnHand, minimo: x.minQuantity, maximo: x.maxQuantity,
          porAlmacen: x.existencias.map((s) => ({ almacen: s.warehouse.code, existencia: s.quantity })),
          ...(costos ? { costoUnitario: x.unitCost } : {}),
        })),
        siguienteCursor,
      },
    };
  });
}
