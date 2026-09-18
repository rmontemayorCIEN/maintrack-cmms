import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  mostrarEmpresa: z.boolean().optional(),
  mostrarPlanta: z.boolean().optional(),
  mostrarEquipo: z.boolean().optional(),
  activo: z.boolean().optional(),
});

const ETIQUETAS: Record<string, string> = {
  mostrarEmpresa: "nombre de la empresa",
  mostrarPlanta: "planta y ubicación",
  mostrarEquipo: "nombre completo del equipo",
  activo: "punto activo",
};

/**
 * Que enseña un punto de reporte a quien escanea, y si sigue vivo.
 *
 * Es configuracion de la empresa —mismo permiso que el resto— y solo sobre sus
 * propios puntos: el punto se busca dentro de la organizacion de la sesion.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("settings:write", async ({ user, orgId }) => {
    const punto = await prisma.reportPoint.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, nombre: true, mostrarEmpresa: true, mostrarPlanta: true, mostrarEquipo: true, activo: true },
    });
    if (!punto) return fail("Punto de reporte no encontrado", 404);

    const input = schema.parse(await request.json());
    const actualizado = await prisma.reportPoint.update({
      where: { id },
      data: input,
      select: { id: true, mostrarEmpresa: true, mostrarPlanta: true, mostrarEquipo: true, activo: true },
    });

    // Cambiar lo que un QR publico enseña es una decision sobre datos que ve
    // cualquiera que pase: queda con nombre y apellido.
    const cambios = Object.entries(input)
      .filter(([k, v]) => v !== undefined && v !== punto[k as keyof typeof punto])
      .map(([k, v]) => `${ETIQUETAS[k] ?? k}: ${v ? "sí" : "no"}`);
    if (cambios.length) {
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "ReportPoint", entityId: id, action: "UPDATED",
        summary: `${punto.nombre} — ${cambios.join(", ")}`,
      });
    }
    return ok({ punto: actualizado });
  });
}
