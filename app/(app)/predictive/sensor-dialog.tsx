"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui";
import { SENSOR_TYPE_LABELS } from "@/lib/constants";
import { SelectorBuscable } from "@/components/selector-buscable";

const DEFAULT_UNITS: Record<string, string> = {
  VIBRATION: "mm/s",
  TEMPERATURE: "°C",
  PRESSURE: "bar",
  CURRENT: "A",
  OIL: "ppm",
  ULTRASOUND: "dB",
  FLOW: "l/min",
  RPM: "rpm",
};

export function SensorDialog({ assets }: { assets: Array<{ id: string; code: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    assetId: assets[0]?.id ?? "",
    name: "",
    sensorType: "VIBRATION",
    unit: "mm/s",
    warningThreshold: "4.5",
    criticalThreshold: "7.1",
    direction: "ABOVE",
    samplingHours: "24",
  });

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "sensorType" ? { unit: DEFAULT_UNITS[value] ?? "" } : {}),
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/sensors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        warningThreshold: form.warningThreshold ? Number(form.warningThreshold) : null,
        criticalThreshold: form.criticalThreshold ? Number(form.criticalThreshold) : null,
        samplingHours: Number(form.samplingHours),
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "No fue posible crear el sensor");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Nuevo punto de monitoreo
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/40 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Nuevo punto de monitoreo</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Al superar el umbral crítico se genera automaticamente una OT predictiva.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Activo</label>
            <SelectorBuscable
              valor={form.assetId}
              onCambio={(id) => set("assetId", id)}
              vacio={null}
              requerido
              marcador="Busque por clave o nombre del equipo"
              opciones={assets.map((a) => ({ id: a.id, etiqueta: `${a.code} — ${a.name}` }))}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Nombre del punto</label>
            <input className="field" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. Vibracion lado acoplamiento" required />
          </div>
          <div>
            <label className="label">Variable</label>
            <select className="field" value={form.sensorType} onChange={(e) => set("sensorType", e.target.value)}>
              {Object.entries(SENSOR_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Unidad</label>
            <input className="field" value={form.unit} onChange={(e) => set("unit", e.target.value)} required />
          </div>
          <div>
            <label className="label">Umbral de alerta</label>
            <input type="number" step="0.01" className="field" value={form.warningThreshold} onChange={(e) => set("warningThreshold", e.target.value)} />
          </div>
          <div>
            <label className="label">Umbral crítico</label>
            <input type="number" step="0.01" className="field" value={form.criticalThreshold} onChange={(e) => set("criticalThreshold", e.target.value)} />
          </div>
          <div>
            <label className="label">Dirección de la falla</label>
            <select className="field" value={form.direction} onChange={(e) => set("direction", e.target.value)}>
              <option value="ABOVE">Falla al subir</option>
              <option value="BELOW">Falla al bajar</option>
            </select>
          </div>
          <div>
            <label className="label">Frecuencia de muestreo (h)</label>
            <input type="number" min="1" className="field" value={form.samplingHours} onChange={(e) => set("samplingHours", e.target.value)} />
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Crear sensor
          </Button>
        </div>
      </form>
    </div>
  );
}
