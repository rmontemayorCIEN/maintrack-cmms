import { z } from "zod";
import { prisma } from "@/lib/db";
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
      sites: {
        create: { name: "Planta principal", code: "P01", country: "Mexico" },
      },
      assetCategories: {
        create: [
          { name: "Equipo de proceso", code: "PROC" },
          { name: "Equipo eléctrico", code: "ELEC" },
          { name: "Equipo de transporte", code: "TRAN" },
          { name: "Instalaciones", code: "INST" },
        ],
      },
      failureCodes: {
        create: [
          { code: "MEC-01", description: "Desgaste mecánico", category: "MECANICO" },
          { code: "ELE-01", description: "Falla electrica", category: "ELECTRICO" },
          { code: "LUB-01", description: "Lubricacion deficiente", category: "MECANICO" },
          { code: "OPE-01", description: "Error de operacion", category: "OPERACION" },
        ],
      },
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

  await createSession({
    userId: user.id,
    organizationId: organization.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  return ok({ organizationId: organization.id, userId: user.id }, 201);
}
