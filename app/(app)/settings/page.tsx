import Link from "next/link";
import { BellRing, Building2, CalendarClock, CreditCard, History, Library, Palette, Plug, Receipt, ShieldCheck, UserCog, Users, ClipboardList } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { consumoDe, PLANES, type ClavePlan } from "@/lib/planes";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { PanelSuscripcion } from "@/components/panel-suscripcion";
import { PanelIa } from "@/components/panel-ia";
import { consumoIa } from "@/lib/ia/consumo";
import { COMPLEMENTO_IA, iaDeLaOrganizacion, planDe } from "@/lib/planes";
import { instalacionDe } from "@/lib/instalaciones";
import { PanelApariencia } from "./apariencia";
import type { ClaveAcento, ClaveDensidad, ClaveEscala } from "@/lib/apariencia";
import { FUNCIONES_IA, type ClaveFuncionIA } from "@/lib/ia/funciones";
import { FichasPlanes } from "./planes";
import { EstadoDeCuenta } from "./estado-cuenta";
import { estadoDeCuenta } from "@/lib/cobranza";
import { ROLE_LABELS } from "@/lib/constants";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { AccountCard } from "./account-card";
import { UserDialog } from "./user-dialog";
import { UserRowActions } from "./user-actions";
import { Pestanas, type Pestana } from "./pestanas";
import { ConfiguracionCompras } from "./compras";
import { ConfiguracionJornada } from "./jornada";
import { ConfiguracionOrdenes } from "./ordenes";
import { ContextoDelNegocio } from "./contexto";
import { contextoEnvejecido, PREGUNTAS, type ClavePregunta } from "@/lib/contexto-negocio";
import { PanelAvisos } from "./avisos";
import { PanelSeguridad } from "./seguridad";

export const metadata = { title: "Configuración" };
export const dynamic = "force-dynamic";

const SECCIONES = ["cuenta", "apariencia", "organizacion", "jornada", "ordenes", "avisos", "seguridad", "suscripcion", "cobranza", "usuarios", "integracion", "auditoria"] as const;
type Seccion = (typeof SECCIONES)[number];

