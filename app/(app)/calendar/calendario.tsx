"use client";

import { useZona } from "@/components/zona-empresa";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, X } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { EquiposElegidos, FiltrosTrabajo } from "@/components/filtros-trabajo";
import {
  FILTRO_VACIO, coincide, enSeleccion as enSeleccionDe,
  type FiltroTrabajo,
} from "@/lib/filtros-trabajo";
import { MAINTENANCE_TYPE_COLORS, MAINTENANCE_TYPE_LABELS, OPEN_STATUSES } from "@/lib/constants";
import { claveDia, cn, diaDeCalendario } from "@/lib/utils";

const DIAS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

type Orden = {
  id: string; number: string; title: string;
  maintenanceType: string; status: string; estimatedHours: number;
  dueDate: string | null;
  /** Texto de vencimiento calculado en el servidor con el estado de la orden («Cumplida en fecha», «Vencida hace 3 días»…). */
  vencimiento: string;
  asset: { id: string; code: string; name: string; categoryId?: string | null } | null;
  assignedTo: { id: string; name: string; color: string | null } | null;
};

type Persona = { userId: string | null; nombre: string; color: string | null; horas: number; capacidad: number; ordenes: number; ocupacion: number };
type Propuesta = {
  persona: string;
  exceso: number;
  dias: Array<{ fecha: string; libres: number }>;
  personas: Array<{ nombre: string; libres: number }>;
};
type Dia = {
  fecha: string; habil: boolean; festivo: string | null; horas: number; capacidad: number;
  personas: Persona[]; sobrecargado: boolean;
  /** Donde cabe lo que sobra, calculado en el servidor con la misma carga. */
  propuestas?: Propuesta[];
};
type Proyeccion = {
  id: string; title: string; asset: string; date: string;
  assetId: string | null; categoryId: string | null;
  /** Que actividades lleva esa visita. Vacio en los planes por medidor. */
  titulos: string[];
};

const mismoDia = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);

