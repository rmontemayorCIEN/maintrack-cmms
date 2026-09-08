"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { TIPOS_SOLICITUD, type ClaveTipoSolicitud } from "@/lib/tipos-solicitud";
import { CampoTitulo } from "@/components/campo-titulo";

/**
 * Sumar un reporte a esta orden, o levantar uno nuevo desde aqui.
 *
 * El caso que lo justifica: el tecnico abrio la maquina por el preventivo y
 * encontro algo mas. Si para reportarlo tiene que salirse, buscar otra
 * pantalla y volver, no lo va a reportar. Asi lo levanta donde esta y queda
 * ligado a la orden en la que lo va a atender.
 */
export function AgregarReporte({
  workOrderId,
  pendientes,
}: {
  workOrderId: string;
  /** Reportes de este equipo que nadie ha atendido. */
  pendientes: Array<{ id: string; number: string; title: string }>;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [modo, setModo] = useState<"EXISTENTE" | "NUEVO">(
    pendientes.length ? "EXISTENTE" : "NUEVO",
  );
  const [requestId, setRequestId] = useState(pendientes[0]?.id ?? "");
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [tipo, setTipo] = useState<ClaveTipoSolicitud>("FALLA");
  const [prioridad, setPrioridad] = useState("MEDIUM");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const cuerpo =
      modo === "EXISTENTE"
        ? { modo, requestId }
        : { modo, title: titulo, description: descripcion || null, tipo, priority: prioridad };
    const res = await fetch(`/api/work-orders/${workOrderId}/reportes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const data = await res.json();
    setGuardando(false);
    if (!res.ok) {
      setError(data.error ?? "No fue posible agregar el reporte");
      return;
    }
    setAbierto(false);
    setTitulo("");
    setDescripcion("");
    router.refresh();
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
      >
        <AlertTriangle className="h-3.5 w-3.5" /> Agregar un reporte
      </button>
    );
  }

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      {pendientes.length ? (
        <div className="flex gap-1 rounded-lg bg-white p-0.5 text-xs">
          {(["EXISTENTE", "NUEVO"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              className={`flex-1 rounded-md px-2 py-1 ${
                modo === m ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {m === "EXISTENTE" ? `Uno que ya reportaron (${pendientes.length})` : "Levantar uno nuevo"}
            </button>
          ))}
        </div>
      ) : null}

      {modo === "EXISTENTE" && pendientes.length ? (
        <div>
          <label className="label">Reporte pendiente de este equipo</label>
          <select className="field" value={requestId} onChange={(e) => setRequestId(e.target.value)}>
            {pendientes.map((p) => (
              <option key={p.id} value={p.id}>{p.number} — {p.title}</option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <div>
            <label className="label">Qué encontró</label>
            <CampoTitulo
              value={titulo}
              onChange={setTitulo}
              onEnter={() => { if (titulo.trim().length >= 4) guardar(); }}
              placeholder="Fuga de aceite en el reductor"
            />
          </div>
          <div>
            <label className="label">Detalle</label>
            <textarea
              className="field min-h-16"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Opcional. Lo que ayude a quien lo atienda."
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">De que se trata</label>
              <select
                className="field"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as ClaveTipoSolicitud)}
              >
                {Object.entries(TIPOS_SOLICITUD).map(([clave, t]) => (
                  <option key={clave} value={clave}>{t.etiqueta}</option>
                ))}
              </select>
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
          <p className="text-[0.6875rem] leading-relaxed text-slate-500">
            {TIPOS_SOLICITUD[tipo].descripcion} Queda con folio propio, en el listado de
            solicitudes y en el historial del equipo.
          </p>
        </>
      )}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setAbierto(false)}>Cancelar</Button>
        <Button
          size="sm"
          onClick={guardar}
          disabled={guardando || (modo === "NUEVO" && titulo.trim().length < 4)}
        >
          {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Agregar a esta orden
        </Button>
      </div>
    </div>
  );
}
