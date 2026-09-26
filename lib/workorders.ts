import { prisma } from "./db";
import { ErrorDeAlmacen, almacenPorOmision, aplicarMovimiento } from "./almacen";
import { can } from "./rbac";
import { esFalla, tipoDeActividad } from "./fallas";
import { WO_STATUS_LABELS } from "./constants";
import {
  esTransicionPosible, faltantesDeCierre, motivoValido, permisoDeTransicion, pideMotivo, textosDeFaltantes,
  type DatosDeCierre,
} from "./reglas-ot";
import { rollForwardPlan } from "./scheduler";
import { avanzarActividadesDeOrden } from "./calendario-actividad";
import { logAudit } from "./audit";
import { avisarTransicion } from "./avisos/ordenes";
import { enFila, hace } from "./repeticion";
import { avisarInventario } from "./avisos/detectores";

/**
 * Recalcula horas y costos de una OT.
 *
 * El costo de un trabajo tiene cuatro componentes: la mano de obra propia, las
 * refacciones del almacen, los servicios que se subcontrataron a proveedores y
 * un "otros" que se captura a mano (fletes, viaticos, consumibles menores).
 */
export async function recalcWorkOrder(workOrderId: string) {
  const [labor, parts, services, wo] = await Promise.all([
    prisma.workOrderLabor.findMany({ where: { workOrderId } }),
    prisma.workOrderPart.findMany({ where: { workOrderId } }),
    prisma.workOrderService.findMany({ where: { workOrderId } }),
    prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { otherCost: true } }),
  ]);

  const actualHours = labor.reduce((s, l) => s + l.hours, 0);
  const laborCost = labor.reduce((s, l) => s + l.cost, 0);
  const partsCost = parts.reduce((s, p) => s + p.cost, 0);
  const serviceCost = services.reduce((s, x) => s + x.cost, 0);
  const otherCost = wo?.otherCost ?? 0;

  /**
   * Y lo mismo por actividad, con lo que se le cargo directamente.
   *
   * Lo que no trae actividad —el viaje, la grua, una refaccion que sirvio para
   * dos cosas— se queda solo en el total de la orden. Por eso la suma de las
   * actividades puede ser menor que el total, y esta bien que asi sea: es
   * preferible a repartir un gasto comun con una regla inventada.
   */
  const porTarea = new Map<string, { labor: number; parts: number; service: number }>();
  const acumular = (taskId: string | null, campo: "labor" | "parts" | "service", monto: number) => {
    if (!taskId) return;
    const acc = porTarea.get(taskId) ?? { labor: 0, parts: 0, service: 0 };
    acc[campo] += monto;
    porTarea.set(taskId, acc);
  };
  for (const l of labor) acumular(l.taskId, "labor", l.cost);
  for (const p of parts) acumular(p.taskId, "parts", p.cost);
  for (const x of services) acumular(x.taskId, "service", x.cost);

  // Se reescriben TODAS las actividades de la orden, no solo las que tienen
  // cargos: si a una se le quito el ultimo cargo, su costo debe volver a cero.
  const tareas = await prisma.workOrderTask.findMany({
    where: { workOrderId },
    select: { id: true },
  });
  await Promise.all(
    tareas.map((t) => {
      const c = porTarea.get(t.id) ?? { labor: 0, parts: 0, service: 0 };
      return prisma.workOrderTask.update({
        where: { id: t.id },
        data: {
          laborCost: c.labor,
          partsCost: c.parts,
          serviceCost: c.service,
          totalCost: c.labor + c.parts + c.service,
        },
      });
    }),
  );

  return prisma.workOrder.update({
    where: { id: workOrderId },
    data: {
      actualHours,
      laborCost,
      partsCost,
      serviceCost,
      totalCost: laborCost + partsCost + serviceCost + otherCost,
    },
  });
}

/**
 * Devuelve el taskId solo si esa actividad es de esa orden.
 *
 * Sin esta comprobacion, un taskId de otra orden cargaria el gasto en el
 * historial de un equipo ajeno. Devolver null en vez de reventar es a
 * proposito: el cargo se guarda igual, solo que como gasto general de la
 * orden, que es el comportamiento de siempre.
 */
export async function actividadValida(
  workOrderId: string,
  taskId: string | null | undefined,
): Promise<string | null> {
  if (!taskId) return null;
  const t = await prisma.workOrderTask.findFirst({
    where: { id: taskId, workOrderId },
    select: { id: true },
  });
  return t?.id ?? null;
}

/** Un paso del ciclo que no procede. Trae su codigo HTTP y, si aplica, la lista de faltantes. */
export class ErrorDeOrden extends Error {
  constructor(mensaje: string, readonly codigo: number = 409, readonly detalles?: string[]) {
    super(mensaje);
    this.name = "ErrorDeOrden";
  }
}

