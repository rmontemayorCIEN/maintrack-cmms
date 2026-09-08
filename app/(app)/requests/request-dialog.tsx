"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui";
import { Adjuntos } from "@/components/adjuntos";
import { PRIORITY_LABELS } from "@/lib/constants";
import { SelectorBuscable } from "@/components/selector-buscable";
import { CampoTitulo } from "@/components/campo-titulo";

export function RequestDialog({ assets }: { assets: Array<{ id: string; code: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", assetId: "", priority: "MEDIUM" });
  // Tras enviar, la solicitud ya existe y se le pueden colgar fotos. Es el
  // momento natural: quien reporta esta parado frente a la falla.
  const [creada, setCreada] = useState<{ id: string; numero: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, assetId: form.assetId || null }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "No fue posible enviar la solicitud");
      return;
    }
    setForm({ title: "", description: "", assetId: "", priority: "MEDIUM" });
    // Sin router.refresh() aqui: refrescar el arbol del servidor remonta este
    // dialogo y se pierde el estado, con lo que el paso de adjuntar nunca se
    // llega a ver. La lista se actualiza al cerrar.
    setCreada({ id: data.request.id, numero: data.request.number });
  }

  function cerrar() {
    setOpen(false);
    setCreada(null);
    setError(null);
    router.refresh();
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Reportar falla
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      {creada ? (
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Solicitud {creada.numero} enviada</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Ya avisamos al supervisor. Si puede, agregue una foto de la falla: acorta el diagnostico.
              </p>
            </div>
            <button type="button" onClick={cerrar} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>

          <Adjuntos
            destino={{ workRequestId: creada.id }}
            adjuntos={[]}
            editable
            titulo="Foto de la falla"
            ayuda="Opcional. Una imagen del síntoma suele ahorrar una visita de diagnóstico."
          />

          <div className="mt-5 flex justify-end">
            <Button onClick={cerrar}>Listo</Button>
          </div>
        </div>
      ) : (
      <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Reportar una falla</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              El supervisor revisara la solicitud y la convertira en orden de trabajo.
            </p>
          </div>
          <button type="button" onClick={cerrar} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4">
          <div>
            <label className="label">¿Qué ocurre?</label>
            <CampoTitulo
              value={form.title}
              onChange={(v) => setForm((f) => ({ ...f, title: v }))}
              placeholder="Ej. Fuga de aceite en reductor"
              required
              minLength={3}
            />
          </div>
          <div>
            <label className="label">Detalle</label>
            <textarea
              className="field min-h-24"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Cuando comenzo, si el equipo sigue operando, ruidos o síntomas observados…"
            />
          </div>
          <div>
            <label className="label">Activo afectado</label>
            <SelectorBuscable
              valor={form.assetId}
              onCambio={(id) => setForm((f) => ({ ...f, assetId: id }))}
              vacio="No identificado"
              marcador="Busque por clave o nombre del equipo"
              opciones={assets.map((a) => ({ id: a.id, etiqueta: `${a.code} — ${a.name}` }))}
            />
          </div>
          <div>
            <label className="label">Urgencia</label>
            <select className="field" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
              {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={cerrar}>Cancelar</Button>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enviar solicitud
          </Button>
        </div>
      </form>
      )}
    </div>
  );
}
