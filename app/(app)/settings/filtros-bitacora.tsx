"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { ACCIONES_SENSIBLES, MODULOS_BITACORA } from "@/lib/bitacora";

/**
 * Filtros de la bitácora, en la URL.
 *
 * Van en la URL y no en estado del cliente por lo mismo que las pestañas: así
 * un hallazgo se comparte pegando la dirección —«mira lo que hizo esta persona
 * el martes»— y el servidor consulta solo lo que se pidió.
 */
export function FiltrosBitacora({
  usuarios,
}: {
  usuarios: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function poner(clave: string, valor: string) {
    const siguiente = new URLSearchParams(params.toString());
    siguiente.set("s", "auditoria");
    if (valor) siguiente.set(clave, valor);
    else siguiente.delete(clave);
    router.push(`/settings?${siguiente.toString()}`);
  }

  const activos = ["desde", "hasta", "usuario", "modulo", "accion"].filter((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 px-5 py-3">
      <label className="grid gap-1 text-[0.6875rem] text-slate-500">
        Desde
        <input
          type="date"
          value={params.get("desde") ?? ""}
          onChange={(e) => poner("desde", e.target.value)}
          className="field px-2 py-1 text-xs"
        />
      </label>
      <label className="grid gap-1 text-[0.6875rem] text-slate-500">
        Hasta
        <input
          type="date"
          value={params.get("hasta") ?? ""}
          onChange={(e) => poner("hasta", e.target.value)}
          className="field px-2 py-1 text-xs"
        />
      </label>
      <label className="grid gap-1 text-[0.6875rem] text-slate-500">
        Usuario
        <select
          value={params.get("usuario") ?? ""}
          onChange={(e) => poner("usuario", e.target.value)}
          className="field max-w-44 px-2 py-1 text-xs"
        >
          <option value="">Todos</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-[0.6875rem] text-slate-500">
        Módulo
        <select
          value={params.get("modulo") ?? ""}
          onChange={(e) => poner("modulo", e.target.value)}
          className="field max-w-44 px-2 py-1 text-xs"
        >
          <option value="">Todos</option>
          {Object.entries(MODULOS_BITACORA).map(([clave, m]) => (
            <option key={clave} value={clave}>{m.titulo}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-[0.6875rem] text-slate-500">
        Acción
        <select
          value={params.get("accion") ?? ""}
          onChange={(e) => poner("accion", e.target.value)}
          className="field max-w-44 px-2 py-1 text-xs"
        >
          <option value="">Todas</option>
          <optgroup label="Sensibles">
            {ACCIONES_SENSIBLES.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </optgroup>
        </select>
      </label>

      {activos.length ? (
        <button
          type="button"
          onClick={() => router.push("/settings?s=auditoria")}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[0.6875rem] text-slate-600 hover:bg-slate-50"
        >
          <X className="h-3 w-3" /> Limpiar
        </button>
      ) : null}
    </div>
  );
}
