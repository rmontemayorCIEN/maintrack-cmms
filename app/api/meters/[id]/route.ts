import { z } from "zod";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { fail, ok, withAuth } from "@/lib/api";
import { TIPOS_MEDIDOR } from "@/lib/medidores";

const schema = z.object({
  tipo: z.enum(Object.keys(TIPOS_MEDIDOR) as [keyof typeof TIPOS_MEDIDOR, ...Array<keyof typeof TIPOS_MEDIDOR>]).optional(),
  maxIncrementoDiario: z.coerce.number().positive().nullable().optional(),
});

/** Configura como se validan las lecturas de un medidor. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAuth("asset:write", async ({ user, orgId }) => {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const medidor = await prisma.meter.findFirst({ where: { id, organizationId: orgId } });
    if (!medidor) return fail("Medidor no encontrado", 404);
    const tipo = input.tipo ?? medidor.tipo;
    if (tipo === "HOROMETRO" && input.maxIncrementoDiario != null && input.maxIncrementoDiario > 24) {
      return fail("Un horómetro no puede sumar más de 24 h por día", 422);
    }
    const actualizado = await prisma.meter.update({
      where: { id },
      data: {
        ...(input.tipo ? { tipo: input.tipo } : {}),
        ...(input.maxIncrementoDiario !== undefined ? { maxIncrementoDiario: input.maxIncrementoDiario } : {}),
      },
    });
    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Meter",
      entityId: id,
      action: "CONFIGURADO",
      summary: `${medidor.name}: ${TIPOS_MEDIDOR[tipo as keyof typeof TIPOS_MEDIDOR] ?? tipo}, máximo ${actualizado.maxIncrementoDiario ?? "sin límite"} ${medidor.unit}/día`,
      changes: {
        antes: { tipo: medidor.tipo, maxIncrementoDiario: medidor.maxIncrementoDiario },
        despues: { tipo: actualizado.tipo, maxIncrementoDiario: actualizado.maxIncrementoDiario },
      },
    });
    return ok({ meter: actualizado });
  });
}
