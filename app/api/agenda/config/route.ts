import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";

/** La jornada de la organizacion: de aqui sale si un dia cabe o no cabe. */
const schema = z.object({
  horasJornada: z.coerce.number().min(1).max(24).optional(),
  /// Lunes es 1 y domingo es 7. Texto separado por comas y no arreglo, porque
  /// el esquema corre en SQLite y en PostgreSQL con el mismo archivo.
  diasHabiles: z.array(z.number().int().min(1).max(7)).min(1).optional(),
});

export async function PATCH(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const datos = schema.parse(await request.json());
    if (!Object.keys(datos).length) return ok({ success: true });

    const actualizacion: Record<string, unknown> = {};
    if (datos.horasJornada !== undefined) actualizacion.horasJornada = datos.horasJornada;
    if (datos.diasHabiles) {
      actualizacion.diasHabiles = [...new Set(datos.diasHabiles)].sort((a, b) => a - b).join(",");
    }

    await prisma.organization.update({ where: { id: orgId }, data: actualizacion });
    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Organization", entityId: orgId, action: "UPDATED",
      summary: `Jornada: ${datos.horasJornada ?? "sin cambio"} h/dia, dias ${actualizacion.diasHabiles ?? "sin cambio"}`,
    });
    return ok({ success: true });
  });
}

/** Horas disponibles de una persona. Nulo la devuelve a la jornada general. */
const porPersona = z.object({
  userId: z.string().min(1),
  horasDisponibles: z.coerce.number().min(0).max(24).nullable(),
});

export async function POST(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const datos = porPersona.parse(await request.json());
    const persona = await prisma.user.findFirst({
      where: { id: datos.userId, organizationId: orgId },
      select: { id: true, name: true },
    });
    if (!persona) return fail("Usuario no encontrado", 404);

    await prisma.user.update({
      where: { id: persona.id },
      data: { horasDisponibles: datos.horasDisponibles },
    });
    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "User", entityId: persona.id, action: "UPDATED",
      summary: datos.horasDisponibles === null
        ? `${persona.name} vuelve a la jornada general`
        : `${persona.name}: ${datos.horasDisponibles} h/dia`,
    });
    return ok({ success: true });
  });
}
