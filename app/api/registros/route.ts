import { fail, ok, withAuth } from "@/lib/api";
import { crearDePlantilla, crearTabla } from "@/lib/registros";
import { revisarContrato } from "./contrato";

/**
 * Da de alta una tabla propia, en blanco o desde una plantilla.
 *
 * Armar el esquema es configuracion, y por eso pide `settings:write`: quien
 * captura en una tabla no es quien decide que columnas tiene. El permiso de
 * CAPTURA es otro y lo declara cada tabla.
 */
export async function POST(req: Request) {
  return withAuth("settings:write", async ({ orgId, user }) => {
    const sinContrato = revisarContrato(user.organization);
    if (sinContrato) return sinContrato;

    const cuerpo = (await req.json().catch(() => null)) as
      | { plantilla?: string; nombre?: string; descripcion?: string; permiso?: string; rolesVer?: string[]; icono?: string; campos?: unknown }
      | null;
    if (!cuerpo) return fail("No llegó nada que dar de alta");

    // Una plantilla tal cual: es el camino que evita tablas sin explicacion.
    if (cuerpo.plantilla && !cuerpo.campos) {
      const r = await crearDePlantilla(orgId, cuerpo.plantilla, user.id);
      return r.ok ? ok({ tabla: r.dato }, 201) : fail(r.motivos.join(" "), 422, r.motivos);
    }

    const r = await crearTabla(orgId, {
      nombre: cuerpo.nombre ?? "",
      descripcion: cuerpo.descripcion ?? "",
      icono: cuerpo.icono ?? null,
      permiso: cuerpo.permiso,
      rolesVer: cuerpo.rolesVer,
      plantilla: cuerpo.plantilla ?? null,
      campos: Array.isArray(cuerpo.campos) ? (cuerpo.campos as never[]) : [],
    }, user.id);

    // Los motivos van tambien en `details`: la pantalla los pinta en lista, que
    // es como se corrige una tabla de doce campos sin adivinar.
    return r.ok ? ok({ tabla: r.dato }, 201) : fail(r.motivos.join(" "), 422, r.motivos);
  });
}
