import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/superadmin";
import { logAudit, notify } from "@/lib/audit";

const schema = z.object({
  accion: z.enum(["PAGAR", "CANCELAR", "REABRIR"]),
  formaPago: z.string().trim().max(60).optional().nullable(),
  referenciaPago: z.string().trim().max(120).optional().nullable(),
  nota: z.string().trim().max(300).optional().nullable(),
});

/** Marcar pagado, cancelar o reabrir un cargo. Solo el operador. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error, user } = await requireSuperAdmin();
  if (error) return error;

  const cargo = await prisma.invoice.findUnique({
    where: { id },
    include: { organization: { select: { id: true, name: true } } },
  });
  if (!cargo) return fail("Cargo no encontrado", 404);

  const input = schema.parse(await request.json());

  if (input.accion === "PAGAR" && cargo.status === "PAID") {
    return fail("El cargo ya esta marcado como pagado", 409);
  }
  if (input.accion === "REABRIR" && cargo.status === "PENDING") {
    return fail("El cargo ya esta pendiente", 409);
  }

  const datos =
    input.accion === "PAGAR"
      ? {
          status: "PAID",
          pagadaEl: new Date(),
          formaPago: input.formaPago ?? null,
          referenciaPago: input.referenciaPago ?? null,
          nota: input.nota ?? cargo.nota,
        }
      : input.accion === "CANCELAR"
        ? { status: "CANCELLED", nota: input.nota ?? cargo.nota }
        : { status: "PENDING", pagadaEl: null, formaPago: null, referenciaPago: null };

  const actualizado = await prisma.invoice.update({ where: { id }, data: datos });

  if (input.accion === "PAGAR") {
    const duenos = await prisma.user.findMany({
      where: { organizationId: cargo.organizationId, role: "OWNER", active: true },
      select: { id: true },
    });
    await Promise.all(
      duenos.map((d) =>
        notify({
          organizationId: cargo.organizationId,
          userId: d.id,
          title: `Pago registrado · ${cargo.folio}`,
          body: "Gracias. Su cargo aparece como pagado en el estado de cuenta.",
          link: "/settings?s=cobranza",
          kind: "SUCCESS",
        }),
      ),
    );
  }

  await logAudit({
    organizationId: user.organizacionPropia.id,
    userId: user.id,
    entity: "Invoice",
    entityId: id,
    action: input.accion,
    summary: `${cargo.organization.name} · ${cargo.folio}`,
  });

  return ok({ cargo: actualizado });
}