type OrdenParaCierre = {
  maintenanceType: string;
  requiresShutdown: boolean;
  resolution: string | null;
  failureCodeId: string | null;
  rootCauseId: string | null;
  downtimeMinutes: number;
  motivoSinHoras: string | null;
  sinParoConfirmado: boolean;
  motivoSinDiagnostico: string | null;
  tasks: Array<{
    id: string; title: string; done: boolean; liberadaAt: Date | null; maintenanceType: string | null;
    failureCodeId: string | null; rootCauseId: string | null; downtimeMinutes: number;
  }>;
};

/**
 * Arma lo que `faltantesDeCierre` revisa, con lo guardado en la orden y —al
 * completar— lo que llega en el formulario encima. Un solo armado para
 * completar y para cerrar: las dos preguntas son la misma.
 */
export function datosDeCierre(
  wo: OrdenParaCierre,
  extra: {
    horas: number;
    archivos: number;
    evidenciaRequerida: boolean;
    resolution?: string | null;
    motivoSinHoras?: string | null;
    sinParoConfirmado?: boolean;
    motivoSinDiagnostico?: string | null;
    downtimeMinutes?: number;
    failureCodeId?: string | null;
    rootCauseId?: string | null;
    fallas?: Array<{ taskId: string | null; failureCodeId: string | null; rootCauseId: string | null; downtimeMinutes: number }>;
  },
): DatosDeCierre {
  const delForm = new Map((extra.fallas ?? []).map((f) => [f.taskId, f]));
  const vivas = wo.tasks.filter((t) => !t.liberadaAt);
  const deFalla = vivas.filter((t) => esFalla(tipoDeActividad(t.maintenanceType, wo.maintenanceType)));

  const fallas: DatosDeCierre["fallas"] = deFalla.map((t) => {
    const f = delForm.get(t.id);
    return {
      etiqueta: `«${t.title}»`,
      failureCodeId: f ? f.failureCodeId : t.failureCodeId,
      rootCauseId: f ? f.rootCauseId : t.rootCauseId,
    };
  });
  // Ordenes viejas de falla sin actividades: el diagnostico va en el encabezado.
  const encabezado = delForm.get(null);
  if (!deFalla.length && !vivas.length && esFalla(wo.maintenanceType)) {
    fallas.push({
      etiqueta: "la orden",
      failureCodeId: encabezado ? encabezado.failureCodeId : extra.failureCodeId !== undefined ? extra.failureCodeId : wo.failureCodeId,
      rootCauseId: encabezado ? encabezado.rootCauseId : extra.rootCauseId !== undefined ? extra.rootCauseId : wo.rootCauseId,
    });
  }

  // Mismo calculo que el evento de paro al completar: lo de cada actividad
  // mas lo del encabezado (el de una orden sin actividades de falla).
  const minutosParo = extra.fallas
    ? extra.fallas.filter((f) => f.taskId !== null).reduce((a, f) => a + (f.downtimeMinutes || 0), 0) +
      (encabezado?.downtimeMinutes ?? extra.downtimeMinutes ?? 0)
    : (extra.downtimeMinutes ?? wo.downtimeMinutes) + vivas.reduce((a, t) => a + t.downtimeMinutes, 0);

  return {
    resolucion: extra.resolution !== undefined && extra.resolution !== null ? extra.resolution : wo.resolution,
    horas: extra.horas,
    motivoSinHoras: extra.motivoSinHoras !== undefined ? extra.motivoSinHoras : wo.motivoSinHoras,
    requiereParo: wo.requiresShutdown,
    minutosParo,
    sinParoConfirmado: extra.sinParoConfirmado ?? wo.sinParoConfirmado,
    fallas,
    motivoSinDiagnostico: extra.motivoSinDiagnostico !== undefined ? extra.motivoSinDiagnostico : wo.motivoSinDiagnostico,
    actividadesSinResolver: vivas.filter((t) => !t.done).length,
    evidenciaRequerida: extra.evidenciaRequerida,
    archivos: extra.archivos,
  };
}

/** Si la empresa pide evidencia para esta orden: equipo critico (A) o trabajo de seguridad. */
export function requiereEvidencia(
  org: { otEvidenciaCriticas: boolean },
  wo: { maintenanceType: string; asset: { criticality: string } | null },
) {
  return org.otEvidenciaCriticas && (wo.asset?.criticality === "A" || wo.maintenanceType === "SAFETY");
}

