import Link from "next/link";
import { Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { buscar } from "@/lib/busqueda";
import { Badge, EmptyState } from "@/components/ui";
import { ASSET_STATUS_COLORS, ASSET_STATUS_LABELS, REQUEST_STATUS_COLORS, REQUEST_STATUS_LABELS, WO_STATUS_COLORS, WO_STATUS_LABELS } from "@/lib/constants";

export const metadata = { title: "Búsqueda" };
export const dynamic = "force-dynamic";

const ESTADOS: Record<string, { etiquetas: Record<string, string>; colores: Record<string, string> }> = {
  orden: { etiquetas: WO_STATUS_LABELS, colores: WO_STATUS_COLORS },
  activo: { etiquetas: ASSET_STATUS_LABELS, colores: ASSET_STATUS_COLORS },
  solicitud: { etiquetas: REQUEST_STATUS_LABELS, colores: REQUEST_STATUS_COLORS },
};

/**
 * Buscar. En el teléfono es su propia pantalla con el campo arriba y el
 * teclado listo; «atrás» regresa a donde se estaba. Lo que se encuentra
 * respeta la empresa y lo que el rol puede ver (lib/busqueda.ts).
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q = "" } = await searchParams;
  const grupos = q.trim() ? await buscar(user, q) : [];
  const total = grupos.reduce((s, g) => s + g.resultados.length, 0);

  return (
    <>
      <form action="/search" role="search" className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <label htmlFor="busqueda" className="sr-only">Buscar</label>
        <input
          id="busqueda" name="q" type="search" enterKeyHint="search" defaultValue={q} autoFocus={!q}
          placeholder="Folio, código de equipo, serie, refacción…"
          className="field con-icono"
          autoComplete="off"
        />
      </form>

      {!q.trim() ? (
        <EmptyState title="¿Qué busca?" description="Escriba un folio de OT, el código o nombre de un equipo, su número de serie o una refacción." />
      ) : total === 0 ? (
        <EmptyState title={`Nada para «${q}»`} description="Pruebe con parte del código o del nombre. No importan acentos ni mayúsculas." />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600" role="status">{total} {total === 1 ? "resultado" : "resultados"} para «{q}»</p>
          <div className="grid gap-4">
            {grupos.map((g) => (
              <section key={g.tipo} aria-labelledby={`g-${g.tipo}`}>
                <h2 id={`g-${g.tipo}`} className="mb-2 text-sm font-semibold text-slate-900">{g.etiqueta} ({g.resultados.length})</h2>
                <ul className="grid gap-2">
                  {g.resultados.map((r) => {
                    const est = r.estado && ESTADOS[r.tipo];
                    return (
                      <li key={r.id}>
                        <Link href={r.enlace} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 hover:border-brand-300 hover:bg-brand-50/40">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-medium text-slate-800">{r.titulo}</p>
                            <p className="break-words text-xs text-slate-500">{r.contexto}</p>
                          </div>
                          {est ? <Badge className={est.colores[r.estado!]}>{est.etiquetas[r.estado!] ?? r.estado}</Badge> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
