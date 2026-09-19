import { ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superadmin";

/** Todas las solicitudes de soporte, para el operador de la plataforma. */
export async function GET() {
  const { error } = await requireSuperAdmin();
  if (error) return error;
  const solicitudes = await prisma.solicitudSoporte.findMany({
    orderBy: [{ estado: "asc" }, { createdAt: "desc" }], take: 200,
    include: { organization: { select: { name: true, plan: true } }, user: { select: { name: true, email: true } } },
  });
  return ok({ solicitudes });
}
