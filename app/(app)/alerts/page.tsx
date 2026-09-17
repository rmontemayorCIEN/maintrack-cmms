import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { SENSOR_TYPE_LABELS } from "@/lib/constants";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import { AlertActions } from "./alert-actions";
import { evaluarPuntos } from "@/lib/predictive";

export const metadata = { title: "Alertas predictivas" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Abierta",
  ACKNOWLEDGED: "Reconocida",
  RESOLVED: "Resuelta",
  DISMISSED: "Descartada",
};

export default async function AlertsPage() {
  const user = await requireUser();
  const editable = can(user.role, "predictive:write");

  const alerts = await prisma.predictiveAlert.findMany({
    where: { organizationId: user.organizationId },
    include: {
      asset: { select: { id: true, code: true, name: true, criticality: true } },
      sensor: { select: { name: true, sensorType: true, unit: true } },
      workOrder: { select: { id: true, number: true, status: true } },
      acknowledgedBy: { select: { name: true } },
    },
    orderBy: [{ status: "asc" }, { severity: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  const open = alerts.filter((a) => ["OPEN", "ACKNOWLEDGED"].includes(a.status));
  // Estado y fechas VIVOS del punto: lo guardado al detectar puede haber
  // quedado atras (una fecha proyectada que ya paso no se muestra como futura).
  const vivas = await evaluarPuntos(user.organizationId, open.map((a) => a.sensorId).filter(Boolean) as string[]);
  const history = alerts.filter((a) => !["OPEN", "ACKNOWLEDGED"].includes(a.status));

  return (
    <>
      <PageHeader
        title="Alertas predictivas"
        description={`${open.length} alertas activas de monitoreo de condicion.`}
      />

      {open.length === 0 ? (
        <EmptyState
          title="Sin alertas activas"
          description="Todos los puntos monitoreados se encuentran dentro de parámetro."
        />
      ) : (
        <div className="grid gap-3">
          {open.map((alert) => (
            <Card key={alert.id}>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={alert.severity === "CRITICAL" ? "danger" : "warning"}>
                      {alert.severity === "CRITICAL" ? "Crítica" : "Advertencia"}
                    </Badge>
                    <Badge tone="muted">{STATUS_LABELS[alert.status]}</Badge>
                    {alert.normalizadaEl ? <Badge tone="success">Normalizada: por validar</Badge> : null}
                    {alert.sensor ? (
                      <Badge tone="info">{SENSOR_TYPE_LABELS[alert.sensor.sensorType]}</Badge>
                    ) : null}
                    <Link href={`/assets/${alert.asset.id}`} className="text-xs font-medium text-brand-600 hover:underline">
                      {alert.asset.code} · {alert.asset.name}
                    </Link>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-800">{alert.title}</p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    <span className="text-slate-400">Al detectar:</span> {alert.message}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-4 text-[0.6875rem] text-slate-500">
                    <span>Detectada {formatDateTime(alert.createdAt)}</span>
                    {alert.value != null ? (
                      <span>
                        Valor {formatNumber(alert.value, 2)} {alert.sensor?.unit}
                        {alert.threshold != null ? ` · umbral ${formatNumber(alert.threshold, 2)}` : ""}
                      </span>
                    ) : null}
                    {(() => {
                      const e = alert.sensorId ? vivas.get(alert.sensorId) : undefined;
                      if (!e) return null;
                      return (
                        <>
                          <span className={`font-medium ${e.estado === "CRITICO" ? "text-red-700" : e.estado === "ADVERTENCIA" ? "text-amber-700" : "text-emerald-700"}`}>
                            Hoy: {e.etiquetaEstado} · {e.etiquetaTendencia}
                          </span>
                          <span>Cruce de advertencia: {e.cruceAdvertencia.texto}</span>
                          <span>Cruce crítico: {e.cruceCritico.texto}</span>
                          <span>{e.etiquetaConfianza} · {e.lecturasUsadas} lecturas</span>
                        </>
                      );
                    })()}
                    {alert.acknowledgedBy ? <span>Reconocida por {alert.acknowledgedBy.name}</span> : null}
                  </div>
                  {alert.workOrder ? (
                    <Link
                      href={`/work-orders/${alert.workOrder.id}`}
                      className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline"
                    >
                      Orden asociada: {alert.workOrder.number}
                    </Link>
                  ) : null}
                </div>

                {editable ? (
                  <AlertActions
                    alertId={alert.id}
                    hasWorkOrder={Boolean(alert.workOrderId)}
                    status={alert.status}
                    normalizada={Boolean(alert.normalizadaEl)}
                  />
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {history.length ? (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-700">Historial</h2>
          <Card padded={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Activo</th>
                    <th>Alerta</th>
                    <th>Severidad</th>
                    <th>Estado</th>
                    <th>Fecha</th>
                    <th>OT</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((alert) => (
                    <tr key={alert.id}>
                      <td className="text-xs text-slate-600">{alert.asset.code} · {alert.asset.name}</td>
                      <td className="max-w-80 truncate text-xs text-slate-700">{alert.message}</td>
                      <td>
                        <Badge tone={alert.severity === "CRITICAL" ? "danger" : "warning"}>
                          {alert.severity === "CRITICAL" ? "Crítica" : "Advertencia"}
                        </Badge>
                      </td>
                      <td><Badge tone="muted">{STATUS_LABELS[alert.status]}</Badge></td>
                      <td className="text-xs text-slate-500">{formatDate(alert.createdAt)}</td>
                      <td className="text-xs">
                        {alert.workOrder ? (
                          <Link href={`/work-orders/${alert.workOrder.id}`} className="text-brand-600 hover:underline">
                            {alert.workOrder.number}
                          </Link>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </>
  );
}
