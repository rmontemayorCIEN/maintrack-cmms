import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { createSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
});

/** Datos de la propia cuenta. Cualquier usuario puede editar los suyos. */
export async function PATCH(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    if (input.email) {
      const email = input.email.toLowerCase().trim();
      if (email !== user.email) {
        const ocupado = await prisma.user.findUnique({ where: { email } });
        if (ocupado) return fail("Ese correo ya esta registrado por otro usuario", 409);
      }
      input.email = email;
    }

    const actualizado = await prisma.user.update({
      where: { id: user.id },
      data: input,
      select: { id: true, name: true, email: true, role: true, phone: true, jobTitle: true },
    });

    // La sesion lleva dentro el correo y el nombre: hay que reemitirla para que
    // la barra superior y los siguientes accesos usen los datos nuevos.
    await createSession({
      userId: actualizado.id,
      organizationId: orgId,
      email: actualizado.email,
      name: actualizado.name,
      role: actualizado.role,
    });

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "User",
      entityId: user.id,
      action: "PROFILE_UPDATED",
      summary: `${actualizado.name} actualizo sus datos de acceso`,
      changes: { email: input.email ? "modificado" : undefined },
    });

    return ok({ user: actualizado });
  });
}
