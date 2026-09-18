import { prisma } from "@/lib/db";
import { conCredencial } from "@/lib/integraciones/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/ubicaciones — sitios con sus ubicaciones. Alcance ubicaciones:leer. */
export async function GET(request: Request) {
  return conCredencial(request, { alcance: "ubicaciones:leer", ruta: "ubicaciones" }, async (quien) => {
    const sitios = await prisma.site.findMany({
      where: { organizationId: quien.organizationId },
      orderBy: { code: "asc" }, take: 500,
      select: { id: true, code: true, name: true, locations: { select: { id: true, code: true, name: true, parentId: true }, orderBy: { code: "asc" } } },
    });
    return {
      estado: 200,
      cuerpo: {
        datos: sitios.map((s) => ({
          id: s.id, codigo: s.code, nombre: s.name,
          ubicaciones: s.locations.map((l) => ({ id: l.id, codigo: l.code, nombre: l.name, padre: l.parentId })),
        })),
      },
    };
  });
}
