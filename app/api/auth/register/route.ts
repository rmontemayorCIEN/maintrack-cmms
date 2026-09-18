import { z } from "zod";
import { prisma } from "@/lib/db";
import { iniciarEmpresa } from "@/lib/demo";
import { createSession, hashPassword } from "@/lib/auth";
import { fail, ok } from "@/lib/api";
import { slugify } from "@/lib/utils";

const schema = z.object({
  organizationName: z.string().min(2),
  industry: z.string().optional(),
  tipoInstalacion: z.string().trim().max(20).optional(),
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

export async function POST(request: Request) {
  // En una URL publica el alta abierta permitiria que cualquiera creara
  // organizaciones dentro de su instancia. Se habilita explicitamente con
  // ALLOW_PUBLIC_SIGNUP=true; de lo contrario solo se dan de alta usuarios
  // desde Configuracion, o la primera organizacion con scripts/bootstrap.ts.
  if (process.env.ALLOW_PUBLIC_SIGNUP !== "true") {
    return fail("El registro publico esta deshabilitado en esta instancia", 403);
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos invalidos", 422);
  }
  const input = parsed.data;
  const email = input.email.toLowerCase().trim();

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return fail("Ese correo ya esta registrado", 409);

  let slug = slugify(input.organizationName);
  let attempt = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${slugify(input.organizationName)}-${attempt++}`;
  }

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 30);

  const organization = await prisma.organization.create({
    data: {
      name: input.organizationName,
      slug,
      industry: input.industry,
      tipoInstalacion: input.tipoInstalacion ?? null,
      plan: "PROFESSIONAL",
      status: "TRIAL",
      trialEndsAt,
    },
  });

  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
      role: "OWNER",
      jobTitle: "Direccion",
    },
  });

  // Empieza vacía: solo los catálogos técnicos indispensables. La
  // configuración recomendada o la demostración las elige después, en la
  // puesta en marcha, donde se explica qué trae cada una.
  await iniciarEmpresa({ organizationId: organization.id, userId: user.id, modo: "VACIA" });

  await createSession({
    userId: user.id,
    organizationId: organization.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  return ok({ organizationId: organization.id, userId: user.id }, 201);
}
