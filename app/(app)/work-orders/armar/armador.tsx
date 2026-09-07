"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, Loader2, PackageX, Wrench } from "lucide-react";
import { Button } from "@/components/ui";
import { SelectorBuscable, type OpcionBuscable } from "@/components/selector-buscable";
import type { TrabajoDisponible } from "@/lib/armar-ot";

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
  const [planes, setPlanes] = useState<string[]>([]);
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
  function alternar(cual: "plan" | "reporte" | "backlog", id: string) {
    const listas = { plan: planes, reporte: reportes, backlog: pendientes };
    const setters = { plan: setPlanes, reporte: setReportes, backlog: setPendientes };
    const actual = listas[cual];
    const nueva = actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id];
    setters[cual](nueva);
    if (!disponible?.multiOrigen && nueva.length) {
      for (const otro of ["plan", "reporte", "backlog"] as const) {
        if (otro !== cual) setters[otro]([]);
      }
    }
  }

  /**
   * Cuantas actividades van a quedar en la orden. Los planes aportan varias
   * cada uno, y verlo antes de crear evita la sorpresa de una orden con
   * cuarenta pasos.
   */
  const cuantas = useMemo(() => {
    if (!disponible) return 0;
    const dePlan = disponible.planes
      .filter((p) => planes.includes(p.asignacionId))
      .reduce((s, p) => s + p.actividades.length, 0);
    return dePlan + reportes.length + pendientes.length;
  }, [disponible, planes, reportes, pendientes]);

  /** Un titulo razonable, que el usuario puede cambiar. */
  const tituloSugerido = useMemo(() => {
    if (!disponible || !nombreActivo) return "";
    const partes: string[] = [];
    const p = disponible.planes.filter((x) => planes.includes(x.asignacionId));
    if (p.length === 1) partes.push(p[0].nombre);
    else if (p.length > 1) partes.push(`${p.length} planes`);
    if (reportes.length) partes.push(`${reportes.length} reporte(s)`);
    if (pendientes.length) partes.push(`${pendientes.length} pendiente(s)`);
    if (!partes.length) return "";
    return `${partes.join(" + ")} — ${nombreActivo.split(" — ")[0]}`;
  }, [disponible, nombreActivo, planes, reportes, pendientes]);

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
        asignaciones: planes,
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
          onCambio={(v) => router.push(v ? `/work-orders/armar?activo=${v}` : "/work-orders/armar")}
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
              Esta organizacion arma una orden por cada origen. Al elegir de un grupo se
              limpia lo marcado en los otros. Se cambia en Configuracion.
            </p>
          ) : null}

          <Grupo
            icono={<CalendarClock className="h-3.5 w-3.5" />}
            titulo="Mantenimiento preventivo"
            vacio="Este equipo no tiene planes asignados."
            cuantos={disponible.planes.length}
          >
            {disponible.planes.map((p) => (
              <Fila
                key={p.asignacionId}
                marcado={planes.includes(p.asignacionId)}
                onMarcar={() => alternar("plan", p.asignacionId)}
                titulo={p.nombre}
                detalle={`${p.actividades.length} actividad(es)${p.horasEstimadas ? ` · ${p.horasEstimadas} h` : ""}`}
                señal={
                  p.yaToca
                    ? { texto: "Ya toca", tono: "urgente" }
                    : p.diasParaVencer !== null
                      ? { texto: `En ${p.diasParaVencer} d`, tono: "suave" }
                      : { texto: "Sin fecha", tono: "suave" }
                }
              />
            ))}
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
                <label className="label">Titulo</label>
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
                    <option value="CRITICAL">Critica</option>
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
  marcado, onMarcar, titulo, detalle, señal,
}: {
  marcado: boolean;
  onMarcar: () => void;
  titulo: string;
  detalle: string;
  señal: { texto: string; tono: "urgente" | "suave" | "listo" };
}) {
  const tonos = {
    urgente: "bg-rose-100 text-rose-700",
    listo: "bg-emerald-100 text-emerald-700",
    suave: "bg-slate-100 text-slate-600",
  };
  return (
    <label
      className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 ${
        marcado ? "border-brand-300 bg-brand-50/60" : "border-slate-200 hover:bg-slate-50"
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
  );
}
