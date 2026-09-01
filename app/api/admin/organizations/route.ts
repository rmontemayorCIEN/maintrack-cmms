import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { requireSuperAdmin } from "@/lib/superadmin";
import { logAudit } from "@/lib/audit";
import { slugify } from "@/lib/utils";

/** Listado de empresas cliente con su consumo, para el panel del operador. */
export async function GET() {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, slug: true, plan: true, status: true,
      industry: true, tipoInstalacion: true, currency: true, trialEndsAt: true, createdAt: true,
      _count: { select: { users: true, assets: true, workOrders: true } },
    },
  });
  return ok({ organizations: orgs });
}

const schema = z.object({
  name: z.string().trim().min(2, "El nombre de la empresa es obligatorio"),
  industry: z.string().trim().optional().nullable(),
  tipoInstalacion: z.string().trim().max(20).optional().nullable(),
  plan: z.enum(["FREE", "STARTER", "PROFESSIONAL", "ENTERPRISE"]).default("PROFESSIONAL"),
  trialDays: z.coerce.number().int().min(0).max(365).default(30),
  ownerName: z.string().trim().min(2, "El nombre del responsable es obligatorio"),
  ownerEmail: z.string().email("Correo invalido"),
  ownerPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

/** Alta de una empresa cliente con su usuario propietario y catalogos base. */
export async function POST(request: Request) {
  const { error, user } = await requireSuperAdmin();
  if (error) return error;

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch (e) {
    const zerr = e as z.ZodError;
    return fail(zerr.errors?.[0]?.message ?? "Datos invalidos", 422);
  }

  const email = input.ownerEmail.toLowerCase().trim();
  if (await prisma.user.findUnique({ where: { email } })) {
    return fail("Ese correo ya esta registrado en la plataforma", 409);
  }

  let slug = slugify(input.name);
  let intento = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${slugify(input.name)}-${intento++}`;
  }

  const trialEndsAt = input.trialDays > 0
    ? new Date(Date.now() + input.trialDays * 86_400_000)
    : null;

  const org = await prisma.organization.create({
    data: {
      name: input.name,
      slug,
      industry: input.industry || null,
      tipoInstalacion: input.tipoInstalacion || null,
      plan: input.plan,
      status: input.trialDays > 0 ? "TRIAL" : "ACTIVE",
      trialEndsAt,
      // Catalogos minimos para que el cliente pueda trabajar desde el dia uno.
      sites: { create: { name: "Planta principal", code: "P01", country: "Mexico" } },
      assetCategories: {
        create: [
          { name: "Equipo de proceso", code: "PROC" },
          { name: "Equipo electrico", code: "ELEC" },
          { name: "Equipo de transporte", code: "TRAN" },
          { name: "Instalaciones", code: "INST" },
        ],
      },
      failureCodes: {
        create: [
          { code: "MEC-01", description: "Desgaste mecanico", category: "MECANICO" },
          { code: "MEC-02", description: "Desalineacion", category: "MECANICO" },
          { code: "LUB-01", description: "Lubricacion deficiente", category: "MECANICO" },
          { code: "ELE-01", description: "Falla electrica", category: "ELECTRICO" },
          { code: "HID-01", description: "Fuga hidraulica", category: "HIDRAULICO" },
          { code: "OPE-01", description: "Error de operacion", category: "OPERACION" },
        ],
      },
      partCategories: {
        create: [
          { code: "RODAMIENTOS", name: "Rodamientos y baleros" },
          { code: "SELLOS", name: "Sellos y retenes" },
          { code: "FILTROS", name: "Filtros" },
          { code: "LUBRICANTES", name: "Lubricantes y grasas" },
          { code: "ELECTRICO", name: "Material electrico" },
          { code: "TORNILLERIA", name: "Tornilleria y sujecion" },
          { code: "OTRO", name: "Otros" },
        ],
      },
      partUnits: {
        create: [
          { code: "pza", name: "Pieza" }, { code: "jgo", name: "Juego" },
          { code: "m", name: "Metro" }, { code: "kg", name: "Kilogramo" },
          { code: "lt", name: "Litro" }, { code: "caja", name: "Caja" },
        ],
      },
    },
  });

  await prisma.user.create({
    data: {
      organizationId: org.id,
      email,
      name: input.ownerName,
      passwordHash: await hashPassword(input.ownerPassword),
      role: "OWNER",
      jobTitle: "Direccion",
    },
  });

  await logAudit({
    organizationId: user.organizacionPropia.id,
    userId: user.id,
    entity: "Organization",
    entityId: org.id,
    action: "CLIENT_CREATED",
    summary: `Alta de empresa cliente: ${org.name}`,
  });

  return ok({ organization: { id: org.id, name: org.name, slug: org.slug } }, 201);
}
