import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { fail, ok } from "@/lib/api";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("Correo o contraseña invalidos", 422);

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase().trim() },
    include: { organization: true },
  });
  if (!user || !user.active) return fail("Credenciales incorrectas", 401);

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) return fail("Credenciales incorrectas", 401);
  if (user.organization.status === "SUSPENDED") return fail("La organizacion esta suspendida", 403);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession({
    userId: user.id,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  return ok({ user: { id: user.id, name: user.name, role: user.role } });
}
