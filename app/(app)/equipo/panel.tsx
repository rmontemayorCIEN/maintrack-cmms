"use client";

import { useZona } from "@/components/zona-empresa";
import { useState } from "react";
import { AlertTriangle, Loader2, Sparkles, ThumbsUp, X } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { MAINTENANCE_TYPE_LABELS } from "@/lib/constants";
import { cn, diaDeCalendario } from "@/lib/utils";

type Persona = {
  id: string; nombre: string; color: string; rol: string; puesto: string | null;
  capacidadDiaria: number;
  asignado: { ordenes: number; horas: number; vencidas: number; horasVencidas: number; criticas: number };
  aplicado: { horas: number; costo: number; porTipo: Record<string, number>; porcentajeCorrectivo: number | null };
  estimacion: { ordenes: number; estimadas: number; reales: number; desviacion: number | null };
  puntualidad: { ordenes: number; aTiempo: number; porcentaje: number | null };
  actividades: { completadas: number; liberadas: number; porMotivo: Record<string, number>; porFaltaDeMaterial: number };
  equipos: { code: string; name: string; horas: number }[];
  proximos: { fecha: string; habil: boolean; horas: number; capacidad: number; excedido: boolean }[];
  diasExcedidos: number;
};

type Datos = {
  rango: { desde: string; hasta: string };
  jornadaBase: number;
  personas: Persona[];
  sinResponsable: { ordenes: number; horas: number };
  motivos: Record<string, string>;
};

type Hallazgo = {
  tema: string; titulo: string; detalle: string; personas: string[]; queHacer: string;
};

const TEMAS: Record<string, string> = {
  CARGA_DESBALANCEADA: "Reparto de la carga",
  CONOCIMIENTO_CONCENTRADO: "Conocimiento concentrado",
  ESTIMACIONES_FUERA: "Estimaciones",
  APAGANDO_INCENDIOS: "Correctivo excesivo",
  TRABA_EXTERNA: "Traba que no es del equipo",
  OTRO: "Otro",
};

