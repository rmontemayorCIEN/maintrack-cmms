"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowUp, Minus, RotateCcw, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { PERIODOS, type ClavePeriodo } from "@/lib/costo-de-parar";

type Equipo = {
  assetId: string; code: string; name: string;
  detieneLinea: boolean | null; horas: number; perdida: number;
};
type Area = {
  locationId: string | null; area: string; margenPorHora: number;
  horasQueDetienen: number; horasQueNoDetienen: number; horasPlaneadas: number;
  perdida: number; equipos: Equipo[];
};
type Mes = { clave: string; etiqueta: string; horas: number; perdida: number };

/**
 * Donde para la planta, visto desde la direccion.
 *
 * El tamano de cada bloque ES el dano: si un area concentra tres cuartas
 * partes de las horas perdidas, ocupa tres cuartas partes del mapa. Una
 * rejilla de bloques iguales no diria nada que la tabla de abajo no diga.
 *
 * Tres cosas que se pueden mover, y ninguna es un panel de filtros:
 *
 *   - El periodo, contra el anterior del MISMO largo. Un numero solo es
 *     inerte: "$332,920" no dice si va bien. "40% mas que antes" si.
 *   - La franja de meses, para ver la tendencia y meterse al mes raro.
 *   - El "¿y si...?": quitar un equipo y ver cuanto baja el total. Eso da un
 *     numero que se lleva a una decision —cuanto vale resolverlo de raiz—.
 */
