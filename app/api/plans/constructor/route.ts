import { z } from "zod";
import { ok, fail, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { constructorDePlanes, fijarMetaDePlanes, ErrorDeMeta } from "@/lib/constructor-planes";

/** `meta: null` vuelve al mínimo sugerido por los grupos de equipos iguales. */
const schema = z.object({ meta: z.coerce.number().int().min(1).max(5000).nullable() });

export async function GET() {
  return withAuth(null, async ({ orgId }) => ok(await constructorDePlanes(orgId)));
}

export async function PUT(request: Request) {
  return withAuth("plan:write", async ({ user, orgId }) => {
    const { meta } = schema.parse(await request.json());
    try {
      const antes = await constructorDePlanes(orgId);
      const despues = await fijarMetaDePlanes({ organizationId: orgId, userId: user.id, meta });
      await logAudit({
        organizationId: orgId,
        userId: user.id,
        entity: "Organization",
        entityId: orgId,
        action: "PLAN_GOAL_CHANGED",
        summary: meta === null
          ? `Meta de planes: vuelve al mínimo sugerido (${despues.sugeridos})`
          : `Meta de planes: ${meta}`,
        changes: { antes: antes.metaFijada, despues: meta, sugeridos: despues.sugeridos },
      });
      return ok(despues);
    } catch (e) {
      if (e instanceof ErrorDeMeta) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
