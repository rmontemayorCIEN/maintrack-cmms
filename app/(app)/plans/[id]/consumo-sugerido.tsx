"use client";

import { useState } from "react";
import { Check, Loader2, PackagePlus, Sparkles, X } from "lucide-react";
import { formatNumber } from "@/lib/utils";

/**
 * Qué consume cada actividad, propuesto y revisado.
 *
 * ── Por qué se acepta una por una ──
 *
 * Este dato se convierte después en compras: la proyección lo usa para decir
 * qué pedir y cuánto. Un «aceptar todo» sin leer mete material que nadie
 * verificó en la lista de compras del trimestre, y el error se descubre
 * cuando llega la factura. Cada renglón se marca a mano, y nada se guarda
 * hasta que alguien le da guardar.
 *
 * ── Las tres respuestas ──
 *
 * Se enseñan las tres, no solo las propuestas: las actividades que NO
 * consumen material son una respuesta válida —y la más común— y saberlo es lo
 * que permite dejar de buscarles refacción. Las que consumen algo que no está
 * en el catálogo son la tercera, y ésas son tarea de almacén, no del plan.
 */

type Linea = {
  taskId: string;
  titulo: string;
  refacciones: Array<{ partId: string; code: string; name: string; unit: string; cantidad: number; porQue: string }>;
};
type Propuesta = {
  lineas: Linea[];
  sinConsumo: Array<{ numero: number; id: string; titulo: string }>;
  sinCatalogo: Array<{
    taskId: string; titulo: string; queFalta: string;
    codigo: string; codigoOcupado: boolean; nombre: string; unidad: string; cantidad: number;
  }>;
  inventadas: string[];
};

