import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { ErrorDePresupuesto, MESES, borrarPresupuesto, guardarPresupuesto } from "@/lib/presupuestos";
import { formatCurrency } from "@/lib/utils";
import { prisma } from "@/lib/db";

const Entrada = z.object({
  centroDeCostoId: z.string().min(1),
  anio: z.number().int().min(2000).max(2100),
  mes: z.number().int().min(1).max(12),
  monto: z.number().min(0),
  nota: z.string().trim().max(300).nullable().optional(),
});

/** Deja el presupuesto de un centro en un mes. Capturar dos veces actualiza. */
export async function PUT(req: Request) {
  return withAuth("settings:write", async ({ orgId, user }) => {
    const datos = Entrada.safeParse(await req.json().catch(() => null));
    if (!datos.success) return fail("Datos incompletos para guardar el presupuesto", 422);

    try {
      const p = await guardarPresupuesto({
        organizationId: orgId, userId: user.id, ...datos.data, nota: datos.data.nota ?? null,
      });
      const [centro, org] = await Promise.all([
        prisma.centroDeCosto.findUnique({ where: { id: datos.data.centroDeCostoId }, select: { code: true } }),
        prisma.organization.findUnique({ where: { id: orgId }, select: { currency: true } }),
      ]);
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "Presupuesto", entityId: p.id, action: "UPDATED",
        // Queda el rastro de CUANTO quedo y de que mes: el historial de una
        // cifra que se ajusta varias veces es justo lo que se audita.
        summary: `Presupuesto ${centro?.code ?? ""} ${MESES[p.mes - 1]} ${p.anio}: ${formatCurrency(p.monto, org?.currency ?? "MXN")}`,
      });
      return ok({ id: p.id, monto: p.monto });
    } catch (error) {
      if (error instanceof ErrorDePresupuesto) return fail(error.message, error.codigo);
      throw error;
    }
  });
}

/** Quita el presupuesto de un mes: no es lo mismo que dejarlo en cero. */
export async function DELETE(req: Request) {
  return withAuth("settings:write", async ({ orgId, user }) => {
    const p = new URL(req.url).searchParams;
    const centroDeCostoId = p.get("centroDeCostoId") ?? "";
    const anio = Number(p.get("anio"));
    const mes = Number(p.get("mes"));
    if (!centroDeCostoId || !Number.isInteger(anio) || !Number.isInteger(mes)) {
      return fail("Falta decir de qué centro y de qué mes se quita el presupuesto", 422);
    }
    const centro = await prisma.centroDeCosto.findFirst({
      where: { id: centroDeCostoId, organizationId: orgId },
      select: { code: true },
    });
    if (!centro) return fail("Ese centro de costo no existe en esta empresa", 404);

    const { quitados } = await borrarPresupuesto({ organizationId: orgId, centroDeCostoId, anio, mes });
    // Quitar algo que ya no estaba no es un error: la pantalla guarda al salir
    // de la casilla y puede pedirlo dos veces. Solo se anota si de verdad habia.
    if (quitados) {
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "Presupuesto", entityId: centroDeCostoId, action: "DELETED",
        summary: `Se quitó el presupuesto de ${centro.code} en ${MESES[mes - 1]} ${anio}`,
      });
    }
    return ok({ quitados });
  });
}
