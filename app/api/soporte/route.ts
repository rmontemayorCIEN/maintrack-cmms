import { ok, withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { crearSolicitudSoporte, esquemaSolicitudSoporte } from "@/lib/soporte";

/** Las solicitudes de soporte: cada quien las suyas; la administración, las de toda la empresa. */
export async function GET() {
  return withAuth(null, async ({ user, orgId }) => {
    const todas = can(user.role, "settings:write");
    const solicitudes = await prisma.solicitudSoporte.findMany({
      where: { organizationId: orgId, ...(todas ? {} : { userId: user.id }) },
      orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, folio: true, asunto: true, descripcion: true, severidad: true, estado: true, respuesta: true, primeraRespuestaAt: true, createdAt: true, updatedAt: true, user: { select: { name: true } } },
    });
    return ok({ solicitudes });
  });
}

/** Pedir ayuda. Cualquier rol: es la forma de reportar un problema con MainTrack. */
export async function POST(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const datos = esquemaSolicitudSoporte.parse(await request.json());
    const s = await crearSolicitudSoporte({ organizationId: orgId, userId: user.id, datos });
    return ok({ solicitud: { id: s.id, folio: s.folio, estado: s.estado, respuestaObjetivo: s.respuestaObjetivo } }, 201);
  });
}