export function PanelEquipo({ datos, veTodo, conIa }: { datos: Datos; veTodo: boolean; conIa: boolean }) {
  const zona = useZona();
  const [analizando, setAnalizando] = useState(false);
  const [revision, setRevision] = useState<{ resumen: string; hallazgos: Hallazgo[]; reconocer: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  async function revisar() {
    setAnalizando(true); setError(null); setRevision(null);
    const res = await fetch("/api/ia/equipo", { method: "POST" });
    const cuerpo = await res.json().catch(() => null);
    setAnalizando(false);
    if (!res.ok) { setError(cuerpo?.error ?? "No fue posible revisar."); return; }
    setRevision(cuerpo.revision);
  }

  const fmt = (d: string) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(diaDeCalendario(d, zona));

  return (
    <div className="grid gap-4">
      {veTodo && datos.sinResponsable.ordenes > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mr-1 inline h-4 w-4" />
          <b>{datos.sinResponsable.ordenes} orden(es) sin responsable</b> — {datos.sinResponsable.horas} h de
          trabajo que no es de nadie, y por eso se pierde de vista.
        </div>
      ) : null}

      {conIa ? (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-xl">
              <p className="text-sm font-semibold text-slate-800">Revisar al equipo con IA</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Lee cómo está repartido el trabajo y señala lo que un número no dice. No califica a
                nadie: busca qué de la operación explica los datos.
              </p>
            </div>
            <Button onClick={revisar} disabled={analizando}>
              {analizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {analizando ? "Revisando…" : "Revisar al equipo"}
            </Button>
          </div>

          {error ? <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}

          {revision ? (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-slate-700">{revision.resumen}</p>
                <button type="button" onClick={() => setRevision(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {revision.hallazgos.length === 0 ? (
                <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  No señala nada que corregir.
                </p>
              ) : (
                <ul className="mt-3 grid gap-2">
                  {revision.hallazgos.map((h, i) => (
                    <li key={i} className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={h.tema === "TRABA_EXTERNA" ? "info" : "warning"}>
                          {TEMAS[h.tema] ?? h.tema}
                        </Badge>
                        <p className="text-sm font-medium text-slate-800">{h.titulo}</p>
                        {h.personas.map((n) => (
                          <span key={n} className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.6875rem] text-slate-600">{n}</span>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{h.detalle}</p>
                      <p className="mt-1.5 text-xs text-slate-800">
                        <span className="font-medium">Qué hacer: </span>{h.queHacer}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {revision.reconocer ? (
                <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  <ThumbsUp className="mr-1 inline h-3.5 w-3.5" />
                  {revision.reconocer}
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      {datos.personas.map((p) => {
        const desplegada = abierta === p.id;
        const maxHoras = Math.max(...p.proximos.map((d) => Math.max(d.horas, d.capacidad)), 1);
        return (
          <Card key={p.id}>
            <button
              type="button"
              onClick={() => setAbierta(desplegada ? null : p.id)}
              className="flex w-full flex-wrap items-center gap-3 text-left"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800">{p.nombre}</span>
                <span className="block text-xs text-slate-500">{p.puesto ?? p.rol}</span>
              </span>

              <span className="ml-auto flex flex-wrap items-center gap-4 text-xs">
                <span className="text-center">
                  <span className="block text-base font-semibold tabular-nums text-slate-800">{p.asignado.ordenes}</span>
                  <span className="text-slate-400">abiertas</span>
                </span>
                <span className="text-center">
                  <span className="block text-base font-semibold tabular-nums text-slate-800">{p.asignado.horas}h</span>
                  <span className="text-slate-400">comprometidas</span>
                </span>
                {p.asignado.vencidas > 0 ? (
                  <span className="text-center">
                    <span className="block text-base font-semibold tabular-nums text-rose-600">{p.asignado.vencidas}</span>
                    <span className="text-rose-500">vencidas</span>
                  </span>
                ) : null}
                <span className="text-center">
                  <span className="block text-base font-semibold tabular-nums text-slate-800">{p.aplicado.horas}h</span>
                  <span className="text-slate-400">aplicadas</span>
                </span>
                {p.diasExcedidos > 0 ? (
                  <Badge tone="warning">{p.diasExcedidos} día(s) saturado(s)</Badge>
                ) : null}
              </span>
            </button>

            {/* La carga que viene, siempre visible: es lo accionable */}
            <div className="mt-3 flex items-end gap-0.5">
              {p.proximos.map((d) => (
                <div key={d.fecha} className="flex-1" title={`${fmt(d.fecha)} · ${d.horas}h de ${d.capacidad}h`}>
                  <div className="flex h-10 items-end">
                    <div
                      className={cn(
                        "w-full rounded-sm",
                        !d.habil ? "bg-slate-200" : d.excedido ? "bg-amber-500" : d.horas > 0 ? "bg-emerald-500" : "bg-slate-100",
                      )}
                      style={{ height: `${Math.max(6, (Math.max(d.horas, d.habil ? 0.5 : 0) / maxHoras) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-center text-[9px] text-slate-400">
                    {diaDeCalendario(d.fecha, zona).getDate()}
                  </p>
                </div>
              ))}
            </div>

            {desplegada ? (
              <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">En qué se le va el tiempo</p>
                  {Object.keys(p.aplicado.porTipo).length === 0 ? (
                    <p className="mt-1 text-xs text-slate-400">Sin horas capturadas en el periodo.</p>
                  ) : (
                    <ul className="mt-1.5 grid gap-1">
                      {Object.entries(p.aplicado.porTipo).sort((a, b) => b[1] - a[1]).map(([tipo, h]) => (
                        <li key={tipo} className="flex items-center gap-2 text-xs">
                          <span className="w-28 shrink-0 text-slate-600">{MAINTENANCE_TYPE_LABELS[tipo] ?? tipo}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(h / p.aplicado.horas) * 100}%` }} />
                          </div>
                          <span className="w-12 shrink-0 text-right tabular-nums text-slate-500">{h}h</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {p.aplicado.porcentajeCorrectivo !== null && p.aplicado.porcentajeCorrectivo >= 70 ? (
                    <p className="mt-1.5 text-xs text-amber-800">
                      {p.aplicado.porcentajeCorrectivo}% correctivo: está apagando incendios más que haciendo mantenimiento.
                    </p>
                  ) : null}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimado contra real</p>
                  {p.estimacion.desviacion === null ? (
                    <p className="mt-1 text-xs text-slate-400">
                      {p.estimacion.ordenes === 0
                        ? "Sin órdenes donde sea la única persona con horas capturadas."
                        : `Solo ${p.estimacion.ordenes} orden(es) comparable(s): muy pocas para decir algo.`}
                    </p>
                  ) : (
                    <>
                      <p className="mt-1 text-sm text-slate-800">
                        <span className="text-lg font-semibold tabular-nums">{p.estimacion.desviacion}%</span>{" "}
                        <span className="text-xs text-slate-500">
                          del tiempo estimado — {p.estimacion.reales}h reales de {p.estimacion.estimadas}h
                        </span>
                      </p>
                      <p className="text-xs text-slate-400">
                        Sobre {p.estimacion.ordenes} orden(es) donde fue la única persona con horas.
                      </p>
                    </>
                  )}

                  {p.puntualidad.porcentaje !== null ? (
                    <p className="mt-2 text-xs text-slate-600">
                      Cerró a tiempo {p.puntualidad.aTiempo} de {p.puntualidad.ordenes} órdenes con fecha.
                    </p>
                  ) : null}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Equipos que atiende</p>
                  {p.equipos.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-400">Sin horas capturadas contra un equipo.</p>
                  ) : (
                    <ul className="mt-1.5 grid gap-0.5 text-xs">
                      {p.equipos.map((e) => (
                        <li key={e.code} className="flex gap-2">
                          <span className="font-medium text-slate-700">{e.code}</span>
                          <span className="min-w-0 flex-1 truncate text-slate-500">{e.name}</span>
                          <span className="tabular-nums text-slate-400">{e.horas}h</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Actividades</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Completó {p.actividades.completadas}
                    {p.actividades.liberadas > 0 ? `, liberó ${p.actividades.liberadas}` : ""}
                  </p>
                  {p.actividades.porFaltaDeMaterial > 0 ? (
                    <p className="mt-1 text-xs text-slate-600">
                      {p.actividades.porFaltaDeMaterial} de las liberadas fue por <b>falta de material</b>.
                      Esa traba no es del técnico: es del almacén.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAbierta(p.id)}
                className="mt-2 text-xs font-medium text-brand-600 hover:underline"
              >
                Ver detalle
              </button>
            )}
          </Card>
        );
      })}

      <p className="text-xs text-slate-400">
        Periodo: últimos 90 días · jornada base {datos.jornadaBase} h. Las barras muestran los próximos
        15 días. Los indicadores que no tienen suficientes casos aparecen en blanco a propósito: un
        porcentaje sacado de dos órdenes no dice nada de nadie.
      </p>
    </div>
  );
}
