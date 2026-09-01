import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDePortal, crearPuntoDeReporte } from "@/lib/portal";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  nombre: z.string().trim().min(3).max(80),
  siteId: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  assetId: z.string().optional().nullable(),
  nota: z.string().trim().max(200).optional().nullable(),
});

export async function POST(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    try {
      const p = await crearPuntoDeReporte({ organizationId: orgId, userId: user.id, ...input });
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "ReportPoint", entityId: p.id, action: "CREATED",
        summary: `Punto de reporte: ${p.nombre}`,
      });
      return ok({ id: p.id, token: p.token }, 201);
    } catch (error) {
      if (error instanceof ErrorDePortal) return fail(error.message, 422);
      throw error;
    }
  });
}
