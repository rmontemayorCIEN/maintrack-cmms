"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui";

/** Captura manual de una lectura de condicion (ruta de inspeccion). */
export function ReadingForm({ sensorId, unit }: { sensorId: string; unit: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!value) return;
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/sensors/readings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sensorId, value: Number(value), source: "MANUAL" }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setMessage(data.error ?? "Error al registrar la lectura");
      return;
    }
    const result = data.results?.[0];
    if (result?.workOrderNumber) {
      setMessage(`Lectura critica: se genero la OT ${result.workOrderNumber}`);
    } else if (result?.status !== "NORMAL") {
      setMessage("Lectura fuera de umbral: se registro una alerta");
    }
    setValue("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-1.5">
      <div className="flex gap-2">
        <input
          type="number" inputMode="decimal"
          step="0.01"
          className="field"
          placeholder={`Nueva lectura (${unit})`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={loading || !value}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Registrar
        </Button>
      </div>
      {message ? <p className="text-[0.6875rem] font-medium text-amber-700">{message}</p> : null}
    </form>
  );
}
