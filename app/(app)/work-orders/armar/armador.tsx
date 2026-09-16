"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, Loader2, PackageX, Wrench } from "lucide-react";
import { Button } from "@/components/ui";
import { SelectorBuscable, type OpcionBuscable } from "@/components/selector-buscable";
import type { TrabajoDisponible } from "@/lib/armar-ot";
import { VENTANAS, type Ventana } from "@/lib/calendario";
import { diaDeCalendario } from "@/lib/utils";

export function Armador({
  activos,
  activoElegido,
  nombreActivo,
  tecnicos,
  disponible,
}: {
  activos: OpcionBuscable[];
  activoElegido: string;
  nombreActivo: string | null;
  tecnicos: Array<{ id: string; name: string }>;
  disponible: TrabajoDisponible | null;
}) {
  const router = useRouter();
  /** Las actividades de plan elegidas, por id de actividad. */
  const [actividades, setActividades] = useState<string[]>([]);
  const [reportes, setReportes] = useState<string[]>([]);
  const [pendientes, setPendientes] = useState<string[]>([]);
  const [titulo, setTitulo] = useState("");
  const [responsable, setResponsable] = useState("");
  const [fecha, setFecha] = useState("");
  const [prioridad, setPrioridad] = useState("MEDIUM");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Con la mezcla apagada, elegir de un grupo limpia los otros.
   *
   * Es mas claro que deshabilitar casillas: el usuario ve que su seleccion se
   * mueve y entiende la regla sin leer nada. El servidor la hace cumplir de
   * todos modos.
   */
  function fijar(cual: "plan" | "reporte" | "backlog", nueva: string[]) {
    const setters = { plan: setActividades, reporte: setReportes, backlog: setPendientes };
    setters[cual](nueva);
    if (!disponible?.multiOrigen && nueva.length) {
      for (const otro of ["plan", "reporte", "backlog"] as const) {
        if (otro !== cual) setters[otro]([]);
      }
    }
  }

  function alternar(cual: "plan" | "reporte" | "backlog", id: string) {
    const actual = { plan: actividades, reporte: reportes, backlog: pendientes }[cual];
    fijar(cual, actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id]);
  }

  /** Marca o desmarca todas las actividades de un plan de un jalón. */
  function alternarPlan(ids: string[]) {
    const todas = ids.every((id) => actividades.includes(id));
    fijar(
      "plan",
      todas
        ? actividades.filter((id) => !ids.includes(id))
        : [...new Set([...actividades, ...ids])],
    );
  }

  const cuantas = actividades.length + reportes.length + pendientes.length;

  /** Un titulo razonable, que el usuario puede cambiar. */
  const tituloSugerido = useMemo(() => {
    if (!disponible || !nombreActivo) return "";
    const partes: string[] = [];
    const planes = disponible.planes.filter((x) =>
      x.actividades.some((a) => actividades.includes(a.id)),
    );
    if (planes.length === 1) {
      const suyas = planes[0].actividades.filter((a) => actividades.includes(a.id)).length;
      partes.push(
        suyas === planes[0].actividades.length
          ? planes[0].nombre
          : `${planes[0].nombre} (${suyas} de ${planes[0].actividades.length})`,
      );
    } else if (planes.length > 1) partes.push(`${planes.length} planes`);
    if (reportes.length) partes.push(`${reportes.length} reporte(s)`);
    if (pendientes.length) partes.push(`${pendientes.length} pendiente(s)`);
    if (!partes.length) return "";
    return `${partes.join(" + ")} — ${nombreActivo.split(" — ")[0]}`;
  }, [disponible, nombreActivo, actividades, reportes, pendientes]);

  function cambiarVentana(v: string) {
    const q = new URLSearchParams();
    if (activoElegido) q.set("activo", activoElegido);
    q.set("ventana", v);
    router.push(`/work-orders/armar?${q.toString()}`);
  }

  async function crear() {
    setGuardando(true);
    setError(null);
    const res = await fetch("/api/work-orders/armar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetId: activoElegido,
        title: titulo || tituloSugerido,
        assignedToId: responsable || null,
        dueDate: fecha || null,
        priority: prioridad,
        actividades,
        reportes,
        backlog: pendientes,
      }),
    });
    const data = await res.json();
    setGuardando(false);
    if (!res.ok) {
      setError(data.error ?? "No fue posible armar la orden");
      return;
    }
    router.push(`/work-orders/${data.workOrder.id}`);
  }

  return (
    <div className="grid gap-5">
      <div>
        <label className="label">Equipo</label>
        <SelectorBuscable
          valor={activoElegido}
          onCambio={(v) => {
            const q = new URLSearchParams();
            if (v) q.set("activo", v);
            if (disponible?.ventana) q.set("ventana", disponible.ventana);
            router.push(`/work-orders/armar${q.size ? `?${q.toString()}` : ""}`);
          }}
          opciones={activos}
          vacio="Elija el equipo"
          marcador="Busque por clave o nombre"
        />
      </div>

      {!disponible ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
          Elija un equipo para ver que trabajo tiene pendiente.
        </p>
      ) : (
        <>
          {!disponible.multiOrigen ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[0.6875rem] text-amber-800">
              Esta organización arma una orden por cada origen. Al elegir de un grupo se
              limpia lo marcado en los otros. Se cambia en Configuración.
            </p>
          ) : null}

          {/*
            Que tan adelante mirar. Lo atrasado se muestra con cualquier
            ventana: una ventana que lo escondiera seria la forma mas facil de
            que se quedara atrasado.
          */}
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-[12rem]">
              <label className="label">Ver actividades de</label>
              <select
                className="field"
                value={disponible.ventana}
                onChange={(e) => cambiarVentana(e.target.value)}
              >
                {(Object.keys(VENTANAS) as Ventana[]).map((v) => (
                  <option key={v} value={v}>
                    {v === "CONFIGURADA"
                      ? `Los próximos ${disponible.horizonteDias} días (la de la empresa)`
                      : VENTANAS[v].etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <p className="pb-2 text-[0.6875rem] text-slate-500">
              Hasta el {diaDeCalendario(disponible.hasta).toLocaleDateString("es-MX", {
                weekday: "short", day: "numeric", month: "short",
              })}. Las atrasadas se ven siempre.
            </p>
          </div>

          {disponible.atrasadas > 0 ? (
            <p className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <b>
                  {disponible.atrasadas === 1
                    ? "1 actividad atrasada"
                    : `${disponible.atrasadas} actividades atrasadas`}
                </b>{" "}
                — ya pasó su fecha y no está en ninguna orden. Van primero en cada plan.
              </span>
            </p>
          ) : null}

          <Grupo
            icono={<CalendarClock className="h-3.5 w-3.5" />}
            titulo="Mantenimiento preventivo"
            vacio="Nada del plan de este equipo cae dentro de la ventana."
            cuantos={disponible.planes.reduce((n, p) => n + p.actividades.length, 0)}
          >
            {disponible.planes.map((p) => {
              const ids = p.actividades.map((a) => a.id);
              const marcadas = ids.filter((id) => actividades.includes(id)).length;
              return (
                <div
                  key={p.asignacionId}
                  className={`rounded-lg border ${
                    marcadas ? "border-brand-300 bg-brand-50/40" : "border-slate-200"
                  }`}
                >
                  {/*
                    El plan es un encabezado, no una casilla que arrastra todo.
                    Marcar todas es un atajo; lo normal es elegir renglon por
                    renglon.
                  */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-200/70 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">
                      {p.nombre}
                    </span>
                    {p.atrasadas > 0 ? (
                      <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-rose-700">
                        {p.atrasadas} atrasada{p.atrasadas === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {ids.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => alternarPlan(ids)}
                        className="text-[0.6875rem] font-medium text-brand-700 hover:underline"
                      >
                        {marcadas === ids.length ? "Quitar todas" : "Marcar todas"}
                      </button>
                    ) : null}
                  </div>

                  <ul className="grid">
                    {p.actividades.map((a) => {
                      const marcado = actividades.includes(a.id);
                      return (
                        <li key={a.id}>
                          <label
                            className={`flex cursor-pointer items-center gap-2.5 px-2.5 py-1.5 ${
                              marcado ? "bg-brand-50" : "hover:bg-slate-50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={marcado}
                              onChange={() => alternar("plan", a.id)}
                              className="h-3.5 w-3.5"
                            />
                            <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                              {a.title}
                            </span>
                            <Vence actividad={a} />
                          </label>
                        </li>
                      );
                    })}
                    {p.yaEnOrden.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-slate-400"
                        title="Ya está en una orden abierta. No se puede poner en dos órdenes a la vez."
                      >
                        <span className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate line-through decoration-slate-300">
                          {a.title}
                        </span>
                        <span className="shrink-0 text-[0.6875rem]">ya va en {a.orden}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </Grupo>

          <Grupo
            icono={<AlertTriangle className="h-3.5 w-3.5" />}
            titulo="Reportes de falla sin atender"
            vacio="No hay fallas reportadas para este equipo."
            cuantos={disponible.reportes.length}
          >
            {disponible.reportes.map((r) => (
              <Fila
                key={r.id}
                marcado={reportes.includes(r.id)}
                onMarcar={() => alternar("reporte", r.id)}
                titulo={r.title}
                detalle={`${r.number} · reportada el ${new Date(r.createdAt).toLocaleDateString("es-MX")}`}
                señal={
                  r.riesgo && r.riesgo !== "NINGUNO"
                    ? { texto: "Riesgo", tono: "urgente" }
                    : { texto: r.priority === "HIGH" || r.priority === "CRITICAL" ? "Alta" : "Normal", tono: "suave" }
                }
              />
            ))}
          </Grupo>

          <Grupo
            icono={<PackageX className="h-3.5 w-3.5" />}
            titulo="Quedo pendiente"
            vacio="Nada quedo trabado en órdenes anteriores."
            cuantos={disponible.backlog.length}
          >
            {disponible.backlog.map((b) => (
              <Fila
                key={b.id}
                marcado={pendientes.includes(b.id)}
                onMarcar={() => alternar("backlog", b.id)}
                titulo={b.title}
                detalle={`De ${b.deLaOrden} · ${b.diasEsperando} dia(s) esperando`}
                señal={
                  b.yaSePuede === true
                    ? { texto: "Ya se puede", tono: "listo" }
                    : b.yaSePuede === false
                      ? { texto: "Sigue trabada", tono: "urgente" }
                      : { texto: "Pendiente", tono: "suave" }
                }
              />
            ))}
          </Grupo>

          {cuantas > 0 ? (
            <div className="grid gap-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
              <p className="text-xs font-semibold text-brand-800">
                {cuantas} actividad(es) en una sola orden
              </p>

              <div>
                <label className="label">Título</label>
                <input
                  className="field"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder={tituloSugerido}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">Responsable</label>
                  <select className="field" value={responsable} onChange={(e) => setResponsable(e.target.value)}>
                    <option value="">Sin asignar</option>
                    {tecnicos.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Vencimiento</label>
                  <input type="date" className="field" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                </div>
                <div>
                  <label className="label">Prioridad</label>
                  <select className="field" value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
                    <option value="LOW">Baja</option>
                    <option value="MEDIUM">Media</option>
                    <option value="HIGH">Alta</option>
                    <option value="CRITICAL">Crítica</option>
                  </select>
                </div>
              </div>

              {error ? <p className="text-xs text-red-600">{error}</p> : null}

              <div className="flex justify-end">
                <Button onClick={crear} disabled={guardando}>
                  {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                  Crear la orden
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Grupo({
  icono, titulo, vacio, cuantos, children,
}: {
  icono: React.ReactNode; titulo: string; vacio: string; cuantos: number; children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        {icono} {titulo}
        {cuantos > 0 ? (
          <span className="rounded-full bg-slate-100 px-1.5 text-[0.625rem] text-slate-600">{cuantos}</span>
        ) : null}
      </p>
      {cuantos === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-[0.6875rem] text-slate-400">
          {vacio}
        </p>
      ) : (
        <div className="grid gap-1.5">{children}</div>
      )}
    </div>
  );
}

function Fila({
  marcado, onMarcar, titulo, detalle, señal, children,
}: {
  marcado: boolean;
  onMarcar: () => void;
  titulo: string;
  detalle: string;
  señal: { texto: string; tono: "urgente" | "suave" | "listo" };
  /** Desglose opcional bajo la fila, para ver que trae adentro. */
  children?: React.ReactNode;
}) {
  const tonos = {
    urgente: "bg-rose-100 text-rose-700",
    listo: "bg-emerald-100 text-emerald-700",
    suave: "bg-slate-100 text-slate-600",
  };
  return (
    <div
      className={`rounded-lg border ${
        marcado ? "border-brand-300 bg-brand-50/60" : "border-slate-200"
      }`}
    >
      <label
        className={`flex cursor-pointer items-center gap-2.5 px-2.5 py-2 ${
          marcado ? "" : "hover:bg-slate-50"
        }`}
      >
        <input type="checkbox" checked={marcado} onChange={onMarcar} className="h-3.5 w-3.5" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-slate-800">{titulo}</span>
          <span className="block truncate text-[0.6875rem] text-slate-500">{detalle}</span>
        </span>
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem] ${tonos[señal.tono]}`}>
          {señal.texto}
        </span>
      </label>
      {children}
    </div>
  );
}

/**
 * Cuando toca una actividad, dicho de forma que se decida con un vistazo.
 *
 * Rojo si ya se paso: es la que no se puede perder de vista. Las de medidor no
 * tienen fecha propia y dicen la lectura contra la meta.
 */
function Vence({
  actividad,
}: {
  actividad: { faltan: number | null; atrasada: boolean; porMedidor: string | null };
}) {
  const { faltan, atrasada, porMedidor } = actividad;
  const texto = atrasada
    ? faltan != null && faltan < 0
      ? `atrasada ${Math.abs(faltan)} d`
      : "atrasada"
    : porMedidor
      ? porMedidor
      : faltan === 0
        ? "vence hoy"
        : faltan != null
          ? `en ${faltan} d`
          : "sin fecha";
  return (
    <span
      className={`shrink-0 text-[0.6875rem] tabular-nums ${
        atrasada
          ? "rounded-full bg-rose-100 px-1.5 py-0.5 font-medium text-rose-700"
          : faltan === 0
            ? "font-medium text-amber-700"
            : "text-slate-400"
      }`}
    >
      {texto}
    </span>
  );
}
