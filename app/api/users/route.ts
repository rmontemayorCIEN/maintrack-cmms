import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { verificarCupo } from "@/lib/planes";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "SUPERVISOR", "TECHNICIAN", "REQUESTER", "VIEWER"]),
  jobTitle: z.string().optional().nullable(),
  hourlyRate: z.coerce.number().min(0).default(0),
  phone: z.string().optional().nullable(),
});

export async function GET() {
  return withAuth(null, async ({ orgId }) => {
    const users = await prisma.user.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, name: true, email: true, role: true, jobTitle: true,
        hourlyRate: true, active: true, color: true, lastLoginAt: true,
      },
      orderBy: { name: "asc" },
    });
    return ok({ users });
  });
}

export async function POST(request: Request) {
  return withAuth("user:manage", async ({ orgId, user }) => {
    const input = schema.parse(await request.json());
    const email = input.email.toLowerCase().trim();

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return fail("Ese correo ya esta registrado", 409);

    const cupo = await verificarCupo(orgId, user.organization.plan, "users");
    if (!cupo.permitido) return fail(cupo.mensaje, 402);

    // El color del avatar rota segun cuantos usuarios haya ya en la empresa.
    const posicion = await prisma.user.count({ where: { organizationId: orgId } });
    const palette = ["#2563eb", "#0891b2", "#7c3aed", "#db2777", "#ea580c", "#059669"];
    const created = await prisma.user.create({
      data: {
        organizationId: orgId,
        name: input.name,
        email,
        passwordHash: await hashPassword(input.password),
        role: input.role,
        jobTitle: input.jobTitle,
        hourlyRate: input.hourlyRate,
        phone: input.phone,
        color: palette[posicion % palette.length],
      },
      select: { id: true, name: true, email: true, role: true },
    });
    return ok({ user: created }, 201);
  });
}
