import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, Wrench, XCircle } from "lucide-react";
import { seguimientoDe } from "@/lib/portal";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi reporte" };

/**
 * Seguimiento publico.
 *
 * Traduce los estados internos a lo que le importa a quien reporto. "APPROVED"
 * no le dice nada a un inquilino; "ya lo revisaron y va a atenderse" si.
 */
const ETAPAS = [
  { clave: "PENDING", titulo: "Recibido", dice: "Su reporte llegó a mantenimiento y está en espera de revisión.", icono: Clock },
  { clave: "APPROVED", titulo: "Revisado", dice: "Mantenimiento lo revisó y lo va a atender.", icono: CheckCircle2 },
  { clave: "CONVERTED", titulo: "En atención", dice: "Ya hay una orden de trabajo asignada.", icono: Wrench },
];

export default async function SeguimientoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await seguimientoDe(token);
  if (!s) notFound();

  const rechazada = s.status === "REJECTED";
  const cerrada = s.workOrder?.status === "COMPLETED" || s.workOrder?.status === "CLOSED";
  const etapaActual = rechazada ? -1 : ETAPAS.findIndex((e) => e.clave === s.status);
  const lugar = [s.asset ? `${s.asset.code} · ${s.asset.name}` : null, s.location?.name, s.site?.name]
    .filter(Boolean).join(" — ");

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg px-4 py-6">
      <header className="mb-5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{s.organization.name}</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">{s.title}</h1>
        <p className="mt-1 font-mono text-sm text-slate-500">{s.number}</p>
        {lugar ? <p className="mt-1 text-sm text-slate-600">{lugar}</p> : null}
        <p className="mt-1 text-xs text-slate-400">Reportado el {formatDateTime(s.createdAt)}</p>
      </header>

      {cerrada ? (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <p className="text-base font-semibold text-emerald-900">Atendido</p>
          </div>
          <p className="mt-1 text-sm text-emerald-800">
            El trabajo se completó
            {s.workOrder?.completedAt ? ` el ${formatDateTime(s.workOrder.completedAt)}` : ""}.
            Si el problema sigue, levante un reporte nuevo con el mismo código.
          </p>
        </div>
      ) : rechazada ? (
        <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-slate-500" />
            <p className="text-base font-semibold text-slate-800">No procede</p>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {s.reviewNotes ?? "Mantenimiento revisó el reporte y determinó que no requiere atención."}
          </p>
        </div>
      ) : null}

      {!rechazada ? (
        <ol className="grid gap-3">
          {ETAPAS.map((e, i) => {
            const alcanzada = etapaActual >= i;
            const Icono = e.icono;
            return (
              <li key={e.clave} className={`flex gap-3 rounded-lg border p-3 ${alcanzada ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50/60"}`}>
                <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${alcanzada ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-400"}`}>
                  <Icono className="h-4 w-4" />
                </div>
                <div>
                  <p className={`text-sm font-medium ${alcanzada ? "text-slate-900" : "text-slate-400"}`}>{e.titulo}</p>
                  <p className={`mt-0.5 text-sm ${alcanzada ? "text-slate-600" : "text-slate-400"}`}>{e.dice}</p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {s.description ? (
        <section className="mt-5 rounded-lg border border-slate-200 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Lo que reportó</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{s.description}</p>
        </section>
      ) : null}

      <div className="mt-6 text-center">
        <Link
          href="/mis-reportes"
          className="inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
        >
          Ver todos mis reportes
        </Link>
        <p className="mt-3 text-xs text-slate-400">
          También puede buscar uno con su folio en{" "}
          <Link href="/consultar" className="underline">consultar mi reporte</Link>.
        </p>
      </div>
    </main>
  );
}