const DESCRIPCIONES: Record<Seccion, string> = {
  cuenta: "Sus datos de acceso al sistema.",
  apariencia: "Tamaño de letra, densidad y la identidad visual de la empresa.",
  organizacion: "Identidad de la empresa y estructura fisica de la planta.",
  ordenes: "Como se arman las ordenes de trabajo: que puede juntarse y cuanto se adelanta.",
  jornada: "Horas de trabajo, días laborables y capacidad de cada persona. De aquí sale si un dia del calendario cabe.",
  avisos: "Avisos al teléfono: si la empresa los manda y cómo activar cada aparato.",
  seguridad: "Sus sesiones, las contraseñas del equipo y la exportación de su información.",
  suscripcion: "Plan contratado, consumo y carga inicial de información.",
  cobranza: "Cargos del servicio, su estado de pago y las notas de cobro.",
  usuarios: "Quien entra al sistema, con que rol y a que tarifa.",
  integracion: "Endpoints para conectar sistemas externos, IoT y tareas programadas.",
  auditoria: "Registro de las operaciones realizadas en el sistema.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  const user = await requireUser();
  const org = user.organization;
  const params = await searchParams;
  const canManage = can(user.role, "user:manage");

  const activa: Seccion = SECCIONES.includes(params.s as Seccion)
    ? (params.s as Seccion)
    : "cuenta";

  const pestanas: Pestana[] = [
    { clave: "cuenta", titulo: "Mi cuenta", icono: <UserCog className="h-4 w-4" /> },
    { clave: "apariencia", titulo: "Apariencia", icono: <Palette className="h-4 w-4" /> },
    { clave: "organizacion", titulo: "Organización", icono: <Building2 className="h-4 w-4" /> },
    { clave: "jornada", titulo: "Jornada y calendario", icono: <CalendarClock className="h-4 w-4" /> },
    { clave: "ordenes", titulo: "Órdenes de trabajo", icono: <ClipboardList className="h-4 w-4" /> },
    { clave: "avisos", titulo: "Avisos", icono: <BellRing className="h-4 w-4" /> },
    { clave: "seguridad", titulo: "Seguridad y sesiones", icono: <ShieldCheck className="h-4 w-4" /> },
    { clave: "suscripcion", titulo: "Suscripción", icono: <CreditCard className="h-4 w-4" /> },
    { clave: "cobranza", titulo: "Estado de cuenta", icono: <Receipt className="h-4 w-4" /> },
    { clave: "usuarios", titulo: "Usuarios", icono: <Users className="h-4 w-4" /> },
    { clave: "integracion", titulo: "Integración", icono: <Plug className="h-4 w-4" /> },
    { clave: "auditoria", titulo: "Auditoría", icono: <History className="h-4 w-4" /> },
  ];

  // Cada pestaña consulta solo lo suyo. Antes la pantalla lanzaba ocho
  // consultas en cada visita aunque se mirara una sola tarjeta.
  // Solo se consulta lo de la pestaña abierta: es el motivo de que la
  // navegacion viva en la URL y no en estado del cliente.
  const jornadaDatos =
    activa === "jornada"
      ? await (async () => {
          const [festivos, personas] = await Promise.all([
            prisma.diaFestivo.findMany({
              where: { organizationId: org.id, fecha: { gte: new Date(new Date().getFullYear(), 0, 1) } },
              orderBy: { fecha: "asc" },
              select: { id: true, fecha: true, nombre: true, deLey: true },
            }),
            prisma.user.findMany({
              where: { organizationId: org.id, active: true },
              orderBy: { name: "asc" },
              select: { id: true, name: true, role: true, horasDisponibles: true },
            }),
          ]);
          return { festivos, personas };
        })()
      : null;

  const [uso, consumo, solicitudPlan, cobranza, usuarios, sitios, ubicaciones, bitacora] = await Promise.all([
    consumoIa(user.organizationId),
    activa === "suscripcion" ? consumoDe(org.id, org.plan) : Promise.resolve(null),
    activa === "suscripcion"
      ? prisma.planRequest.findFirst({
          where: { organizationId: org.id, status: "PENDING" },
          select: { id: true, planSolicitado: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve(null),
    activa === "cobranza" ? estadoDeCuenta(org.id) : Promise.resolve(null),
    activa === "usuarios"
      ? prisma.user.findMany({
          where: { organizationId: org.id },
          orderBy: [{ active: "desc" }, { name: "asc" }],
        })
      : Promise.resolve(null),
    activa === "organizacion"
      ? prisma.site.findMany({
          where: { organizationId: org.id },
          include: { _count: { select: { assets: true, locations: true } } },
          orderBy: { code: "asc" },
        })
      : Promise.resolve(null),
    activa === "organizacion"
      ? prisma.location.findMany({
          where: { organizationId: org.id },
          include: { _count: { select: { assets: true } } },
          orderBy: { name: "asc" },
        })
      : Promise.resolve(null),
    activa === "auditoria"
      ? prisma.auditLog.findMany({
          where: { organizationId: org.id },
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 60,
        })
      : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title="Configuracion" description={DESCRIPCIONES[activa]} />
      <Pestanas activa={activa} pestanas={pestanas} />

      {activa === "apariencia" ? (
        <PanelApariencia
          escala={(user.escalaUi ?? "NORMAL") as ClaveEscala}
          densidad={(user.densidadUi ?? "COMODA") as ClaveDensidad}
          acento={(org.colorAcento ?? "AZUL") as ClaveAcento}
          logoUrl={org.logoUrl}
          puedeEditarMarca={can(user.role, "settings:write")}
        />
      ) : null}

      {activa === "jornada" && jornadaDatos ? (
        <ConfiguracionJornada
          horasJornada={org.horasJornada}
          diasHabiles={org.diasHabiles.split(",").map(Number).filter((n) => n >= 1 && n <= 7)}
          festivos={jornadaDatos.festivos.map((f) => ({
            id: f.id, nombre: f.nombre, deLey: f.deLey, fecha: f.fecha.toISOString(),
          }))}
          personas={jornadaDatos.personas}
          editable={can(user.role, "settings:write")}
        />
      ) : null}

      {activa === "ordenes" ? (
        <ConfiguracionOrdenes
          multiOrigen={org.otMultiOrigen}
          horizonteDias={org.otHorizonteDias}
          recalculo={org.recalculoPlan}
          diasHabiles={org.otDiasHabiles}
          generacion={org.otGeneracion}
          evidenciaCriticas={org.otEvidenciaCriticas}
          jornadaDias={org.diasHabiles}
          editable={can(user.role, "settings:write")}
        />
      ) : null}

      {activa === "avisos" ? (
        <PanelAvisos
          encendidoInicial={org.avisosPush}
          puedeEditar={can(user.role, "settings:write")}
        />
      ) : null}

      {activa === "seguridad" ? (
        <PanelSeguridad
          puedeExportar={can(user.role, "data:export")}
          ultimoAcceso={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : null}
        />
      ) : null}

      {activa === "cuenta" ? (
        <AccountCard
          usuario={{
            name: user.name, email: user.email, role: user.role,
            phone: user.phone, jobTitle: user.jobTitle,
          }}
        />
      ) : null}

      {activa === "organizacion" && sitios && ubicaciones ? (
        <div className="grid gap-4">
          <ContextoDelNegocio
            valores={Object.fromEntries(
              PREGUNTAS.map((p) => [p.clave, org[p.clave]]),
            ) as Record<ClavePregunta, string | null>}
            tipoInstalacion={org.tipoInstalacion}
            actualizadoEl={org.contextoAt ? formatDate(org.contextoAt) : null}
            envejecido={contextoEnvejecido(org)}
            editable={can(user.role, "settings:write")}
          />

        <div className="grid gap-4 lg:grid-cols-3">
          <ConfiguracionCompras
            comprasInternas={org.comprasInternas}
            montoAutorizacion={org.montoAutorizacion}
            moneda={org.currency}
            editable={can(user.role, "settings:write")}
          />
          <Card>
            <CardHeader title="Datos de la organización" subtitle={org.name} />
            <dl className="grid gap-3 text-sm">
              <Row label="Identificador">{org.slug}</Row>
              <Row label="Giro">{org.industry ?? "Sin definir"}</Row>
              <Row label="Tipo de instalación">{instalacionDe(org.tipoInstalacion).nombre}</Row>
              <Row label="Zona horaria">{org.timezone}</Row>
              <Row label="Moneda">{org.currency}</Row>
              <Row label="Alta">{formatDate(org.createdAt)}</Row>
              <Row label="Folios emitidos">
                {org.woSequence} OT · {org.wrSequence} solicitudes
              </Row>
            </dl>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader
              title="Estructura fisica"
              subtitle="Sitios y sus ubicaciones. El número entre parentesis son los activos de cada una."
              action={
                can(user.role, "settings:write") ? (
                  <Link
                    href="/catalogs?tipo=sites"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    <Library className="h-3.5 w-3.5" /> Administrar
                  </Link>
                ) : null
              }
            />
            {sitios.length === 0 ? (
              <EmptyState title="Sin sitios" description="Registre el primero desde Catálogos." />
            ) : (
              <ul className="grid gap-2">
                {sitios.map((sitio) => (
                  <li key={sitio.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        {sitio.code} · {sitio.name}
                      </p>
                      <span className="text-[0.6875rem] text-slate-500">
                        {sitio._count.assets} activos · {sitio._count.locations} ubicaciones
                      </span>
                    </div>
                    {sitio.address ? <p className="text-xs text-slate-500">{sitio.address}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {ubicaciones
                        .filter((u) => u.siteId === sitio.id)
                        .map((u) => (
                          <span
                            key={u.id}
                            className="rounded-full border border-slate-200 px-2 py-0.5 text-[0.6875rem] text-slate-600"
                          >
                            {u.name} ({u._count.assets})
                          </span>
                        ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        </div>
      ) : null}

      {activa === "suscripcion" && consumo ? (
        /*
          El orden es el de las preguntas que trae quien entra: primero "que
          tengo y cuanto llevo usado", enseguida "cuanto cuesta cambiarme".
          Antes los planes quedaban hasta el fondo, empujados por la lista de
          dieciocho funciones de IA, y habia que desplazarse para encontrarlos.
        */
        <div className="grid gap-6">
          <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
            <div className="lg:col-span-2">
              <PanelSuscripcion org={org} consumo={consumo} />
            </div>
            <PanelIa
              operacionesUsadas={uso.operaciones}
              operacionesIncluidas={iaDeLaOrganizacion(org).operaciones}
              complementoActivo={org.iaComplemento}
              puedeSolicitar={can(user.role, "billing:manage")}
              solicitudPendiente={solicitudPlan?.planSolicitado === COMPLEMENTO_IA.clave}
              planDePago={planDe(org.plan).precioMensual > 0}
              moneda={org.currency}
              complemento={{
                nombre: COMPLEMENTO_IA.nombre,
                precioMensual: COMPLEMENTO_IA.precioMensual,
                operaciones: COMPLEMENTO_IA.operaciones,
                incluye: COMPLEMENTO_IA.incluye,
              }}
              funciones={(Object.keys(FUNCIONES_IA) as ClaveFuncionIA[]).map((clave) => ({
                clave,
                nombre: FUNCIONES_IA[clave].nombre,
                descripcion: FUNCIONES_IA[clave].descripcion,
                incluida: iaDeLaOrganizacion(org).funciones.includes(clave),
                disponible: FUNCIONES_IA[clave].disponible,
              }))}
            />

          </div>

          <FichasPlanes
            planActual={org.plan}
            moneda={org.currency}
            puedeSolicitar={can(user.role, "billing:manage")}
            solicitudPendiente={
              solicitudPlan
                ? {
                    id: solicitudPlan.id,
                    planSolicitado: solicitudPlan.planSolicitado,
                    createdAt: solicitudPlan.createdAt.toISOString(),
                  }
                : null
            }
            planes={(Object.keys(PLANES) as ClavePlan[]).map((clave) => ({
              clave,
              nombre: PLANES[clave].nombre,
              precioMensual: PLANES[clave].precioMensual,
              descripcion: PLANES[clave].descripcion,
              limites: PLANES[clave].limites,
              incluye: PLANES[clave].incluye,
            }))}
          />
        </div>
      ) : null}

      {activa === "cobranza" && cobranza ? (
        <EstadoDeCuenta
          cargos={cobranza.cargos}
          saldo={cobranza.saldo}
          vencido={cobranza.vencido}
          pendientes={cobranza.pendientes}
          vencidos={cobranza.vencidos}
          moneda={org.currency}
        />
      ) : null}

      {activa === "usuarios" && usuarios ? (
        <Card padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Usuarios y roles</h3>
              <p className="text-xs text-slate-500">
                {usuarios.filter((u) => u.active).length} activos de {usuarios.length} registrados
              </p>
            </div>
            {canManage ? <UserDialog /> : null}
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Nombre</th><th>Correo</th><th>Rol</th><th>Puesto</th>
                  <th className="text-right">Tarifa/h</th><th>Último acceso</th><th>Estado</th>
                  {canManage ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {usuarios.map((miembro) => (
                  <tr key={miembro.id} className={miembro.active ? "" : "opacity-50"}>
                    <td className="font-medium text-slate-800">{miembro.name}</td>
                    <td className="text-xs text-slate-600">{miembro.email}</td>
                    <td><Badge tone="muted">{ROLE_LABELS[miembro.role] ?? miembro.role}</Badge></td>
                    <td className="text-xs text-slate-500">{miembro.jobTitle ?? "—"}</td>
                    <td className="text-right tabular-nums text-xs">
                      {formatCurrency(miembro.hourlyRate, org.currency)}
                    </td>
                    <td className="text-xs text-slate-500">{formatDateTime(miembro.lastLoginAt)}</td>
                    <td>
                      <Badge tone={miembro.active ? "success" : "muted"}>
                        {miembro.active ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>
                    {canManage ? (
                      <td className="text-right">
                        {miembro.role !== "OWNER" && miembro.id !== user.id ? (
                          <UserRowActions userId={miembro.id} userName={miembro.name} active={miembro.active} role={miembro.role} />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {activa === "integracion" ? (
        <Card>
          <CardHeader
            title="Endpoints disponibles"
            subtitle="Todos requieren sesión, salvo el programador, que usa su propio token."
          />
          <div className="grid gap-3 text-xs md:grid-cols-2">
            <Endpoint method="GET" path="/api/cron/scheduler" description="Genera las OT preventivas vencidas de todas las organizaciones. Autenticacion: encabezado Authorization: Bearer CRON_SECRET. Programelo en Cloud Scheduler cada hora." />
            <Endpoint method="POST" path="/api/sensors/readings" description="Ingesta de lecturas de condicion (una o hasta 500 en lote). Evalua umbrales, actualiza la tendencia y abre alertas u ordenes predictivas." />
            <Endpoint method="POST" path="/api/readings" description="Registro de lectura de medidor (horas, km, ciclos). Recalcula el consumo diario y adelanta los planes por uso." />
            <Endpoint method="GET" path="/api/work-orders" description="Consulta de órdenes con filtros por estado, tipo, activo y responsable." />
            <Endpoint method="POST" path="/api/requests" description="Alta de solicitudes de servicio desde portales o sistemas de producción." />
            <Endpoint method="GET" path="/api/assets" description="Catalogo de activos, con busqueda por código, nombre o número de serie." />
          </div>
        </Card>
      ) : null}

      {activa === "auditoria" && bitacora ? (
        <Card padded={false}>
          <div className="px-5 py-4">
            <h3 className="text-sm font-semibold text-slate-900">Bitácora de auditoría</h3>
            <p className="text-xs text-slate-500">Ultimas {bitacora.length} operaciones registradas</p>
          </div>
          {bitacora.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState title="Sin movimientos" description="Aquí apareceran las operaciones conforme se usen." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Fecha</th><th>Usuario</th><th>Entidad</th><th>Acción</th><th>Detalle</th></tr>
                </thead>
                <tbody>
                  {bitacora.map((entrada) => (
                    <tr key={entrada.id}>
                      <td className="text-xs text-slate-500">{formatDateTime(entrada.createdAt)}</td>
                      <td className="text-xs text-slate-600">{entrada.user?.name ?? "Sistema"}</td>
                      <td className="text-xs text-slate-600">{entrada.entity}</td>
                      <td><Badge tone="muted">{entrada.action}</Badge></td>
                      <td className="text-xs text-slate-600">{entrada.summary ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
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

function Endpoint({ method, path, description }: { method: string; path: string; description: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold text-white">
          {method}
        </span>
        <code className="font-mono text-[0.6875rem] text-slate-700">{path}</code>
      </div>
      <p className="mt-1 text-[0.6875rem] leading-relaxed text-slate-500">{description}</p>
    </div>
  );
}