/** Lo que le falta HOY a una orden guardada para completarse o cerrarse. */
export async function faltantesDeLaOrden(organizationId: string, workOrderId: string) {
  const wo = await prisma.workOrder.findFirst({
    where: { id: workOrderId, organizationId },
    include: {
      tasks: true,
      asset: { select: { criticality: true } },
      organization: { select: { otEvidenciaCriticas: true } },
      _count: { select: { attachments: true } },
    },
  });
  if (!wo) throw new ErrorDeOrden("Orden de trabajo no encontrada", 404);
  const horas = (await prisma.workOrderLabor.aggregate({ where: { workOrderId }, _sum: { hours: true } }))._sum.hours ?? 0;
  return faltantesDeCierre(datosDeCierre(wo, {
    horas,
    archivos: wo._count.attachments,
    evidenciaRequerida: requiereEvidencia(wo.organization, wo),
  }));
}

/**
 * Cambia el estado de una OT aplicando las reglas del ciclo (`lib/reglas-ot.ts`)
 * y los efectos colaterales del flujo: marcas de tiempo, registro de paro del
 * activo, avance del plan preventivo y notificaciones.
 *
 * Todo lo decide el servidor: permiso del rol para ESE paso, motivo cuando se
 * pide, responsable antes de iniciar, y la informacion esencial antes de
 * completar o cerrar. La pantalla solo evita ofrecer lo que aqui se rechaza.
 */
