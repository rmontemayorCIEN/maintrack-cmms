import { prisma } from "./db";
import { nextWorkOrderNumber } from "./numbering";
import { logAudit, notify } from "./audit";
import { tipoDeTrabajo } from "./tipos-solicitud";

/**
 * Aprobar una solicitud y convertirla en trabajo.
 *
 * Vive aqui y no dentro de la ruta porque la ruta necesita sesion y una prueba
 * no la tiene. Si la prueba replicara estos pasos por su cuenta, estaria
 * probando su propia copia mientras el sistema hace otra cosa —el defecto mas
 * caro que ha tenido este proyecto: la prueba del alta de planes asignaba por
 * su cuenta, el endpoint nunca asignaba, y las dos pasaban—.
 *
 * Ahora la ruta y la prueba llaman LA MISMA funcion.
 */

export class ErrorDeSolicitud extends Error {
  constructor(mensaje: string, readonly codigo: number = 409) {
    super(mensaje);
  }
}

export type AprobarSolicitud = {
  organizationId: string;
  userId: string;
  solicitudId: string;
  /**
   * El equipo que pone quien revisa. `undefined` deja lo que trajera la
   * solicitud; `null` lo quita a proposito.
   *
   * Llega sin equipo mas seguido de lo que parece: el QR de un area no lo
   * trae, y a quien reporta desde su celular no se le exige adivinar la clave
   * —un equipo mal escogido ensucia el historial de uno que no fallo y deja
   * sin registro al que si—. Quien conoce el catalogo es el gestor.
   */
  assetId?: string | null;
  tipo?: string | null;
  assignedToId?: string | null;
  dueDate?: string | null;
  reviewNotes?: string;
  /** Para sumar el reporte a una orden que ya existe, en vez de abrir otra. */
  workOrderId?: string | null;
};

export async function aprobarSolicitud(p: AprobarSolicitud) {
  const solicitud = await prisma.workRequest.findFirst({
    where: { id: p.solicitudId, organizationId: p.organizationId },
  });
  if (!solicitud) throw new ErrorDeSolicitud("Solicitud no encontrada", 404);
  if (solicitud.status !== "PENDING") {
    throw new ErrorDeSolicitud("La solicitud ya fue revisada", 409);
  }

  /**
   * El equipo se guarda en la SOLICITUD antes de convertirla.
   *
   * La orden lo copia de ahi, y la solicitud conserva a que equipo se refirio
   * —que es lo que despues explica su historia—. Hasta hoy no habia donde
   * ponerlo: una solicitud sin equipo se volvia una orden SIN ACTIVO, para
   * siempre. Esa orden no entra al expediente de ningun equipo, no cuenta en
   * su Pareto y no suma a su costo de paro. Se veia bien y desaparecia.
   */
  let assetId = solicitud.assetId;
  let siteId = solicitud.siteId;
  let locationId = solicitud.locationId;

  if (p.assetId !== undefined) {
    const asset = p.assetId
      ? await prisma.asset.findFirst({
          where: { id: p.assetId, organizationId: p.organizationId },
          select: { id: true, siteId: true, locationId: true },
        })
      : null;
    if (p.assetId && !asset) {
      throw new ErrorDeSolicitud("Ese equipo no existe en su empresa", 404);
    }
    assetId = asset?.id ?? null;
    // El sitio y el area del equipo mandan sobre lo que trajo el punto del QR:
    // si el reporte entro por el punto general, no traia ninguno de los dos.
    siteId = asset?.siteId ?? solicitud.siteId;
    locationId = asset?.locationId ?? solicitud.locationId;
    await prisma.workRequest.update({
      where: { id: solicitud.id },
      data: { assetId, siteId, locationId },
    });
  }

  const tipoFinal = p.tipo ?? solicitud.tipo;

  /**
   * El reporte se atiende como ACTIVIDAD, no como encabezado.
   *
   * Antes la conversion creaba una OT vacia y el codigo de falla se capturaba
   * arriba. Eso impedia que una misma orden atendiera dos reportes: un
   * encabezado no puede tener dos causas.
   */
  let workOrder: { id: string; number: string };

  if (p.workOrderId) {
    const destino = await prisma.workOrder.findFirst({
      where: { id: p.workOrderId, organizationId: p.organizationId },
      select: { id: true, number: true, status: true, assetId: true },
    });
    if (!destino) throw new ErrorDeSolicitud("La orden de trabajo no existe", 404);
    if (["COMPLETED", "CANCELLED"].includes(destino.status)) {
      throw new ErrorDeSolicitud("Esa orden ya esta cerrada. Elija otra o abra una nueva.", 409);
    }
    // Sumar a una orden de otro equipo mezclaria el historial de dos activos.
    if (assetId && destino.assetId && assetId !== destino.assetId) {
      throw new ErrorDeSolicitud(
        "La orden es de otro equipo. El reporte debe ir a una orden del mismo activo.",
        409,
      );
    }
    workOrder = destino;
  } else {
    workOrder = await prisma.workOrder.create({
      data: {
        organizationId: p.organizationId,
        number: await nextWorkOrderNumber(p.organizationId),
        title: solicitud.title,
        description: solicitud.description,
        // Del tipo de la solicitud, no a fuego: una mejora o un apoyo no deben
        // entrar como falla y ensuciar el Pareto.
        maintenanceType: tipoDeTrabajo(tipoFinal),
        status: p.assignedToId ? "ASSIGNED" : "OPEN",
        priority: solicitud.priority,
        assetId,
        siteId,
        locationId,
        assignedToId: p.assignedToId || null,
        createdById: p.userId,
        dueDate: p.dueDate ? new Date(p.dueDate) : new Date(Date.now() + 3 * 86_400_000),
        estimatedHours: 2,
      },
      select: { id: true, number: true },
    });
  }

  const ultima = await prisma.workOrderTask.aggregate({
    where: { workOrderId: workOrder.id },
    _max: { position: true },
  });
  await prisma.workOrderTask.create({
    data: {
      workOrderId: workOrder.id,
      position: (ultima._max.position ?? -1) + 1,
      origen: "SOLICITUD",
      origenRequestId: solicitud.id,
      maintenanceType: tipoDeTrabajo(tipoFinal),
      title: solicitud.title,
      description: solicitud.description,
      taskType: "CHECK",
      required: true,
    },
  });

  const updated = await prisma.workRequest.update({
    where: { id: solicitud.id },
    data: {
      status: "CONVERTED",
      tipo: tipoFinal,
      reviewedById: p.userId,
      reviewedAt: new Date(),
      reviewNotes: p.reviewNotes,
      workOrderId: workOrder.id,
    },
  });

  await logAudit({
    organizationId: p.organizationId,
    userId: p.userId,
    entity: "WorkRequest",
    entityId: solicitud.id,
    action: "CONVERTED",
    summary: `${solicitud.number} → ${workOrder.number}`,
  });

  if (solicitud.requestedById) {
    await notify({
      organizationId: p.organizationId,
      userId: solicitud.requestedById,
      title: `Solicitud ${solicitud.number} aprobada`,
      body: `Se genero la orden ${workOrder.number}`,
      link: `/work-orders/${workOrder.id}`,
      kind: "SUCCESS",
      tag: solicitud.number,
    });
  }

  return { request: updated, workOrder };
}
