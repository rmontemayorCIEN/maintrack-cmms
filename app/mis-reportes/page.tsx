import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, ChevronRight, Clock, Wrench, XCircle } from "lucide-react";
import { misSolicitudes, reportanteActual } from "@/lib/portal";
import { formatDate } from "@/lib/utils";
import { Olvidarme } from "./olvidarme";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mis reportes" };

const ETIQUETA: Record<string, { texto: string; clase: string; franja: string; icono: typeof Clock }> = {
  PENDING: { texto: "Recibido", clase: "bg-amber-100 text-amber-800", franja: "bg-amber-400", icono: Clock },
  APPROVED: { texto: "Revisado", clase: "bg-sky-100 text-sky-800", franja: "bg-sky-400", icono: CheckCircle2 },
  CONVERTED: { texto: "En atención", clase: "bg-sky-100 text-sky-800", franja: "bg-sky-500", icono: Wrench },
  REJECTED: { texto: "No procede", clase: "bg-slate-100 text-slate-600", franja: "bg-slate-300", icono: XCircle },
};

/**
 * El historial de quien reporta, sin cuenta.
 *
 * Se llega aqui despues de identificarse una vez. El dispositivo lo recuerda,
 * asi que un inquilino que reporta cada mes no vuelve a teclear nada.
 */
export default async function MisReportesPage() {
  const celular = await reportanteActual();
  if (!celular) redirect("/consultar");

  const grupos = await misSolicitudes(celular);
  const total = grupos.reduce((s, g) => s + g.solicitudes.length, 0);

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg px-4 py-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Mis reportes</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            {total === 0 ? "Todavía no ha reportado nada." : `${total} ${total === 1 ? "reporte" : "reportes"} desde este celular.`}
          </p>
        </div>
        <Olvidarme />
      </header>

      {grupos.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          Cuando reporte algo escaneando un código, aparecerá aquí.
        </p>
      ) : (
        <div className="grid gap-6">
          {grupos.map((g) => (
            <section key={g.empresa}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{g.empresa}</h2>
              <ul className="grid gap-2">
                {g.solicitudes.map((s) => {
                  const cerrada = s.workOrder?.status === "COMPLETED" || s.workOrder?.status === "CLOSED";
                  const e = cerrada
                    ? { texto: "Atendido", clase: "bg-emerald-100 text-emerald-800", franja: "bg-emerald-500", icono: CheckCircle2 }
                    : ETIQUETA[s.status] ?? ETIQUETA.PENDING;
                  const Icono = e.icono;
                  const lugar = [s.asset ? `${s.asset.code} · ${s.asset.name}` : null, s.location?.name, s.site?.name]
                    .filter(Boolean).join(" — ");
                  const contenido = (
                    <>
                      <span className={`w-1.5 shrink-0 self-stretch rounded-l-lg ${e.franja}`} aria-hidden />
                      <div className="min-w-0 flex-1 py-3 pr-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${e.clase}`}>
                            <Icono className="h-3 w-3" /> {e.texto}
                          </span>
                          <span className="shrink-0 text-[0.6875rem] text-slate-400">{formatDate(s.createdAt)}</span>
                        </div>
                        <p className="mt-1.5 text-sm font-medium leading-snug text-slate-900">{s.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          <span className="font-mono">{s.number}</span>
                          {lugar ? ` · ${lugar}` : ""}
                        </p>
                      </div>
                    </>
                  );
                  return (
                    <li key={s.number}>
                      {s.publicToken ? (
                        <Link
                          href={`/solicitud/${s.publicToken}`}
                          className="flex items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white transition hover:border-slate-300"
                        >
                          {contenido}
                          <span className="grid shrink-0 place-items-center pr-2">
                            <ChevronRight className="h-4 w-4 text-slate-300" />
                          </span>
                        </Link>
                      ) : (
                        <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white">{contenido}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