export function ConsumoSugerido({ planId, disponible }: { planId: string; disponible: boolean }) {
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [p, setP] = useState<Propuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  // Clave «tarea|refacción»: se acepta renglón por renglón.
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  /**
   * Las altas se editan antes de crearse, y NO vienen marcadas.
   *
   * Lo demas se marca solo porque solo cuelga material que ya existe; esto
   * crea un renglon nuevo en el catalogo del almacen, que es de otra persona y
   * dura para siempre. Un catalogo se ensucia una vez y se limpia durante
   * meses (para eso existe la pantalla de duplicados): que cueste un clic mas.
   */
  const [altas, setAltas] = useState<Map<string, { code: string; name: string; unit: string; cantidad: string; on: boolean }>>(new Map());

  if (!disponible) return null;
  const clave = (t: string, r: string) => `${t}|${r}`;

  async function proponer() {
    setCargando(true); setError(null); setListo(null); setP(null);
    try {
      const res = await fetch("/api/ia/recursos-plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "No se pudo revisar el plan."); return; }
      setP(d);
      // Todo marcado de entrada, pero visible: lo que se quita es más rápido
      // de ver que lo que falta por marcar.
      setElegidas(new Set((d.lineas as Linea[]).flatMap((l) => l.refacciones.map((r) => clave(l.taskId, r.partId)))));
      setAltas(new Map((d.sinCatalogo as Propuesta["sinCatalogo"]).map((x) => [
        x.taskId,
        // El código repetido llega vacío: se pide uno, en vez de reventar al guardar.
        { code: x.codigoOcupado ? "" : x.codigo, name: x.nombre, unit: x.unidad || "pza", cantidad: String(x.cantidad), on: false },
      ])));
    } catch {
      setError("Se perdió la conexión.");
    } finally { setCargando(false); }
  }

  async function guardar() {
    if (!p || guardando) return;
    const lineas = p.lineas
      .map((l) => ({
        taskId: l.taskId,
        refacciones: l.refacciones.filter((r) => elegidas.has(clave(l.taskId, r.partId))).map((r) => ({ partId: r.partId, cantidad: r.cantidad })),
      }))
      .filter((l) => l.refacciones.length);
    const nuevas = [...altas.entries()]
      .filter(([, a]) => a.on && a.code.trim() && a.name.trim() && Number(a.cantidad) > 0)
      .map(([taskId, a]) => ({ taskId, code: a.code.trim(), name: a.name.trim(), unit: a.unit.trim() || "pza", cantidad: Number(a.cantidad) }));
    if (!lineas.length && !nuevas.length) { setError("No hay nada marcado para guardar."); return; }
    setGuardando(true); setError(null);
    try {
      const res = await fetch("/api/ia/recursos-plan", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, lineas, altas: nuevas }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "No se pudo guardar."); return; }
      setListo(
        `Se cargó el consumo de ${d.actividades} actividad(es): ${d.refacciones} refacción(es)`
        + (d.creadas ? `, ${d.creadas} dada(s) de alta en el almacén` : "")
        + (d.ocupados?.length ? `. Estos códigos ya existían y no se crearon: ${d.ocupados.join(", ")}` : "."),
      );
      setP(null);
      // La pantalla la pinta el servidor: al recargar se ve lo guardado.
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setError("Se perdió la conexión.");
    } finally { setGuardando(false); }
  }

  const marcadas = p
    ? p.lineas.flatMap((l) => l.refacciones.filter((r) => elegidas.has(clave(l.taskId, r.partId)))).length
      + [...altas.values()].filter((a) => a.on && a.code.trim() && a.name.trim()).length
    : 0;

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      {!p ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button" onClick={() => void proponer()} disabled={cargando}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
            {cargando ? "Revisando el plan…" : "Sugerir qué consume cada actividad"}
          </button>
          <span className="text-[0.625rem] text-slate-500">
            Propone del catálogo de su empresa. Nada se guarda sin que usted lo marque.
          </span>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      {listo ? <p className="mt-2 text-xs font-medium text-emerald-700">{listo}</p> : null}

      {p ? (
        <div className="grid gap-3">
          {p.lineas.length ? (
            <ul className="grid gap-2">
              {p.lineas.map((l) => (
                <li key={l.taskId} className="rounded-lg border border-slate-200 p-2.5">
                  <p className="text-xs font-medium text-slate-800">{l.titulo}</p>
                  <ul className="mt-1.5 grid gap-1">
                    {l.refacciones.map((r) => {
                      const k = clave(l.taskId, r.partId);
                      const on = elegidas.has(k);
                      return (
                        <li key={k}>
                          <label className="flex cursor-pointer items-start gap-2 text-xs">
                            <input
                              type="checkbox" checked={on}
                              onChange={() => setElegidas((s) => {
                                const n = new Set(s);
                                if (n.has(k)) n.delete(k); else n.add(k);
                                return n;
                              })}
                              className="mt-0.5 h-3.5 w-3.5"
                            />
                            <span className={on ? "text-slate-800" : "text-slate-400"}>
                              <span className="font-medium tabular-nums">{formatNumber(r.cantidad, 2)} {r.unit}</span> de {r.code} · {r.name}
                              {r.porQue ? <span className="block text-[0.625rem] text-slate-500">{r.porQue}</span> : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">No propuso material para ninguna actividad.</p>
          )}

          {p.sinConsumo.length ? (
            <p className="text-[0.6875rem] text-slate-500">
              <Check className="mr-1 inline h-3.5 w-3.5 text-emerald-600" aria-hidden />
              <span className="font-medium">{p.sinConsumo.length} actividad(es) no gastan material</span> —revisar, medir,
              limpiar o probar—: {p.sinConsumo.map((s) => s.titulo).join("; ")}. Es una respuesta correcta, no un hueco.
            </p>
          ) : null}

          {p.sinCatalogo.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[0.6875rem] text-amber-900">
              <p className="font-medium">
                <PackagePlus className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                {p.sinCatalogo.length} actividad(es) consumen algo que NO está en su catálogo. Puede darlo de alta aquí:
              </p>
              <ul className="mt-1.5 grid gap-2">
                {p.sinCatalogo.map((x) => {
                  const a = altas.get(x.taskId);
                  if (!a) return null;
                  const set = (campo: "code" | "name" | "unit" | "cantidad", v: string) =>
                    setAltas((m) => new Map(m).set(x.taskId, { ...a, [campo]: v }));
                  return (
                    <li key={x.taskId} className="rounded-lg border border-amber-200 bg-white p-2">
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox" checked={a.on}
                          onChange={() => setAltas((m) => new Map(m).set(x.taskId, { ...a, on: !a.on }))}
                          className="mt-0.5 h-3.5 w-3.5"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-800">{x.titulo}</span>
                          <span className="block text-slate-600">{x.queFalta}</span>
                        </span>
                      </label>
                      {a.on ? (
                        <div className="mt-2 grid gap-1.5 pl-5 sm:grid-cols-[7rem_minmax(0,1fr)_4rem_4rem]">
                          <label className="text-[0.625rem] text-slate-500">
                            Código
                            <input className="field" value={a.code} onChange={(e) => set("code", e.target.value.toUpperCase().slice(0, 40))}
                              placeholder={x.codigoOcupado ? "Ya existe: ponga otro" : ""} />
                          </label>
                          <label className="text-[0.625rem] text-slate-500">
                            Nombre
                            <input className="field" value={a.name} onChange={(e) => set("name", e.target.value.slice(0, 160))} />
                          </label>
                          <label className="text-[0.625rem] text-slate-500">
                            Unidad
                            <input className="field" value={a.unit} onChange={(e) => set("unit", e.target.value.slice(0, 20))} />
                          </label>
                          <label className="text-[0.625rem] text-slate-500">
                            Cantidad
                            <input className="field" inputMode="decimal" value={a.cantidad} onChange={(e) => set("cantidad", e.target.value.replace(/[^\d.]/g, "").slice(0, 8))} />
                          </label>
                          {x.codigoOcupado && !a.code ? (
                            <p className="text-[0.625rem] text-amber-800 sm:col-span-4">
                              El código que propuso ya existe en su catálogo. Escriba otro.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1.5">
                Lo que marque se da de alta en el almacén y queda colgado de su actividad, en un solo paso. Nace sin
                existencia ni mínimo: eso se captura después en Almacén, con el primer conteo o la primera compra.
              </p>
            </div>
          ) : null}

          {p.inventadas.length ? (
            <p className="text-[0.625rem] text-slate-400">
              Se descartaron {p.inventadas.length} código(s) que no existen en su catálogo: {p.inventadas.join(", ")}.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button" onClick={() => void guardar()} disabled={guardando || !marcadas}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Guardar {marcadas} marcada(s)
            </button>
            <button
              type="button" onClick={() => { setP(null); setError(null); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Descartar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