export function MapaDeParos({
  periodo, areas, perdida, cambio, anterior,
  horasQueDetienen, horasPlaneadas, cobertura, comoDecirlo, serie, moneda,
}: {
  periodo: ClavePeriodo;
  areas: Area[];
  perdida: number;
  cambio: number | null;
  anterior: { perdida: number };
  horasQueDetienen: number;
  horasPlaneadas: number;
  cobertura: { equiposConParo: number; equiposDefinidos: number; areasConParo: number; areasConTarifa: number; completa: boolean };
  comoDecirlo: { prefijo: string; falta: string | null };
  serie: Mes[];
  moneda: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [areaViendo, setAreaViendo] = useState<string | null>(areas[0]?.locationId ?? null);
  /** Equipos que el director quito para ver cuanto bajaria sin ellos. */
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());

  const conParo = areas.filter((a) => a.horasQueDetienen > 0);
  const totalHoras = conParo.reduce((s, a) => s + a.horasQueDetienen, 0);

  /**
   * El "¿y si...?" se recalcula aqui y no en el servidor.
   *
   * Los datos por equipo ya viajaron: quitar uno es aritmetica. Ir al servidor
   * por cada clic haria lento justo el gesto que se siente poderoso.
   */
  const simulado = useMemo(() => {
    if (!excluidos.size) return null;
    const quitado = areas.flatMap((a) => a.equipos).filter((e) => excluidos.has(e.assetId));
    const ahorro = quitado.reduce((s, e) => s + e.perdida, 0);
    const horas = quitado.reduce((s, e) => s + (e.detieneLinea ? e.horas : 0), 0);
    return {
      perdida: perdida - ahorro,
      ahorro,
      horas: Math.round(horas * 10) / 10,
      equipos: quitado,
    };
  }, [excluidos, areas, perdida]);

  function cambiarPeriodo(p: ClavePeriodo) {
    const q = new URLSearchParams(params.toString());
    q.set("p", p);
    // El periodo vive en la URL: asi el director puede mandar el enlace de lo
    // que esta viendo, y volver a el es recargar y no reconstruir.
    router.push(`/paros?${q.toString()}`);
  }

  const area = conParo.find((a) => a.locationId === areaViendo) ?? conParo[0];
  const maxMes = Math.max(...serie.map((m) => m.horas), 1);

  return (
    <div className="grid gap-4">
      {/* ── El periodo ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(PERIODOS) as ClavePeriodo[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => cambiarPeriodo(p)}
            aria-pressed={p === periodo}
            className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
              p === periodo
                ? "border-slate-900 bg-slate-900 font-medium text-white"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {PERIODOS[p].etiqueta}
          </button>
        ))}
      </div>

      {/* ── El veredicto ─────────────────────────────────────────────── */}
      <Card>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-center">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Lo que costó que la planta se detuviera
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="text-3xl font-semibold tabular-nums text-slate-900">
                {comoDecirlo.prefijo}
                {formatCurrency(simulado ? simulado.perdida : perdida, moneda)}
              </span>
              <Flecha cambio={cambio} />
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              {horasQueDetienen} horas que detuvieron producción, y {horasPlaneadas} h de
              mantenimiento planeado que no se cuentan como pérdida.
              {cambio !== null ? (
                <> El periodo anterior fueron {formatCurrency(anterior.perdida, moneda)}.</>
              ) : null}
            </p>
          </div>

          {!cobertura.completa && comoDecirlo.falta ? (
            <div className="flex gap-2 rounded-lg bg-amber-50 p-2.5">
              <TriangleAlert className="mt-px h-4 w-4 shrink-0 text-amber-700" />
              <p className="text-[0.6875rem] leading-relaxed text-amber-900">
                Es un piso, no el total: falta {comoDecirlo.falta}. Se completa en{" "}
                <Link href="/assets" className="font-medium underline underline-offset-2">
                  Activos
                </Link>{" "}
                y en{" "}
                <Link href="/catalogs?c=locations" className="font-medium underline underline-offset-2">
                  Ubicaciones
                </Link>
                .
              </p>
            </div>
          ) : null}
        </div>
      </Card>

      {/* ── La franja de meses ───────────────────────────────────────── */}
      <Card>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Cómo ha venido</h2>
            <p className="text-[0.6875rem] text-slate-500">
              Horas que detuvieron producción, mes a mes
            </p>
          </div>
          <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: 96 }}>
            {serie.map((m) => (
              <div key={m.clave} className="flex min-w-8 flex-1 flex-col items-center gap-1">
                <span className="text-[0.625rem] tabular-nums text-slate-500">
                  {m.horas > 0 ? m.horas : ""}
                </span>
                <div
                  className={`w-full rounded-t ${m.horas > 0 ? "bg-orange-400" : "bg-slate-100"}`}
                  style={{ height: `${Math.max((m.horas / maxMes) * 56, m.horas > 0 ? 4 : 2)}px` }}
                  title={`${m.etiqueta}: ${m.horas} h · ${formatCurrency(m.perdida, moneda)}`}
                />
                <span className="text-[0.625rem] text-slate-400">{m.etiqueta}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── El mapa ──────────────────────────────────────────────────── */}
      <Card padded={false}>
        <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="grid gap-3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">El mapa de la planta</h2>
              <p className="text-[0.6875rem] text-slate-500">
                El tamaño es el daño. Toque un área.
              </p>
            </div>

            {/*
              El ancho de cada bloque va en porcentaje pero con un minimo en
              pixeles: con un area muy chica el bloque quedaba tan angosto que
              el nombre se partia a media palabra —"Almacé y patio"—. Si ya no
              caben, la fila se desliza; deformar las proporciones para que
              quepan seria mentir sobre el tamano del dano, que es justo lo que
              este mapa dice.
            */}
            {conParo.length ? (
              <div className="flex gap-1 overflow-x-auto" style={{ height: 260 }}>
                {conParo.map((a) => (
                  <button
                    key={a.locationId ?? a.area}
                    type="button"
                    onClick={() => setAreaViendo(a.locationId)}
                    aria-pressed={a.locationId === area?.locationId}
                    style={{
                      flex: `1 1 ${(a.horasQueDetienen / totalHoras) * 100}%`,
                      minWidth: 108,
                      background: tono(a.horasQueDetienen, totalHoras),
                    }}
                    className={`flex flex-col justify-between overflow-hidden rounded-lg p-2.5 text-left outline-offset-[-2px] transition hover:brightness-105 ${
                      a.locationId === area?.locationId ? "outline outline-2 outline-slate-900" : ""
                    }`}
                  >
                    <span
                      className="text-[0.8125rem] font-semibold leading-tight text-white drop-shadow-sm"
                      style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                    >
                      {a.area}
                    </span>
                    <span>
                      <span className="block text-2xl font-semibold leading-none tabular-nums text-white drop-shadow-sm">
                        {a.horasQueDetienen}
                        <span className="text-sm font-medium opacity-85"> h</span>
                      </span>
                      <span className="mt-0.5 block text-[0.6875rem] text-white/90">
                        {a.perdida > 0 ? formatCurrency(a.perdida, moneda) : "sin tarifa"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">
                En este periodo ningún equipo marcado como que detiene la producción registró
                paro. Si eso no le cuadra, revise que el paro se esté capturando al cerrar las
                órdenes.
              </p>
            )}
          </div>

          {/* ── El panel del área, con el "¿y si...?" ─────────────────── */}
          <div className="border-t border-slate-200 p-4 lg:border-l lg:border-t-0">
            {area ? (
              <div className="grid gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{area.area}</h3>
                  <p className="text-[0.6875rem] text-slate-500">
                    {area.margenPorHora > 0
                      ? `${formatCurrency(area.margenPorHora, moneda)} por hora detenida`
                      : "Sin tarifa capturada"}
                    {area.horasQueNoDetienen > 0
                      ? ` · ${area.horasQueNoDetienen} h de equipos que no detienen`
                      : ""}
                  </p>
                </div>

                <ul className="grid gap-0">
                  {area.equipos.map((e) => {
                    const fuera = excluidos.has(e.assetId);
                    const cuenta = e.detieneLinea === true;
                    return (
                      <li
                        key={e.assetId}
                        className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 border-t border-slate-100 py-2 first:border-t-0"
                      >
                        <div className="min-w-0">
                          <p className={`truncate text-xs font-medium ${fuera ? "text-slate-400 line-through" : "text-slate-800"}`}>
                            <span className="font-mono text-[0.6875rem] text-brand-600">{e.code}</span>{" "}
                            {e.name}
                          </p>
                          <p className="text-[0.6875rem] text-slate-500">
                            {e.horas} h
                            {!cuenta ? (
                              <span className="ml-1 text-slate-400">
                                · {e.detieneLinea === false ? "no detiene" : "sin definir"}
                              </span>
                            ) : null}
                          </p>
                        </div>
                        {cuenta ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExcluidos((s) => {
                                const n = new Set(s);
                                if (n.has(e.assetId)) n.delete(e.assetId);
                                else n.add(e.assetId);
                                return n;
                              })
                            }
                            title={fuera ? "Volver a contarlo" : "Ver cuánto bajaría sin este equipo"}
                            className={`shrink-0 rounded-lg border px-2 py-1 text-[0.6875rem] tabular-nums transition ${
                              fuera
                                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            {fuera ? "sin él" : formatCurrency(e.perdida, moneda)}
                          </button>
                        ) : (
                          <span className="shrink-0 text-[0.6875rem] text-slate-400">—</span>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {simulado ? (
                  <div className="grid gap-2 rounded-lg bg-emerald-50 p-2.5">
                    <p className="text-[0.6875rem] leading-relaxed text-emerald-900">
                      Sin {simulado.equipos.map((e) => e.code).join(", ")}, la pérdida del
                      periodo baja a{" "}
                      <strong className="tabular-nums">
                        {formatCurrency(simulado.perdida, moneda)}
                      </strong>
                      . Son <strong className="tabular-nums">{formatCurrency(simulado.ahorro, moneda)}</strong>{" "}
                      y {simulado.horas} horas.
                    </p>
                    <p className="text-[0.625rem] leading-relaxed text-emerald-800/80">
                      Eso es lo que valdría resolverlo de raíz en este periodo. No es una
                      promesa: es la cuenta de lo que ya pasó, sin ese equipo.
                    </p>
                    <button
                      type="button"
                      onClick={() => setExcluidos(new Set())}
                      className="inline-flex w-fit items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 py-1 text-[0.6875rem] text-emerald-800 hover:bg-emerald-50"
                    >
                      <RotateCcw className="h-3 w-3" /> Volver a contarlos todos
                    </button>
                  </div>
                ) : (
                  <p className="text-[0.6875rem] leading-relaxed text-slate-500">
                    Toque el monto de un equipo para ver cuánto bajaría la pérdida sin él.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

/** La rampa de calor. Un area que concentra el dano se ve caliente. */
function tono(horas: number, total: number): string {
  const p = total > 0 ? horas / total : 0;
  if (p >= 0.5) return "#9e2f12";
  if (p >= 0.25) return "#c4522a";
  if (p >= 0.1) return "#d9622c";
  return "#e08b4f";
}

/**
 * La flecha del cambio.
 *
 * Aqui subir es MALO: mas perdida. Se pinta al reves de lo habitual a
 * proposito, porque lo que el director lee de un vistazo es el color, no la
 * direccion.
 */
function Flecha({ cambio }: { cambio: number | null }) {
  if (cambio === null) {
    return (
      <span className="text-xs text-slate-500">sin periodo anterior con qué comparar</span>
    );
  }
  if (cambio === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
        <Minus className="h-3 w-3" /> igual que antes
      </span>
    );
  }
  const peor = cambio > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
        peor ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
      }`}
    >
      {peor ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(cambio)}% {peor ? "más" : "menos"} que el periodo anterior
    </span>
  );
}

export { formatNumber };
