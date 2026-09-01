import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/api";
import { createSession, readSession } from "@/lib/auth";
import { requireSuperAdmin } from "@/lib/superadmin";
import { logAudit } from "@/lib/audit";

const schema = z.object({ organizationId: z.string().min(1) });

/** Entrar a una empresa cliente sin cerrar sesion. */
export async function POST(request: Request) {
  const { error, user } = await requireSuperAdmin();
  if (error) return error;

  const input = schema.parse(await request.json());
  const destino = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true },
  });
  if (!destino) return fail("Empresa no encontrada", 404);

  const sesion = await readSession();
  await createSession({
    userId: user.id,
    organizationId: user.organizacionPropia.id,
    email: sesion?.email ?? user.email,
    name: user.name,
    role: user.rolPropio,
    actingOrganizationId: destino.id,
  });

  // Entrar a los datos de un cliente queda registrado en la bitacora propia.
  await logAudit({
    organizationId: user.organizacionPropia.id,
    userId: user.id,
    entity: "Organization",
    entityId: destino.id,
    action: "CLIENT_ACCESSED",
    summary: `Acceso a la empresa cliente ${destino.name}`,
  });

  return ok({ organization: destino });
}

/** Volver a la organizacion propia. */
export async function DELETE() {
  const { error, user } = await requireSuperAdmin();
  if (error) return error;

  const sesion = await readSession();
  await createSession({
    userId: user.id,
    organizationId: user.organizacionPropia.id,
    email: sesion?.email ?? user.email,
    name: user.name,
    role: user.rolPropio,
  });
  return ok({ success: true });
}
