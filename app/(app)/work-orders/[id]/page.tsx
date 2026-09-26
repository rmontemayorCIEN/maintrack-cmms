import Link from "next/link";
import { Compromisos } from "@/components/compromisos";
import { Comentarios } from "@/components/comentarios";
import { notFound } from "next/navigation";
import { ArrowLeft, LifeBuoy, Printer } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Avatar, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import {
  MAINTENANCE_TYPE_COLORS,
  MAINTENANCE_TYPE_LABELS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  WO_STATUS_COLORS,
  WO_STATUS_LABELS,
} from "@/lib/constants";
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatDia } from "@/lib/utils";
import { filtroDeActividadesDeLaOrden, incluirTareas } from "@/lib/plan-tasks";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { iaConfigurada } from "@/lib/ia/cliente";
import { WorkOrderActions } from "./actions";
import { TaskList } from "./task-list";
import { AgregarReporte } from "./agregar-reporte";
import { LaborPanel } from "./labor-panel";
import { PartsPanel } from "./parts-panel";
import { RefaccionesDelPlan } from "./refacciones-plan";
import { EditarOrden } from "./editar";
import { ProcedimientoIa } from "./procedimiento";
import { refaccionesDelPlan } from "@/lib/requisiciones";
import { ServicesPanel } from "./services-panel";
import { CommentsPanel } from "./comments-panel";
import { Adjuntos } from "@/components/adjuntos";
import { esFalla, tipoDeActividad } from "@/lib/fallas";
import { datosDeCierre, requiereEvidencia } from "@/lib/workorders";
import { accionesDisponibles, faltantesDeCierre, inicioSinResponsable, motivoValido, type SeccionDeOrden } from "@/lib/reglas-ot";
import { puedeVerRuta, verCostos } from "@/lib/pantallas";
import { MeterReadingForm } from "../../meters/reading-form";
import { FichaDeEjecucion, IndiceDeSecciones, type EstadoDeSeccion, type SeccionDelIndice } from "./ejecucion";
import { FaltaParaCerrar } from "./faltantes";
import { ResultadoDelTrabajo } from "./resultado";
import { Row } from "./fila";
import { AceptarOrden } from "./aceptar";
import { Plegable } from "@/components/plegable";
import { SeccionPlegable } from "./seccion";
import { naceAbierta } from "@/lib/secciones-orden";
import { BitacoraDeEstados } from "./bitacora";
import { MaterialPorActividad } from "./material-actividad";
import { PasarRegistros } from "@/components/paso-registros";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Acotado a la organizacion: sin esto el titulo de la pestania alcanzaba a
  // mostrar el folio de otra empresa aunque la pagina diera 404.
  const user = await requireUser();
  const wo = await prisma.workOrder.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { number: true },
  });
  return { title: wo ? `${wo.number}` : "Orden de trabajo" };
}

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const zona = user.organization.timezone || "America/Mexico_City";

  const wo = await prisma.workOrder.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      asset: { select: { id: true, code: true, name: true, criticality: true, status: true } },
      site: { select: { name: true } },
      location: { select: { name: true } },
      plan: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true, color: true } },
      createdBy: { select: { name: true } },
      failureCode: true,
      rootCause: true,
      tasks: {
        orderBy: { position: "asc" },
        include: { origenRequest: { select: { number: true } } },
      },
      labor: { include: { user: { select: { name: true, color: true } } }, orderBy: { workedAt: "desc" } },
      partsUsed: { include: { part: { select: { code: true, name: true, unit: true } } } },
      servicesUsed: {
        include: { supplier: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
      comments: { include: { user: { select: { name: true, color: true } } }, orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "desc" }, select: {
        id: true, name: true, kind: true, size: true, mimeType: true, createdAt: true,
        uploadedBy: { select: { name: true } },
      } },
      requests: { select: { id: true, number: true } },
    },
  });
  if (!wo) notFound();

  /**
   * Las actividades que representan una falla y por lo tanto se codifican al
   * cerrar. El tipo de la actividad manda sobre el del encabezado: un
   * correctivo colado en una OT preventiva sigue siendo un correctivo.
   *
   * Las liberadas quedan fuera: no se hicieron, asi que no hay falla que
   * documentar. Se van al backlog y se codificaran cuando se atiendan.
   */
  /**
   * A que actividades se les puede cargar un gasto. Las liberadas quedan
   * fuera: no se hicieron, asi que no consumieron nada.
   */
  /**
   * Reportes de este equipo que nadie ha atendido, para poder sumarlos a esta
   * orden sin salir de aqui. Si la orden ya esta cerrada no se ofrecen: lo que
   * se reporte despues va en otra orden.
   */
  const reportesPendientes = ["COMPLETED", "CLOSED", "CANCELLED"].includes(wo.status) || !wo.assetId
    ? []
    : await prisma.workRequest.findMany({
        where: { organizationId: user.organizationId, assetId: wo.assetId, status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: { id: true, number: true, title: true },
      });

  const actividadesCargables = wo.tasks
    .filter((t) => !t.liberadaAt)
    .map((t) => ({
      id: t.id,
      title: t.title,
      maintenanceType: tipoDeActividad(t.maintenanceType, wo.maintenanceType),
    }));

  const actividadesDeFalla = wo.tasks
    .filter((t) => !t.liberadaAt && esFalla(tipoDeActividad(t.maintenanceType, wo.maintenanceType)))
    .map((t) => ({
      id: t.id,
      title: t.title,
      maintenanceType: tipoDeActividad(t.maintenanceType, wo.maintenanceType),
      solicitud: t.origenRequest?.number ?? null,
    }));

  // Lo que el plan pide para esta orden, y con que se puede cubrir. Solo tiene
  // sentido en preventivas: una correctiva no nace de un plan.
  // Catalogo ligero para el dialogo de "no se pudo hacer". El catalogo grande
  // de mas abajo solo se carga en preventivas, y una correctiva tambien se
  // puede trabar por falta de refaccion.
  const refaccionesLiberar = await prisma.part.findMany({
    where: { organizationId: user.organizationId, active: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  const delPlan = await refaccionesDelPlan(user.organizationId, wo.id);
  const [almacenesWo, catalogoWo, existenciasWo, requisicionesWo] = delPlan
    ? await Promise.all([
        prisma.warehouse.findMany({
          where: { organizationId: user.organizationId, active: true },
          orderBy: [{ esGeneral: "desc" }, { code: "asc" }],
          select: { id: true, name: true },
        }),
        prisma.part.findMany({
          where: { organizationId: user.organizationId, active: true },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true, unit: true },
        }),
        prisma.partStock.findMany({
          where: { organizationId: user.organizationId, part: { active: true } },
          select: { warehouseId: true, partId: true, quantity: true },
        }),
        prisma.materialRequest.findMany({
          where: { organizationId: user.organizationId, workOrderId: wo.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, folio: true, estado: true,
            renglones: { select: { cantidadSolicitada: true, cantidadSurtida: true } },
          },
        }),
      ])
    : [[], [], [], []];

  const [tecnicosWo, cuadrillasWo, activosWo, centrosWo] = await Promise.all([
    // Responsables posibles: quien ejecuta. Un solicitante o una cuenta de consulta no pueden iniciar la orden.
    prisma.user.findMany({
      where: { organizationId: user.organizationId, active: true, role: { in: ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.team.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.asset.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { code: "asc" }, take: 500,
      select: { id: true, code: true, name: true },
    }),
    prisma.centroDeCosto.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  const stockWo: Record<string, Record<string, number>> = {};
  for (const e of existenciasWo) (stockWo[e.warehouseId] ??= {})[e.partId] = e.quantity;

  const [technicians, parts, failureCodes, causasRaiz, serviciosCatalogo, proveedores] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: { id: true, name: true, hourlyRate: true },
      orderBy: { name: "asc" },
    }),
    prisma.part.findMany({
      where: { organizationId: user.organizationId, active: true, quantityOnHand: { gt: 0 } },
      select: { id: true, code: true, name: true, unit: true, unitCost: true, quantityOnHand: true },
      orderBy: { code: "asc" },
    }),
    prisma.failureCode.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { code: "asc" },
    }),
    prisma.rootCause.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, code: true, description: true },
      orderBy: { code: "asc" },
    }),
    prisma.externalService.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: { id: true, code: true, name: true, unit: true, unitCost: true, supplierId: true },
      orderBy: { code: "asc" },
    }),
    prisma.supplier.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Lo que el plan preveia para este trabajo. Es referencia, no compromiso: el
  // tecnico carga lo que realmente uso. Sirve para preparar el material antes
  // de bajar a piso y para comparar planeado contra real.
  //
  // Solo de las actividades que trae ESTA orden, no del plan completo: con tres
  // de cinco actividades, preparar el material de las cinco manda al tecnico a
  // piso con refacciones que no va a usar.
  const filtroPlaneado = await filtroDeActividadesDeLaOrden(wo.id);
  const planeado = filtroPlaneado
    ? await prisma.planTask.findMany({
        where: { ...filtroPlaneado, plan: { organizationId: user.organizationId } },
        ...incluirTareas,
      })
    : [];

  const moPlaneada = new Map<string, { nombre: string; horas: number }>();
  const refPlaneadas = new Map<string, { nombre: string; unidad: string; cantidad: number }>();
  const srvPlaneados = new Map<string, { nombre: string; unidad: string; cantidad: number }>();
  for (const tarea of planeado) {
    for (const l of tarea.labor) {
      const previo = moPlaneada.get(l.specialtyId);
      const horas = (previo?.horas ?? 0) + l.personas * l.hours;
      moPlaneada.set(l.specialtyId, { nombre: `${l.specialty.code} — ${l.specialty.name}`, horas });
    }
    for (const p of tarea.parts) {
      const previo = refPlaneadas.get(p.partId);
      refPlaneadas.set(p.partId, {
        nombre: `${p.part.code} — ${p.part.name}`,
        unidad: p.part.unit,
        cantidad: (previo?.cantidad ?? 0) + p.quantity,
      });
    }
    for (const x of tarea.services) {
      const previo = srvPlaneados.get(x.serviceId);
      srvPlaneados.set(x.serviceId, {
        nombre: `${x.service.code} — ${x.service.name}`,
        unidad: x.service.unit,
        cantidad: (previo?.cantidad ?? 0) + x.quantity,
      });
    }
  }
  const hayPlaneado = moPlaneada.size + refPlaneadas.size + srvPlaneados.size > 0;

  const currency = user.organization.currency;
  // Quien ejecuta no ve importes: lib/pantallas.ts verCostos.
  const conCostos = verCostos(user.role);
  const moneda = conCostos ? currency : "";
  const medidores = wo.assetId
    ? await prisma.meter.findMany({ where: { organizationId: user.organizationId, assetId: wo.assetId }, select: { id: true, name: true, unit: true, currentValue: true }, orderBy: { name: "asc" } })
    : [];
  /*
   * Lecturas tomadas EN esta orden, no del medidor en general: el horometro
   * que capturo el operador en su ronda no dice nada de este trabajo. Solo se
   * pregunta si el equipo tiene medidores; si no, la seccion ni existe.
   */
  const lecturasDeLaOrden = medidores.length
    ? await prisma.meterReading.count({
        where: { organizationId: user.organizationId, workOrderId: wo.id, estado: { not: "ANULADA" } },
      })
    : 0;
  const vencida = Boolean(wo.dueDate && wo.dueDate < new Date() && ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(wo.status));

  // Orden activa sin responsable: se dice en la orden, no solo al presionar «Iniciar».
  const activaSinResponsable = !wo.assignedToId && ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(wo.status);
  const excepcionDeInicio = activaSinResponsable && wo.startedAt
    ? await prisma.auditLog.findFirst({
        where: {
          organizationId: user.organizationId, entity: "WorkOrder", entityId: wo.id,
          action: "STATUS_CHANGED", changes: { contains: "iniciadaSinResponsable" },
        },
        orderBy: { createdAt: "desc" },
        select: { changes: true, createdAt: true, user: { select: { name: true } } },
      })
    : null;
  const motivoExcepcion = excepcionDeInicio
    ? (() => { try { return (JSON.parse(excepcionDeInicio.changes) as { motivo?: string }).motivo ?? null; } catch { return null; } })()
    : null;

  // Lo que se revisa al completar y al cerrar: el mismo armado que usa el servidor.
  const evidenciaRequerida = requiereEvidencia(user.organization, wo);
  const horasRegistradas = wo.labor.reduce((a, l) => a + l.hours, 0);
  const datosCierre = datosDeCierre(wo, {
    horas: horasRegistradas,
    archivos: wo.attachments.length,
    evidenciaRequerida,
  });
  const diagnosticadas = datosCierre.fallas.filter((f) => f.failureCodeId && f.rootCauseId).length;
  const cierre = {
    horas: horasRegistradas,
    manoDeObra: wo.laborCost,
    refacciones: wo.partsCost,
    servicios: wo.serviceCost,
    otros: wo.otherCost,
    total: wo.totalCost,
    minutosParo: datosCierre.minutosParo,
    sinParoConfirmado: wo.sinParoConfirmado,
    diagnostico: datosCierre.fallas.length === 0
      ? "No aplica (sin fallas)"
      : diagnosticadas === datosCierre.fallas.length
        ? "Código y causa capturados"
        : `${diagnosticadas} de ${datosCierre.fallas.length} con código y causa${wo.motivoSinDiagnostico ? ` · sin determinar: ${wo.motivoSinDiagnostico}` : ""}`,
    resolucion: wo.resolution,
    actividadesPendientes: datosCierre.actividadesSinResolver,
    actividadesEnBacklog: wo.tasks.filter((t) => t.liberadaAt).length,
    archivos: wo.attachments.length,
    moneda: user.organization.currency,
    faltantes: wo.status === "COMPLETED" ? faltantesDeCierre(datosCierre) : [],
  };

  /**
   * Lo que falta para cerrar, desde que la orden se INICIA y no solo al
   * intentar completarla.
   *
   * Antes de iniciar no se enseña: a una orden que nadie ha empezado no «le
   * faltan» las horas, no se ha trabajado. Mostrarlo ahí volvía la pantalla
   * una regañina de entrada, y a la tercera vez nadie la lee. Ya cerrada o
   * cancelada tampoco: no hay nada que hacer con la lista.
   */
  const faltantes = ["IN_PROGRESS", "ON_HOLD", "COMPLETED"].includes(wo.status) ? faltantesDeCierre(datosCierre) : [];
  const mostrarFaltantes = faltantes.length > 0 || wo.status === "COMPLETED";
  const faltaEn = new Set(faltantes.map((f) => f.seccion));

  // El mismo contenido para el teléfono y la computadora: se arma una vez.
  const resultado = {
    completado: Boolean(wo.completedAt),
    resolucion: wo.resolution,
    codigoFalla: wo.failureCode ? `${wo.failureCode.code} — ${wo.failureCode.description}` : null,
    causaRaiz: wo.rootCause ? `${wo.rootCause.code} — ${wo.rootCause.description}` : null,
    requiereParo: wo.requiresShutdown,
    esFalla: esFalla(wo.maintenanceType),
    evidenciaRequerida,
  };
  const canExecute = can(user.role, "workorder:execute");
  const canEdit = can(user.role, "workorder:write");
  const doneTasks = wo.tasks.filter((t) => t.done).length;
  // Aceptar: el responsable, antes de iniciar, si no la ha aceptado ya. Pedir apoyo: mientras esté abierta.
  const aceptacion = wo.assignedToId === user.id && !wo.startedAt && ["OPEN", "ASSIGNED"].includes(wo.status)
    ? await prisma.auditLog.findFirst({ where: { organizationId: user.organizationId, entity: "WorkOrder", entityId: wo.id, action: "ACCEPTED", userId: user.id }, select: { createdAt: true } })
    : null;
  const puedeAceptar = canExecute && wo.assignedToId === user.id && !wo.startedAt && ["OPEN", "ASSIGNED"].includes(wo.status) && !aceptacion;
  const aceptadaPor = aceptacion ? `Usted la aceptó el ${formatDateTime(aceptacion.createdAt, zona)}` : null;
  const puedePedirApoyo = canExecute && ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(wo.status);
  const hayAcciones = accionesDisponibles({ status: wo.status, iniciada: !!wo.startedAt, conResponsable: !!wo.assignedToId }, user.role).length > 0;
  /**
   * La secuencia del trabajo, en el orden en que se hace, cada paso con su
   * señal.
   *
   * «Hecho» se marca SOLO donde el sistema lo sabe de verdad: actividades
   * resueltas, horas registradas, evidencia subida, solución escrita. Las que
   * no tienen noción de completas —seguridad, materiales, lecturas,
   * bitácora— se quedan neutras en vez de inventarles un estado. Un palomeado
   * de adorno es peor que ninguno: hace creer que ya se revisó.
   */
  const conHoras = horasRegistradas > 0 || motivoValido(wo.motivoSinHoras);
  const seña = (id: string, hecho: boolean): EstadoDeSeccion =>
    faltaEn.has(id as SeccionDeOrden) ? "falta" : hecho ? "hecho" : "neutro";
  const indice: SeccionDelIndice[] = [
    { id: "actividades", texto: "Actividades", estado: seña("actividades", wo.tasks.length > 0 && datosCierre.actividadesSinResolver === 0) },
    ...(wo.procedure || wo.safetyNotes ? [{ id: "seguridad", texto: "Seguridad", estado: "neutro" as EstadoDeSeccion }] : []),
    { id: "tiempo", texto: "Tiempo", estado: seña("tiempo", conHoras) },
    /*
     * Estos tres no detienen el cierre —una orden no se queda «sin bitacora»—
     * pero SI se ponen en verde cuando ya tienen algo capturado. Estaban fijos
     * en gris, asi que cargar una refaccion o registrar el horometro no movia
     * nada y parecia que no se habia guardado. Lo reporto Rafael.
     */
    { id: "materiales", texto: "Materiales", estado: wo.partsCost > 0 || wo.serviceCost > 0 ? "hecho" : "neutro" },
    ...(medidores.length
      ? [{ id: "lecturas", texto: "Lecturas", estado: (lecturasDeLaOrden > 0 ? "hecho" : "neutro") as EstadoDeSeccion }]
      : []),
    { id: "evidencias", texto: "Evidencias", estado: seña("evidencias", wo.attachments.length > 0) },
    { id: "bitacora", texto: "Bitácora", estado: wo.comments.length > 0 ? "hecho" : "neutro" },
    // El faltante dice «resultado»; el ancla del teléfono es «resultado-movil».
    { id: "resultado-movil", texto: "Resultado", estado: seña("resultado", motivoValido(wo.resolution)) },
  ];

  return (
    <>
      <PageHeader
        title={`${wo.number} — ${wo.title}`}
        breadcrumb={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/work-orders" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Órdenes de trabajo
          </Link>
            <PasarRegistros base="/work-orders" id={id} />
          </span>
        }
        description={wo.description ?? undefined}
        actions={
          <>
            <EditarOrden
              orden={{
                id: wo.id,
                title: wo.title,
                description: wo.description,
                maintenanceType: wo.maintenanceType,
                priority: wo.priority,
                assignedToId: wo.assignedToId,
                teamId: wo.teamId,
                assetId: wo.assetId,
                centroDeCostoId: wo.centroDeCostoId,
                dueDate: wo.dueDate?.toISOString() ?? null,
                scheduledStart: wo.scheduledStart?.toISOString() ?? null,
                estimatedHours: wo.estimatedHours,
                requiresShutdown: wo.requiresShutdown,
                procedure: wo.procedure,
                safetyNotes: wo.safetyNotes,
              }}
              tecnicos={tecnicosWo}
              cuadrillas={cuadrillasWo}
              activos={activosWo}
              centrosDeCosto={centrosWo}
              editable={can(user.role, "workorder:write") && !["CLOSED", "CANCELLED"].includes(wo.status)}
            />
            <Link
              href={`/work-orders/${wo.id}/print`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              <Printer className="h-3.5 w-3.5" /> Imprimir
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* En el teléfono, estado y prioridad van en la ficha, después del equipo y la ubicación. */}
        <span className="hidden lg:contents">
          <Badge className={WO_STATUS_COLORS[wo.status]}>{WO_STATUS_LABELS[wo.status]}</Badge>
          <Badge className={MAINTENANCE_TYPE_COLORS[wo.maintenanceType]}>
            {MAINTENANCE_TYPE_LABELS[wo.maintenanceType]}
          </Badge>
          <Badge className={PRIORITY_COLORS[wo.priority]}>Prioridad {PRIORITY_LABELS[wo.priority]}</Badge>
        </span>
        {wo.requiresShutdown ? <Badge tone="danger">Requiere paro</Badge> : null}
        {activaSinResponsable ? (
          <Badge tone="warning">{wo.startedAt ? "En curso sin responsable" : "Sin responsable"}</Badge>
        ) : null}
        {wo.plan ? (
          <Link href="/plans" className="text-xs text-slate-500 hover:text-brand-600">
            Generada por el plan: {wo.plan.name}
          </Link>
        ) : null}
        {wo.requests.map((r) => (
          // El folio lleva al reporte: es la pregunta que sigue —quien lo
          // reporto, cuando, con que foto— y estaba a tres pantallas.
          <Link key={r.number} href={`/requests/${r.id}`} className="no-underline">
            <Badge tone="info" className="hover:bg-sky-100">
              Desde solicitud {r.number}
            </Badge>
          </Link>
        ))}
      </div>

      {canExecute && (hayAcciones || puedeAceptar || puedePedirApoyo) ? (
        // En el teléfono, las acciones del paso siguiente quedan fijas abajo, sobre la barra de navegación:
        // iniciar, pausar o terminar sin recorrer toda la orden. En computadora van en su renglón.
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-slate-200 bg-white px-3 py-2 shadow-[0_-4px_12px_rgba(15,23,42,0.08)] no-print lg:static lg:z-auto lg:mb-4 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none [&_button]:min-h-11 lg:[&_button]:min-h-0">
          <div className="flex flex-wrap items-center gap-2">
              {/* Primero aceptar (si toca), luego el paso siguiente, y pedir apoyo al final. */}
              {puedeAceptar ? <AceptarOrden workOrderId={wo.id} /> : null}
              {hayAcciones ? <WorkOrderActions
              iaDisponible={iaConfigurada() && iaDeLaOrganizacion(user.organization).funciones.includes("CIERRE_OT")}
              /* El dictado NO depende de `iaConfigurada()`: eso mira la llave
                 del modelo, y transcribir no pasa por el modelo. Amarrarlos
                 dejaria al tecnico sin microfono por una llave que no usa. */
              dictadoDisponible={iaDeLaOrganizacion(user.organization).funciones.includes("DICTADO")}
                workOrderId={wo.id}
                status={wo.status}
                failureCodes={failureCodes}
                causasRaiz={causasRaiz}
                actividadesDeFalla={actividadesDeFalla}
                esOrdenDeFalla={esFalla(wo.maintenanceType)}
                pendingRequired={wo.tasks.filter((t) => !t.done && !t.liberadaAt).length}
                puedeGestionarCatalogos={can(user.role, "settings:write")}
                rol={user.role}
                iniciada={!!wo.startedAt}
                conResponsable={!!wo.assignedToId}
                requiereParo={wo.requiresShutdown}
                evidenciaRequerida={evidenciaRequerida}
                cierre={cierre}
              /> : null}
              {puedePedirApoyo ? (
                <a href="#pedir-apoyo" className="boton inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 lg:min-h-0 lg:py-1.5">
                  <LifeBuoy className="h-3.5 w-3.5" /> Pedir apoyo
                </a>
              ) : null}
          </div>
        </div>
      ) : null}

      {activaSinResponsable ? (
        <div role="note" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {wo.startedAt ? (
            <>
              <span className="font-semibold">En curso sin responsable. </span>
              {excepcionDeInicio
                ? `Se inició como excepción el ${formatDateTime(excepcionDeInicio.createdAt, zona)} por ${excepcionDeInicio.user?.name ?? "alguien"}${motivoExcepcion ? `: «${motivoExcepcion}»` : ""}. `
                : "Se inició antes de que se exigiera responsable. "}
              Sigue contando en «activas sin responsable» hasta que se asigne.
            </>
          ) : (
            <>
              <span className="font-semibold">Sin responsable. </span>
              {inicioSinResponsable(user.role).texto.replace("Esta orden no tiene responsable. ", "")}
            </>
          )}
        </div>
      ) : null}

      {mostrarFaltantes ? <FaltaParaCerrar faltantes={faltantes} /> : null}

      {/* minmax(0,1fr): sin esto la columna crece con el contenido (un nombre de equipo largo) y se corta en el teléfono. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4 lg:col-span-2">
          <FichaDeEjecucion
            estado={wo.status} prioridad={wo.priority} tipo={wo.maintenanceType}
            aceptada={aceptadaPor}
            compromiso={wo.dueDate ? formatDia(wo.dueDate, { zona }) : null}
            vencida={vencida}
            activo={wo.asset ? { id: wo.asset.id, texto: `${wo.asset.code} · ${wo.asset.name}` } : null}
            puedeVerActivo={puedeVerRuta(user.role, "/assets")}
            ubicacion={[wo.site?.name, wo.location?.name].filter(Boolean).join(" / ") || null}
            responsable={wo.assignedTo?.name ?? null}
            requiereParo={wo.requiresShutdown} conSeguridad={Boolean(wo.safetyNotes || wo.procedure)}
            actividades={{ hechas: doneTasks, total: wo.tasks.length }}
          />
          <IndiceDeSecciones secciones={indice} />

          <section id="actividades" className="grid min-w-0 scroll-mt-28 grid-cols-[minmax(0,1fr)] content-start gap-4">
          <Card>
            <CardHeader
              title="Lista de verificación"
              subtitle={`${doneTasks} de ${wo.tasks.length} tareas completadas`}
              action={
                canExecute && !["COMPLETED", "CLOSED", "CANCELLED"].includes(wo.status) ? (
                  <AgregarReporte workOrderId={wo.id} pendientes={reportesPendientes} />
                ) : null
              }
            />
            <TaskList
              workOrderId={wo.id}
              refacciones={refaccionesLiberar}
              tasks={wo.tasks.map((t) => ({
                id: t.id,
                title: t.title,
                description: t.description,
                taskType: t.taskType,
                unit: t.unit,
                minValue: t.minValue,
                maxValue: t.maxValue,
                required: t.required,
                liberadaAt: t.liberadaAt,
                motivoLiberacion: t.motivoLiberacion,
                motivoDetalle: t.motivoDetalle,
                bloqueadaPorPartId: t.bloqueadaPorPartId,
                origen: t.origen,
                solicitud: t.origenRequest?.number ?? null,
                done: t.done,
                resultNumber: t.resultNumber,
                resultText: t.resultText,
                passed: t.passed,
              }))}
              editable={canExecute && !["CLOSED", "CANCELLED"].includes(wo.status)}
            />
          </Card>

          </section>
          {wo.procedure || wo.safetyNotes ? (
            <SeccionPlegable
              id="seguridad"
              titulo="Procedimiento y seguridad"
              abiertaPorOmision={naceAbierta("seguridad", wo.status)}
            >
              {wo.procedure ? (
                <div className="mb-4">
                  <p className="label">Procedimiento</p>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{wo.procedure}</p>
                </div>
              ) : null}
              {wo.safetyNotes ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Seguridad</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">{wo.safetyNotes}</p>
                </div>
              ) : null}
            </SeccionPlegable>
          ) : null}
          <section id="tiempo" className="grid min-w-0 scroll-mt-28 grid-cols-[minmax(0,1fr)] content-start gap-4">
          <Card>
            <CardHeader title="Mano de obra" subtitle={`${formatNumber(wo.actualHours, 1)} h registradas${conCostos ? ` · ${formatCurrency(wo.laborCost, currency)}` : ""}`} />
            <LaborPanel
              workOrderId={wo.id}
              actividades={actividadesCargables}
              entries={wo.labor.map((l) => ({
                id: l.id,
                name: l.user.name,
                color: l.user.color,
                hours: l.hours,
                cost: l.cost,
                workedAt: l.workedAt.toISOString(),
                notes: l.notes,
              }))}
              technicians={technicians}
              currentUserId={user.id}
              currency={moneda}
              editable={canExecute && !["CLOSED", "CANCELLED"].includes(wo.status)}
            />
          </Card>

          </section>
          <section id="materiales" className="grid min-w-0 scroll-mt-28 grid-cols-[minmax(0,1fr)] content-start gap-4">
          {hayPlaneado ? (
            <Card>
              <CardHeader
                title="Recursos planeados"
                subtitle="Lo que el plan prevé para las actividades de esta orden. Prepare el material antes de bajar a piso."
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <ListaPlaneada
                  titulo="Mano de obra"
                  items={[...moPlaneada.values()].map((m) => ({
                    nombre: m.nombre, detalle: `${formatNumber(m.horas, 1)} h`,
                  }))}
                />
                <ListaPlaneada
                  titulo="Refacciones"
                  items={[...refPlaneadas.values()].map((r) => ({
                    nombre: r.nombre, detalle: `${formatNumber(r.cantidad, 2)} ${r.unidad}`,
                  }))}
                />
                <ListaPlaneada
                  titulo="Servicios externos"
                  items={[...srvPlaneados.values()].map((x) => ({
                    nombre: x.nombre, detalle: `${formatNumber(x.cantidad, 2)} ${x.unidad}`,
                  }))}
                />
              </div>
            </Card>
          ) : null}

          {delPlan ? (
            <RefaccionesDelPlan
              plan={delPlan.plan}
              renglones={delPlan.renglones}
              orden={{ id: wo.id, etiqueta: `${wo.number} · ${wo.title}`, activo: wo.asset ? `${wo.asset.code} · ${wo.asset.name}` : null }}
              almacenes={almacenesWo.map((a) => ({ id: a.id, etiqueta: a.name }))}
              refacciones={catalogoWo}
              existencias={stockWo}
              requisiciones={requisicionesWo.map((r) => ({
                id: r.id, folio: r.folio, estado: r.estado,
                porSurtir: r.renglones.reduce((sum, l) => sum + (l.cantidadSolicitada - l.cantidadSurtida), 0),
              }))}
              puedePedir={can(user.role, "requisition:create")}
            />
          ) : null}

          <Card>
            <CardHeader title="Refacciones" subtitle={conCostos ? formatCurrency(wo.partsCost, currency) : "Lo que se usó en este trabajo"} />
            <PartsPanel
              workOrderId={wo.id}
              actividades={actividadesCargables}
              used={wo.partsUsed.map((p) => ({
                id: p.id,
                code: p.part.code,
                name: p.part.name,
                unit: p.part.unit,
                quantity: p.quantity,
                cost: p.cost,
              }))}
              catalog={parts}
              currency={moneda}
              editable={canExecute && !["CLOSED", "CANCELLED"].includes(wo.status)}
            />
          </Card>
          </section>
          {medidores.length > 0 ? (
            <SeccionPlegable
              id="lecturas"
              titulo="Lecturas del equipo"
              subtitulo={`${medidores.length} medidor(es)`}
              abiertaPorOmision={naceAbierta("lecturas", wo.status)}
            >
              <p className="mb-2 text-xs text-slate-500">Registre el horómetro o contador si lo tomó en este trabajo.</p>
              <ul className="grid gap-3">
                {medidores.map((m) => (
                  <li key={m.id} className="rounded-lg border border-slate-200 p-3">
                    <p className="mb-2 text-sm font-medium text-slate-800">
                      {m.name} <span className="font-normal text-slate-500">· actual {m.currentValue === null ? "sin lectura" : `${formatNumber(m.currentValue, 1)} ${m.unit}`}</span>
                    </p>
                    {canExecute && !["CLOSED", "CANCELLED"].includes(wo.status) ? <MeterReadingForm meterId={m.id} unit={m.unit} current={m.currentValue} workOrderId={wo.id} /> : null}
                  </li>
                ))}
              </ul>
            </SeccionPlegable>
          ) : null}
          <section id="evidencias" className="grid min-w-0 scroll-mt-28 grid-cols-[minmax(0,1fr)] content-start gap-4">
          <Card>
            {/* Los adjuntos se permiten en cualquier estado, tambien en OT
                cerradas o canceladas: el reporte del proveedor, la factura o la
                foto del retrabajo suelen llegar dias despues. Lo que si queda
                congelado al cerrar son las tareas, las horas y los costos, que
                son los que sostienen los indicadores. */}
            <Adjuntos
              destino={{ workOrderId: wo.id }}
              editable={canExecute}
              titulo="Evidencia del trabajo"
              ayuda="Fotos del antes y después, video del síntoma, reporte del proveedor."
              adjuntos={wo.attachments.map((a) => ({
                id: a.id, name: a.name, kind: a.kind, size: a.size,
                mimeType: a.mimeType, createdAt: a.createdAt.toISOString(),
                subidoPor: a.uploadedBy?.name ?? null,
              }))}
            />
          </Card>

          </section>
          <SeccionPlegable
            id="bitacora"
            titulo="Bitácora"
            subtitulo={wo.comments.length ? `${wo.comments.length} nota(s)` : "Sin notas"}
            abiertaPorOmision={naceAbierta("bitacora", wo.status)}
          >
            <p className="mb-2 text-xs text-slate-500">Notas del equipo. Si necesita ayuda, pida apoyo aquí.</p>
            <CommentsPanel
              workOrderId={wo.id}
              comments={wo.comments.map((c) => ({
                id: c.id,
                body: c.body,
                name: c.user.name,
                color: c.user.color,
                createdAt: c.createdAt.toISOString(),
              }))}
              editable={canExecute}
            />
          </SeccionPlegable>
          {/* 10. Resultado: qué se pedirá al terminar (o lo que quedó). El botón está en la barra de abajo. */}
          <section id="resultado-movil" className="grid min-w-0 scroll-mt-28 lg:hidden">
            <Card>
              <CardHeader title="Resultado" subtitle={wo.completedAt ? "Lo que quedó registrado al terminar" : "Al terminar se le pedirá esto"} />
              <ResultadoDelTrabajo {...resultado} />
              <p className="mt-3 text-xs text-slate-500">Después toque «Terminar y enviar a revisión» abajo: supervisión la revisa y la cierra.</p>
            </Card>
          </section>

          {/* Lo secundario va plegado en el teléfono y abierto en computadora: no se oculta, se acomoda. */}
          <Plegable titulo="Más de la orden: servicios, procedimiento, material por actividad e historial">
          {conCostos ? (
          <Card>
            <CardHeader
              title="Servicios externos"
              subtitle={formatCurrency(wo.serviceCost, currency)}
            />
            {/* Lo que se subcontrato a un tercero para completar el trabajo:
                rebobinado, maniobras, calibracion. No pasa por el almacen, pero
                si por el costo de la orden. */}
            <ServicesPanel
              workOrderId={wo.id}
              actividades={actividadesCargables}
              lineas={wo.servicesUsed.map((s) => ({
                id: s.id,
                descripcion: s.descripcion,
                proveedor: s.supplier?.name ?? null,
                quantity: s.quantity,
                unitCost: s.unitCost,
                cost: s.cost,
                folioProveedor: s.folioProveedor,
                nota: s.nota,
              }))}
              catalogo={serviciosCatalogo}
              proveedores={proveedores}
              currency={currency}
              editable={canExecute && !["CLOSED", "CANCELLED"].includes(wo.status)}
            />
          </Card>

          ) : null}

          {!delPlan ? (
            <ProcedimientoIa
              workOrderId={wo.id}
              disponible={
                iaConfigurada() &&
                (user.isSuperAdmin || iaDeLaOrganizacion(user.organization).funciones.includes("PROCEDIMIENTO"))
              }
              editable={can(user.role, "workorder:write") && !["CLOSED", "CANCELLED"].includes(wo.status)}
              yaTieneActividades={wo.tasks.length > 0}
            />
          ) : null}

          <MaterialPorActividad organizationId={user.organizationId} workOrderId={wo.id} moneda={moneda} />

          <BitacoraDeEstados organizationId={user.organizationId} workOrderId={wo.id} zona={zona} />
          </Plegable>
        </div>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
          <Plegable titulo="Datos completos de la orden">
          <Card>
            <CardHeader title="Resumen" />
            <dl className="grid gap-3 text-sm">
              <Row label="Activo">
                {wo.asset ? (
                  <Link href={`/assets/${wo.asset.id}`} className="text-brand-600 hover:underline">
                    {wo.asset.code} · {wo.asset.name}
                  </Link>
                ) : (
                  <span className="text-slate-400">Sin activo</span>
                )}
              </Row>
              <Row label="Ubicacion">
                {[wo.site?.name, wo.location?.name].filter(Boolean).join(" / ") || "—"}
              </Row>
              <Row label="Responsable">
                {wo.assignedTo ? (
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={wo.assignedTo.name} color={wo.assignedTo.color} />
                    {wo.assignedTo.name}
                  </span>
                ) : activaSinResponsable ? (
                  <span className="font-medium text-amber-700">Sin responsable</span>
                ) : (
                  <span className="text-slate-400">Sin asignar</span>
                )}
              </Row>
              <Row label="Creada por">{wo.createdBy?.name ?? "Sistema"}</Row>
              <Row label="Creada">{formatDateTime(wo.createdAt, zona)}</Row>
              <Row label="Compromiso">{formatDia(wo.dueDate, { zona })}</Row>
              <Row label="Inicio real">{formatDateTime(wo.startedAt, zona)}</Row>
              <Row label="Termino">{formatDateTime(wo.completedAt, zona)}</Row>
              <Row label="Horas est. / real">
                {formatNumber(wo.estimatedHours, 1)} / {formatNumber(wo.actualHours, 1)} h
              </Row>
              <Row label="Paro registrado">{formatNumber(wo.downtimeMinutes / 60, 1)} h</Row>
              {wo.responseMinutes != null ? (
                <Row label="Tiempo de respuesta">{formatNumber(wo.responseMinutes / 60, 1)} h</Row>
              ) : null}
            </dl>
          </Card>

          {conCostos ? (
          <Card>
            <CardHeader title="Costos" />
            <dl className="grid gap-2 text-sm">
              <CostRow label="Mano de obra" value={formatCurrency(wo.laborCost, currency)} />
              <CostRow label="Refacciones" value={formatCurrency(wo.partsCost, currency)} />
              <CostRow label="Servicios externos" value={formatCurrency(wo.serviceCost, currency)} />
              <CostRow label="Otros" value={formatCurrency(wo.otherCost, currency)} />
              <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-2">
                <dt className="text-sm font-semibold text-slate-800">Total</dt>
                <dd className="text-base font-semibold tabular-nums text-slate-900">
                  {formatCurrency(wo.totalCost, currency)}
                </dd>
              </div>
            </dl>
          </Card>
          ) : null}

          {/* Existe aunque la orden no haya terminado: es el ancla a la que llevan
              los faltantes, y es donde quien revisa desde su escritorio ve qué
              se le va a pedir. Antes solo aparecía ya completada. */}
          <Card id="resultado" className="hidden scroll-mt-28 lg:block">
            <CardHeader
              title="Resultado del trabajo"
              subtitle={wo.completedAt ? "Lo que quedó registrado al terminar" : "Al terminar se le pedirá esto"}
            />
            <ResultadoDelTrabajo {...resultado} />
          </Card>
          </Plegable>
        </div>
      </div>
      {/* Lugar para la barra de acciones fija del teléfono: el final de la orden no queda debajo. */}
      {canExecute && (hayAcciones || puedeAceptar || puedePedirApoyo) ? <div className="h-32 lg:hidden" aria-hidden /> : null}

      {/* Lo que se hable de este registro queda aquí, no en un chat
          suelto donde se pierde en veinte minutos. */}
      <div className="mt-4">
        <Comentarios ancla="workOrder" anclaId={wo.id} yo={user.id} zona={user.organization.timezone} titulo="Conversación de la orden" />
      </div>

      {/* Lo que se acordó y no es una orden de trabajo. */}
      <div className="mt-4">
        <Compromisos entidad="WorkOrder" entidadId={wo.id} yo={user.id} zona={user.organization.timezone} />
      </div>
    </>
  );
}



function CostRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="tabular-nums text-slate-700">{value}</dd>
    </div>
  );
}

function ListaPlaneada({
  titulo,
  items,
}: {
  titulo: string;
  items: Array<{ nombre: string; detalle: string }>;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">—</p>
      ) : (
        <ul className="grid gap-1">
          {items.map((item) => (
            <li key={item.nombre} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-slate-700">{item.nombre}</span>
              <span className="shrink-0 tabular-nums text-slate-500">{item.detalle}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
