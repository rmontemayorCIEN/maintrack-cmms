import { z } from "@/lib/zod";
import { fail, leerCuerpo, ok, withAuth } from "@/lib/api";
import { activarConsultorDe } from "@/lib/consultor/consultor";
import { quienDe } from "@/lib/consultor/quien";

export const dynamic = "force-dynamic";

/** Encender o apagar el Consultor en la empresa (Ajustes). Queda en la bitacora. */
export async function POST(request: Request) {
  return withAuth("settings:write", async ({ user }) => {
    const leido = await leerCuerpo(request, z.object({ encendido: z.boolean() }));
    if (!leido.ok) return leido.respuesta;
    const r = await activarConsultorDe(quienDe(user), leido.datos.encendido);
    return r.ok ? ok(r) : fail(r.error, 403);
  });
}
