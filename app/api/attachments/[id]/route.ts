import { NextResponse } from "next/server";
import { puedeVerRuta, veTodasLasSolicitudes } from "@/lib/pantallas";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { borrarArchivo, urlDeLectura } from "@/lib/almacenamiento";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

function puedeVerAdjunto(
  user: { id: string; role: string; isSuperAdmin: boolean },
  a: { workOrderId: string | null; assetId: string | null; partId: string | null; workRequest: { requestedById: string | null; workOrder: { assignedToId: string | null } | null } | null },
) {
  const ve = (ruta: string) => puedeVerRuta(user.role, ruta, { esSuperAdmin: user.isSuperAdmin });
  if (a.workRequest) {
    return veTodasLasSolicitudes(user.role) || a.workRequest.requestedById === user.id || a.workRequest.workOrder?.assignedToId === user.id;
  }
  if (a.workOrderId) return ve("/work-orders");
  if (a.assetId) return ve("/assets");
  if (a.partId) return ve("/inventory");
  return true;
}

/** Redirige a un enlace firmado y temporal. Nunca se expone una URL fija. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth(null, async ({ orgId, user }) => {
    const adjunto = await prisma.attachment.findFirst({
      where: { id, organizationId: orgId },
      select: {
        storagePath: true, name: true, workOrderId: true, assetId: true, partId: true,
        workRequest: { select: { requestedById: true, workOrder: { select: { assignedToId: true } } } },
      },
    });
    // Un archivo se abre si se ve el registro al que pertenece: la foto de
    // una solicitud ajena no se vuelve pública por conocer su identificador.
    if (!adjunto || !puedeVerAdjunto(user, adjunto)) return fail("Archivo no encontrado", 404);

    const url = await urlDeLectura(adjunto.storagePath, adjunto.name);

    /**
     * Abrir un archivo queda registrado.
     *
     * Una evidencia puede ser la foto de un accidente o el documento de una
     * garantia. Saber quien la abrio es parte de poder responder despues; y
     * como lo que se entrega es una liga firmada que caduca, este es el unico
     * momento en que se puede saber.
     */
    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Attachment", entityId: id, action: "FILE_ACCESSED",
      summary: `${user.name} abrió ${adjunto.name}`,
    });
    return NextResponse.redirect(url.startsWith("http") ? url : new URL(url, _request.url));
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth(null, async ({ user, orgId }) => {
    const adjunto = await prisma.attachment.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true, storagePath: true, workRequestId: true, uploadedById: true },
    });
    if (!adjunto) return fail("Archivo no encontrado", 404);

    // Quien subio el archivo puede quitarlo; para lo demas se exige el permiso
    // de ejecucion, que es el que tienen tecnicos y supervisores.
    const propio = adjunto.uploadedById === user.id;
    if (!propio && !can(user.role, "workorder:execute")) {
      return fail("Sin permisos suficientes", 403);
    }

    await prisma.attachment.delete({ where: { id } });
    await borrarArchivo(adjunto.storagePath);

    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Attachment", entityId: id,
      action: "DELETED", summary: `${adjunto.name} eliminado`,
    });
    return ok({ success: true });
  });
}
