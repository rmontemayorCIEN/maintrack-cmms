"use client";

import { useZona } from "@/components/zona-empresa";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { cn, diaDeCalendario } from "@/lib/utils";

const SEMANA = [
  { n: 1, corto: "Lun" }, { n: 2, corto: "Mar" }, { n: 3, corto: "Mie" },
  { n: 4, corto: "Jue" }, { n: 5, corto: "Vie" }, { n: 6, corto: "Sab" }, { n: 7, corto: "Dom" },
];

type Festivo = { id: string; fecha: string; nombre: string; deLey: boolean };
type Persona = { id: string; name: string; role: string; horasDisponibles: number | null };

/**
 * Jornada, dias no laborables y capacidad por persona.
 *
 * De aqui sale si un dia del calendario cabe o no cabe, y en que fechas puede
 * programar el programador. La capacidad se define por excepcion: la
 * organizacion fija el numero general y solo quien tenga un horario distinto
 * lleva el suyo.
 */
export function ConfiguracionJornada({
  horasJornada, diasHabiles, festivos, personas, editable,
}: {
  horasJornada: number;
  diasHabiles: number[];
  festivos: Festivo[];
  personas: Persona[];
  editable: boolean;
}) {
  const zona = useZona();
  const router = useRouter();
  const [horas, setHoras] = useState(String(horasJornada));
  const [dias, setDias] = useState<number[]>(diasHabiles);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [nuevaFecha, setNuevaFecha] = useState("");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [errorFestivo, setErrorFestivo] = useState<string | null>(null);

  async function guardarJornada() {
    if (!dias.length) { setMensaje("Elija al menos un dia de trabajo"); return; }
    setGuardando(true); setMensaje(null);
    const res = await fetch("/api/agenda/config", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ horasJornada: Number(horas) || 8, diasHabiles: dias }),
    });
    setGuardando(false);
    setMensaje(res.ok ? "Guardado" : "No fue posible guardar");
    if (res.ok) router.refresh();
  }

  async function guardarPersona(id: string, valor: string) {
    const horasDisponibles = valor.trim() === "" ? null : Number(valor);
    await fetch("/api/agenda/config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: id, horasDisponibles }),
    });
    router.refresh();
  }

  async function agregarFestivo() {
    setErrorFestivo(null);
    const res = await fetch("/api/agenda/festivos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha: nuevaFecha, nombre: nuevoNombre }),
    });
    if (!res.ok) {
      const cuerpo = await res.json().catch(() => null);
      setErrorFestivo(cuerpo?.error ?? "No se pudo agregar");
      return;
    }
    setNuevaFecha(""); setNuevoNombre("");
    router.refresh();
  }

  async function quitarFestivo(id: string) {
    await fetch("/api/agenda/festivos", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  async function sembrar(anio: number) {
    await fetch("/api/agenda/festivos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sembrarAnio: anio }),
    });
    router.refresh();
  }

  const anioSiguiente = new Date().getFullYear() + 1;
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
      .format(diaDeCalendario(iso, zona));

  return (
    <div className="grid gap-4">
      <Card>
        <p className="text-sm font-semibold text-slate-800">Jornada de trabajo</p>
        <p className="mt-0.5 text-xs text-slate-500">
          De aquí sale si un dia del calendario cabe, y en que fechas puede programar el programador.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Horas de trabajo al día</label>
            <input
              type="number" inputMode="decimal" step="0.5" min="1" max="24"
              className="field max-w-28"
              disabled={!editable}
              value={horas}
              onChange={(e) => setHoras(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              El valor general. Abajo se ajusta a quien tenga un horario distinto.
            </p>
          </div>

          <div>
            <label className="label">Días que se trabajan</label>
            <div className="flex flex-wrap gap-1">
              {SEMANA.map((d) => {
                const activo = dias.includes(d.n);
                return (
                  <button
                    key={d.n}
                    type="button"
                    disabled={!editable}
                    onClick={() => setDias((p) => (activo ? p.filter((x) => x !== d.n) : [...p, d.n]))}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      activo
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-slate-200 text-slate-500 hover:bg-slate-50",
                      !editable && "cursor-not-allowed opacity-60",
                    )}
                  >
                    {d.corto}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              En un dia apagado, la capacidad es cero y el trabajo programado sale marcado.
            </p>
          </div>
        </div>

        {editable ? (
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={guardarJornada} disabled={guardando}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
            {mensaje ? <span className="text-xs text-slate-500">{mensaje}</span> : null}
          </div>
        ) : null}
      </Card>

      <Card>
        <p className="text-sm font-semibold text-slate-800">Capacidad por persona</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Solo para quien trabaje distinto. En blanco usa la jornada general de {horasJornada} h.
        </p>
        <ul className="mt-3 grid gap-1.5">
          {personas.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{p.name}</span>
              <span className="hidden text-xs text-slate-400 sm:block">{p.role}</span>
              <input
                type="number" inputMode="decimal" step="0.5" min="0" max="24"
                className="field h-8 w-24 py-0 text-xs"
                disabled={!editable}
                placeholder={`${horasJornada} h`}
                defaultValue={p.horasDisponibles ?? ""}
                onBlur={(e) => editable && guardarPersona(p.id, e.target.value)}
              />
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-800">Días no laborables</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Los de ley vienen cargados. Agregue los suyos: aniversario de la planta, vacaciones,
              o lo que su empresa cierre.
            </p>
          </div>
          {editable ? (
            <Button variant="ghost" onClick={() => sembrar(anioSiguiente)}>
              Cargar los de ley de {anioSiguiente}
            </Button>
          ) : null}
        </div>

        {editable ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="label">Fecha</label>
              <input type="date" className="field h-9" value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)} />
            </div>
            <div className="min-w-48 flex-1">
              <label className="label">Motivo</label>
              <input className="field h-9" maxLength={80} placeholder="Ej. Aniversario de la planta" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
            </div>
            <Button onClick={agregarFestivo} disabled={!nuevaFecha || nuevoNombre.trim().length < 2}>
              <Plus className="h-4 w-4" />
              Agregar
            </Button>
          </div>
        ) : null}
        {errorFestivo ? <p className="mt-2 text-xs text-rose-600">{errorFestivo}</p> : null}

        {festivos.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
            No hay días no laborables registrados.
          </p>
        ) : (
          <ul className="mt-3 grid gap-1">
            {festivos.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs">
                <span className="w-44 shrink-0 capitalize tabular-nums text-slate-600">{fmt(f.fecha)}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{f.nombre}</span>
                {f.deLey ? <Badge tone="muted">De ley</Badge> : null}
                {editable ? (
                  <button
                    type="button"
                    onClick={() => quitarFestivo(f.id)}
                    className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    aria-label={`Quitar ${f.nombre}`}
                    title={f.deLey ? "Es de ley. Quitelo solo si su empresa si trabaja ese dia." : "Quitar"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
