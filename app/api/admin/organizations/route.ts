import { z } from "zod";
import { prisma } from "@/lib/db";
import { MODOS_DE_INICIO } from "@/lib/modos-inicio";
import { fail, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/superadmin";
import { logAudit } from "@/lib/audit";
import { ErrorDeAlta, darDeAltaEmpresa } from "@/lib/alta-empresa";
import { PRUEBA_DIAS } from "@/lib/comercial";

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
  plan: z.enum(["PROFESSIONAL", "ENTERPRISE"]).default("PROFESSIONAL"),
  trialDays: z.coerce.number().int().min(0).max(365).default(PRUEBA_DIAS),
  ownerName: z.string().trim().min(2, "El nombre del responsable es obligatorio"),
  ownerEmail: z.string().email("Correo invalido"),
  ownerPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  // Sin valor por omisión: quien da de alta tiene que elegir, habiendo leído
  // qué trae cada opción.
  modo: z.enum(["VACIA", "RECOMENDADA", "DEMO"], { required_error: "Elija cómo empieza la empresa" }),
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

  let org: { id: string; name: string; slug: string };
  try {
    ({ org } = await darDeAltaEmpresa({
      nombre: input.name, giro: input.industry, tipoInstalacion: input.tipoInstalacion, plan: input.plan, diasPrueba: input.trialDays,
      responsable: { nombre: input.ownerName, correo: input.ownerEmail, contrasena: input.ownerPassword },
      modo: input.modo, origen: "OPERADOR", iniciadoPor: user.id,
    }));
  } catch (e) {
    if (e instanceof ErrorDeAlta) return fail(e.message, e.status);
    throw e;
  }
  const elegido = MODOS_DE_INICIO.find((m) => m.modo === input.modo)!;

  await logAudit({
    organizationId: user.organizacionPropia.id,
    userId: user.id,
    entity: "Organization",
    entityId: org.id,
    action: "CLIENT_CREATED",
    summary: `Alta de empresa cliente: ${org.name} (${elegido.titulo.toLowerCase()})`,
  });

  return ok({ organization: { id: org.id, name: org.name, slug: org.slug } }, 201);
}
