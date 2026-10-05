import { z } from "zod";
import { ok, fail, withAuth } from "@/lib/api";
import { constructorDePlanes } from "@/lib/constructor-planes";
import { aplicarPlanDelGrupo, clonarPlan, corregirGrupo, ErrorDeAccion } from "@/lib/constructor-acciones";
import { ErrorDeAsignacion } from "@/lib/asignaciones";

/**
 * Las acciones del constructor, en una sola ruta con unión discriminada: es el
 * mismo molde de `/api/puesta-en-marcha`, donde una pantalla dispara varias
 * cosas y conviene que todas pasen por el mismo permiso y el mismo manejo de
 * errores.
 */
const schema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("APLICAR_AL_GRUPO"), planId: z.string().min(1), clave: z.string().min(1) }),
  z.object({
    accion: z.literal("CLONAR"),
    planId: z.string().min(1),
    nombre: z.string().trim().max(120).optional().nullable(),
    equipos: z.array(z.string().min(1)).max(200).optional(),
  }),
  z.object({
    accion: z.literal("CORREGIR_GRUPO"),
    equipos: z.array(z.string().min(1)).min(1).max(200),
    /** Null deshace la corrección y vuelve al agrupado calculado. */
    destino: z.string().trim().max(200).nullable(),
  }),
]);

export async function POST(request: Request) {
  return withAuth("plan:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    try {
      if (input.accion === "APLICAR_AL_GRUPO") {
        const r = await aplicarPlanDelGrupo({ organizationId: orgId, userId: user.id, planId: input.planId, clave: input.clave });
        return ok({ ...r, constructor: await constructorDePlanes(orgId) });
      }
      if (input.accion === "CLONAR") {
        const r = await clonarPlan({
          organizationId: orgId, userId: user.id, planId: input.planId,
          nombre: input.nombre, equipos: input.equipos,
        });
        return ok({ ...r, constructor: await constructorDePlanes(orgId) });
      }
      return ok({ constructor: await corregirGrupo({ organizationId: orgId, userId: user.id, equipos: input.equipos, destino: input.destino }) });
    } catch (e) {
      if (e instanceof ErrorDeAccion || e instanceof ErrorDeAsignacion) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
