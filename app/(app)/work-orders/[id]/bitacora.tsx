import { prisma } from "@/lib/db";
import { Card, CardHeader } from "@/components/ui";
import { WO_STATUS_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";

const ACCIONES = ["CREATED", "AUTO_GENERATED", "STATUS_CHANGED", "RESCHEDULED"];

/**
 * Quien movio la orden, cuando, de que estado a cual y por que.
 *
 * Sale de la auditoria, que ya guardaba cada transicion: aqui solo se hace
 * visible, para que una orden reabierta o cancelada se explique sola sin
 * pedirle a nadie que busque en otro lado.
 */
export async function BitacoraDeEstados({ organizationId, workOrderId, zona }: {
  organizationId: string; workOrderId: string; zona: string;
}) {
  const eventos = await prisma.auditLog.findMany({
    where: { organizationId, entity: "WorkOrder", entityId: workOrderId, action: { in: ACCIONES } },
    orderBy: { createdAt: "asc" },
    select: { id: true, action: true, summary: true, changes: true, createdAt: true, user: { select: { name: true } } },
    take: 100,
  });
  if (!eventos.length) return null;

  const texto = (e: (typeof eventos)[number]) => {
    let c: { from?: string; to?: string; motivo?: string; tomadaPor?: string; iniciadaSinResponsable?: boolean } = {};
    try { c = JSON.parse(e.changes); } catch { /* cambios viejos sin formato */ }
    if (e.action === "STATUS_CHANGED" && c.from && c.to) {
      return {
        paso: `${WO_STATUS_LABELS[c.from] ?? c.from} → ${WO_STATUS_LABELS[c.to] ?? c.to}`,
        detalle: [
          c.tomadaPor ? "la tomó al iniciar" : null,
          c.iniciadaSinResponsable ? "iniciada sin responsable" : null,
          c.motivo ?? null,
        ].filter(Boolean).join(" · "),
      };
    }
    if (e.action === "RESCHEDULED") return { paso: "Reprogramada", detalle: e.summary?.replace(/^[^:]+:\s*/, "") ?? "" };
    return { paso: "Creada", detalle: e.action === "AUTO_GENERATED" ? "por el programador" : "" };
  };

  return (
    <Card>
      <CardHeader title="Historial de estados" subtitle="Cada cambio con quién, cuándo y por qué" />
      <ol className="grid gap-2 text-xs">
        {eventos.map((e) => {
          const t = texto(e);
          return (
            <li key={e.id} className="grid grid-cols-[auto_1fr] gap-x-3">
              <span className="tabular-nums text-slate-400">{formatDateTime(e.createdAt, zona)}</span>
              <span>
                <span className="font-medium text-slate-700">{t.paso}</span>
                <span className="text-slate-500"> · {e.user?.name ?? "Sistema"}</span>
                {t.detalle ? <span className="block text-slate-600">{t.detalle}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
