"use client";

import { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { PlanDialog, type Task } from "./plan-dialog";
import type { Opcion } from "./recursos-tarea";
import { SelectorBuscable } from "@/components/selector-buscable";

type Borrador = {
  name: string; description: string; maintenanceType: string; triggerType: string;
  intervalDays: string; priority: string; estimatedHours: string;
  requiresShutdown: boolean; safetyNotes: string; tasks: Task[];
};

/**
 * Redaccion asistida de un plan.
 *
 * Pide el equipo y, si el usuario quiere, un par de indicaciones de contexto
 * —horas de operacion, ambiente, lo que sepa y no este en el sistema—. Lo que
 * vuelve es un borrador que se abre en el formulario normal de alta.
 *
 * Deliberadamente no guarda nada: un plan mal puesto genera ordenes
 * equivocadas durante anos, asi que siempre pasa por revision humana.
 */
export function GeneradorPlan({
  assets,
  meters,
  technicians,
  especialidades,
  refacciones,
  servicios,
  moneda,
  puedeCrearCatalogos,
  operacionesRestantes,
}: {
  assets: Array<{ id: string; code: string; name: string }>;
  meters: Array<{ id: string; name: string; unit: string; assetId: string; currentValue: number }>;
  technicians: Array<{ id: string; name: string }>;
  especialidades: Opcion[];
  refacciones: Opcion[];
  servicios: Opcion[];
  moneda: string;
  puedeCrearCatalogos: boolean;
  operacionesRestantes: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const [assetId, setAssetId] = useState(assets[0]?.id ?? "");
  const [notas, setNotas] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [faltantes, setFaltantes] = useState<string[]>([]);
  const [justificacion, setJustificacion] = useState("");

  async function generar() {
    setCargando(true);
    setError(null);
    const res = await fetch("/api/ia/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId, notas: notas || null }),
    });
    const data = await res.json();
    setCargando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible generar el plan"); return; }
    setBorrador(data.formulario);
    setFaltantes(data.faltantes ?? []);
    setJustificacion(data.justificacion ?? "");
    setAbierto(false);
  }

  if (borrador) {
    const activo = assets.find((a) => a.id === assetId);
    const aviso = [
      justificacion ? `Criterio de la propuesta: ${justificacion}` : null,
      faltantes.length
        ? `No se incluyo lo siguiente porque no existe en sus catalogos: ${faltantes.join(", ")}. Puede darlo de alta y agregarlo a mano.`
        : null,
    ].filter(Boolean).join(" ");

    return (
      <PlanDialog
        assets={assets}
        meters={meters}
        technicians={technicians}
        especialidades={especialidades}
        refacciones={refacciones}
        servicios={servicios}
        moneda={moneda}
        puedeCrearCatalogos={puedeCrearCatalogos}
        aviso={aviso || null}
        borrador={{
          ...borrador,
          assetId: activo?.id ?? assets[0]?.id ?? "",
          intervalDays: Number(borrador.intervalDays),
          estimatedHours: Number(borrador.estimatedHours),
        }}
        onCerrar={() => setBorrador(null)}
      />
    );
  }

  if (!abierto) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setAbierto(true)} disabled={operacionesRestantes < 2}>
        <Sparkles className="h-3.5 w-3.5" />
        Redactar con IA
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 text-left">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Redactar un plan con IA</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Toma los datos del equipo, su historial de fallas y sus catalogos, y propone el plan completo.
              Usted lo revisa antes de crearlo.
            </p>
          </div>
          <button type="button" onClick={() => setAbierto(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4">
          <div>
            <label className="label">Equipo</label>
            <SelectorBuscable
              valor={assetId}
              onCambio={setAssetId}
              vacio={null}
              marcador="Busque por clave o nombre del equipo"
              opciones={assets.map((a) => ({ id: a.id, etiqueta: `${a.code} — ${a.name}` }))}
            />
          </div>
          <div>
            <label className="label">Lo que usted sabe y el sistema no (opcional)</label>
            <textarea
              className="field min-h-20"
              placeholder="Ej: opera 16 horas al dia en ambiente con polvo de fundicion; el fabricante pide cambio de aceite cada 2,000 horas."
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              maxLength={600}
            />
            <p className="mt-1 text-[0.6875rem] text-slate-500">
              Condiciones de operacion, exigencias del fabricante o normas que deba cumplir.
            </p>
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-2">
          <span className="text-[0.6875rem] text-slate-400">Consume 2 operaciones de IA</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button>
            <Button onClick={generar} disabled={cargando || !assetId}>
              {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {cargando ? "Redactando…" : "Redactar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
