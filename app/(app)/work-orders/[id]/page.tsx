import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
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
import { faltantesDeCierre } from "@/lib/reglas-ot";
import { BitacoraDeEstados } from "./bitacora";

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

  const [tecnicosWo, cuadrillasWo, activosWo] = await Promise.all([
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
  const canExecute = can(user.role, "workorder:execute");
  const canEdit = can(user.role, "workorder:write");
  const doneTasks = wo.tasks.filter((t) => t.done).length;

  return (
    <>
      <PageHeader
        title={`${wo.number} — ${wo.title}`}
        breadcrumb={
          <Link href="/work-orders" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Órdenes de trabajo
          </Link>
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
              editable={can(user.role, "workorder:write") && !["CLOSED", "CANCELLED"].includes(wo.status)}
            />
            <Link
              href={`/work-orders/${wo.id}/print`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              <Printer className="h-3.5 w-3.5" /> Imprimir
            </Link>
            {canExecute ? (
              <WorkOrderActions
              iaDisponible={iaConfigurada() && iaDeLaOrganizacion(user.organization).funciones.includes("CIERRE_OT")}
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
              />
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge className={WO_STATUS_COLORS[wo.status]}>{WO_STATUS_LABELS[wo.status]}</Badge>
        <Badge className={MAINTENANCE_TYPE_COLORS[wo.maintenanceType]}>
          {MAINTENANCE_TYPE_LABELS[wo.maintenanceType]}
        </Badge>
        <Badge className={PRIORITY_COLORS[wo.priority]}>Prioridad {PRIORITY_LABELS[wo.priority]}</Badge>
        {wo.requiresShutdown ? <Badge tone="danger">Requiere paro</Badge> : null}
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

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
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

          {wo.procedure || wo.safetyNotes ? (
            <Card>
              <CardHeader title="Procedimiento y seguridad" />
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
            </Card>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader title="Mano de obra" subtitle={`${formatNumber(wo.actualHours, 1)} h · ${formatCurrency(wo.laborCost, currency)}`} />
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
                currency={currency}
                editable={canExecute && !["CLOSED", "CANCELLED"].includes(wo.status)}
              />
            </Card>

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
              <CardHeader title="Refacciones" subtitle={formatCurrency(wo.partsCost, currency)} />
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
                currency={currency}
                editable={canExecute && !["CLOSED", "CANCELLED"].includes(wo.status)}
              />
            </Card>
          </div>

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

          <Card>
            <CardHeader title="Bitacora" subtitle="Notas del equipo de mantenimiento" />
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
          </Card>

          <BitacoraDeEstados organizationId={user.organizationId} workOrderId={wo.id} zona={zona} />
        </div>

        <div className="grid content-start gap-4">
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

          {wo.completedAt ? (
            <Card>
              <CardHeader title="Cierre técnico" />
              <dl className="grid gap-3 text-sm">
                <Row label="Código de falla">
                  {wo.failureCode ? `${wo.failureCode.code} — ${wo.failureCode.description}` : "—"}
                </Row>
                <Row label="Causa raiz">
                  {wo.rootCause ? `${wo.rootCause.code} — ${wo.rootCause.description}` : "—"}
                </Row>
                <Row label="Solución aplicada">{wo.resolution ?? "—"}</Row>
              </dl>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-700">{children}</dd>
    </div>
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
