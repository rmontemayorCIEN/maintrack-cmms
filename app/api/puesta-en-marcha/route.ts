import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { puestaEnMarcha } from "@/lib/puesta-en-marcha";
import { modoDeInicio } from "@/lib/modos-inicio";
import { ErrorDeInicio, iniciarEmpresa, quitarDemo, vistaPreviaQuitarDemo } from "@/lib/demo";
import {
  ErrorDePuesta, cambiarTipoInstalacion, comenzarAOperar, declararModulo,
} from "@/lib/puesta-en-marcha-acciones";

/**
 * Las decisiones de la puesta en marcha, en una sola ruta.
 *
 * Todas piden configurar la empresa (`settings:write`) y todas trabajan sobre
 * la organización de la sesión: no reciben ningún identificador de empresa.
 * La lógica vive en lib/, que es lo que prueban las pruebas.
 */
const accion = z.discriminatedUnion("accion", [
  // «ESTRUCTURA» es el nombre anterior de la configuración recomendada.
  z.object({ accion: z.literal("INICIAR"), modo: z.enum(["VACIA", "RECOMENDADA", "ESTRUCTURA", "DEMO"]) }),
  z.object({ accion: z.literal("QUITAR_DEMO"), confirmado: z.boolean().default(false) }),
  z.object({ accion: z.literal("MODULO"), modulo: z.enum(["almacen", "compras", "medidores"]), usa: z.boolean().nullable() }),
  z.object({ accion: z.literal("TIPO"), tipo: z.string().trim().min(2).max(20) }),
  z.object({ accion: z.literal("OPERAR") }),
]);

/** El estado completo, con la vista previa de lo que quitaría la demo. */
export async function GET() {
  return withAuth("settings:write", async ({ orgId }) => {
    const marcha = await puestaEnMarcha(orgId);
    return ok({ ...marcha, demo: marcha.hayDemo ? await vistaPreviaQuitarDemo(orgId) : null });
  }, { esLectura: true });
}

export async function POST(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const input = accion.parse(await request.json());
    try {
      switch (input.accion) {
        case "INICIAR":
          return ok(await iniciarEmpresa({ organizationId: orgId, userId: user.id, modo: modoDeInicio(input.modo)! }), 201);
        case "QUITAR_DEMO":
          return ok(await quitarDemo({ organizationId: orgId, userId: user.id, confirmado: input.confirmado }));
        case "MODULO":
          return ok(await declararModulo({ organizationId: orgId, userId: user.id, modulo: input.modulo, usa: input.usa }));
        case "TIPO":
          await cambiarTipoInstalacion({ organizationId: orgId, userId: user.id, tipo: input.tipo });
          return ok({ success: true });
        case "OPERAR":
          return ok(await comenzarAOperar({ organizationId: orgId, userId: user.id }));
      }
    } catch (e) {
      if (e instanceof ErrorDeInicio || e instanceof ErrorDePuesta) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
