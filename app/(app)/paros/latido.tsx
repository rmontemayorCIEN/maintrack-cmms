"use client";

import { useZona } from "@/components/zona-empresa";
import { useMemo, useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export type Evento = {
  id: string; inicio: number; minutos: number; planeado: boolean;
  assetId: string; code: string; name: string; area: string;
  locationId: string | null; detieneLinea: boolean | null;
  perdida: number; folio: string | null; queSeHizo: string | null;
};

/**
 * El latido de la planta: cada paro, en su lugar del tiempo.
 *
 * Una barra mensual destruye lo que hace falta ver. "45 horas en julio" no
 * dice si fue un paro largo o doce cortos, y esa diferencia ES el
 * diagnostico: un equipo que para cada tres semanas tiene un patron; uno que
 * paro dos veces tuvo dos accidentes. Se atienden distinto y cuestan distinto.
 *
 * Se arrastra el dedo —o el raton— sobre la linea para escoger cualquier
 * ventana, no solo las de los botones. Y lo que se escoge se le puede
 * preguntar a la IA: es la unica forma de que el director interrogue un
 * pedazo de su historia que el mismo delimito.
 *
 * Funciona igual con dedo y con raton: los eventos de puntero unifican los
 * dos, en vez de escribir dos caminos que se desincronizan.
 */
export function Latido({
  eventos,
  desde,
  hasta,
  moneda,
  onVentana,
  onLimpiar,
  ventana,
}: {
  eventos: Evento[];
  desde: number;
  hasta: number;
  moneda: string;
  /** Se avisa al soltar, no durante el arrastre: recalcular en cada pixel se siente lento. */
  onVentana: (v: { desde: number; hasta: number }) => void;
  onLimpiar: () => void;
  ventana: { desde: number; hasta: number } | null;
}) {
  const zona = useZona();
  const pista = useRef<HTMLDivElement>(null);
  const [arrastre, setArrastre] = useState<{ a: number; b: number } | null>(null);
  const [tocado, setTocado] = useState<Evento | null>(null);

  const largo = Math.max(hasta - desde, 1);
  const pct = (t: number) => ((t - desde) / largo) * 100;

  /**
   * Una fila por equipo, ordenadas por lo que costaron.
   *
   * Los que no cuestan van al final pero SI se muestran: ver que el extractor
   * de humos paro cuatro veces sin costar produccion es informacion, y
   * esconderlo daria la impresion de que ese equipo no falla.
   */
  const filas = useMemo(() => {
    const porEquipo = new Map<string, { code: string; name: string; perdida: number; eventos: Evento[] }>();
    for (const e of eventos) {
      const f = porEquipo.get(e.assetId) ?? { code: e.code, name: e.name, perdida: 0, eventos: [] };
      f.perdida += e.perdida;
      f.eventos.push(e);
      porEquipo.set(e.assetId, f);
    }
    return [...porEquipo.entries()]
      .map(([assetId, f]) => ({ assetId, ...f }))
      .sort((a, b) => b.perdida - a.perdida || b.eventos.length - a.eventos.length);
  }, [eventos]);

  /**
   * El paro mas largo, para escalar las alturas.
   *
   * La duracion iba en el ANCHO y no se leia: en una ventana de 90 dias, un
   * paro de 17 horas mide 0.8% y el ancho minimo se lo come. Todas las marcas
   * salian igual de delgadas y la duracion —que es la mitad del diagnostico—
   * se perdia.
   *
   * En la altura si se lee: la posicion dice CUANDO, la altura CUANTO y el
   * color QUE FUE. Las tres de un vistazo, como un sismografo.
   */
  const masLargo = useMemo(
    () => Math.max(...eventos.map((e) => e.minutos), 60),
    [eventos],
  );

  function posicionEn(clientX: number): number {
    const caja = pista.current?.getBoundingClientRect();
    if (!caja) return desde;
    const p = Math.min(Math.max((clientX - caja.left) / caja.width, 0), 1);
    return desde + p * largo;
  }

  function alBajar(e: React.PointerEvent) {
    // Solo el arrastre sobre la pista, no sobre una marca que se quiere tocar.
    if ((e.target as HTMLElement).closest("[data-marca]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = posicionEn(e.clientX);
    setArrastre({ a: t, b: t });
  }

  function alMover(e: React.PointerEvent) {
    if (!arrastre) return;
    setArrastre({ ...arrastre, b: posicionEn(e.clientX) });
  }

  function alSoltar() {
    if (!arrastre) return;
    const a = Math.min(arrastre.a, arrastre.b);
    const b = Math.max(arrastre.a, arrastre.b);
    setArrastre(null);
    // Un arrastre de menos de un dia casi siempre es un toque fallido, no una
    // seleccion: aplicarlo dejaria la pantalla en blanco sin que se entienda.
    if (b - a < 86_400_000) return;
    onVentana({ desde: a, hasta: b });
  }

  const sel = arrastre
    ? { a: Math.min(arrastre.a, arrastre.b), b: Math.max(arrastre.a, arrastre.b) }
    : ventana
      ? { a: ventana.desde, b: ventana.hasta }
      : null;

  const fecha = (t: number) =>
    new Date(t).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "2-digit", timeZone: zona });

  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">El latido de la planta</h2>
          <p className="text-[0.6875rem] leading-relaxed text-slate-500">
            Cada marca es un paro: dónde está dice cuándo, qué tan alta dice cuánto duró.
            Arrastre sobre la línea de arriba para escoger cualquier tramo, o toque una
            marca para ver qué pasó.
          </p>
        </div>
        {ventana ? (
          <button
            type="button"
            onClick={onLimpiar}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] text-slate-600 hover:bg-slate-50"
          >
            <RotateCcw className="h-3 w-3" /> Todo el periodo
          </button>
        ) : null}
      </div>

      <div className="grid gap-1 overflow-x-auto">
        <div className="grid" style={{ gridTemplateColumns: "minmax(96px, 132px) minmax(280px, 1fr)" }}>
          <span />
          <div
            ref={pista}
            onPointerDown={alBajar}
            onPointerMove={alMover}
            onPointerUp={alSoltar}
            onPointerCancel={() => setArrastre(null)}
            className="relative select-none rounded-md bg-slate-50"
            // touch-action: sin esto el navegador se lleva el gesto para desplazar
            // la pagina y el arrastre nunca ocurre en el telefono.
            style={{ touchAction: "none", cursor: "crosshair", minHeight: 18 }}
          >
            {sel ? (
              <div
                className="pointer-events-none absolute inset-y-0 rounded-sm bg-brand-500/20 ring-1 ring-brand-500/50"
                style={{ left: `${pct(sel.a)}%`, width: `${pct(sel.b) - pct(sel.a)}%` }}
              />
            ) : null}
            <div className="flex justify-between px-1 py-0.5 text-[0.625rem] text-slate-400">
              <span>{fecha(desde)}</span>
              {sel ? (
                <span className="font-medium text-brand-700">
                  {fecha(sel.a)} — {fecha(sel.b)}
                </span>
              ) : null}
              {/* `hasta` es la medianoche que ABRE el dia siguiente (periodo
                  semiabierto): se rotula el ultimo dia que si incluye. */}
              <span>{fecha(hasta - 1)}</span>
            </div>
          </div>
        </div>

        {filas.map((f) => (
          <div
            key={f.assetId}
            className="grid items-center"
            style={{ gridTemplateColumns: "minmax(96px, 132px) minmax(280px, 1fr)" }}
          >
            <div className="min-w-0 pr-2">
              <p className="truncate font-mono text-[0.6875rem] font-medium text-slate-700">{f.code}</p>
              <p className="truncate text-[0.625rem] text-slate-400">
                {f.eventos.length} paro{f.eventos.length === 1 ? "" : "s"}
                {f.perdida > 0 ? ` · ${formatCurrency(f.perdida, moneda)}` : ""}
              </p>
            </div>
            <div className="relative h-8 rounded-md bg-slate-50">
              {sel ? (
                <div
                  className="pointer-events-none absolute inset-y-0 bg-brand-500/10"
                  style={{ left: `${pct(sel.a)}%`, width: `${pct(sel.b) - pct(sel.a)}%` }}
                />
              ) : null}
              {f.eventos.map((e) => {
                // Piso del 22%: una marca de media hora tiene que verse y poder
                // tocarse, aunque al lado haya una de veinte horas.
                const alto = Math.max((e.minutos / masLargo) * 100, 22);
                return (
                  <button
                    key={e.id}
                    type="button"
                    data-marca
                    onClick={() => setTocado(e)}
                    title={`${fecha(e.inicio)} · ${Math.round((e.minutos / 60) * 10) / 10} h${e.planeado ? " · planeado" : ""}`}
                    aria-label={`Paro de ${f.code} el ${fecha(e.inicio)}, ${Math.round((e.minutos / 60) * 10) / 10} horas`}
                    className={`absolute bottom-0.5 w-[5px] rounded-[2px] transition hover:brightness-110 ${
                      e.planeado
                        ? "bg-sky-600/70"
                        : e.detieneLinea === true
                          ? "bg-orange-600"
                          : "bg-slate-300"
                    } ${tocado?.id === e.id ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                    style={{ left: `calc(${pct(e.inicio)}% - 2px)`, height: `${alto}%` }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.625rem] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-3 w-[5px] rounded-[2px] bg-orange-600" /> detuvo producción
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-3 w-[5px] rounded-[2px] bg-sky-600/70" /> mantenimiento planeado
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-3 w-[5px] rounded-[2px] bg-slate-300" /> paró, pero no detuvo producción
        </span>
      </div>

      {tocado ? (
        <div className="grid gap-1 rounded-lg border border-slate-200 bg-white p-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-slate-900">
              <span className="font-mono text-brand-600">{tocado.code}</span> · {tocado.name}
            </p>
            <button
              type="button"
              onClick={() => setTocado(null)}
              aria-label="Cerrar"
              className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-[0.6875rem] text-slate-600">
            {fecha(tocado.inicio)} · {Math.round((tocado.minutos / 60) * 10) / 10} h ·{" "}
            {tocado.planeado
              ? "mantenimiento planeado"
              : tocado.detieneLinea === true
                ? `detuvo la producción · ${formatCurrency(tocado.perdida, moneda)}`
                : "no detuvo la producción"}
            {tocado.folio ? ` · ${tocado.folio}` : ""}
          </p>
          {tocado.queSeHizo ? (
            <p className="text-[0.6875rem] leading-relaxed text-slate-600">
              <strong className="font-semibold">Se hizo: </strong>
              {tocado.queSeHizo}
            </p>
          ) : (
            <p className="text-[0.6875rem] italic text-slate-400">
              La orden se cerró sin decir qué se hizo. Eso es lo que le quita fuerza al
              análisis después.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