export async function transitionWorkOrder(params: {
  workOrderId: string;
  to: string;
  userId: string;
  organizationId: string;
  /** Rol de quien lo pide: cada paso tiene su permiso (ver `permisoDeTransicion`). */
  rol: string;
  /** Poner en espera, cancelar, devolver, reabrir o reactivar. */
  motivo?: string | null;
  /** Al iniciar una orden sin responsable: quien la inicia se vuelve responsable. */
  tomarla?: boolean;
  resolution?: string;
  rootCauseId?: string | null;
  failureCodeId?: string | null;
  downtimeMinutes?: number;
  /** Excepciones justificadas del cierre tecnico. */
  motivoSinHoras?: string | null;
  sinParoConfirmado?: boolean;
  motivoSinDiagnostico?: string | null;
  /**
   * Una falla por actividad. Es la forma nueva de cerrar: una OT mezclada
   * puede traer varios reportes y cada uno conserva su codigo, su causa y su
   * paro. taskId en null cae en el encabezado, para las ordenes viejas.
   */
  fallas?: Array<{
    taskId: string | null;
    failureCodeId: string | null;
    rootCauseId: string | null;
    downtimeMinutes: number;
  }>;
}) {
  const wo = await prisma.workOrder.findFirst({
    where: { id: params.workOrderId, organizationId: params.organizationId },
    include: {
      tasks: true,
      asset: { select: { criticality: true } },
      organization: { select: { otEvidenciaCriticas: true } },
      _count: { select: { attachments: true } },
    },
  });
  if (!wo) throw new ErrorDeOrden("Orden de trabajo no encontrada", 404);
  // Reintento o doble clic que llega despues del primero: ya esta hecho.
  if (wo.status === params.to) return wo;

  const etiqueta = (s: string) => WO_STATUS_LABELS[s] ?? s;
  if (!esTransicionPosible(wo.status, params.to)) {
    throw new ErrorDeOrden(`Una orden ${etiqueta(wo.status).toLowerCase()} no puede pasar a ${etiqueta(params.to).toLowerCase()}.`, 409);
  }
  if (!can(params.rol, permisoDeTransicion(wo.status, params.to))) {
    throw new ErrorDeOrden(
      params.to === "CLOSED" ? "Cerrar una orden lo valida un supervisor o la administración."
        : wo.status === "CLOSED" ? "Reabrir una orden cerrada lo autoriza la administración o el propietario."
        : "Su rol no puede hacer este cambio de estado.",
      403,
    );
  }
  const motivo = params.motivo?.trim() || null;
  if (pideMotivo(wo.status, params.to) && !motivoValido(motivo)) {
    throw new ErrorDeOrden("Indique el motivo del cambio.", 422);
  }

  const now = new Date();
  const data: Record<string, unknown> = { status: params.to };
  let excepcionSinResponsable = false;

  if (params.to === "IN_PROGRESS" && !wo.assignedToId) {
    if (params.tomarla) {
      data.assignedToId = params.userId;
    } else if (can(params.rol, "workorder:write") && motivoValido(motivo)) {
      excepcionSinResponsable = true;
    } else {
      throw new ErrorDeOrden(
        "La orden no tiene responsable. Tómela usted al iniciar, o asígnela antes" +
          (can(params.rol, "workorder:write") ? " (o indique el motivo para iniciarla sin responsable)." : "."),
        422,
      );
    }
  }
  if (params.to === "ASSIGNED" && !wo.assignedToId) {
    throw new ErrorDeOrden("Para dejarla asignada necesita un responsable.", 422);
  }

  // Completar (desde proceso) y cerrar revisan la informacion esencial. Reabrir
  // una cerrada tambien llega a COMPLETED, pero no vuelve a «completarse»: no
  // repite efectos ni exige de nuevo lo que ya tenia.
  const completando = params.to === "COMPLETED" && wo.status !== "CLOSED";
  if (completando || params.to === "CLOSED") {
    const horas = (await prisma.workOrderLabor.aggregate({ where: { workOrderId: wo.id }, _sum: { hours: true } }))._sum.hours ?? 0;
    const faltan = faltantesDeCierre(datosDeCierre(wo, {
      horas,
      archivos: wo._count.attachments,
      evidenciaRequerida: requiereEvidencia(wo.organization, wo),
      ...(completando ? {
        resolution: params.resolution,
        motivoSinHoras: params.motivoSinHoras,
        sinParoConfirmado: params.sinParoConfirmado,
        motivoSinDiagnostico: params.motivoSinDiagnostico,
        downtimeMinutes: params.downtimeMinutes,
        failureCodeId: params.failureCodeId,
        rootCauseId: params.rootCauseId,
        fallas: params.fallas,
      } : {}),
    }));
    if (faltan.length) {
      const textos = textosDeFaltantes(faltan);
      throw new ErrorDeOrden(
        `No se puede ${completando ? "completar" : "cerrar"} la orden todavía: ${textos.join(" ")}`,
        422,
        textos,
      );
    }
  }

  if (params.to === "IN_PROGRESS" && !wo.startedAt) {
    data.startedAt = now;
    data.responseMinutes = Math.round((now.getTime() - wo.createdAt.getTime()) / 60000);
  }
  if (params.to === "ON_HOLD") data.motivoEspera = motivo;
  if (wo.status === "ON_HOLD") data.motivoEspera = null;
  if (params.to === "CANCELLED") data.motivoCancelacion = motivo;
  if (wo.status === "CANCELLED") data.motivoCancelacion = null;
  if (wo.status === "CLOSED") data.closedAt = null;

  if (completando) {
    data.completedAt = now;
    if (params.motivoSinHoras !== undefined) data.motivoSinHoras = params.motivoSinHoras?.trim() || null;
    if (params.sinParoConfirmado !== undefined) data.sinParoConfirmado = params.sinParoConfirmado;
    if (params.motivoSinDiagnostico !== undefined) data.motivoSinDiagnostico = params.motivoSinDiagnostico?.trim() || null;
    if (params.resolution) data.resolution = params.resolution;
    if (params.rootCauseId !== undefined) data.rootCauseId = params.rootCauseId;
    if (params.failureCodeId !== undefined) data.failureCodeId = params.failureCodeId;
    if (params.downtimeMinutes !== undefined) data.downtimeMinutes = params.downtimeMinutes;

    // La falla del encabezado, cuando el cierre nuevo la manda con taskId null.
    const delEncabezado = params.fallas?.find((f) => f.taskId === null);
    if (delEncabezado) {
      data.failureCodeId = delEncabezado.failureCodeId;
      data.rootCauseId = delEncabezado.rootCauseId;
      data.downtimeMinutes = delEncabezado.downtimeMinutes;
    }
  }
  if (params.to === "CLOSED") data.closedAt = now;
  /**
   * Reabrir una orden terminada borra su fecha de finalizacion.
   *
   * Los indicadores cuentan como terminada lo que tiene `completedAt`: una
   * orden reabierta que la conservaba seguia sumando al MTTR, al costo y al
   * cumplimiento mientras volvia a estar en proceso. Al completarla otra vez
   * recibe la fecha nueva, que es cuando de verdad quedo hecha. La fecha
   * anterior queda en la bitacora de auditoria de la transicion.
   */
  if (wo.status === "COMPLETED" && params.to !== "CLOSED") data.completedAt = null;

  /**
   * Cancelar una orden LIBERA las solicitudes que atendia.
   *
   * Sin esto la solicitud se quedaba marcada como "convertida en OT" apuntando
   * a una orden cancelada, y ya no se podia volver a atender: el sistema decia
   * que estaba en una orden abierta —la que se acababa de cancelar. El reporte
   * quedaba muerto sin que nadie lo notara, que es peor que perderlo, porque
   * quien lo levanto cree que va en camino.
   *
   * La actividad se queda en la orden cancelada como historia de lo que se
   * penso hacer. Lo que se libera es la solicitud.
   */
  /**
   * El cambio se aplica solo si la orden sigue en el estado que se leyo.
   *
   * Dos clics seguidos, o dos personas a la vez, leian el mismo estado y las
   * dos escribian: el paro se registraba dos veces y el plan avanzaba doble.
   * Ahora gana una; la otra encuentra la orden ya movida y no repite nada.
   */
  const aplicado = await prisma.workOrder.updateMany({
    where: { id: wo.id, organizationId: params.organizationId, status: wo.status },
    data,
  });
  if (aplicado.count === 0) {
    const ahora = await prisma.workOrder.findUnique({ where: { id: wo.id } });
    if (ahora?.status === params.to) return ahora;
    throw new ErrorDeOrden(
      `La orden cambió de estado mientras tanto (ahora está ${etiqueta(ahora?.status ?? "").toLowerCase()}). Recargue la página.`,
      409,
    );
  }
  /**
   * Las solicitudes se mueven DESPUES del candado, no antes.
   *
   * Estaban arriba, y quien perdia la carrera —dos personas, una cancelando y
   * otra cerrando— ya habia soltado o reclamado las solicitudes cuando
   * recibia el 409, sin revertir nada. Quedaba una orden cerrada con sus
   * solicitudes sueltas, o una solicitud reclamada por una orden que nunca se
   * reabrio. Aqui abajo solo corre quien gano.
   */
  if (params.to === "CANCELLED") {
    await prisma.workRequest.updateMany({
      where: { workOrderId: wo.id, status: "CONVERTED" },
      data: { status: "PENDING", workOrderId: null, reviewedAt: null, reviewedById: null },
    });
  }

  /**
   * Reabrir una orden cancelada vuelve a tomar sus solicitudes, pero solo las
   * que siguen libres: si alguien ya las atendio en otra orden mientras tanto,
   * arrebatarselas dejaria dos ordenes creyendo que atienden el mismo reporte.
   */
  if ((params.to === "OPEN" || params.to === "ASSIGNED") && wo.status === "CANCELLED") {
    const suyas = await prisma.workOrderTask.findMany({
      where: { workOrderId: wo.id, origenRequestId: { not: null } },
      select: { origenRequestId: true },
    });
    const ids = suyas.map((t) => t.origenRequestId!).filter(Boolean);
    if (ids.length) {
      await prisma.workRequest.updateMany({
        where: { id: { in: ids }, status: "PENDING", workOrderId: null },
        data: { status: "CONVERTED", workOrderId: wo.id },
      });
    }
  }


  const updated = (await prisma.workOrder.findUnique({ where: { id: wo.id } }))!;

  if (completando) {
    /**
     * Cada actividad guarda su propia falla. Se valida que la actividad sea de
     * esta orden: un taskId de otra orden escribiria la falla en el historial
     * de un equipo ajeno.
     */
    const porActividad = (params.fallas ?? []).filter((f) => f.taskId !== null);
    if (porActividad.length) {
      const propias = new Set(
        (await prisma.workOrderTask.findMany({
          where: { workOrderId: wo.id, id: { in: porActividad.map((f) => f.taskId!) } },
          select: { id: true },
        })).map((t) => t.id),
      );
      for (const f of porActividad) {
        if (!propias.has(f.taskId!)) continue;
        await prisma.workOrderTask.update({
          where: { id: f.taskId! },
          data: {
            failureCodeId: f.failureCodeId,
            rootCauseId: f.rootCauseId,
            downtimeMinutes: f.downtimeMinutes,
          },
        });
      }
    }

    if (wo.assetId) {
      /**
       * El paro del equipo es la suma de lo que causo cada falla. Tomar solo el
       * del encabezado perderia el de las demas actividades de una OT mezclada.
       */
      const sumaDeActividades = porActividad.reduce((a, f) => a + f.downtimeMinutes, 0);
      const minutes = params.fallas
        ? sumaDeActividades + (params.fallas.find((f) => f.taskId === null)?.downtimeMinutes ?? params.downtimeMinutes ?? 0)
        : params.downtimeMinutes ?? wo.downtimeMinutes;
      /**
       * Un paro por orden. Completar, reabrir y volver a completar creaba un
       * segundo evento con los mismos minutos y el paro de la planta salia al
       * doble. Ahora el cierre nuevo corrige el evento que ya existia.
       */
      const previo = await prisma.downtimeEvent.findFirst({
        where: { workOrderId: wo.id, assetId: wo.assetId },
        select: { id: true },
        orderBy: { startedAt: "asc" },
      });
      if (minutes > 0 || previo) {
        await prisma.downtimeEvent.upsert({
          where: { id: previo?.id ?? "" },
          update: {
            endedAt: now,
            minutes,
            planned:
              sumaDeActividades === 0 &&
              (wo.maintenanceType === "PREVENTIVE" || wo.maintenanceType === "INSPECTION"),
          },
          create: {
            organizationId: params.organizationId,
            assetId: wo.assetId,
            workOrderId: wo.id,
            startedAt: wo.startedAt ?? wo.createdAt,
            endedAt: now,
            minutes,
            /**
             * Planeado solo si el paro no vino de una falla.
             *
             * Antes se decidia con el tipo del encabezado, y eso contaba como
             * paro planeado un correctivo colado en una OT preventiva —que es
             * justo el caso que el sistema ahora permite. Si alguna actividad
             * de falla reporto paro, el paro no fue planeado.
             */
            planned:
              sumaDeActividades === 0 &&
              (wo.maintenanceType === "PREVENTIVE" || wo.maintenanceType === "INSPECTION"),
            reason: wo.title,
          },
        });
      }
      await prisma.asset.update({
        where: { id: wo.assetId },
        data: { status: "OPERATIONAL" },
      });
    }
    // Se le pasa el activo: el plan puede servir a varios y solo avanza el de este.
    // Recalcular al completar, aunque las rutas ya lo hagan al capturar.
    //
    // Aqui el costo deja de ser un dato en movimiento y se vuelve historia del
    // equipo: es lo que despues decide si se repara otra vez o se reemplaza.
    // Si algun camino escribiera horas o refacciones sin recalcular, el numero
    // quedaria mal para siempre y nadie se enteraria.
    await recalcWorkOrder(wo.id);

    /**
     * Avanzar TODOS los planes que aportaron trabajo, no solo el del encabezado.
     *
     * Una orden mezclada puede traer actividades de dos planes distintos, y el
     * planId de arriba solo alcanza para uno: el segundo plan se quedaba sin
     * avanzar y volvia a vencer como si no se hubiera hecho. Peor todavia, una
     * orden armada con el generador nace sin planId, asi que no avanzaba
     * ninguno.
     *
     * Las actividades liberadas no cuentan: no se hicieron, y avanzar el plan
     * por trabajo que no se ejecuto es exactamente la mentira que se quiere
     * evitar.
     */
    const planesQueAvanzan = new Set<string>();
    if (wo.planId) planesQueAvanzan.add(wo.planId);
    const deActividades = await prisma.workOrderTask.findMany({
      where: { workOrderId: wo.id, liberadaAt: null, origenPlanId: { not: null } },
      select: { origenPlanId: true },
      distinct: ["origenPlanId"],
    });
    for (const t of deActividades) planesQueAvanzan.add(t.origenPlanId!);

    for (const planId of planesQueAvanzan) {
      await rollForwardPlan(planId, now, wo.meterValue, wo.assetId);
    }

    /**
     * Y avanzar el reloj de CADA actividad que se hizo.
     *
     * El plan avanza como conjunto —eso sigue, para las pantallas que todavia
     * leen la fecha de la asignacion— pero la verdad ahora esta por actividad:
     * una orden puede traer tres de las diez actividades del plan y las otras
     * siete siguen debiendose para cuando les toque. Avanzar el plan entero se
     * llevaria las siete por delante sin que nadie lo viera.
     *
     * Las liberadas no cuentan aqui tampoco: no se hicieron.
     */
    await avanzarActividadesDeOrden({
      organizationId: params.organizationId,
      workOrderId: wo.id,
      assetId: wo.assetId,
      completadaEl: now,
    });

    /**
     * Completar la OT predictiva NO toca su alerta.
     *
     * Terminar el trabajo no prueba que la condicion se corrigio: eso lo dice
     * la siguiente lectura. Mientras el punto siga fuera de rango la alerta
     * queda activa; cuando una lectura lo muestre normal, la ingesta la marca
     * como normalizada con esa lectura como evidencia, y alguien la valida.
     */

    // Quien la creó o la pidió se entera al CERRARSE (OT_CERRADA); al
    // terminarse se avisa a quien la revisa (OT_LISTA_REVISION). Ver
    // lib/avisos/ordenes.ts.
  }

  if (params.to === "IN_PROGRESS" && wo.assetId && wo.requiresShutdown) {
    await prisma.asset.update({ where: { id: wo.assetId }, data: { status: "DOWN" } });
  }

  await logAudit({
    organizationId: params.organizationId,
    userId: params.userId,
    entity: "WorkOrder",
    entityId: wo.id,
    action: "STATUS_CHANGED",
    summary: `${wo.number}: ${wo.status} → ${params.to}${motivo ? ` — ${motivo}` : ""}`,
    changes: {
      from: wo.status,
      to: params.to,
      ...(motivo ? { motivo } : {}),
      ...(data.assignedToId ? { tomadaPor: params.userId } : {}),
      ...(excepcionSinResponsable ? { iniciadaSinResponsable: true } : {}),
      // Lo que se borra al reabrir se guarda aqui, para no perder cuando se
      // habia dado por terminada la primera vez.
      ...(data.completedAt === null && wo.completedAt ? { completedAtAnterior: wo.completedAt.toISOString() } : {}),
    },
  });

  // El motivo tambien queda a la vista en la orden, donde lo lee quien la retome.
  if (motivo) {
    // El nombre del paso depende de donde venia: pasar a «en proceso» es
    // iniciar, reanudar o devolver segun el estado anterior.
    const paso =
      params.to === "ON_HOLD" ? "En espera"
        : params.to === "CANCELLED" ? "Cancelada"
        : wo.status === "CANCELLED" ? "Reactivada"
        : wo.status === "CLOSED" ? "Reabierta"
        : wo.status === "COMPLETED" ? "Devuelta a proceso"
        : wo.status === "ON_HOLD" ? "Reanudada"
        : params.to === "IN_PROGRESS" ? "Iniciada"
        : etiqueta(params.to);
    await prisma.workOrderComment.create({
      data: {
        workOrderId: wo.id,
        userId: params.userId,
        body: `${paso}${excepcionSinResponsable ? " sin responsable" : ""}: ${motivo}`,
      },
    });
  }

  // Avisos del cambio de estado: a quién le toca actuar ahora y qué quedó atendido.
  await avisarTransicion(params.organizationId, wo.id, wo.status, params.to, motivo, params.userId);

  return updated;
}

