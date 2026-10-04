import { ok, withAuth } from "@/lib/api";
import { olvidarResumen } from "@/lib/resumen-inicio";

/**
 * «Actualizar» del inicio: tira el resumen guardado para que la siguiente
 * carga lo calcule.
 *
 * Sin permiso especial —solo leer— porque no cambia un dato: vuelve a contar
 * lo que ya esta ahi. Cada quien lo hace para su propia empresa, que es la
 * de su sesion.
 */
export async function POST() {
  return withAuth(null, async ({ orgId }) => {
    await olvidarResumen(orgId);
    return ok({ listo: true });
  });
}
