import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { revocarSesiones } from "@/lib/auth";
import { verificarCupo } from "@/lib/planes";
import { logAudit } from "@/lib/audit";
import { ROLE_LABELS } from "@/lib/constants";

const schema = z.object({
  role: z.enum(["ADMIN", "SUPERVISOR", "TECHNICIAN", "REQUESTER", "VIEWER", "COMPRAS"]).optional(),
  active: z.boolean().optional(),
  hourlyRate: z.coerce.number().min(0).optional(),
  jobTitle: z.string().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("user:manage", async ({ orgId, user }) => {
    const target = await prisma.user.findFirst({ where: { id, organizationId: orgId } });
    if (!target) return fail("Usuario no encontrado", 404);
    if (target.role === "OWNER") return fail("No se puede modificar al propietario", 403);
    if (target.id === user.id) return fail("No puede modificar su propio rol", 403);

    const input = schema.parse(await request.json());

    // Reactivar a alguien es dar de alta un usuario: el cupo del plan cuenta a
    // los activos. Sin esta revision, bastaba desactivar y reactivar para pasar
    // por encima del limite contratado.
    if (input.active === true && !target.active) {
      const cupo = await verificarCupo(orgId, user.organization.plan, "users");
      if (!cupo.permitido) return fail(cupo.mensaje, 402);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: input,
      select: { id: true, name: true, role: true, active: true },
    });

    /**
     * Cambiar el rol o dar de baja no puede esperar a que caduque la sesion.
     *
     * El rol se lee de la base en cada peticion, asi que un ascenso o una
     * degradacion pegan de inmediato; una baja tampoco deja pasar. Aun asi se
     * revocan las sesiones: es lo que corta el navegador que quedo abierto en
     * la caseta, y deja la intencion escrita en el codigo y no en un comentario.
     */
    const cambioSensible = (input.role && input.role !== target.role) || input.active === false;
    if (cambioSensible) await revocarSesiones(id);

    const cambios: string[] = [];
    if (input.role && input.role !== target.role) {
      cambios.push(`rol ${ROLE_LABELS[target.role] ?? target.role} → ${ROLE_LABELS[input.role] ?? input.role}`);
    }
    if (input.active !== undefined && input.active !== target.active) {
      cambios.push(input.active ? "reactivado" : "desactivado");
    }
    if (input.hourlyRate !== undefined && input.hourlyRate !== target.hourlyRate) {
      cambios.push("tarifa por hora");
    }
    if (cambios.length) {
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "User", entityId: id,
        action: input.active === false ? "USER_DEACTIVATED" : input.role ? "USER_ROLE_CHANGED" : "USER_UPDATED",
        summary: `${target.name}: ${cambios.join(", ")}`,
        changes: { antes: { rol: target.role, activo: target.active }, despues: { rol: updated.role, activo: updated.active } },
      });
    }
    return ok({ user: updated });
  });
}