/**
 * Una orden cerrada o cancelada ya no acepta cambios sensibles (horas,
 * refacciones, servicios, actividades). Para corregirla se reabre con motivo.
 */
export function asegurarEditable(wo: { status: string } | null) {
  if (!wo) throw new ErrorDeOrden("Orden de trabajo no encontrada", 404);
  if (wo.status === "CLOSED") {
    throw new ErrorDeOrden("La orden está cerrada. Para cambiarla, reábrala indicando el motivo.", 409);
  }
  if (wo.status === "CANCELLED") {
    throw new ErrorDeOrden("La orden está cancelada. Reactívela si el trabajo sigue pendiente.", 409);
  }
}

/** Consume refacciones del almacen y las carga a la OT. */
export async function consumePart(params: {
  organizationId: string;
  workOrderId: string;
  partId: string;
  quantity: number;
  userId: string;
  /** De que almacen sale. Sin indicar, el general de la cuenta. */
  warehouseId?: string | null;
  /** A que actividad se le carga la refaccion. */
  taskId?: string | null;
}) {
  // El doble toque no saca dos veces del almacén (lib/repeticion.ts).
  return enFila(`consumo:${params.userId}:${params.workOrderId}:${params.partId}:${params.quantity}`, async () => {
    const repetido = await prisma.stockMovement.count({
      where: {
        organizationId: params.organizationId, workOrderId: params.workOrderId, partId: params.partId,
        userId: params.userId, quantity: params.quantity, createdAt: { gte: hace() },
      },
    });
    if (repetido) throw new ErrorDeOrden("Ese consumo ya se registró hace un momento. No se volvió a descontar del almacén.", 409);
    return consumirRefaccion(params);
  });
}

