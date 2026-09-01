import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada } from "@/lib/ia/cliente";
import { juzgarDuplicados } from "@/lib/ia/dedupe";
import { ErrorDeFusion, fusionarRefacciones } from "@/lib/dedupe-refacciones";
import { logAudit } from "@/lib/audit";

export const maxDuration = 180;

const schema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("ANALIZAR") }),
  z.object({
    accion: z.literal("FUSIONAR"),
    sobrevivienteId: z.string().min(1),
    absorbidasIds: z.array(z.string().min(1)).min(1).max(20),
    nombreNuevo: z.string().trim().min(2).max(140).optional().nullable(),
  }),
]);

export async function POST(request: Request) {
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    if (input.accion === "ANALIZAR") {
      if (!iaConfigurada()) return fail("La limpieza del catalogo no esta configurada en este servidor.", 503);
      try {
        const r = await juzgarDuplicados(
          {
            id: orgId,
            plan: user.organization.plan,
            iaComplemento: user.organization.iaComplemento,
            iaExtra: user.organization.iaExtra,
          },
          { userId: user.id, operador: user.isSuperAdmin },
        );
        if (!r.ok) return fail(r.motivo, 402);
        return ok({ juicio: r.juicio, candidatos: r.candidatos });
      } catch (error) {
        if (error instanceof IaNoConfigurada) return fail(error.message, 503);
        return fail(error instanceof Error ? error.message : "No fue posible analizar", 502);
      }
    }

    try {
      const r = await fusionarRefacciones({
        organizationId: orgId, userId: user.id,
        sobrevivienteId: input.sobrevivienteId,
        absorbidasIds: input.absorbidasIds,
      });
      if (input.nombreNuevo) {
        await import("@/lib/db").then(({ prisma }) =>
          prisma.part.update({ where: { id: input.sobrevivienteId }, data: { name: input.nombreNuevo! } }),
        );
      }
      // La fusion no se deshace: la bitacora es el unico rastro de que existio
      // lo absorbido y de quien decidio juntarlo.
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "Part", entityId: input.sobrevivienteId, action: "MERGED",
        summary: `${r.sobreviviente.code} absorbio: ${r.absorbidas.join(", ")}`,
        changes: { absorbidas: r.absorbidas, existenciaFinal: r.sobreviviente.quantityOnHand },
      });
      return ok(r);
    } catch (error) {
      if (error instanceof ErrorDeFusion) return fail(error.message, 422);
      throw error;
    }
  });
}
