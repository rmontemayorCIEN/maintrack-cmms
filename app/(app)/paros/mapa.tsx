"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowUp, Loader2, Minus, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { PERIODOS, type ClavePeriodo } from "@/lib/costo-de-parar";
import { Latido, type Evento } from "./latido";
import { Croquis } from "./croquis";

type Equipo = {
  assetId: string; code: string; name: string;
  detieneLinea: boolean | null; horas: number; perdida: number;
};
type Area = {
  locationId: string | null; area: string; margenPorHora: number;
  planoX: number | null; planoY: number | null; planoAncho: number; planoAlto: number;
  horasQueDetienen: number; horasQueNoDetienen: number; horasPlaneadas: number;
  perdida: number; equipos: Equipo[];
};
type Analisis = {
  explicacion: string;
  loQueConecta: string | null;
  contraLoQueDijo: string | null;
  accion: { titulo: string; porque: string; quien: string };
  confianza: "ALTA" | "MEDIA" | "BAJA";
};

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
  horasQueDetienen, horasPlaneadas, cobertura, comoDecirlo, periodoTexto,
  eventos, desdeLinea, hastaLinea, ventana, puedeAcomodar, moneda,
}: {
  periodo: ClavePeriodo;
  areas: Area[];
  perdida: number;
  cambio: number | null;
  anterior: { perdida: number };
  horasQueDetienen: number;
  horasPlaneadas: number;
  /** «20 jun 2026 al 17 sep 2026 · America/Monterrey», del constructor central de periodos. */
  periodoTexto?: string;
  cobertura: { equiposConParo: number; equiposDefinidos: number; areasConParo: number; areasConTarifa: number; completa: boolean };
  comoDecirlo: { prefijo: string; falta: string | null };
  eventos: Evento[];
  desdeLinea: number;
  hastaLinea: number;
  ventana: { desde: number; hasta: number } | null;
  /** Solo un administrador acomoda el croquis; los demas lo miran. */
  puedeAcomodar: boolean;
  moneda: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [areaViendo, setAreaViendo] = useState<string | null>(areas[0]?.locationId ?? null);
  /** Equipos que el director quito para ver cuanto bajaria sin ellos. */
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());

  /**
   * La explicacion de la IA, por area.
   *
   * Se guarda por area y no una sola: quien pregunta por la nave y luego por
   * el patio no deberia perder la primera respuesta al volver. Y se limpia al
   * cambiar de periodo, porque una explicacion de otro trimestre pegada a
   * numeros nuevos es peor que no tener explicacion.
   */
  const [explicaciones, setExplicaciones] = useState<Record<string, Analisis>>({});
  const [preguntando, setPreguntando] = useState(false);
  const [errorIa, setErrorIa] = useState<string | null>(null);

  async function preguntarPorQue(locationId: string | null) {
    setPreguntando(true);
    setErrorIa(null);
    const res = await fetch("/api/ia/paros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, periodo, ...(ventana ?? {}) }),
    });
    const datos = await res.json().catch(() => ({}));
    setPreguntando(false);
    if (!res.ok) {
      // El motivo ya viene redactado para el usuario: se muestra tal cual.
      setErrorIa(datos.error ?? "No fue posible analizar");
      return;
    }
    setExplicaciones((e) => ({ ...e, [locationId ?? "__sin__"]: datos.analisis }));
  }

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

  function irA(q: URLSearchParams) {
    // Al cambiar lo que se esta viendo se borran las explicaciones: una
    // respuesta de otro tramo pegada a numeros nuevos confunde mas que ayudar.
    setExplicaciones({});
    setErrorIa(null);
    router.push(`/paros?${q.toString()}`);
  }

  function elegirVentana(v: { desde: number; hasta: number }) {
    const q = new URLSearchParams(params.toString());
    q.set("d", String(Math.round(v.desde)));
    q.set("h", String(Math.round(v.hasta)));
    irA(q);
  }

  function limpiarVentana() {
    const q = new URLSearchParams(params.toString());
    q.delete("d");
    q.delete("h");
    irA(q);
  }

  function cambiarPeriodo(p: ClavePeriodo) {
    const q = new URLSearchParams(params.toString());
    q.set("p", p);
    // Un periodo nuevo invalida la ventana: sus fechas pueden quedar fuera.
    q.delete("d");
    q.delete("h");
    // Todo lo que se ve vive en la URL: asi el director puede mandar el enlace
    // de lo que esta mirando, y volver a el es recargar y no reconstruir.
    irA(q);
  }

  const area = conParo.find((a) => a.locationId === areaViendo) ?? conParo[0];

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
              {horasQueDetienen} h de paro no planeado en equipos que detienen la producción, y{" "}
              {horasPlaneadas} h de mantenimiento planeado (todo paro planeado, de cualquier equipo; es la
              misma cifra que «Paro planeado» en Reportes) que no se cuentan como pérdida. El paro no
              planeado de equipos que no detienen la línea se muestra en cada área, sin costo.
              {periodoTexto ? <> Periodo: {periodoTexto}.</> : null}
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

      {/* ── El latido ────────────────────────────────────────────────── */}
      <Card>
        <Latido
          eventos={eventos}
          desde={desdeLinea}
          hasta={hastaLinea}
          moneda={moneda}
          ventana={ventana}
          onVentana={elegirVentana}
          onLimpiar={limpiarVentana}
        />
      </Card>

      {/* ── El mapa ──────────────────────────────────────────────────── */}
      <Card padded={false}>
        <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="p-4">
            {conParo.length ? (
              <Croquis
                areas={conParo.map((a) => ({
                  locationId: a.locationId,
                  area: a.area,
                  planoX: a.planoX,
                  planoY: a.planoY,
                  planoAncho: a.planoAncho,
                  planoAlto: a.planoAlto,
                  horasQueDetienen: a.horasQueDetienen,
                  perdida: a.perdida,
                }))}
                moneda={moneda}
                editable={puedeAcomodar}
                areaViendo={areaViendo}
                onVerArea={setAreaViendo}
              />
            ) : (
              <p className="rounded-lg bg-slate-50 p-4 text-xs leading-relaxed text-slate-500">
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

                {/* ── Lo que dice la IA de esta área ──────────────────── */}
                {(() => {
                  const clave = area.locationId ?? "__sin__";
                  const ia = explicaciones[clave];
                  if (ia) {
                    return (
                      <div className="grid gap-2 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-brand-700">
                            <Sparkles className="h-3.5 w-3.5" /> Por qué para esta área
                          </span>
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium ${
                              ia.confianza === "ALTA"
                                ? "bg-emerald-100 text-emerald-800"
                                : ia.confianza === "MEDIA"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-200 text-slate-600"
                            }`}
                            title="Qué tanto sostiene el texto de las órdenes esta conclusión"
                          >
                            confianza {ia.confianza.toLowerCase()}
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-slate-700">{ia.explicacion}</p>
                        {ia.loQueConecta ? (
                          <p className="text-xs leading-relaxed text-slate-700">
                            <strong className="font-semibold">Lo que conecta: </strong>
                            {ia.loQueConecta}
                          </p>
                        ) : null}
                        {/*
                          Lo que el dueno declaro contra lo que dicen los numeros.
                          Se destaca aparte porque cuando NO coinciden, ese es el
                          hallazgo mas valioso de toda la pantalla.
                        */}
                        {ia.contraLoQueDijo ? (
                          <p className="rounded-md bg-white/70 p-2 text-xs leading-relaxed text-slate-700">
                            <strong className="font-semibold">Contra lo que usted dijo: </strong>
                            {ia.contraLoQueDijo}
                          </p>
                        ) : null}
                        <div className="rounded-md border border-brand-200 bg-white p-2">
                          <p className="text-xs font-semibold text-slate-900">{ia.accion.titulo}</p>
                          <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-slate-600">
                            {ia.accion.porque}
                          </p>
                          <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-slate-600">
                            le toca a {ia.accion.quien.toLowerCase()}
                          </span>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="grid gap-1.5">
                      <button
                        type="button"
                        onClick={() => preguntarPorQue(area.locationId)}
                        disabled={preguntando}
                        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-700 transition hover:bg-brand-100 disabled:opacity-60"
                      >
                        {preguntando ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        {preguntando ? "Leyendo las órdenes…" : "¿Por qué para esta área?"}
                      </button>
                      {/* El motivo del rechazo ya viene redactado: se muestra tal cual. */}
                      {errorIa ? (
                        <p className="text-[0.6875rem] leading-relaxed text-amber-800">{errorIa}</p>
                      ) : null}
                    </div>
                  );
                })()}

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
