"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, X } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { MAINTENANCE_TYPE_COLORS, MAINTENANCE_TYPE_LABELS, OPEN_STATUSES } from "@/lib/constants";
import { cn } from "@/lib/utils";

const DIAS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

type Orden = {
  id: string; number: string; title: string;
  maintenanceType: string; status: string; estimatedHours: number;
  dueDate: string | null;
  asset: { id: string; code: string; name: string } | null;
  assignedTo: { id: string; name: string; color: string | null } | null;
};

type Persona = { userId: string | null; nombre: string; color: string | null; horas: number; capacidad: number; ordenes: number; ocupacion: number };
type Dia = { fecha: string; habil: boolean; festivo: string | null; horas: number; capacidad: number; personas: Persona[]; sobrecargado: boolean };
type Proyeccion = { id: string; title: string; asset: string; date: string };

const mismoDia = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);

export function Calendario({
  mes, dias, carga, ordenes, vencidas, proyecciones, tecnicos, horasJornada,
}: {
  mes: string;
  dias: string[];
  carga: Dia[];
  ordenes: Orden[];
  vencidas: Orden[];
  proyecciones: Proyeccion[];
  tecnicos: { id: string; name: string; color: string | null }[];
  horasJornada: number;
}) {
  const router = useRouter();
  const [tecnico, setTecnico] = useState("");
  const [tipo, setTipo] = useState("");
  const [soloAbiertas, setSoloAbiertas] = useState(false);
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null);

  const filtrar = (lista: Orden[]) =>
    lista.filter(
      (o) =>
        (!tecnico || o.assignedTo?.id === tecnico || (tecnico === "__sin" && !o.assignedTo)) &&
        (!tipo || o.maintenanceType === tipo) &&
        (!soloAbiertas || OPEN_STATUSES.includes(o.status)),
    );

  const visibles = useMemo(() => filtrar(ordenes), [ordenes, tecnico, tipo, soloAbiertas]);
  const vencidasVisibles = useMemo(() => filtrar(vencidas), [vencidas, tecnico, tipo, soloAbiertas]);
  const hayFiltro = Boolean(tecnico || tipo || soloAbiertas);

  const primero = new Date(dias[0]);
  const offset = (primero.getDay() + 6) % 7;
  const celdas: (string | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...dias,
  ];
  while (celdas.length % 7 !== 0) celdas.push(null);

  const [anio, mesNum] = mes.split("-").map(Number);
  const anterior = new Date(anio, mesNum - 2, 1).toISOString().slice(0, 7);
  const siguiente = new Date(anio, mesNum, 1).toISOString().slice(0, 7);
  const etiquetaMes = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" })
    .format(new Date(anio, mesNum - 1, 1));
  const hoy = new Date().toISOString().slice(0, 10);

  const delDia = (fecha: string) => visibles.filter((o) => o.dueDate && mismoDia(o.dueDate, fecha));
  const proyeccionesDe = (fecha: string) => proyecciones.filter((p) => mismoDia(p.date, fecha));
  const cargaDe = (fecha: string) => carga.find((c) => mismoDia(c.fecha, fecha));
  const abierto = diaAbierto ? cargaDe(diaAbierto) : null;

  return (
    <div className="grid gap-4">
      {/* Lo vencido, siempre visible */}
      {vencidasVisibles.length > 0 ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600" />
            <p className="text-sm font-semibold text-rose-900">
              {vencidasVisibles.length} orden(es) vencida(s) sin cerrar
            </p>
            <span className="text-xs text-rose-700">
              {vencidasVisibles.reduce((s, o) => s + o.estimatedHours, 0).toFixed(1)} h de trabajo
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {vencidasVisibles.slice(0, 12).map((o) => (
              <Link
                key={o.id}
                href={`/work-orders/${o.id}`}
                className="rounded border border-rose-200 bg-white px-1.5 py-0.5 text-[0.6875rem] text-rose-800 hover:bg-rose-100"
                title={`${o.title} · vencia ${o.dueDate?.slice(0, 10)}`}
              >
                {o.number} · {o.asset?.code ?? "sin activo"}
              </Link>
            ))}
            {vencidasVisibles.length > 12 ? (
              <span className="px-1 py-0.5 text-[0.6875rem] text-rose-700">
                y {vencidasVisibles.length - 12} mas
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold capitalize text-slate-900">{etiquetaMes}</h2>

          <div className="flex flex-wrap items-center gap-1.5">
            <select className="field h-8 py-0 text-xs" value={tecnico} onChange={(e) => setTecnico(e.target.value)}>
              <option value="">Todo el equipo</option>
              <option value="__sin">Sin responsable</option>
              {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select className="field h-8 py-0 text-xs" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos los tipos</option>
              {Object.entries(MAINTENANCE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600">
              <input type="checkbox" className="h-3.5 w-3.5" checked={soloAbiertas} onChange={(e) => setSoloAbiertas(e.target.checked)} />
              Solo abiertas
            </label>
            {hayFiltro ? (
              <button
                type="button"
                onClick={() => { setTecnico(""); setTipo(""); setSoloAbiertas(false); }}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
              >
                Limpiar
              </button>
            ) : null}
            <span className="mx-1 h-4 w-px bg-slate-200" />
            <button onClick={() => router.push(`/calendar?month=${anterior}`)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">Anterior</button>
            <button onClick={() => router.push("/calendar")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">Hoy</button>
            <button onClick={() => router.push(`/calendar?month=${siguiente}`)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">Siguiente</button>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/60">
          {DIAS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-[0.625rem] font-semibold uppercase tracking-wide text-slate-500">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {celdas.map((fecha, i) => {
            if (!fecha) return <div key={i} className="min-h-28 border-b border-r border-slate-100 bg-slate-50/40" />;
            const c = cargaDe(fecha);
            const delDiaOrdenes = delDia(fecha);
            const proys = proyeccionesDe(fecha);
            const total = delDiaOrdenes.length + proys.length;
            const esHoy = fecha.slice(0, 10) === hoy;
            const numero = new Date(fecha).getDate();

            return (
              <button
                key={i}
                type="button"
                onClick={() => total > 0 && setDiaAbierto(fecha)}
                className={cn(
                  "min-h-28 border-b border-r border-slate-100 p-1.5 text-left align-top transition-colors",
                  !c?.habil && "bg-slate-50/70",
                  c?.sobrecargado && "bg-amber-50/70",
                  total > 0 && "hover:bg-slate-50",
                  total === 0 && "cursor-default",
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-1">
                  <span className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[0.6875rem] font-medium",
                    esHoy ? "bg-brand-600 text-white" : c?.habil ? "text-slate-500" : "text-slate-400",
                  )}>
                    {numero}
                  </span>
                  {c && c.horas > 0 ? (
                    <span className={cn(
                      "rounded px-1 text-[9px] font-semibold tabular-nums",
                      c.sobrecargado ? "bg-amber-200 text-amber-900" : "bg-slate-100 text-slate-500",
                    )} title={`${c.horas} h asignadas${c.capacidad ? ` sobre ${c.capacidad} h disponibles` : ""}`}>
                      {c.horas}h
                    </span>
                  ) : null}
                </div>

                {c?.festivo ? (
                  <p className="mb-1 truncate text-[9px] font-medium text-slate-400" title={c.festivo}>{c.festivo}</p>
                ) : null}

                <div className="grid gap-1">
                  {delDiaOrdenes.slice(0, 3).map((o) => (
                    <span
                      key={o.id}
                      className={cn(
                        "flex items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[0.625rem] font-medium",
                        MAINTENANCE_TYPE_COLORS[o.maintenanceType],
                        !OPEN_STATUSES.includes(o.status) && "opacity-50 line-through",
                      )}
                      title={`${o.number} — ${o.title}`}
                    >
                      {o.assignedTo?.color ? (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: o.assignedTo.color }} />
                      ) : null}
                      <span className="truncate">{o.number} {o.title}</span>
                    </span>
                  ))}
                  {proys.slice(0, 2).map((p) => (
                    <span key={p.id} className="block truncate rounded border border-dashed border-slate-300 bg-white px-1.5 py-0.5 text-[0.625rem] text-slate-500" title={`Proyectado: ${p.title} — ${p.asset}`}>
                      ◇ {p.title}
                    </span>
                  ))}
                  {total > 5 ? (
                    <span className="px-1 text-[0.625rem] font-medium text-brand-600">
                      +{total - Math.min(3, delDiaOrdenes.length) - Math.min(2, proys.length)} mas — ver dia
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="font-medium text-slate-600">Leyenda:</span>
        {Object.entries(MAINTENANCE_TYPE_LABELS).map(([k, v]) => (
          <Badge key={k} className={MAINTENANCE_TYPE_COLORS[k]}>{v}</Badge>
        ))}
        <span className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[0.6875rem]">◇ Proyeccion del plan</span>
        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[0.6875rem] text-amber-900">Dia sobrecargado</span>
        <span className="text-slate-400">Jornada base: {horasJornada} h</span>
      </div>

      {abierto && diaAbierto ? (
        <DetalleDia
          dia={abierto}
          ordenes={delDia(diaAbierto)}
          proyecciones={proyeccionesDe(diaAbierto)}
          onCerrar={() => setDiaAbierto(null)}
        />
      ) : null}
    </div>
  );
}

/** El dia completo: lo que la celda del mes no alcanza a mostrar. */
function DetalleDia({
  dia, ordenes, proyecciones, onCerrar,
}: {
  dia: Dia;
  ordenes: Orden[];
  proyecciones: Proyeccion[];
  onCerrar: () => void;
}) {
  const fecha = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(dia.fecha));

  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold capitalize text-slate-900">{fecha}</h3>
          <p className="text-xs text-slate-500">
            {dia.horas} h asignadas
            {dia.capacidad > 0 ? ` de ${dia.capacidad} h disponibles` : ""}
            {!dia.habil ? ` · ${dia.festivo ?? "dia no laborable"}` : ""}
          </p>
        </div>
        <button type="button" onClick={onCerrar} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>

      {dia.personas.length > 0 ? (
        <div className="mb-4 grid gap-1.5">
          {dia.personas.map((p) => (
            <div key={p.userId ?? "sin"} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? "#cbd5e1" }} />
              <span className="w-36 shrink-0 truncate text-slate-700">{p.nombre}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={cn("h-full rounded-full", p.ocupacion > 1 ? "bg-amber-500" : "bg-emerald-500")}
                  style={{ width: `${Math.min(100, (p.ocupacion || 0) * 100)}%` }}
                />
              </div>
              <span className={cn("w-24 shrink-0 text-right tabular-nums", p.ocupacion > 1 ? "font-semibold text-amber-700" : "text-slate-500")}>
                {p.horas}h {p.capacidad > 0 ? `/ ${p.capacidad}h` : "(no laborable)"}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <ul className="grid gap-1.5">
        {ordenes.map((o) => (
          <li key={o.id}>
            <Link href={`/work-orders/${o.id}`} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-50">
              <Badge className={MAINTENANCE_TYPE_COLORS[o.maintenanceType]}>
                {MAINTENANCE_TYPE_LABELS[o.maintenanceType]}
              </Badge>
              <span className="font-medium text-slate-800">{o.number}</span>
              <span className="min-w-0 flex-1 truncate text-slate-600">{o.title}</span>
              {o.asset ? <span className="shrink-0 text-slate-400">{o.asset.code}</span> : null}
              <span className="shrink-0 tabular-nums text-slate-500">{o.estimatedHours}h</span>
              {o.assignedTo ? (
                <span className="flex shrink-0 items-center gap-1 text-slate-500">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: o.assignedTo.color ?? "#cbd5e1" }} />
                  {o.assignedTo.name}
                </span>
              ) : (
                <span className="shrink-0 text-amber-600">Sin responsable</span>
              )}
            </Link>
          </li>
        ))}
        {proyecciones.map((p) => (
          <li key={p.id} className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs text-slate-500">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{p.title}</span>
            <span className="shrink-0 text-slate-400">{p.asset}</span>
            <span className="shrink-0 text-slate-400">proyectada</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
