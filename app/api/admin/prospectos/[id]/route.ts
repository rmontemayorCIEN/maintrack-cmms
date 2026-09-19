import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superadmin";
import { ESTADOS_PROSPECTO, MOTIVOS_PERDIDA } from "@/lib/prospectos";

const esquema = z.object({
  estado: z.enum(ESTADOS_PROSPECTO.map((e) => e.clave) as [string, ...string[]]),
  planInteres: z.enum(["PROFESSIONAL", "ENTERPRISE"]).optional().nullable(),
  resultado: z.string().trim().max(500).optional().nullable(),
  motivoPerdida: z.enum(MOTIVOS_PERDIDA).optional().nullable(),
  notas: z.string().trim().max(2000).optional().nullable(),
});

/** Seguimiento de un prospecto: estado, demostración realizada, resultado y motivo de pérdida. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireSuperAdmin();
  if (error) return error;
  const parsed = esquema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos", 422);
  const d = parsed.data;
  if (d.estado === "PERDIDA" && !d.motivoPerdida) return fail("Indique el motivo de la pérdida", 422);
  const actual = await prisma.prospecto.findUnique({ where: { id: (await params).id } });
  if (!actual) return fail("Prospecto no encontrado", 404);
  const p = await prisma.prospecto.update({
    where: { id: actual.id },
    data: {
      estado: d.estado, planInteres: d.planInteres ?? actual.planInteres, resultado: d.resultado ?? actual.resultado,
      motivoPerdida: d.estado === "PERDIDA" ? d.motivoPerdida : null, notas: d.notas ?? actual.notas,
      ...(d.estado === "DEMO_REALIZADA" && !actual.demoRealizadaAt ? { demoRealizadaAt: new Date() } : {}),
    },
  });
  return ok({ prospecto: p });
}
