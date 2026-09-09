"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, Loader2, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui";
import { SelectorBuscable } from "@/components/selector-buscable";
import { TIPOS_EQUIVALENCIA } from "@/lib/equivalencias";
import { cn } from "@/lib/utils";

type Equivalencia = {
  id: string;
  tipo: keyof typeof TIPOS_EQUIVALENCIA;
  nota: string | null;
  hay: number;
  refaccion: { id: string; code: string; name: string; unit: string; quantityOnHand: number };
};

/**
 * Con que mas se puede resolver esta refaccion.
 *
 * Dos casos que la operacion vive todos los dias: la misma pieza de otra marca
 * y el sustituto que sirve cuando la original no llega. El sustituto casi
 * siempre trae una salvedad —"requiere espaciador de 2 mm"— y esa salvedad es
 * lo mas importante del registro: sin ella, alguien monta la pieza equivocada
 * creyendo que hizo bien.
 */
export function EquivalenciasRefaccion({
  partId,
  code,
  editable,
  catalogo,
}: {
  partId: string;
  code: string;
  editable: boolean;
  catalogo: { id: string; code: string; name: string }[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<Equivalencia[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [otra, setOtra] = useState("");
  const [tipo, setTipo] = useState<keyof typeof TIPOS_EQUIVALENCIA>("EQUIVALENTE");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCargando(true);
    const res = await fetch(`/api/refacciones/equivalencias?partId=${partId}`);
    const cuerpo = await res.json().catch(() => null);
    setLista(res.ok ? cuerpo.equivalencias : []);
    setCargando(false);
  }

  useEffect(() => { if (abierto) cargar(); }, [abierto]);

  async function agregar() {
    setGuardando(true); setError(null);
    const res = await fetch("/api/refacciones/equivalencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partId, equivalenteId: otra, tipo, nota: nota.trim() || null }),
    });
    setGuardando(false);
    if (!res.ok) {
      const c = await res.json().catch(() => null);
      setError(c?.error ?? "No se pudo registrar");
      return;
    }
    setOtra(""); setNota(""); setTipo("EQUIVALENTE");
    cargar();
  }

  async function quitar(id: string) {
    await fetch("/api/refacciones/equivalencias", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    cargar();
  }

  const conExistencia = lista?.filter((e) => e.hay > 0).length ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[0.625rem] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        title="Refacciones equivalentes"
      >
        <ArrowLeftRight className="h-3 w-3" />
        Equivalentes
      </button>

      {abierto && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/40 p-4"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.target === e.currentTarget && setAbierto(false)}
            >
              <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">
                      Con qué más se puede resolver
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {code} · lo que sirve en su lugar cuando no llega a tiempo
                    </p>
                  </div>
                  <button type="button" onClick={() => setAbierto(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {cargando ? (
                  <p className="py-8 text-center text-xs text-slate-400">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </p>
                ) : lista && lista.length > 0 ? (
                  <>
                    {conExistencia > 0 ? (
                      <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                        {conExistencia === 1
                          ? "Hay 1 equivalente con existencia."
                          : `Hay ${conExistencia} equivalentes con existencia.`}
                      </p>
                    ) : null}
                    <ul className="mt-3 grid gap-1.5">
                      {lista.map((e) => (
                        <li key={e.id} className={cn(
                          "rounded-lg border px-3 py-2",
                          e.hay > 0 ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200",
                        )}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-slate-800">{e.refaccion.code}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{e.refaccion.name}</span>
                            <Badge tone={e.tipo === "EQUIVALENTE" ? "info" : "warning"}>
                              {e.tipo === "EQUIVALENTE" ? "Misma pieza" : "Sustituto"}
                            </Badge>
                            <span className={cn(
                              "shrink-0 text-xs tabular-nums",
                              e.hay > 0 ? "font-medium text-emerald-700" : "text-slate-400",
                            )}>
                              {e.hay > 0 ? `hay ${e.hay} ${e.refaccion.unit}` : "sin existencia"}
                            </span>
                            {editable ? (
                              <button type="button" onClick={() => quitar(e.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>
                          {e.nota ? (
                            <p className="mt-1 text-xs text-amber-800">⚠ {e.nota}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-4 rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                    Sin equivalentes registrados.
                  </p>
                )}

                {editable ? (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Agregar</p>
                    <div className="mt-2 grid gap-2">
                      <SelectorBuscable
                        valor={otra}
                        onCambio={setOtra}
                        vacio="Elija la refacción"
                        marcador="Busque por clave o descripción"
                        opciones={catalogo
                          .filter((c) => c.id !== partId)
                          .map((c) => ({ id: c.id, etiqueta: `${c.code} — ${c.name}` }))}
                      />
                      <select className="field" value={tipo} onChange={(e) => setTipo(e.target.value as keyof typeof TIPOS_EQUIVALENCIA)}>
                        {Object.entries(TIPOS_EQUIVALENCIA).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                      <input
                        className="field"
                        maxLength={240}
                        value={nota}
                        onChange={(e) => setNota(e.target.value)}
                        placeholder={tipo === "SUSTITUTO" ? "La salvedad: «requiere espaciador de 2 mm»" : "Nota (opcional)"}
                      />
                      {tipo === "SUSTITUTO" && !nota.trim() ? (
                        <p className="text-xs text-amber-700">
                          En un sustituto, la salvedad es lo más importante: sin ella alguien puede montar
                          la pieza equivocada creyendo que hizo bien.
                        </p>
                      ) : null}
                      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
                      <button
                        type="button"
                        onClick={agregar}
                        disabled={!otra || guardando}
                        className="btn-primary justify-self-start"
                      >
                        {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Registrar
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