/**
 * Quita una refaccion de la orden y la DEVUELVE al almacen.
 *
 * No es borrar un renglon. Cargar una refaccion saco existencia y la escribio
 * en el kardex; quitarla sin regresarla dejaria el almacen creyendo que hay
 * menos de lo que hay, y el kardex sin explicacion de a donde se fue. Por eso
 * la salida se compensa con una devolucion —el tipo RETURN existe justo para
 * esto— y no borrando el movimiento: el kardex no se edita, se corrige con
 * otro movimiento.
 *
 * Regresa al MISMO almacen del que salio. Si la salida no se encuentra (un
 * dato viejo), al almacen general, y se dice en la referencia.
 */
export async function quitarRefaccion(params: {
  organizationId: string;
  workOrderId: string;
  lineaId: string;
  userId: string;
}) {
  const linea = await prisma.workOrderPart.findFirst({
    where: { id: params.lineaId, workOrderId: params.workOrderId, workOrder: { organizationId: params.organizationId } },
    select: { id: true, partId: true, quantity: true, part: { select: { code: true, name: true, unit: true } } },
  });
  if (!linea) throw new ErrorDeOrden("Esa refacción no es de esta orden", 404);

  asegurarEditable(await prisma.workOrder.findFirst({
    where: { id: params.workOrderId, organizationId: params.organizationId },
    select: { status: true },
  }));

  // De donde salio: la ultima salida de esta refaccion en esta orden.
  const salida = await prisma.stockMovement.findFirst({
    where: { organizationId: params.organizationId, workOrderId: params.workOrderId, partId: linea.partId, movementType: "OUT" },
    orderBy: { createdAt: "desc" },
    select: { warehouseId: true },
  });
  const almacen = salida?.warehouseId ?? (await almacenPorOmision(params.organizationId))?.id;
  if (!almacen) throw new ErrorDeAlmacen("La cuenta no tiene ningún almacén activo");

  await prisma.$transaction(async (tx) => {
    await tx.workOrderPart.delete({ where: { id: linea.id } });
    await aplicarMovimiento(
      {
        organizationId: params.organizationId,
        partId: linea.partId,
        warehouseId: almacen,
        tipo: "RETURN",
        cantidad: linea.quantity,
        workOrderId: params.workOrderId,
        userId: params.userId,
        referencia: salida ? "Se quitó de la OT: devolución" : "Se quitó de la OT: devolución al almacén general",
      },
      tx,
    );
  });

  await logAudit({
    organizationId: params.organizationId, userId: params.userId,
    entity: "WorkOrder", entityId: params.workOrderId, action: "UPDATED",
    summary: `Se quitó ${linea.quantity} ${linea.part.unit} de ${linea.part.code} — ${linea.part.name} y se devolvió al almacén`,
  });

  return recalcWorkOrder(params.workOrderId);
}

