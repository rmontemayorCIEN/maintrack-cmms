import { prisma } from "./db";
import { nextWorkOrderNumber } from "./numbering";
import { logAudit } from "./audit";
import { atenderAvisos, emitirAviso } from "./avisos/emitir";
import { avisarNuevaOrden } from "./avisos/ordenes";
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
    throw new ErrorDeSolicitud(yaRevisada(solicitud.status), 409);
  }

  /**
   * El equipo se guarda en la SOLICITUD antes de convertirla.
   *
   * La orden lo copia de ahi, y la solicitud conserva a que equipo se refirio
   * —que es lo que despues explica su historia—. Una solicitud sin equipo se
   * volvia una orden SIN ACTIVO, para siempre: no entraba al expediente de
   * ningun equipo, no contaba en su Pareto y no sumaba a su costo de paro.
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
  }

  if (p.assignedToId) {
    const responsable = await prisma.user.count({
      where: { id: p.assignedToId, organizationId: p.organizationId, active: true, role: { in: ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN"] } },
    });
    if (!responsable) throw new ErrorDeSolicitud("El responsable indicado no existe, está inactivo o su rol no ejecuta órdenes", 404);
  }

  const tipoFinal = p.tipo ?? solicitud.tipo;

  let destino: { id: string; number: string } | null = null;
  if (p.workOrderId) {
    const orden = await prisma.workOrder.findFirst({
      where: { id: p.workOrderId, organizationId: p.organizationId },
      select: { id: true, number: true, status: true, assetId: true },
    });
    if (!orden) throw new ErrorDeSolicitud("La orden de trabajo no existe", 404);
    if (["COMPLETED", "CLOSED", "CANCELLED"].includes(orden.status)) {
      throw new ErrorDeSolicitud("Esa orden ya está terminada o cancelada. Elija otra o abra una nueva.", 409);
    }
    // Sumar a una orden de otro equipo mezclaria el historial de dos activos.
    if (assetId && orden.assetId && assetId !== orden.assetId) {
      throw new ErrorDeSolicitud(
        "La orden es de otro equipo. El reporte debe ir a una orden del mismo activo.",
        409,
      );
    }
    destino = orden;
  }

  const ahora = new Date();
  /**
   * Todo en una transaccion, y lo PRIMERO es apartar la solicitud.
   *
   * Antes se revisaba «esta pendiente» y luego se creaba la orden: dos clics
   * seguidos pasaban los dos la revision y salian dos ordenes para un mismo
   * reporte. Ahora el cambio a CONVERTED solo lo gana quien la encuentra
   * todavia pendiente; el segundo no aparta nada y no crea nada. Si algo falla
   * a la mitad, la transaccion regresa la solicitud a pendiente sin orden.
   */
  const { updated, workOrder } = await prisma.$transaction(async (tx) => {
    const apartada = await tx.workRequest.updateMany({
      where: { id: solicitud.id, organizationId: p.organizationId, status: "PENDING" },
      data: {
        status: "CONVERTED",
        tipo: tipoFinal,
        assetId, siteId, locationId,
        reviewedById: p.userId,
        reviewedAt: ahora,
        reviewNotes: p.reviewNotes,
      },
    });
    if (apartada.count === 0) throw new ErrorDeSolicitud(yaRevisada("CONVERTED"), 409);

    /**
     * El reporte se atiende como ACTIVIDAD, no como encabezado: asi una misma
     * orden puede atender dos reportes, cada uno con su propia causa.
     */
    const workOrder = destino ?? await tx.workOrder.create({
      data: {
        organizationId: p.organizationId,
        number: await nextWorkOrderNumber(p.organizationId, tx),
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

    const ultima = await tx.workOrderTask.aggregate({
      where: { workOrderId: workOrder.id },
      _max: { position: true },
    });
    await tx.workOrderTask.create({
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

    const updated = await tx.workRequest.update({
      where: { id: solicitud.id },
      data: { workOrderId: workOrder.id },
    });
    return { updated, workOrder };
  });

  await logAudit({
    organizationId: p.organizationId,
    userId: p.userId,
    entity: "WorkRequest",
    entityId: solicitud.id,
    action: "CONVERTED",
    summary: `${solicitud.number} → ${workOrder.number}${destino ? " (sumada a una orden existente)" : ""}`,
    changes: { workOrderId: workOrder.id, tipo: tipoFinal, assetId, revisadaPor: p.userId },
  });

  await atenderAvisos({ organizationId: p.organizationId, entidadId: solicitud.id, motivo: "la solicitud se convirtió en orden" });
  await avisarNuevaOrden(p.organizationId, workOrder.id);
  if (solicitud.requestedById) {
    await emitirAviso({
      organizationId: p.organizationId, tipo: "SOLICITUD_CONVERTIDA", entidad: "WorkRequest", entidadId: solicitud.id,
      titulo: `Solicitud ${solicitud.number} aprobada`, cuerpo: `Se generó la orden ${workOrder.number}`,
      enlace: `/work-orders/${workOrder.id}`, contexto: { solicitanteId: solicitud.requestedById }, tag: solicitud.number,
      datos: { folio: solicitud.number, orden: workOrder.number },
    });
  }

  return { request: updated, workOrder };
}

function yaRevisada(status: string) {
  return status === "REJECTED"
    ? "La solicitud ya fue rechazada."
    : status === "CONVERTED"
      ? "La solicitud ya se convirtió en orden de trabajo."
      : "La solicitud ya fue revisada.";
}

/**
 * Rechazar una solicitud. Exige motivo: quien reporto merece saber por que no
 * se atiende, y sin motivo el rechazo no se puede auditar.
 */
export async function rechazarSolicitud(p: {
  organizationId: string;
  userId: string;
  solicitudId: string;
  motivo: string;
}) {
  const motivo = p.motivo?.trim() ?? "";
  if (motivo.length < 5) throw new ErrorDeSolicitud("Indique el motivo del rechazo.", 422);
  const solicitud = await prisma.workRequest.findFirst({
    where: { id: p.solicitudId, organizationId: p.organizationId },
  });
  if (!solicitud) throw new ErrorDeSolicitud("Solicitud no encontrada", 404);

  // Mismo apartado atomico que al convertir: un rechazo y una conversion a la
  // vez no pueden ganar los dos.
  const apartada = await prisma.workRequest.updateMany({
    where: { id: solicitud.id, organizationId: p.organizationId, status: "PENDING" },
    data: { status: "REJECTED", reviewedById: p.userId, reviewedAt: new Date(), reviewNotes: motivo },
  });
  if (apartada.count === 0) {
    const actual = await prisma.workRequest.findUnique({ where: { id: solicitud.id }, select: { status: true } });
    throw new ErrorDeSolicitud(yaRevisada(actual?.status ?? ""), 409);
  }

  await logAudit({
    organizationId: p.organizationId,
    userId: p.userId,
    entity: "WorkRequest",
    entityId: solicitud.id,
    action: "REJECTED",
    summary: `${solicitud.number} rechazada — ${motivo}`,
    changes: { motivo },
  });
  await atenderAvisos({ organizationId: p.organizationId, entidadId: solicitud.id, motivo: "la solicitud se rechazó" });
  if (solicitud.requestedById) {
    await emitirAviso({
      organizationId: p.organizationId, tipo: "SOLICITUD_RECHAZADA", entidad: "WorkRequest", entidadId: solicitud.id,
      titulo: `Solicitud ${solicitud.number} rechazada`, cuerpo: motivo, enlace: "/requests",
      contexto: { solicitanteId: solicitud.requestedById }, tag: solicitud.number, datos: { folio: solicitud.number },
    });
  }
  return prisma.workRequest.findUniqueOrThrow({ where: { id: solicitud.id } });
}
