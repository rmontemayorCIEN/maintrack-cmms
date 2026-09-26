"use client";

import { useState } from "react";
import { Loader2, Star } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { IconoMenu } from "@/components/shell/iconos";
import { MAXIMO_FAVORITOS } from "@/lib/favoritos";
import type { GrupoMenu } from "@/lib/pantallas";

/**
 * Las pantallas que cada quien quiere a la mano.
 *
 * ── Por qué se eligen aquí y no con una estrella en el menú ──
 *
 * La estrella al pasar el ratón no existe en el teléfono, y resolverlo con un
 * modo «editar» en el menú deja un botón extra estorbando todos los días para
 * algo que se hace dos veces al año. Aquí se ve la lista completa —incluidas
 * las pantallas que quizá no sabía que existían— y se elige de una sentada.
 *
 * ── Por qué se ven agrupadas como el menú ──
 *
 * Porque es el mismo sistema. Si aquí aparecieran en otro orden o con otros
 * nombres, elegir sería un ejercicio de traducción.
 */
export function PanelAtajos({
  grupos, iniciales,
}: {
  /** El menú de esta persona, tal como lo ve. */
  grupos: GrupoMenu[];
  iniciales: string[];
}) {
  const [elegidas, setElegidas] = useState<string[]>(iniciales);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const lleno = elegidas.length >= MAXIMO_FAVORITOS;

  function alternar(href: string) {
    setListo(false);
    setError(null);
    setElegidas((antes) => {
      if (antes.includes(href)) return antes.filter((x) => x !== href);
      if (antes.length >= MAXIMO_FAVORITOS) {
        setError(`Caben ${MAXIMO_FAVORITOS}. Quite alguno antes de agregar otro.`);
        return antes;
      }
      // Se agregan al final: el orden es el que la persona fue eligiendo.
      return [...antes, href];
    });
  }

  async function guardar() {
    setGuardando(true); setError(null); setListo(false);
    try {
      const r = await fetch("/api/favoritos", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rutas: elegidas }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo guardar."); return; }
      setListo(true);
      // El menú lo pinta el servidor: al recargar aparecen arriba.
      setTimeout(() => window.location.reload(), 900);
    } catch {
      setError("Se perdió la conexión.");
    } finally { setGuardando(false); }
  }

  const nombrePorRuta = new Map(grupos.flatMap((g) => g.items.map((i) => [i.href, i] as const)));

  return (
    <Card>
      <CardHeader
        title="Lo que más uso"
        subtitle={
          "Marque las pantallas que abre a diario y aparecerán hasta arriba del menú, antes de los grupos. "
          + "Es suyo: no cambia el menú de nadie más, ni los nombres de las cosas."
        }
      />

      {elegidas.length ? (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
          <p className="mb-1.5 text-[0.625rem] font-semibold uppercase tracking-wide text-slate-500">
            En este orden ({elegidas.length} de {MAXIMO_FAVORITOS})
          </p>
          <ol className="flex flex-wrap gap-1.5">
            {elegidas.map((href, i) => {
              const item = nombrePorRuta.get(href);
              return (
                <li key={href}>
                  <button
                    type="button" onClick={() => alternar(href)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs text-brand-800 hover:bg-brand-100"
                    title="Quitar de los accesos rápidos"
                  >
                    <span className="text-brand-400">{i + 1}.</span>
                    {item ? <IconoMenu nombre={item.icono} className="h-3.5 w-3.5" /> : null}
                    {item?.etiqueta ?? href}
                    <span aria-hidden>×</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      <div className="grid gap-3">
        {grupos.map((g) => (
          <div key={g.clave}>
            <p className="mb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-slate-500">{g.seccion}</p>
            <ul className="grid gap-0.5 sm:grid-cols-2">
              {g.items.map((item) => {
                const on = elegidas.includes(item.href);
                return (
                  <li key={item.href}>
                    <label className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${on ? "bg-brand-50 text-brand-900" : "text-slate-700 hover:bg-slate-50"} ${!on && lleno ? "opacity-50" : ""}`}>
                      <input
                        type="checkbox" checked={on} onChange={() => alternar(item.href)}
                        disabled={!on && lleno}
                        className="h-3.5 w-3.5"
                      />
                      <IconoMenu nombre={item.icono} className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 truncate">{item.etiqueta}</span>
                      {on ? <Star className="ml-auto h-3.5 w-3.5 shrink-0 fill-current text-brand-500" aria-hidden /> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      {listo ? <p className="mt-2 text-xs font-medium text-emerald-700">Guardado. Ya aparecen arriba del menú.</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button" onClick={() => void guardar()} disabled={guardando}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
        >
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Guardar
        </button>
        {elegidas.length ? (
          <button
            type="button" onClick={() => { setElegidas([]); setListo(false); setError(null); }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Quitar todos
          </button>
        ) : null}
      </div>
    </Card>
  );
}