/**
 * Quita un registro de horas.
 *
 * Aqui si es borrar: las horas no movieron nada fuera de la orden. Lo unico
 * que hay que rehacer es el costo, que `recalcWorkOrder` suma de cero.
 */
export async function quitarHoras(params: {
  organizationId: string;
  workOrderId: string;
  lineaId: string;
  userId: string;
  /** Un tecnico solo puede quitar lo suyo; quien supervisa, cualquiera. */
  soloPropias: boolean;
}) {
  const linea = await prisma.workOrderLabor.findFirst({
    where: { id: params.lineaId, workOrderId: params.workOrderId, workOrder: { organizationId: params.organizationId } },
    select: { id: true, hours: true, userId: true, user: { select: { name: true } } },
  });
  if (!linea) throw new ErrorDeOrden("Ese registro de horas no es de esta orden", 404);
  if (params.soloPropias && linea.userId !== params.userId) {
    throw new ErrorDeOrden("Solo puede quitar las horas que usted registró", 403);
  }

  asegurarEditable(await prisma.workOrder.findFirst({
    where: { id: params.workOrderId, organizationId: params.organizationId },
    select: { status: true },
  }));

  await prisma.workOrderLabor.delete({ where: { id: linea.id } });
  await logAudit({
    organizationId: params.organizationId, userId: params.userId,
    entity: "WorkOrder", entityId: params.workOrderId, action: "UPDATED",
    summary: `Se quitaron ${linea.hours} h de ${linea.user.name}`,
  });
  return recalcWorkOrder(params.workOrderId);
}