export function Calendario({
  vista, mes, semana, dia, dias, carga, ordenes, vencidas, proyecciones,
  tecnicos, activos, familias, horasJornada,
}: {
  vista: "mes" | "semana" | "dia";
  mes: string;
  semana: string;
  dia: string;
  dias: string[];
  carga: Dia[];
  ordenes: Orden[];
  vencidas: Orden[];
  proyecciones: Proyeccion[];
  tecnicos: { id: string; name: string; color: string | null }[];
  activos: { id: string; code: string; name: string; categoryId: string | null }[];
  familias: { id: string; name: string }[];
  horasJornada: number;
}) {
  const zona = useZona();
  const router = useRouter();
  const [filtro, setFiltro] = useState<FiltroTrabajo>(FILTRO_VACIO);
  const [soloAbiertas, setSoloAbiertas] = useState(false);
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null);

  // La regla —los equipos elegidos mandan sobre la familia— vive en
  // lib/filtros-trabajo, compartida con el Tablero.
  const enSeleccion = (assetId?: string | null, categoryId?: string | null) =>
    enSeleccionDe(filtro, assetId, categoryId);

  const filtrar = (lista: Orden[]) =>
    lista.filter(
      (o) =>
        coincide(filtro, {
          maintenanceType: o.maintenanceType,
          responsableId: o.assignedTo?.id ?? null,
          assetId: o.asset?.id ?? null,
          categoryId: o.asset?.categoryId ?? null,
        }) && (!soloAbiertas || OPEN_STATUSES.includes(o.status)),
    );

  // La lista de dependencias tiene que traer TODOS los filtros. Si falta uno,
  // useMemo devuelve el resultado anterior y el filtro se ve muerto: la
  // pantalla no cambia y no hay error en ningun lado que lo delate.
  const visibles = useMemo(
    () => filtrar(ordenes),
    [ordenes, filtro, soloAbiertas],
  );
  const vencidasVisibles = useMemo(
    () => filtrar(vencidas),
    [vencidas, filtro, soloAbiertas],
  );

  const primero = diaDeCalendario(dias[0], zona);
  const offset = (primero.getDay() + 6) % 7;
  const celdas: (string | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...dias,
  ];
  while (celdas.length % 7 !== 0) celdas.push(null);

  const [anio, mesNum] = mes.split("-").map(Number);
  // El hoy de la EMPRESA: igual en el servidor (UTC) que en el navegador.
  const hoy = claveDia(new Date(), zona);

  const corrimiento = (dias_: number) => {
    const d = new Date(semana);
    d.setDate(d.getDate() + dias_);
    return d.toISOString().slice(0, 10);
  };
  const irA = (destino: string) => router.push(destino);
  const corrimientoDia = (n: number) => {
    const d = new Date(`${dia}T12:00:00`);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const rutaAnterior =
    vista === "dia"
      ? `/calendar?vista=dia&dia=${corrimientoDia(-1)}`
      : vista === "semana"
        ? `/calendar?vista=semana&semana=${corrimiento(-7)}`
        : `/calendar?month=${new Date(anio, mesNum - 2, 1).toISOString().slice(0, 7)}`;
  const rutaSiguiente =
    vista === "dia"
      ? `/calendar?vista=dia&dia=${corrimientoDia(1)}`
      : vista === "semana"
        ? `/calendar?vista=semana&semana=${corrimiento(7)}`
        : `/calendar?month=${new Date(anio, mesNum, 1).toISOString().slice(0, 7)}`;
  const rutaHoy =
    vista === "dia" ? "/calendar?vista=dia" : vista === "semana" ? "/calendar?vista=semana" : "/calendar";

  const etiquetaMes =
    vista === "dia"
      ? new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${dia}T12:00:00`))
      : vista === "semana"
        ? `${new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(diaDeCalendario(dias[0], zona))} al ${new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" }).format(diaDeCalendario(dias[dias.length - 1], zona))}`
        : new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(new Date(anio, mesNum - 1, 1));

  const delDia = (fecha: string) => visibles.filter((o) => o.dueDate && mismoDia(o.dueDate, fecha));
  // La proyeccion se filtra igual que las ordenes: si no, al aislar un equipo
  // seguirian apareciendo las lineas punteadas de todos los demas.
  const proyeccionesVisibles = useMemo(
    () => proyecciones.filter((p) => enSeleccion(p.assetId, p.categoryId)),
    [proyecciones, filtro],
  );
  const proyeccionesDe = (fecha: string) =>
    proyeccionesVisibles.filter((p) => mismoDia(p.date, fecha));
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
                title={`${o.title} · ${o.vencimiento}`}
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
        {/* Dos renglones y no cinco: los filtros juntos arriba, la navegacion
            abajo. Van con `compacto` porque `field` trae width 100% y apilaba
            cada select en su propio renglon, empujando el calendario fuera de
            pantalla. */}
        <div className="border-b border-slate-200 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-1 text-sm font-semibold capitalize text-slate-900">{etiquetaMes}</h2>

            <FiltrosTrabajo
              valor={filtro}
              alCambiar={setFiltro}
              tecnicos={tecnicos}
              activos={activos}
              familias={familias}
              extraActivo={soloAbiertas}
              alLimpiarExtra={() => setSoloAbiertas(false)}
              extra={
                <label className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    checked={soloAbiertas}
                    onChange={(e) => setSoloAbiertas(e.target.checked)}
                  />
                  Solo abiertas
                </label>
              }
            />

            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <div className="flex overflow-hidden rounded-lg border border-slate-200">
                {([
                  ["mes", "Mes", "/calendar"],
                  ["semana", "Semana", "/calendar?vista=semana"],
                  ["dia", "Día", "/calendar?vista=dia"],
                ] as const).map(([clave, texto, destino], i) => (
                  <button
                    key={clave}
                    onClick={() => irA(destino)}
                    className={cn(
                      "px-2.5 py-1 text-xs",
                      i > 0 && "border-l border-slate-200",
                      vista === clave ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {texto}
                  </button>
                ))}
              </div>
              <div className="flex overflow-hidden rounded-lg border border-slate-200">
                <button onClick={() => irA(rutaAnterior)} className="px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">‹</button>
                <button onClick={() => irA(rutaHoy)} className="border-x border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">Hoy</button>
                <button onClick={() => irA(rutaSiguiente)} className="px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">›</button>
              </div>
            </div>
          </div>
        </div>

        {filtro.equipos.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50/40 px-4 py-2">
            <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-slate-400">
              Solo estos equipos
            </span>
            <EquiposElegidos valor={filtro} alCambiar={setFiltro} activos={activos} />
            <button
              type="button"
              onClick={() => setFiltro({ ...filtro, equipos: [] })}
              className="ml-1 text-[0.6875rem] font-medium text-brand-600 hover:underline"
            >
              Ver todos
            </button>
          </div>
        ) : null}

        {/* Las fichas de equipos quedan ARRIBA del condicional para que se vean
            en las tres vistas, no solo en el mes. */}
        {vista === "dia" ? (
          <div className="p-4">
            {(() => {
              const c = cargaDe(dia);
              return c ? (
                <DetalleDia dia={c} ordenes={delDia(dia)} proyecciones={proyeccionesDe(dia)} sinMarco />
              ) : (
                <p className="py-10 text-center text-xs text-slate-400">Sin información para ese dia.</p>
              );
            })()}
          </div>
        ) : vista === "semana" ? (
          <RejillaSemana
            dias={dias}
            carga={carga}
            ordenes={visibles}
            proyecciones={proyeccionesVisibles}
            hoy={hoy}
            onAbrirDia={setDiaAbierto}
          />
        ) : (
        <>
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
            const numero = diaDeCalendario(fecha, zona).getDate();

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
                      title={`${o.number} — ${o.title} · ${o.vencimiento}`}
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
        </>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="font-medium text-slate-600">Leyenda:</span>
        {Object.entries(MAINTENANCE_TYPE_LABELS).map(([k, v]) => (
          <Badge key={k} className={MAINTENANCE_TYPE_COLORS[k]}>{v}</Badge>
        ))}
        <span className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[0.6875rem]">◇ Proyección del plan</span>
        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[0.6875rem] text-amber-900">Día sobrecargado</span>
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
  dia, ordenes, proyecciones, onCerrar, sinMarco,
}: {
  dia: Dia;
  ordenes: Orden[];
  proyecciones: Proyeccion[];
  onCerrar?: () => void;
  /** En la vista de dia ya vive dentro de la tarjeta del calendario. */
  sinMarco?: boolean;
}) {
  const zona = useZona();
  const fecha = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" })
    .format(diaDeCalendario(dia.fecha, zona));

  const Marco = sinMarco
    ? ({ children }: { children: React.ReactNode }) => <div>{children}</div>
    : Card;

  return (
    <Marco>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold capitalize text-slate-900">{fecha}</h3>
          <p className="text-xs text-slate-500">
            {dia.horas} h asignadas
            {dia.capacidad > 0 ? ` de ${dia.capacidad} h disponibles` : ""}
            {!dia.habil ? ` · ${dia.festivo ?? "dia no laborable"}` : ""}
          </p>
        </div>
        {onCerrar ? (
          <button type="button" onClick={onCerrar} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        ) : null}
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

      {dia.propuestas?.length ? (
        <div className="mb-4 grid gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">Cómo resolver la sobrecarga</p>
          {dia.propuestas.map((p) => (
            <p key={p.persona}>
              A <span className="font-medium">{p.persona}</span> le sobran {p.exceso} h.{" "}
              {p.dias.length
                ? `Le caben en ${p.dias.map((d) => `${new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric" }).format(diaDeCalendario(d.fecha, zona))} (${d.libres} h libres)`).join(" o ")}`
                : "No tiene días con lugar en lo que se está viendo"}
              {p.personas.length
                ? `; ese mismo día pueden tomarlas ${p.personas.map((x) => `${x.nombre} (${x.libres} h)`).join(" o ")}.`
                : "; nadie más tiene lugar ese día."}
              {" "}Reprograme o asigne desde la orden: el cambio de fecha pide motivo.
            </p>
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
          <li key={p.id} className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
              <span className="shrink-0 text-slate-400">{p.asset}</span>
              <span className="shrink-0 text-slate-400">proyectada</span>
            </div>
            {/*
              Que lleva esa visita. Con cada actividad en su propia fecha, dos
              visitas del mismo plan pueden traer cosas distintas: una el
              engrase y la otra el engrase mas el aceite. Enseñar solo el nombre
              del plan las haria ver iguales.
            */}
            {p.titulos.length ? (
              <p className="mt-0.5 pl-5 text-[0.6875rem] leading-relaxed text-slate-400">
                {p.titulos.join(" · ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {ordenes.length === 0 && proyecciones.length === 0 ? (
        <p className="py-8 text-center text-xs text-slate-400">No hay trabajo programado este dia.</p>
      ) : null}
    </Marco>
  );
}

/**
 * La semana con las personas en las filas.
 *
 * En el mes uno ve QUE hay; aqui ve DE QUIEN es. Es la vista donde se nota que
 * un tecnico trae tres dias saturados mientras otro esta libre —eso en la
 * cuadricula del mes queda escondido, porque ahi todo se mezcla por dia.
 */
function RejillaSemana({
  dias, carga, ordenes, proyecciones, hoy, onAbrirDia,
}: {
  dias: string[];
  carga: Dia[];
  ordenes: Orden[];
  proyecciones: Proyeccion[];
  hoy: string;
  onAbrirDia: (fecha: string) => void;
}) {
  const zona = useZona();
  // Las filas: quien tiene trabajo esta semana, y al final lo que no tiene
  // responsable —que es justo lo que hay que repartir.
  const personas = new Map<string, { id: string | null; nombre: string; color: string | null }>();
  for (const o of ordenes) {
    const clave = o.assignedTo?.id ?? "__sin";
    if (!personas.has(clave)) {
      personas.set(clave, {
        id: o.assignedTo?.id ?? null,
        nombre: o.assignedTo?.name ?? "Sin responsable",
        color: o.assignedTo?.color ?? null,
      });
    }
  }
  const filas = [...personas.values()].sort((a, b) => {
    if (a.id === null) return 1;
    if (b.id === null) return -1;
    return a.nombre.localeCompare(b.nombre);
  });

  const cargaDe = (fecha: string) => carga.find((c) => mismoDia(c.fecha, fecha));
  const deDia = (fecha: string, personaId: string | null) =>
    ordenes.filter(
      (o) => o.dueDate && mismoDia(o.dueDate, fecha) && (o.assignedTo?.id ?? null) === personaId,
    );

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[52rem]">
        <div className="grid border-b border-slate-200 bg-slate-50/60" style={{ gridTemplateColumns: "10rem repeat(7, 1fr)" }}>
          <div className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-wide text-slate-400">
            Responsable
          </div>
          {dias.map((fecha) => {
            const c = cargaDe(fecha);
            const esHoy = fecha.slice(0, 10) === hoy;
            const d = diaDeCalendario(fecha, zona);
            return (
              <button
                key={fecha}
                type="button"
                onClick={() => onAbrirDia(fecha)}
                className={cn(
                  "border-l border-slate-200 px-2 py-2 text-center transition-colors hover:bg-slate-100",
                  !c?.habil && "bg-slate-100/70",
                  c?.sobrecargado && "bg-amber-100/70",
                )}
                title={c?.festivo ?? undefined}
              >
                <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-slate-500">
                  {DIAS[(d.getDay() + 6) % 7]}
                </p>
                <p className={cn("text-sm font-medium", esHoy ? "text-brand-600" : "text-slate-700")}>
                  {d.getDate()}
                </p>
                {c?.festivo ? (
                  <p className="truncate text-[9px] text-slate-400">{c.festivo}</p>
                ) : c && c.horas > 0 ? (
                  <p className={cn("text-[9px] tabular-nums", c.sobrecargado ? "font-semibold text-amber-800" : "text-slate-400")}>
                    {c.horas}h
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>

        {filas.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-slate-400">
            No hay trabajo programado esta semana.
          </p>
        ) : (
          filas.map((persona) => (
            <div
              key={persona.id ?? "sin"}
              className="grid border-b border-slate-100"
              style={{ gridTemplateColumns: "10rem repeat(7, 1fr)" }}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: persona.color ?? "#cbd5e1" }} />
                <span className={cn("truncate text-xs", persona.id ? "text-slate-700" : "font-medium text-amber-700")}>
                  {persona.nombre}
                </span>
              </div>

              {dias.map((fecha) => {
                const suyas = deDia(fecha, persona.id);
                const c = cargaDe(fecha);
                const suCarga = c?.personas.find((p) => p.userId === persona.id);
                const excedido = (suCarga?.ocupacion ?? 0) > 1;

                return (
                  <div
                    key={fecha}
                    className={cn(
                      "min-h-16 border-l border-slate-100 p-1",
                      !c?.habil && "bg-slate-50/60",
                      excedido && "bg-amber-50",
                    )}
                  >
                    {suyas.map((o) => (
                      <Link
                        key={o.id}
                        href={`/work-orders/${o.id}`}
                        className={cn(
                          "mb-1 block truncate rounded border px-1 py-0.5 text-[0.625rem] font-medium",
                          MAINTENANCE_TYPE_COLORS[o.maintenanceType],
                          !OPEN_STATUSES.includes(o.status) && "opacity-50 line-through",
                        )}
                        title={`${o.number} — ${o.title} · ${o.estimatedHours}h · ${o.asset?.code ?? "sin activo"} · ${o.vencimiento}`}
                      >
                        {o.title}
                      </Link>
                    ))}
                    {suCarga && suCarga.horas > 0 ? (
                      <p className={cn(
                        "px-1 text-[9px] tabular-nums",
                        excedido ? "font-semibold text-amber-800" : "text-slate-400",
                      )}>
                        {suCarga.horas}h{suCarga.capacidad > 0 ? ` / ${suCarga.capacidad}h` : " · no laborable"}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))
        )}

        {proyecciones.length > 0 ? (
          <div className="grid border-t border-slate-200 bg-slate-50/40" style={{ gridTemplateColumns: "10rem repeat(7, 1fr)" }}>
            <div className="px-3 py-2 text-[0.625rem] font-medium uppercase tracking-wide text-slate-400">
              Proyectado
            </div>
            {dias.map((fecha) => (
              <div key={fecha} className="min-h-12 border-l border-slate-100 p-1">
                {proyecciones.filter((p) => mismoDia(p.date, fecha)).map((p) => (
                  <span
                    key={p.id}
                    className="mb-1 block truncate rounded border border-dashed border-slate-300 bg-white px-1 py-0.5 text-[0.625rem] text-slate-500"
                    title={`${p.title} — ${p.asset}`}
                  >
                    ◇ {p.title}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
