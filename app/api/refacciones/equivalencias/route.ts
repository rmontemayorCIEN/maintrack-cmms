import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import {
  ErrorDeEquivalencia, equivalentesDe, esTipoValido,
  quitarEquivalencia, registrarEquivalencia,
} from "@/lib/equivalencias";
import { logAudit } from "@/lib/audit";

/** Las equivalentes de una refaccion, con su existencia de hoy. */
export async function GET(request: Request) {
  return withAuth(null, async ({ orgId }) => {
    const partId = new URL(request.url).searchParams.get("partId");
    if (!partId) return fail("Falta la refaccion", 400);
    return ok({ equivalencias: await equivalentesDe(orgId, partId) });
  });
}

const crear = z.object({
  partId: z.string().min(1),
  equivalenteId: z.string().min(1),
  tipo: z.string().refine(esTipoValido, { message: "Tipo invalido" }),
  nota: z.string().trim().max(240).nullable().optional(),
});

export async function POST(request: Request) {
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const input = crear.parse(await request.json());
    try {
      const fila = await registrarEquivalencia({
        organizationId: orgId,
        partId: input.partId,
        equivalenteId: input.equivalenteId,
        tipo: input.tipo,
        nota: input.nota ?? null,
        userId: user.id,
      });
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "EquivalenciaRefaccion", entityId: fila.id, action: "CREATED",
        summary: `Equivalencia registrada (${input.tipo})`,
      });
      return ok({ equivalencia: fila }, 201);
    } catch (e) {
      if (e instanceof ErrorDeEquivalencia) return fail(e.message, e.codigo);
      throw e;
    }
  });
}

export async function DELETE(request: Request) {
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(await request.json());
    try {
      await quitarEquivalencia(orgId, id);
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "EquivalenciaRefaccion", entityId: id, action: "DELETED",
        summary: "Equivalencia quitada",
      });
      return ok({ success: true });
    } catch (e) {
      if (e instanceof ErrorDeEquivalencia) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
