import { fail, ok, withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { actualizarDesdeCatalogo, firmarRevisionDeNorma } from "@/lib/normas";
import { revisarContrato } from "../contrato";

/** Apaga o enciende una norma, le pone responsable, o la actualiza desde el catálogo. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("settings:write", async ({ orgId, user }) => {
    const sinContrato = revisarContrato(user.organization);
    if (sinContrato) return sinContrato;

    const cuerpo = (await req.json().catch(() => null)) as
      | {
          activa?: boolean; responsableId?: string | null; nota?: string | null; actualizar?: boolean;
          /// Firma de revision. `null` la retira; ver `firmarRevisionDeNorma`.
          revisadaPorNombre?: string | null; revisadaPorCargo?: string | null;
        }
      | null;
    if (!cuerpo) return fail("No llegó nada que cambiar");

    if (cuerpo.actualizar) {
      const r = await actualizarDesdeCatalogo(orgId, id, user.id);
      return r.ok ? ok(r.dato) : fail(r.motivos.join(" "), 422, r.motivos);
    }

    // La firma va por su propia funcion: pone la fecha, escribe la bitacora y
    // sabe distinguir firmar de retirar. Aqui solo se le pasa lo que llego.
    if (cuerpo.revisadaPorNombre !== undefined) {
      const r = await firmarRevisionDeNorma({
        organizationId: orgId, normaId: id, userId: user.id,
        nombre: cuerpo.revisadaPorNombre, cargo: cuerpo.revisadaPorCargo ?? null,
      });
      return r.ok ? ok(r.dato) : fail(r.motivos.join(" "), 422, r.motivos);
    }

    const norma = await prisma.normaAdoptada.findFirst({ where: { id, organizationId: orgId }, select: { id: true, clave: true } });
    if (!norma) return fail("Esa norma no existe", 404);

    // El responsable tiene que ser de esta empresa: el id llega del navegador.
    if (cuerpo.responsableId) {
      const existe = await prisma.user.findFirst({ where: { id: cuerpo.responsableId, organizationId: orgId }, select: { id: true } });
      if (!existe) return fail("Esa persona no es de esta empresa", 422);
    }

    await prisma.normaAdoptada.update({
      where: { id: norma.id },
      data: {
        ...(cuerpo.activa !== undefined ? { activa: cuerpo.activa } : {}),
        ...(cuerpo.responsableId !== undefined ? { responsableId: cuerpo.responsableId } : {}),
        ...(cuerpo.nota !== undefined ? { nota: cuerpo.nota?.trim() || null } : {}),
      },
    });
    await logAudit({
      organizationId: orgId, userId: user.id, action: cuerpo.activa === false ? "DELETE" : "UPDATE",
      entity: "NormaAdoptada", entityId: norma.id,
      summary: cuerpo.activa === false ? `Dejó de seguir ${norma.clave}` : `Cambió ${norma.clave}`,
    });
    return ok({ actualizada: true });
  });
}