async function consumirRefaccion(params: Parameters<typeof consumePart>[0]) {
  const part = await prisma.part.findFirst({
    where: { id: params.partId, organizationId: params.organizationId },
  });
  if (!part) throw new ErrorDeOrden("Refacción no encontrada", 404);
  // La orden tambien debe ser de la empresa: sin esto el cargo y la salida de
  // almacen podian colgarse de la orden de otra cuenta con solo conocer su id.
  asegurarEditable(await prisma.workOrder.findFirst({
    where: { id: params.workOrderId, organizationId: params.organizationId },
    select: { status: true },
  }));
  if (part.quantityOnHand < params.quantity) {
    throw new Error(`Existencia insuficiente: ${part.quantityOnHand} ${part.unit} disponibles`);
  }

  const cost = params.quantity * part.unitCost;

  // El almacen del que sale: el que se indique, o el de la cuenta. El descuento
  // del saldo y el kardex los hace aplicarMovimiento, que es el unico lugar que
  // sabe hacerlo bien.
  const almacen = params.warehouseId ?? (await almacenPorOmision(params.organizationId))?.id;
  if (!almacen) throw new ErrorDeAlmacen("La cuenta no tiene ningún almacén activo");

  const balance = await prisma.$transaction(async (tx) => {
    await tx.workOrderPart.create({
      data: {
        workOrderId: params.workOrderId,
        partId: part.id,
        quantity: params.quantity,
        unitCost: part.unitCost,
        cost,
        taskId: params.taskId ?? null,
      },
    });
    return aplicarMovimiento(
      {
        organizationId: params.organizationId,
        partId: part.id,
        warehouseId: almacen,
        tipo: "OUT",
        cantidad: params.quantity,
        workOrderId: params.workOrderId,
        userId: params.userId,
        referencia: "Consumo en OT",
      },
      tx,
    );
  });

  // Cruzó el mínimo: aviso agrupado a almacén y compras (no a todo el que
  // tenga rol alto), y si se agotó una refacción crítica, aviso propio.
  if (balance <= part.minQuantity) await avisarInventario(params.organizationId).catch(() => undefined);

  return recalcWorkOrder(params.workOrderId);
}
