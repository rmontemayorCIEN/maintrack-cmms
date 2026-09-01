"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { CATEGORIAS_GLOSARIO, type TerminoGlosario } from "@/lib/glosario";
import { cn } from "@/lib/utils";

/** Quita acentos para que "operacion" encuentre "Operación" y viceversa. */
const normalizar = (x: string) =>
  x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function VistaGlosario({ terminos }: { terminos: TerminoGlosario[] }) {
  const params = useSearchParams();
  // Al llegar desde un popup con ?q=MTTR, la busqueda viene precargada.
  const [busqueda, setBusqueda] = useState(params.get("q") ?? "");
  const [categoria, setCategoria] = useState<string>("Todas");

  const filtrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return terminos.filter((t) => {
      if (categoria !== "Todas" && t.c !== categoria) return false;
      if (!q) return true;
      return (
        normalizar(t.t).includes(q) ||
        normalizar(t.n ?? "").includes(q) ||
        normalizar(t.d).includes(q)
      );
    });
  }, [terminos, busqueda, categoria]);

  const porCategoria = useMemo(() => {
    const mapa = new Map<string, TerminoGlosario[]>();
    for (const t of filtrados) {
      if (!mapa.has(t.c)) mapa.set(t.c, []);
      mapa.get(t.c)!.push(t);
    }
    return [...mapa.entries()];
  }, [filtrados]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="field pl-9"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar termino o definicion…"
            autoComplete="off"
          />
          {busqueda ? (
            <button
              type="button"
              onClick={() => setBusqueda("")}
              aria-label="Limpiar"
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CATEGORIAS_GLOSARIO.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategoria(c)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                categoria === c
                  ? "border-brand-300 bg-brand-50 text-brand-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-slate-500">
          {filtrados.length} de {terminos.length}
        </span>
      </div>

      {filtrados.length === 0 ? (
        <EmptyState
          title="Sin coincidencias"
          description="Pruebe con otra palabra o quite el filtro de categoria."
        />
      ) : (
        <div className="grid gap-6">
          {porCategoria.map(([cat, items]) => (
            <section key={cat}>
              <h2 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">
                {cat}
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {items.map((t) => (
                  <Card key={t.t} id={`t-${t.t}`}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h3 className="text-sm font-semibold text-slate-900">{t.t}</h3>
                      {t.n ? <span className="text-xs text-slate-500">{t.n}</span> : null}
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{t.d}</p>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
