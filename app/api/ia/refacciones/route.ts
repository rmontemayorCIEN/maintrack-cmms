import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada } from "@/lib/ia/cliente";
import { sugerirRefacciones } from "@/lib/ia/refacciones";
import { logAudit } from "@/lib/audit";

export const maxDuration = 300;

const sugerir = z.object({
  assetId: z.string().min(1),
  notas: z.string().trim().max(600).optional().nullable(),
});

/** Propone refacciones para un equipo. No da de alta nada. */
export async function POST(request: Request) {
  return withAuth("inventory:write", async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("La función de inteligencia artificial no esta configurada en este servidor.", 503);
    }
    const input = sugerir.parse(await request.json());

    try {
      const r = await sugerirRefacciones(
        { id: orgId, plan: user.organization.plan, iaComplemento: user.organization.iaComplemento, iaExtra: user.organization.iaExtra },
        { assetId: input.assetId, notas: input.notas, userId: user.id },
      );
      if (!r.ok) return fail(r.motivo, 402);
      return ok({ refacciones: r.refacciones, nota: r.nota, activo: r.activo });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(error instanceof Error ? error.message : "No fue posible generar la propuesta", 502);
    }
  });
}

const alta = z.object({
  refacciones: z.array(
    z.object({
      code: z.string().trim().min(1).max(60),
      name: z.string().trim().min(2).max(160),
      category: z.string().trim().max(40).optional().nullable(),
      unit: z.string().trim().max(30).default("pza"),
      minQuantity: z.coerce.number().min(0).default(1),
      description: z.string().trim().max(400).optional().nullable(),
    }),
  ).min(1).max(20),
});

/**
 * Alta en lote de lo que el usuario acepto.
 *
 * Se da de alta con existencia y costo en cero a proposito: la IA no inventa
 * precios ni cuenta lo que hay en el anaquel. Quien reciba la compra captura
 * la entrada, y ahi el costo entra por donde debe.
 */
export async function PUT(request: Request) {
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const input = alta.parse(await request.json());

    const existentes = new Set(
      (await prisma.part.findMany({ where: { organizationId: orgId }, select: { code: true } }))
        .map((p) => p.code.toUpperCase()),
    );

    const nuevas = input.refacciones.filter((r) => !existentes.has(r.code.toUpperCase()));
    const omitidas = input.refacciones.length - nuevas.length;
    if (!nuevas.length) return fail("Todas esas refacciones ya existen en su catálogo", 409);

    const creadas = await prisma.$transaction(
      nuevas.map((r) =>
        prisma.part.create({
          data: {
            organizationId: orgId,
            code: r.code,
            name: r.name,
            description: r.description || null,
            category: r.category || null,
            unit: r.unit || "pza",
            unitCost: 0,
            quantityOnHand: 0,
            minQuantity: r.minQuantity,
            maxQuantity: r.minQuantity * 3,
          },
          select: { id: true, code: true },
        }),
      ),
    );

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Part",
      entityId: creadas[0].id,
      action: "CREATED",
      summary: `Alta de ${creadas.length} refacciones sugeridas por IA`,
    });

    return ok({ creadas: creadas.length, omitidas }, 201);
  });
}
