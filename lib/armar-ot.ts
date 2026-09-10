import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { backlog } from "@/lib/backlog";
import { actividadesPendientes, sembrarLoQueFalte } from "@/lib/calendario-actividad";
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
 */
export async function trabajoDisponible(organizationId: string, assetId: string) {
  /**
   * El horizonte lo decide la organizacion, no el codigo.
   *
   * Adelantar de mas gasta el mantenimiento antes de tiempo; adelantar de menos
   * obliga a un segundo viaje. Donde esta el punto depende de la planta, asi
   * que es parametro.
   */
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { otHorizonteDias: true, otMultiOrigen: true },
  });
  const horizonte = org?.otHorizonteDias ?? 0;

  // Que este equipo no aparezca sin trabajo solo porque le faltan relojes: una
  // asignacion anterior a este cambio, o creada por importacion, no los tiene.
  // Es barato cuando no hay nada que sembrar.
  await sembrarLoQueFalte(organizationId, assetId);

  const hasta = new Date(Date.now() + horizonte * 86_400_000);
  const porTocar = await actividadesPendientes(organizationId, { assetId, hasta });

  const [asignaciones, reportes, pendientes] = await Promise.all([
    /**
     * Los planes asignados a ESE equipo que ya vencieron o vencen dentro del
     * horizonte configurado. Mas alla de ese plazo no se ofrecen: adelantar un
     * preventivo que vence en tres meses es tirar vida util del servicio.
     *
     * Los que no tienen fecha se ofrecen siempre —nunca se han ejecutado y no
     * hay de donde calcular vencimiento.
     */
    prisma.planAsset.findMany({
      where: {
        organizationId, assetId, active: true,
        OR: [
          { nextDueDate: null },
          { nextDueDate: { lte: new Date(Date.now() + horizonte * 86_400_000) } },
        ],
      },
      select: {
        id: true, nextDueDate: true, nextDueMeter: true, lastCompletedAt: true,
        ejecuciones: true,
        plan: {
          select: {
            id: true, name: true, maintenanceType: true, estimatedHours: true,
            tasks: {
              orderBy: { position: "asc" },
              select: {
                id: true, position: true, title: true, description: true,
                taskType: true, unit: true, minValue: true, maxValue: true, required: true,
                cadaCuantas: true,
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

  /** Lo que toca de un plan, ya ordenado por fecha. */
  const deEstePlan = (planId: string) =>
    porTocar.filter((x) => x.planId === planId).sort((a, b) => +a.proximaEl - +b.proximaEl);

  return {
    /** Como esta configurada la organizacion, para que la pantalla obedezca. */
    multiOrigen: org?.otMultiOrigen ?? true,
    horizonteDias: horizonte,
    planes: asignaciones
      .filter((a) => a.plan.tasks.length > 0)
      .map((a) => ({
        asignacionId: a.id,
        planId: a.plan.id,
        nombre: a.plan.name,
        maintenanceType: a.plan.maintenanceType,
        horasEstimadas: a.plan.estimatedHours,
        /**
         * La fecha del plan es la MAS PROXIMA de sus actividades.
         *
         * Deja de ser un dato propio y pasa a ser un resumen: con cada
         * actividad llevando su calendario, "cuando vence el plan" solo puede
         * significar "cuando vence lo primero que trae".
         */
        venceEl: deEstePlan(a.plan.id)[0]?.proximaEl ?? a.nextDueDate,
        /** Ya vencio o vence pronto: es lo que de verdad "toca". */
        yaToca: deEstePlan(a.plan.id).some((x) => x.faltan <= 0),
        diasParaVencer: deEstePlan(a.plan.id)[0]?.faltan ?? null,
        /**
         * Solo las actividades que TOCAN en la proxima ejecucion.
         *
         * Ofrecer las cinco de un plan cuando en esta visita van tres es
         * invitar a que alguien las meta todas: se cambia el aceite de mas y
         * el calendario del resto se desalinea sin que nadie lo note.
         *
         * Cada una viaja con su propio vencimiento para que la pantalla pueda
         * decir "vencida" o "vence en 6 dias" por renglon, que es justo la
         * informacion con la que se decide adelantar o no.
         */
        actividades: deEstePlan(a.plan.id).map((x) => ({
          id: x.planTaskId,
          position: x.position,
          title: x.titulo,
          description: x.descripcion,
          taskType: x.taskType,
          unit: x.unit,
          minValue: x.minValue,
          maxValue: x.maxValue,
          required: x.required,
          venceEl: x.proximaEl,
          faltan: x.faltan,
        })),
      }))
      .filter((p) => p.actividades.length > 0),
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
  asignaciones: string[];
  reportes: string[];
  backlog: string[];
}): Promise<{ orden: { id: string; number: string }; cuantas: number } | { error: string; codigo: 400 | 404 }> {
  if (!p.asignaciones.length && !p.reportes.length && !p.backlog.length) {
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
    select: { otMultiOrigen: true, otHorizonteDias: true },
  });
  const grupos = [p.asignaciones.length, p.reportes.length, p.backlog.length].filter((n) => n > 0);
  if (config && !config.otMultiOrigen && grupos.length > 1) {
    return {
      error: "Esta organización arma una orden por cada origen. Elija de un solo grupo.",
      codigo: 400 as const,
    };
  }

  // Todo se lee acotado a la organizacion y al activo: un id de otra cuenta
  // o de otro equipo no debe poder colarse en la orden.
  const [asignaciones, reportes, delBacklog] = await Promise.all([
    prisma.planAsset.findMany({
      where: { id: { in: p.asignaciones }, organizationId: p.organizationId, assetId: asset.id },
      select: {
        id: true,
        plan: {
          select: {
            id: true, maintenanceType: true, estimatedHours: true,
            procedure: true, safetyNotes: true, requiresShutdown: true,
            tasks: {
              orderBy: { position: "asc" },
              select: {
                id: true, title: true, description: true, taskType: true,
                unit: true, minValue: true, maxValue: true, required: true,
              },
            },
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
        origen: true, origenPlanId: true, origenRequestId: true,
      },
    }),
  ]);

  /**
   * El tipo del encabezado: preventivo si el grueso del trabajo lo es.
   *
   * Es solo una etiqueta para listar y filtrar. Lo que manda para los
   * indicadores es el tipo de cada actividad.
   */
  const hayPreventivo = asignaciones.some((a) => a.plan.maintenanceType === "PREVENTIVE");
  const tipoEncabezado = hayPreventivo ? "PREVENTIVE" : "CORRECTIVE";

  /**
   * El plan del encabezado, cuando el trabajo vino de UNO solo.
   *
   * Varias pantallas siguen leyendo `WorkOrder.planId`: el panel de recursos
   * planeados —lo que el tecnico debe preparar antes de bajar— y el calendario,
   * que oculta la proyeccion de un plan que ya tiene orden. Dejarlo nulo hacia
   * que el panel no apareciera y que el calendario mostrara la proyeccion
   * duplicada.
   *
   * Con dos o mas planes se queda nulo a proposito: no hay uno que represente
   * al conjunto, y elegir el primero seria mentir. Para ese caso el avance de
   * planes ya no depende del encabezado, sino del origen de cada actividad.
   */
  const planUnico = asignaciones.length === 1 ? asignaciones[0].plan.id : null;

  const horas = asignaciones.reduce((s, a) => s + (a.plan.estimatedHours ?? 0), 0)
    + reportes.length * 1
    + delBacklog.length * 0.5;

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
      dueDate: p.dueDate ? new Date(p.dueDate) : new Date(Date.now() + 3 * 86_400_000),
      estimatedHours: Math.max(1, Math.round(horas * 2) / 2),
      // Del primer plan: dos procedimientos distintos no se pueden fusionar
      // sin inventar, y dejar uno es mejor que dejar ninguno.
      procedure: asignaciones[0]?.plan.procedure ?? null,
      safetyNotes: asignaciones[0]?.plan.safetyNotes ?? null,
      requiresShutdown: asignaciones.some((a) => a.plan.requiresShutdown),
    },
    select: { id: true, number: true },
  });

  let posicion = 0;
  const actividades: Prisma.WorkOrderTaskCreateManyInput[] = [];

  /**
   * De un plan entran SOLO las actividades que le tocan a esta visita.
   *
   * Antes entraban todas, porque todas compartian la fecha del plan. Con el
   * calendario por actividad eso meteria la revision semestral en cada orden
   * manual, y al cerrar avanzaria su reloj seis meses cada vez: el semestral se
   * volveria anual sin que nadie lo pidiera y sin un solo aviso.
   *
   * Se usa la MISMA ventana con la que se ofrecieron en pantalla, para que lo
   * que se guarda sea exactamente lo que la persona vio.
   */
  // Igual que al ofrecer: una asignacion sin relojes —creada por importacion,
  // por script, o anterior a este cambio— quedaria fuera de la orden sin decir
  // por que, y su plan no avanzaria nunca.
  await sembrarLoQueFalte(p.organizationId, asset.id);
  const porTocar = await actividadesPendientes(p.organizationId, {
    assetId: asset.id,
    hasta: new Date(Date.now() + (config?.otHorizonteDias ?? 0) * 86_400_000),
  });
  const tocan = new Set(porTocar.map((x) => x.planTaskId));

  for (const a of asignaciones) {
    for (const t of a.plan.tasks) {
      if (!tocan.has(t.id)) continue;
      actividades.push({
        workOrderId: orden.id, position: posicion++,
        title: t.title, description: t.description, taskType: t.taskType,
        unit: t.unit, minValue: t.minValue, maxValue: t.maxValue, required: t.required,
        origen: "PLAN", origenPlanId: a.plan.id, planTaskId: t.id,
        maintenanceType: a.plan.maintenanceType,
      });
    }
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
   * Armar una orden a mano TAMBIEN es una ejecucion del plan.
   *
   * El contador `ejecuciones` solo lo sigue usando el camino de medidores; en
   * el de calendario mandan los relojes por actividad, que avanzan al CERRAR
   * la orden y no al armarla —armar no es haber hecho el trabajo—. Se mantiene
   * al dia para que los dos caminos cuenten lo mismo.
   */
  await prisma.planAsset.updateMany({
    where: { id: { in: asignaciones.map((a) => a.id) } },
    data: { lastGeneratedAt: new Date(), ejecuciones: { increment: 1 } },
  });

  await logAudit({
    organizationId: p.organizationId,
    userId: p.userId,
    entity: "WorkOrder",
    entityId: orden.id,
    action: "CREATED",
    summary: `${orden.number} armada con ${actividades.length} actividad(es) de ${
      [asignaciones.length && "plan", reportes.length && "reportes", delBacklog.length && "backlog"]
        .filter(Boolean).join(", ")
    }`,
  });


  return { orden, cuantas: actividades.length };
}
