import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { backlog } from "@/lib/backlog";
import {
  actividadesPendientes,
  candadoDeOrdenes,
  sembrarLoQueFalte,
} from "@/lib/calendario-actividad";
import { limiteDeVentana, type Ventana } from "@/lib/calendario";
import { nextWorkOrderNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import { tipoDeTrabajo } from "@/lib/tipos-solicitud";

/**
 * Que trabajo hay disponible para un equipo, de todos los origenes.
 *
 * El caso real: el tecnico va a bajar a esa bomba. Antes de bajar conviene
 * saber TODO lo que se le debe —el preventivo que ya toca, las fallas que le
 * reportaron, lo que quedo pendiente la vez pasada— para hacerlo en un solo
 * viaje en vez de tres. Esto es lo que alimenta el armador de ordenes.
 *
 * ── Del plan se eligen ACTIVIDADES, no el plan ──
 *
 * Un plan de cinco actividades puede tener las cinco en la misma semana y aun
 * asi el gestor mandar tres en una orden y dos en otra: otro tecnico, otro dia
 * de paro, otra especialidad. Por eso cada actividad se ofrece suelta, con su
 * propia fecha, y elegir una no arrastra a las demas.
 *
 * Tres reglas sobre lo que se ofrece:
 *
 *  - **Lo atrasado se ve siempre**, con cualquier ventana. Una actividad que
 *    vencio y no esta en ninguna orden es exactamente la que no se puede
 *    perder de vista.
 *  - **Lo que ya esta en una orden abierta no se ofrece**, pero se nombra: el
 *    gestor ve que las otras dos del plan ya van en la OT-000123, en vez de
 *    preguntarse donde quedaron.
 *  - **Lo que esta en el backlog se ofrece solo ahi.** Una actividad liberada
 *    por falta de refaccion saldria dos veces —como pendiente del plan y como
 *    trabajo trabado—, y retomarla desde el backlog es lo que conserva la
 *    cadena de "se trabo aqui, se hizo alla".
 */
export async function trabajoDisponible(
  organizationId: string,
  assetId: string,
  opciones: { ventana?: Ventana } = {},
) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { otHorizonteDias: true, otMultiOrigen: true },
  });
  const horizonte = org?.otHorizonteDias ?? 0;
  const ventana: Ventana = opciones.ventana ?? "CONFIGURADA";
  const hoy = new Date();
  const hasta = limiteDeVentana(ventana, hoy, horizonte);
  const inicioDeHoy = new Date(hoy);
  inicioDeHoy.setHours(0, 0, 0, 0);

  // Que este equipo no aparezca sin trabajo solo porque le faltan relojes: una
  // asignacion anterior al calendario por actividad, o creada por importacion,
  // no los tiene. Es barato cuando no hay nada que sembrar.
  await sembrarLoQueFalte(organizationId, assetId);

  const [porTocar, enOrdenAbierta, asignaciones, reportes, pendientes] = await Promise.all([
    actividadesPendientes(organizationId, { assetId, hasta }),
    candadoDeOrdenes(organizationId, { assetId }),
    prisma.planAsset.findMany({
      where: { organizationId, assetId, active: true, plan: { active: true, tasks: { some: {} } } },
      select: {
        id: true, nextDueDate: true, nextDueMeter: true,
        meter: { select: { currentValue: true, unit: true } },
        plan: {
          select: {
            id: true, name: true, maintenanceType: true, estimatedHours: true, triggerType: true,
            tasks: {
              orderBy: { position: "asc" },
              select: {
                id: true, position: true, title: true, description: true,
                taskType: true, unit: true, minValue: true, maxValue: true, required: true,
              },
            },
          },
        },
      },
    }),
    // Los reportes de falla que nadie ha atendido.
    prisma.workRequest.findMany({
      where: { organizationId, assetId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, number: true, title: true, description: true,
        priority: true, riesgo: true, createdAt: true,
      },
    }),
    // Lo que quedo trabado la vez pasada.
    backlog(organizationId, { assetId }),
  ]);

  const enBacklog = new Set(pendientes.map((t) => t.planTaskId).filter(Boolean) as string[]);
  const reloj = new Map(porTocar.map((x) => [x.planTaskId, x]));

  type Ofrecida = {
    id: string;
    position: number;
    title: string;
    description: string | null;
    taskType: string;
    unit: string | null;
    minValue: number | null;
    maxValue: number | null;
    required: boolean;
    /** Cuando toca. Nulo en planes por medidor, que no llevan fecha propia. */
    venceEl: Date | null;
    /** Dias que faltan; negativo si ya vencio. Nulo si va por medidor. */
    faltan: number | null;
    /** Vencio y no esta en ninguna orden. */
    atrasada: boolean;
    /** Texto para las que van por lectura: "a 2,000 h · lleva 1,960 h". */
    porMedidor: string | null;
  };

  const planes = asignaciones.map((a) => {
    const disponibles: Ofrecida[] = [];
    const yaEnOrden: Array<{ id: string; title: string; orden: string }> = [];

    /**
     * Los planes por medidor no tienen reloj por actividad todavia: su fecha
     * sale del consumo del equipo y vive en la asignacion. Se ofrecen cuando
     * la asignacion entra en la ventana o la lectura ya alcanzo la meta. Sin
     * esto, desde el calendario por actividad desaparecieron del armado a
     * mano, y no avisaba.
     */
    const esMedidor = a.plan.triggerType === "METER";
    const medidorAlcanzado =
      esMedidor && a.nextDueMeter != null && (a.meter?.currentValue ?? 0) >= a.nextDueMeter;
    const medidorEnVentana =
      esMedidor && (medidorAlcanzado || (a.nextDueDate != null && a.nextDueDate <= hasta));

    for (const t of a.plan.tasks) {
      if (enBacklog.has(t.id)) continue;

      const r = reloj.get(t.id);
      const entra = esMedidor ? medidorEnVentana : !!r;
      if (!entra) continue;

      const orden = enOrdenAbierta(t.id, a.plan.id, assetId);
      if (orden) {
        yaEnOrden.push({ id: t.id, title: t.title, orden });
        continue;
      }

      const venceEl = esMedidor ? a.nextDueDate : (r?.proximaEl ?? null);
      const faltan = esMedidor
        ? a.nextDueDate
          ? Math.round((a.nextDueDate.getTime() - inicioDeHoy.getTime()) / 86_400_000)
          : null
        : (r?.faltan ?? null);

      disponibles.push({
        id: t.id,
        position: t.position,
        title: t.title,
        description: t.description,
        taskType: t.taskType,
        unit: t.unit,
        minValue: t.minValue,
        maxValue: t.maxValue,
        required: t.required,
        venceEl,
        faltan,
        atrasada: (faltan != null && faltan < 0) || medidorAlcanzado,
        porMedidor: esMedidor
          ? `a ${a.nextDueMeter?.toLocaleString("es-MX") ?? "?"} ${a.meter?.unit ?? ""} · lleva ${
              a.meter?.currentValue.toLocaleString("es-MX") ?? "?"
            } ${a.meter?.unit ?? ""}`.trim()
          : null,
      });
    }

    // Las atrasadas primero, y dentro de cada grupo por fecha.
    disponibles.sort((x, y) => {
      if (x.atrasada !== y.atrasada) return x.atrasada ? -1 : 1;
      return (x.venceEl?.getTime() ?? Infinity) - (y.venceEl?.getTime() ?? Infinity);
    });

    return {
      asignacionId: a.id,
      planId: a.plan.id,
      nombre: a.plan.name,
      maintenanceType: a.plan.maintenanceType,
      horasEstimadas: a.plan.estimatedHours,
      porMedidor: esMedidor,
      venceEl: disponibles[0]?.venceEl ?? null,
      atrasadas: disponibles.filter((d) => d.atrasada).length,
      actividades: disponibles,
      /** Las de este plan que ya van en otra orden abierta, y en cual. */
      yaEnOrden,
    };
  });

  return {
    /** Como esta configurada la organizacion, para que la pantalla obedezca. */
    multiOrigen: org?.otMultiOrigen ?? true,
    horizonteDias: horizonte,
    ventana,
    hasta,
    atrasadas: planes.reduce((n, p) => n + p.atrasadas, 0),
    planes: planes.filter((p) => p.actividades.length || p.yaEnOrden.length),
    reportes,
    backlog: pendientes.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      taskType: t.taskType,
      unit: t.unit,
      minValue: t.minValue,
      maxValue: t.maxValue,
      required: t.required,
      maintenanceType: t.maintenanceType,
      origen: t.origen,
      origenPlanId: t.origenPlanId,
      origenRequestId: t.origenRequestId,
      diasEsperando: t.diasEsperando,
      motivoLiberacion: t.motivoLiberacion,
      yaSePuede: t.yaSePuede,
      deLaOrden: t.workOrder.number,
    })),
  };
}

