"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui";

export function MeterReadingForm({
  meterId,
  unit,
  current,
}: {
  meterId: string;
  unit: string;
  current: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/readings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meterId, value: Number(value) }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "No fue posible registrar la lectura");
      return;
    }
    setValue("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-1.5">
      <div className="flex gap-2">
        <input
          type="number"
          step="1"
          min={current}
          className="field"
          placeholder={`Lectura actual (min. ${current} ${unit})`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={loading || !value}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Registrar
        </Button>
      </div>
      {error ? <p className="text-[0.6875rem] text-red-600">{error}</p> : null}
    </form>
  );
}
