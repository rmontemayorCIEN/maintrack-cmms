"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Sparkles, X } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { CATEGORIAS_GLOSARIO, type TerminoGlosario } from "@/lib/glosario";
import { cn } from "@/lib/utils";
import { AyudaConIa } from "@/components/shell/ayuda-ia";
import { SIN_CIFRA, type CifraDeTermino } from "@/lib/glosario-cifras";
import { formatNumber } from "@/lib/utils";

/** Quita acentos para que "operacion" encuentre "Operación" y viceversa. */
const normalizar = (x: string) =>
  x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Lo que se le puede preguntar a cualquiera de los 82 terminos.
 *
 * Sirven para los 82 a proposito. «¿Como va el mio?» funciona para el MTBF y
 * no para el kardex; estas tres funcionan para todos, y son las que de verdad
 * convierten un diccionario en algo util: que significa ESTO en MI planta,
 * donde lo veo, y que hago con ello.
 */
const PREGUNTAS = [
  "¿Qué significa esto en mi planta?",
  "¿Dónde lo veo en el sistema?",
  "¿Qué debería hacer con esto?",
];

export function VistaGlosario({
  terminos, conIa, cifras, periodo,
}: {
  terminos: TerminoGlosario[];
  conIa: boolean;
  /** La cifra de la propia empresa, para los términos que tienen una. */
  cifras: Record<string, CifraDeTermino>;
  /** El periodo del que salen esas cifras. Sin él, un número no dice nada. */
  periodo: string | null;
}) {
  /**
   * Solo un termino abierto a la vez.
   *
   * Poner la caja de preguntar en las 82 tarjetas convertiria el glosario en
   * un muro de formularios. Se abre donde se toca.
   */
  const [abierto, setAbierto] = useState<string | null>(null);
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
            className="field con-icono"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar termino o definición…"
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
          description="Pruebe con otra palabra o quite el filtro de categoría."
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

                    <SuCifra termino={t.t} cifra={cifras[t.t]} periodo={periodo} />

                    {/* La definición es la misma para todos; lo que sigue es
                        lo único que ningún diccionario puede dar: qué
                        significa esto con SUS datos. */}
                    {conIa ? (
                      abierto === t.t ? (
                        <AyudaConIa
                          pantalla="/glossary"
                          termino={t.t}
                          sugerencias={PREGUNTAS}
                          compacto
                          titulo={`«${t.t}» en su planta`}
                          explica="Amplía la definición con sus propios datos: cómo va el suyo, dónde se ve y qué hacer con él. Si el sistema no calcula ese número, lo dice."
                          marcador={`¿…sobre ${t.t}?`}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAbierto(t.t)}
                          className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-400 hover:bg-brand-50"
                        >
                          <Sparkles className="h-3.5 w-3.5" aria-hidden />
                          Qué significa en mi planta
                        </button>
                      )
                    ) : null}
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

/**
 * La cifra de la empresa para este termino, si la hay.
 *
 * Tres estados, y los tres dicen algo:
 *
 *   Hay cifra      -> el numero, su periodo y el calculo con sus propios
 *                     datos. El calculo no es adorno: es lo que hace que
 *                     alguien le crea al numero sin ir a verificarlo.
 *   Hay indicador
 *   pero sin dato  -> el motivo que da el propio calculo —«sin fallas en el
 *                     periodo»—, no un cero, que se leeria como un resultado.
 *   No se calcula  -> se dice, y se dice que haria falta. Es el caso del OEE,
 *                     y callarlo dejaria a alguien buscando en Reportes un
 *                     numero que no existe.
 *
 * Cuando el termino no es un indicador —«kardex», «criticidad»— no se enseña
 * nada: ahi la definicion se basta.
 */
function SuCifra({
  termino, cifra, periodo,
}: {
  termino: string;
  cifra?: CifraDeTermino;
  periodo: string | null;
}) {
  const noSeCalcula = SIN_CIFRA[termino];

  if (!cifra && !noSeCalcula) return null;

  if (noSeCalcula) {
    return (
      <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
        <p className="text-[0.6875rem] font-medium text-amber-900">Este no se calcula en MainTrack</p>
        <p className="mt-0.5 text-[0.6875rem] leading-snug text-amber-800">{noSeCalcula}</p>
      </div>
    );
  }

  if (cifra!.valor === null) {
    return (
      <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-[0.6875rem] text-slate-600">
          <span className="font-medium">Su cifra:</span> {cifra!.sinValor ?? "no se pudo calcular en este periodo."}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2.5 rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.6875rem] font-medium text-slate-600">Su cifra</span>
        <span className="text-sm font-semibold tabular-nums text-brand-800">
          {formatNumber(cifra!.valor, cifra!.unidad === "%" ? 1 : cifra!.unidad === "ordenes" ? 0 : 1)}
          {cifra!.unidad === "%" ? "%" : cifra!.unidad === "ordenes" ? "" : ` ${cifra!.unidad}`}
        </span>
      </div>
      {periodo ? <p className="mt-0.5 text-[0.625rem] text-slate-500">{periodo}</p> : null}
      {/* El cálculo con sus propios números: es lo que separa un dato de una
          afirmación. El mismo que abre cada tarjeta en Reportes. */}
      <p className="mt-1 border-t border-brand-200/60 pt-1 text-[0.625rem] leading-snug text-slate-500">
        {cifra!.calculo}
      </p>
    </div>
  );
}