export type TrabajoDisponible = Awaited<ReturnType<typeof trabajoDisponible>>;

/**
 * Crea la orden con el trabajo elegido.
 *
 * Vive aqui y no en la ruta para poder probarla sin sesion: es la parte que de
 * verdad tiene reglas —que nada de otra cuenta ni de otro equipo se cuele, que
 * cada actividad conserve su origen y su tipo— y esa es justo la que hay que
 * cubrir con pruebas.
 */
export async function armarOrden(p: {
  organizationId: string;
  userId: string;
  assetId: string;
  title: string;
  assignedToId?: string | null;
  dueDate?: string | null;
  priority?: string;
  /**
   * Las actividades de plan que van en la orden, por id de actividad.
   *
   * Antes se elegia el PLAN y entraba todo lo que le tocaba. Eso no deja al
   * gestor mandar tres de cinco actividades en una orden y dos en otra, que es
   * justo como se reparte el trabajo en un departamento de mantenimiento.
   */
  actividades: string[];
  reportes: string[];
  backlog: string[];
}): Promise<{ orden: { id: string; number: string }; cuantas: number } | { error: string; codigo: 400 | 404 | 409 }> {
  if (!p.actividades.length && !p.reportes.length && !p.backlog.length) {
    return { error: "Elija al menos una actividad para la orden", codigo: 400 };
  }

  const asset = await prisma.asset.findFirst({
    where: { id: p.assetId, organizationId: p.organizationId },
    select: { id: true, siteId: true, locationId: true },
  });
  if (!asset) return { error: "Activo no encontrado", codigo: 404 as const };

  /**
   * El apagador se respeta AQUI, no solo escondiendo botones.
   *
   * Una pantalla que oculta opciones no impide que alguien mande la peticion
   * a mano. Si la organizacion decidio una orden por origen, el servidor lo
   * hace cumplir.
   */
  const config = await prisma.organization.findUnique({
    where: { id: p.organizationId },
    select: { otMultiOrigen: true },
  });
  const grupos = [p.actividades.length, p.reportes.length, p.backlog.length].filter((n) => n > 0);
  if (config && !config.otMultiOrigen && grupos.length > 1) {
    return {
      error: "Esta organización arma una orden por cada origen. Elija de un solo grupo.",
      codigo: 400 as const,
    };
  }

  // Todo se lee acotado a la organizacion y al activo: un id de otra cuenta
  // o de otro equipo no debe poder colarse en la orden.
  const ids = [...new Set(p.actividades)];
  const [tareas, reportes, delBacklog] = await Promise.all([
    prisma.planTask.findMany({
      where: {
        id: { in: ids },
        plan: {
          organizationId: p.organizationId,
          active: true,
          // La actividad tiene que ser de un plan ASIGNADO a este equipo.
          asignaciones: { some: { assetId: asset.id, active: true } },
        },
      },
      orderBy: { position: "asc" },
      select: {
        id: true, title: true, description: true, taskType: true,
        unit: true, minValue: true, maxValue: true, required: true,
        labor: { select: { personas: true, hours: true } },
        plan: {
          select: {
            id: true, maintenanceType: true, estimatedHours: true,
            procedure: true, safetyNotes: true, requiresShutdown: true,
          },
        },
      },
    }),
    prisma.workRequest.findMany({
      where: { id: { in: p.reportes }, organizationId: p.organizationId, status: "PENDING" },
      select: { id: true, number: true, title: true, description: true, priority: true, tipo: true },
    }),
    prisma.workOrderTask.findMany({
      where: {
        id: { in: p.backlog },
        liberadaAt: { not: null },
        retomadaPor: null,
        workOrder: { organizationId: p.organizationId, assetId: asset.id },
      },
      select: {
        id: true, title: true, description: true, taskType: true, unit: true,
        minValue: true, maxValue: true, required: true, maintenanceType: true,
        origen: true, origenPlanId: true, origenRequestId: true, planTaskId: true,
      },
    }),
  ]);

  if (tareas.length !== ids.length) {
    return {
      error: "Alguna actividad no pertenece a un plan activo de este equipo.",
      codigo: 404 as const,
    };
  }

  /**
   * Ninguna actividad puede ir en dos ordenes abiertas a la vez.
   *
   * La pantalla ya no las ofrece, pero entre que el gestor abre el armador y
   * da clic, otra persona pudo meter esa misma actividad en otra orden. Sin
   * esta revision el cambio de aceite quedaria en dos ordenes, las dos se
   * verian legitimas, y se haria dos veces.
   */
  const enOrdenAbierta = await candadoDeOrdenes(p.organizationId, { assetId: asset.id });
  const ocupadas = tareas
    .map((t) => ({ t, orden: enOrdenAbierta(t.id, t.plan.id, asset.id) }))
    .filter((x) => x.orden);
  if (ocupadas.length) {
    return {
      error: `Ya están en una orden abierta: ${ocupadas
        .map((x) => `${x.t.title} (${x.orden})`)
        .join(", ")}. Actualice la pantalla.`,
      codigo: 409 as const,
    };
  }

  /**
   * El tipo del encabezado: preventivo si el grueso del trabajo lo es.
   *
   * Es solo una etiqueta para listar y filtrar. Lo que manda para los
   * indicadores es el tipo de cada actividad.
   */
  const hayPreventivo = tareas.some((t) => t.plan.maintenanceType === "PREVENTIVE");
  const tipoEncabezado = hayPreventivo ? "PREVENTIVE" : "CORRECTIVE";

  /**
   * El plan del encabezado, cuando el trabajo vino de UNO solo.
   *
   * Varias pantallas siguen leyendo `WorkOrder.planId`: el panel de recursos
   * planeados y el calendario, que oculta la proyeccion de un plan que ya
   * tiene orden. Con dos o mas planes se queda nulo a proposito: no hay uno que
   * represente al conjunto. El avance de relojes no depende del encabezado,
   * sino de cada actividad.
   */
  const planesDistintos = [...new Map(tareas.map((t) => [t.plan.id, t.plan])).values()];
  const planUnico = planesDistintos.length === 1 ? planesDistintos[0].id : null;

  /**
   * Las horas de lo que DE VERDAD entra.
   *
   * Si las actividades elegidas declaran mano de obra, se suma eso. Si de un
   * plan ninguna la declara, cuenta el estimado de ese plan una vez —el mismo
   * criterio que usa el programador automatico, para que una orden armada a
   * mano y una generada no estimen distinto el mismo trabajo—.
   */
  let horasDePlan = 0;
  for (const plan of planesDistintos) {
    const suyas = tareas.filter((t) => t.plan.id === plan.id);
    const declaradas = suyas.reduce(
      (n, t) => n + t.labor.reduce((m, l) => m + l.personas * l.hours, 0),
      0,
    );
    horasDePlan += declaradas > 0 ? declaradas : (plan.estimatedHours ?? 0);
  }
  const horas = horasDePlan + reportes.length * 1 + delBacklog.length * 0.5;

  /**
   * Si no se dio vencimiento, el de la actividad mas proxima.
   *
   * Una orden que junta una actividad vencida no deberia nacer con un
   * vencimiento de "dentro de tres dias": eso la esconde del rojo que le toca.
   */
  let vence = p.dueDate ? new Date(p.dueDate) : null;
  if (!vence && tareas.length) {
    const relojes = await prisma.planTaskAsset.findMany({
      where: { assetId: asset.id, planTaskId: { in: ids }, proximaEl: { not: null } },
      orderBy: { proximaEl: "asc" },
      take: 1,
      select: { proximaEl: true },
    });
    vence = relojes[0]?.proximaEl ?? null;
  }
  if (!vence) vence = new Date(Date.now() + 3 * 86_400_000);

  const number = await nextWorkOrderNumber(p.organizationId);
  const orden = await prisma.workOrder.create({
    data: {
      organizationId: p.organizationId,
      number,
      title: p.title,
      maintenanceType: tipoEncabezado,
      planId: planUnico,
      status: p.assignedToId ? "ASSIGNED" : "OPEN",
      priority: p.priority,
      assetId: asset.id,
      siteId: asset.siteId,
      locationId: asset.locationId,
      assignedToId: p.assignedToId || null,
      createdById: p.userId,
      dueDate: vence,
      estimatedHours: Math.max(1, Math.round(horas * 2) / 2),
      // Del primer plan: dos procedimientos distintos no se pueden fusionar
      // sin inventar, y dejar uno es mejor que dejar ninguno.
      procedure: planesDistintos[0]?.procedure ?? null,
      safetyNotes: planesDistintos[0]?.safetyNotes ?? null,
      requiresShutdown: planesDistintos.some((pl) => pl.requiresShutdown),
    },
    select: { id: true, number: true },
  });

  let posicion = 0;
  const actividades: Prisma.WorkOrderTaskCreateManyInput[] = [];

  for (const t of tareas) {
    actividades.push({
      workOrderId: orden.id, position: posicion++,
      title: t.title, description: t.description, taskType: t.taskType,
      unit: t.unit, minValue: t.minValue, maxValue: t.maxValue, required: t.required,
      origen: "PLAN", origenPlanId: t.plan.id, planTaskId: t.id,
      maintenanceType: t.plan.maintenanceType,
    });
  }
  for (const r of reportes) {
    actividades.push({
      workOrderId: orden.id, position: posicion++,
      title: r.title, description: r.description, taskType: "CHECK", required: true,
      origen: "SOLICITUD", origenRequestId: r.id,
      maintenanceType: tipoDeTrabajo(r.tipo),
    });
  }
  for (const b of delBacklog) {
    actividades.push({
      workOrderId: orden.id, position: posicion++,
      title: b.title, description: b.description, taskType: b.taskType,
      unit: b.unit, minValue: b.minValue, maxValue: b.maxValue, required: b.required,
      // Conserva de donde salio originalmente, no "BACKLOG a secas": una
      // actividad de plan que se trabo sigue siendo de ese plan.
      origen: b.origen === "MANUAL" ? "BACKLOG" : b.origen,
      origenPlanId: b.origenPlanId, origenRequestId: b.origenRequestId,
      // Y conserva DE QUE ACTIVIDAD salio. Antes no se copiaba: al cerrar la
      // orden que la retomaba, el reloj de esa actividad no avanzaba nunca, y
      // quedaba marcada como atrasada aunque ya se hubiera hecho.
      planTaskId: b.planTaskId,
      maintenanceType: b.maintenanceType,
      retomaDeTaskId: b.id,
    });
  }

  await prisma.workOrderTask.createMany({ data: actividades });

  // Los reportes quedan ligados a la orden que los atiende.
  if (reportes.length) {
    await prisma.workRequest.updateMany({
      where: { id: { in: reportes.map((r) => r.id) } },
      data: {
        status: "CONVERTED", workOrderId: orden.id,
        reviewedById: p.userId, reviewedAt: new Date(),
      },
    });
  }

  /**
   * Armar una orden a mano TAMBIEN cuenta como generada para el plan.
   *
   * El reloj de cada actividad NO avanza aqui: avanza al CERRAR la orden,
   * porque armar no es haber hecho el trabajo. Lo que se actualiza es la marca
   * de cuando se genero, y el contador que sigue usando el camino de
   * medidores.
   */
  if (planesDistintos.length) {
    await prisma.planAsset.updateMany({
      where: {
        organizationId: p.organizationId,
        assetId: asset.id,
        planId: { in: planesDistintos.map((pl) => pl.id) },
      },
      data: { lastGeneratedAt: new Date(), ejecuciones: { increment: 1 } },
    });
  }

  await logAudit({
    organizationId: p.organizationId,
    userId: p.userId,
    entity: "WorkOrder",
    entityId: orden.id,
    action: "CREATED",
    summary: `${orden.number} armada con ${actividades.length} actividad(es) de ${
      [tareas.length && "plan", reportes.length && "reportes", delBacklog.length && "backlog"]
        .filter(Boolean).join(", ")
    }`,
  });

  return { orden, cuantas: actividades.length };
}
