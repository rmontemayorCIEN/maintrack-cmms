import { fail, ok, withAuth } from "@/lib/api";
import { adoptarDelCatalogo, crearNormaPropia } from "@/lib/normas";
import { revisarContrato } from "./contrato";

/**
 * Adopta una norma del catalogo, o da de alta una propia del cliente.
 *
 * Pide `settings:write` porque decidir que normas sigue la empresa es
 * configuracion, no operacion: quien ejecuta el trabajo no decide a que se
 * obliga la empresa.
 */
export async function POST(req: Request) {
  return withAuth("settings:write", async ({ orgId, user }) => {
    const sinContrato = revisarContrato(user.organization);
    if (sinContrato) return sinContrato;

    const cuerpo = (await req.json().catch(() => null)) as
      | { clave?: string; delCatalogo?: boolean; titulo?: string; emisor?: string; resumen?: string; obligaciones?: unknown }
      | null;
    if (!cuerpo?.clave) return fail("Falta la clave de la norma");

    if (cuerpo.delCatalogo) {
      const r = await adoptarDelCatalogo(orgId, cuerpo.clave, user.id);
      return r.ok ? ok({ norma: r.dato }, 201) : fail(r.motivos.join(" "), 422, r.motivos);
    }

    const r = await crearNormaPropia(orgId, {
      clave: cuerpo.clave,
      titulo: cuerpo.titulo ?? "",
      emisor: cuerpo.emisor ?? null,
      resumen: cuerpo.resumen ?? null,
      obligaciones: Array.isArray(cuerpo.obligaciones) ? (cuerpo.obligaciones as never[]) : [],
    }, user.id);
    return r.ok ? ok({ norma: r.dato }, 201) : fail(r.motivos.join(" "), 422, r.motivos);
  });
}
