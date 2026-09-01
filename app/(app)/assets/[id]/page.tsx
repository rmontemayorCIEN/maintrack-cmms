import Link from "next/link";
import { LectorPlaca } from "./lector-placa";
import { iaConfigurada } from "@/lib/ia/cliente";
import { enlaceMapa } from "@/lib/geografia";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { puntoDeActivo } from "@/lib/portal";
import { expedienteDeFallas } from "@/lib/recurrencia";
import { Recurrencia, type Analisis } from "./recurrencia";
import { prisma } from "@/lib/db";
import { analyzeTrend, healthScore } from "@/lib/predictive";
import { Badge, Card, CardHeader, PageHeader, Progress, Stat } from "@/components/ui";
import {
  ASSET_STATUS_COLORS,
  ASSET_STATUS_LABELS,
  CRITICALITY_COLORS,
  CRITICALITY_LABELS,
  MAINTENANCE_TYPE_COLORS,
  MAINTENANCE_TYPE_LABELS,
  OPEN_STATUSES,
  SENSOR_STATUS_COLORS,
  SENSOR_TYPE_LABELS,
  WO_STATUS_COLORS,
  WO_STATUS_LABELS,
} from "@/lib/constants";
import { dueLabel, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { can } from "@/lib/rbac";
import { AssetDialog } from "../asset-dialog";
import { Adjuntos } from "@/components/adjuntos";
import { Enlaces } from "@/components/enlaces";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await prisma.asset.findUnique({ where: { id }, select: { code: true, name: true } });
  return { title: asset ? `${asset.code} — ${asset.name}` : "Activo" };
}

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const currency = user.organization.currency;

  const asset = await prisma.asset.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      site: true,
      location: true,
      category: true,
      parent: { select: { id: true, code: true, name: true } },
      children: { select: { id: true, code: true, name: true, status: true } },
      meters: true,
      sensors: { include: { readings: { orderBy: { readingAt: "desc" }, take: 30 } } },
      plans: { select: { id: true, name: true, nextDueDate: true, active: true, intervalDays: true, triggerType: true } },
    },
  });
  if (!asset) notFound();

  // El codigo de reporte del equipo. Se crea la primera vez que se abre su
  // ficha, asi que los activos que ya existian lo tienen igual que los nuevos.
  const punto = await puntoDeActivo(user.organizationId, asset.id, user.id);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const qrUrl = `${proto}://${host}/reportar/${punto.token}`;
  const qrSvg = await QRCode.toString(qrUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M", width: 160 });

  // El expediente de fallas se calcula siempre: las cifras no cuestan y sirven
  // aunque la cuenta no tenga IA. El analisis del patron es lo unico opcional.
  const expediente = await expedienteDeFallas(user.organizationId, asset.id, 365);
  let analisisRecurrencia: Analisis | null = null;
  if (asset.iaRecurrencia) {
    try {
      analisisRecurrencia = JSON.parse(asset.iaRecurrencia) as Analisis;
    } catch {
      analisisRecurrencia = null;
    }
  }
  const recurrenciaDisponible =
    iaConfigurada() && (user.isSuperAdmin || iaDeLaOrganizacion(user.organization).funciones.includes("RECURRENCIA"));

  const [sitios, ubicaciones, categorias] = await Promise.all([
    prisma.site.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true, code: true },
      orderBy: { code: "asc" },
    }),
    prisma.location.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true, code: true, siteId: true },
      orderBy: { code: "asc" },
    }),
    prisma.assetCategory.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true, code: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const enlaces = await prisma.referenceLink.findMany({
    where: { assetId: asset.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, url: true, note: true, createdAt: true },
  });

  const adjuntos = await prisma.attachment.findMany({
    where: { assetId: asset.id },
    orderBy: { createdAt: "desc" },
    select: {
        id: true, name: true, kind: true, size: true, mimeType: true, createdAt: true,
        uploadedBy: { select: { name: true } },
      },
  });

  const [workOrders, costs, downtime] = await Promise.all([
    prisma.workOrder.findMany({
      where: { assetId: asset.id },
      include: { assignedTo: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.workOrder.aggregate({
      where: { assetId: asset.id },
      _sum: { totalCost: true, actualHours: true, downtimeMinutes: true },
      _count: { _all: true },
    }),
    prisma.downtimeEvent.aggregate({
      where: { assetId: asset.id },
      _sum: { minutes: true },
      _count: { _all: true },
    }),
  ]);

  const open = workOrders.filter((wo) => OPEN_STATUSES.includes(wo.status));
  const corrective = workOrders.filter((wo) => wo.maintenanceType === "CORRECTIVE" && wo.completedAt);
  const mttr = corrective.length
    ? corrective.reduce((s, wo) => s + wo.actualHours, 0) / corrective.length
    : 0;
  const health = healthScore(asset.sensors);
  const totalCost = costs._sum.totalCost ?? 0;
  const ratio = asset.replacementCost ? (totalCost / asset.replacementCost) * 100 : 0;

  return (
    <>
      <PageHeader
        title={`${asset.code} — ${asset.name}`}
        breadcrumb={
          <Link href="/assets" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Activos
          </Link>
        }
        description={asset.description ?? undefined}
        actions={
          <>
            {can(user.role, "asset:write") ? (
              <AssetDialog
                sites={sitios}
                locations={ubicaciones}
                categories={categorias}
                puedeGestionarCatalogos={can(user.role, "settings:write")}
                activo={{
                  id: asset.id,
                  code: asset.code,
                  name: asset.name,
                  description: asset.description,
                  siteId: asset.siteId,
                  locationId: asset.locationId,
                  categoryId: asset.categoryId,
                  manufacturer: asset.manufacturer,
                  model: asset.model,
                  serialNumber: asset.serialNumber,
                  criticality: asset.criticality,
                  status: asset.status,
                  purchaseDate: asset.purchaseDate?.toISOString() ?? null,
                  warrantyExpiry: asset.warrantyExpiry?.toISOString() ?? null,
                  purchaseCost: asset.purchaseCost,
                  replacementCost: asset.replacementCost,
                }}
              />
            ) : null}
            <Link
              href={`/work-orders/new?assetId=${asset.id}`}
              className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700"
            >
              Nueva OT para este activo
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge className={ASSET_STATUS_COLORS[asset.status]}>{ASSET_STATUS_LABELS[asset.status]}</Badge>
        <Badge className={CRITICALITY_COLORS[asset.criticality]}>{CRITICALITY_LABELS[asset.criticality]}</Badge>
        {asset.category ? <Badge tone="muted">{asset.category.name}</Badge> : null}
        {asset.parent ? (
          <Link href={`/assets/${asset.parent.id}`} className="text-xs text-slate-500 hover:text-brand-600">
            Pertenece a {asset.parent.code}
          </Link>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Salud del equipo"
          value={`${health}%`}
          tone={health >= 85 ? "good" : health >= 60 ? "warn" : "bad"}
          hint={`${asset.sensors.length} puntos monitoreados`}
        />
        <Stat label="OT historicas" value={costs._count._all} hint={`${open.length} abiertas`} />
        <Stat label="MTTR del activo" value={`${formatNumber(mttr, 1)} h`} hint={`${corrective.length} correctivos cerrados`} />
        <Stat
          label="Costo acumulado"
          value={formatCurrency(totalCost, currency)}
          hint={asset.replacementCost ? `${formatNumber(ratio, 0)}% del valor de reposicion` : "Sin valor de reposicion"}
          tone={ratio > 60 ? "bad" : ratio > 30 ? "warn" : "default"}
        />
      </div>

      {expediente && expediente.fallas > 0 ? (
        <div className="mt-6">
          <Recurrencia
            assetId={asset.id}
            cifras={{
              fallas: expediente.fallas,
              diasEntreFallas: expediente.diasEntreFallas,
              tendencia: expediente.tendencia,
              costoTotal: expediente.costoTotal,
              costoAnualizado: expediente.costoAnualizado,
              porcentajeDeReposicion: expediente.porcentajeDeReposicion,
              paroHoras: expediente.paroHoras,
              sinCausaRaiz: expediente.sinCausaRaiz,
              periodoDias: expediente.periodoDias,
            }}
            analisis={analisisRecurrencia}
            analizadoEl={asset.iaRecurrenciaEl?.toISOString() ?? null}
            moneda={currency}
            disponible={recurrenciaDisponible}
          />
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Codigo de reporte"
            subtitle="Pegado en el equipo, cualquiera reporta una falla sin cuenta"
          />
          <div className="mx-auto w-40 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <p className="mt-2 break-all text-center text-[0.625rem] text-slate-400">{qrUrl}</p>
          <p className="mt-2 text-center text-xs leading-relaxed text-slate-600">
            Quien lo escanea reporta directo sobre <strong>{asset.code}</strong>, sin elegir nada
            ni saber cómo se llama el equipo.
          </p>
          <div className="mt-3 flex justify-center">
            <Link
              href="/requests/puntos"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Imprimir con los demás
            </Link>
          </div>
        </Card>

        <Card>
          <CardHeader title="Ficha tecnica" />
          <dl className="grid gap-3 text-sm">
            <Row label="Sitio / ubicacion">
              {[asset.site.name, asset.location?.name].filter(Boolean).join(" / ")}
              {(() => {
                // El enlace, no un mapa incrustado: Google cobra por cada carga
                // de mapa y en la ficha de un activo se abriria todo el dia.
                const url = enlaceMapa(asset.site);
                return url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1.5 inline-flex items-center gap-0.5 text-[0.6875rem] font-medium text-brand-600 hover:underline"
                  >
                    <MapPin className="h-3 w-3" /> mapa
                  </a>
                ) : null;
              })()}
            </Row>
            <Row label="Fabricante">{asset.manufacturer ?? "—"}</Row>
            <Row label="Modelo">{asset.model ?? "—"}</Row>
            <Row label="Numero de serie">{asset.serialNumber ?? "—"}</Row>
            <Row label="Fecha de compra">{formatDate(asset.purchaseDate)}</Row>
            <Row label="Costo de adquisicion">{formatCurrency(asset.purchaseCost, currency)}</Row>
            <Row label="Costo de reposicion">{formatCurrency(asset.replacementCost, currency)}</Row>
            <Row label="Garantia">
              {asset.warrantyExpiry
                ? asset.warrantyExpiry > new Date()
                  ? `Vigente hasta ${formatDate(asset.warrantyExpiry)}`
                  : `Vencida el ${formatDate(asset.warrantyExpiry)}`
                : "—"}
            </Row>
            <Row label="Paro acumulado">
              {formatNumber((downtime._sum.minutes ?? 0) / 60, 1)} h en {downtime._count._all} eventos
            </Row>
          </dl>
        </Card>

        {can(user.role, "asset:write") && iaConfigurada() && (user.isSuperAdmin || iaDeLaOrganizacion(user.organization).funciones.includes("PLACA")) ? (
          <LectorPlaca
            assetId={asset.id}
            nombreDelActivo={`${asset.code} ${asset.name}`}
            yaTieneDatos={Boolean(asset.manufacturer || asset.model || asset.serialNumber)}
          />
        ) : null}

        <Card>
          <CardHeader title="Medidores" subtitle="Base de los planes por uso" />
          {asset.meters.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Sin medidores registrados</p>
          ) : (
            <ul className="grid gap-3">
              {asset.meters.map((meter) => (
                <li key={meter.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs font-medium text-slate-700">{meter.name}</p>
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatNumber(meter.currentValue, 0)} <span className="text-[0.6875rem] text-slate-400">{meter.unit}</span>
                    </p>
                  </div>
                  <p className="mt-0.5 text-[0.6875rem] text-slate-400">
                    Promedio {formatNumber(meter.dailyAverage, 1)} {meter.unit}/dia · ultima lectura {formatDate(meter.lastReadingAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs font-semibold text-slate-700">Planes asociados</p>
            {asset.plans.length === 0 ? (
              <p className="text-xs text-slate-400">Sin planes preventivos</p>
            ) : (
              <ul className="grid gap-1.5">
                {asset.plans.map((plan) => {
                  const due = dueLabel(plan.nextDueDate);
                  return (
                    <li key={plan.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className={plan.active ? "text-slate-700" : "text-slate-400 line-through"}>{plan.name}</span>
                      <Badge tone={due.tone === "muted" ? "muted" : due.tone}>{due.text}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Monitoreo de condicion" subtitle="Estado predictivo" />
          {asset.sensors.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Sin puntos de monitoreo</p>
          ) : (
            <ul className="grid gap-3">
              {asset.sensors.map((sensor) => {
                const trend = analyzeTrend(
                  sensor.readings.map((r) => ({ value: r.value, readingAt: r.readingAt })),
                  sensor,
                );
                const threshold = sensor.criticalThreshold ?? sensor.warningThreshold ?? 0;
                const usage = threshold ? Math.min(100, ((sensor.lastValue ?? 0) / threshold) * 100) : 0;
                return (
                  <li key={sensor.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-slate-700">{sensor.name}</p>
                        <p className="text-[0.6875rem] text-slate-400">{SENSOR_TYPE_LABELS[sensor.sensorType]}</p>
                      </div>
                      <Badge className={SENSOR_STATUS_COLORS[sensor.lastStatus]}>
                        {formatNumber(sensor.lastValue ?? 0, 2)} {sensor.unit}
                      </Badge>
                    </div>
                    <div className="mt-2">
                      <Progress value={usage} tone={usage >= 100 ? "bad" : usage >= 75 ? "warn" : "good"} />
                    </div>
                    {trend.daysToThreshold != null ? (
                      <p className="mt-1.5 text-[0.6875rem] font-medium text-amber-700">
                        Umbral estimado en {trend.daysToThreshold} dias (confianza {formatNumber(trend.confidence * 100, 0)}%)
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {asset.children.length ? (
        <Card className="mt-4">
          <CardHeader title="Componentes" subtitle="Activos hijos en la jerarquia" />
          <div className="flex flex-wrap gap-2">
            {asset.children.map((child) => (
              <Link
                key={child.id}
                href={`/assets/${child.id}`}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:border-brand-300 hover:bg-brand-50"
              >
                {child.code} · {child.name}
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="mt-4">
        <Adjuntos
          destino={{ assetId: asset.id }}
          editable={can(user.role, "asset:write")}
          titulo="Manuales, planos y fotos"
          ayuda="Manual del fabricante, diagramas, placa de datos, fotos de instalacion."
          adjuntos={adjuntos.map((a) => ({
              id: a.id, name: a.name, kind: a.kind, size: a.size,
              mimeType: a.mimeType, createdAt: a.createdAt.toISOString(),
              subidoPor: a.uploadedBy?.name ?? null,
            }))}
        />
      </Card>

      <Card className="mt-4">
        <Enlaces
          destino={{ assetId: asset.id }}
          editable={can(user.role, "asset:write")}
          ayuda="Manual en linea del fabricante, refacciones del proveedor, video de procedimiento, norma aplicable."
          enlaces={enlaces.map((l) => ({ id: l.id, title: l.title, url: l.url, note: l.note, createdAt: l.createdAt.toISOString() }))}
        />
      </Card>

      <Card className="mt-4" padded={false}>
        <div className="px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">Historial de mantenimiento</h3>
          <p className="text-xs text-slate-500">Ultimas {workOrders.length} ordenes de trabajo</p>
        </div>
        {workOrders.length === 0 ? (
          <p className="px-5 pb-6 text-center text-xs text-slate-400">Sin historial</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Trabajo</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Responsable</th>
                  <th>Fecha</th>
                  <th className="text-right">Horas</th>
                  <th className="text-right">Costo</th>
                </tr>
              </thead>
              <tbody>
                {workOrders.map((wo) => (
                  <tr key={wo.id}>
                    <td>
                      <Link href={`/work-orders/${wo.id}`} className="font-medium text-brand-600 hover:underline">
                        {wo.number}
                      </Link>
                    </td>
                    <td className="max-w-64 truncate text-slate-700">{wo.title}</td>
                    <td>
                      <Badge className={MAINTENANCE_TYPE_COLORS[wo.maintenanceType]}>
                        {MAINTENANCE_TYPE_LABELS[wo.maintenanceType]}
                      </Badge>
                    </td>
                    <td><Badge className={WO_STATUS_COLORS[wo.status]}>{WO_STATUS_LABELS[wo.status]}</Badge></td>
                    <td className="text-xs text-slate-600">{wo.assignedTo?.name ?? "—"}</td>
                    <td className="text-xs text-slate-500">{formatDate(wo.completedAt ?? wo.createdAt)}</td>
                    <td className="text-right tabular-nums text-xs">{formatNumber(wo.actualHours, 1)}</td>
                    <td className="text-right tabular-nums text-xs">{formatCurrency(wo.totalCost, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
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
