import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/superadmin";
import { emitirCargosDelPeriodo, periodoDe } from "@/lib/cobranza";
import { logAudit, notify } from "@/lib/audit";
import { prisma } from "@/lib/db";

const schema = z.object({
  periodo: z.string().regex(/^\d{4}-\d{2}$/, "Use el formato AAAA-MM").optional(),
  organizationId: z.string().optional(),
});

/** Emite los cargos del mes. Idempotente: no duplica los ya emitidos. */
export async function POST(request: Request) {
  const { error, user } = await requireSuperAdmin();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const input = schema.parse(body);
  const periodo = input.periodo ?? periodoDe(new Date());

  const resultado = await emitirCargosDelPeriodo(periodo, {
    organizationId: input.organizationId,
  });

  // Se avisa al propietario de cada empresa que tiene un cargo nuevo.
  if (resultado.emitidos > 0) {
    // Solo los recién emitidos: los pendientes de antes ya se avisaron.
    const cargos = await prisma.invoice.findMany({
      where: { periodo, status: "PENDING", folio: { in: resultado.detalle.map((d) => d.folio) } },
      select: { organizationId: true, folio: true, importe: true, moneda: true },
    });
    for (const c of cargos) {
      const duenos = await prisma.user.findMany({
        where: { organizationId: c.organizationId, role: "OWNER", active: true },
        select: { id: true },
      });
      await Promise.all(
        duenos.map((d) =>
          notify({
            organizationId: c.organizationId,
            userId: d.id,
            title: `Nuevo cargo ${c.folio}`,
            body: `${c.importe.toLocaleString("es-MX")} ${c.moneda} por el servicio del periodo.`,
            link: "/settings?s=cobranza",
          }),
        ),
      );
    }
  }

  await logAudit({
    organizationId: user.organizacionPropia.id,
    userId: user.id,
    entity: "Invoice",
    entityId: periodo,
    action: "GENERATED",
    summary: `Emision de ${periodo}: ${resultado.emitidos} cargos`,
  });

  return ok(resultado, 201);
}
