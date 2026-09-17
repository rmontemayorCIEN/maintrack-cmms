"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/utils";

type Contexto = {
  anterior: number | null;
  anteriorEl: string | null;
  nueva: number;
  incremento: number | null;
  horasTranscurridas: number | null;
  usoPorDia: number | null;
  promedioDiario: number;
  maximoPermitido: number | null;
  unidad: string;
  alternativas?: string[];
};

/** Lo que el servidor dice de una lectura que no paso limpia. */
export function DetalleValidacion({ contexto }: { contexto: Contexto }) {
  const u = contexto.unidad;
  const filas: Array<[string, string]> = [
    ["Lectura anterior", contexto.anterior === null ? "—" : `${formatNumber(contexto.anterior, 1)} ${u}${contexto.anteriorEl ? ` · ${formatDateTime(contexto.anteriorEl)}` : ""}`],
    ["Lectura nueva", `${formatNumber(contexto.nueva, 1)} ${u}`],
    ["Incremento", contexto.incremento === null ? "—" : `${formatNumber(contexto.incremento, 1)} ${u}`],
    ["Tiempo transcurrido", contexto.horasTranscurridas === null ? "—" : contexto.horasTranscurridas < 48 ? `${formatNumber(contexto.horasTranscurridas, 1)} h` : `${formatNumber(contexto.horasTranscurridas / 24, 1)} días`],
    ["Uso por día de esta lectura", contexto.usoPorDia === null ? "—" : `${formatNumber(contexto.usoPorDia, 1)} ${u}/día`],
    ["Máximo permitido", contexto.maximoPermitido === null ? "—" : `${formatNumber(contexto.maximoPermitido, 1)} ${u}`],
    ["Promedio actual", `${formatNumber(contexto.promedioDiario, 1)} ${u}/día`],
  ];
  return (
    <>
      <dl className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-[0.6875rem]">
        {filas.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-right tabular-nums text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
      {contexto.alternativas?.length ? (
        <div className="mt-1.5 text-[0.6875rem]">
          <p className="font-semibold">Qué puede hacer:</p>
          <ul className="list-disc pl-4">
            {contexto.alternativas.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      ) : null}
    </>
  );
}

export function MeterReadingForm({
  meterId,
  unit,
  current,
}: {
  meterId: string;
  unit: string;
  /** Nulo: el medidor no tiene lectura vigente. */
  current: number | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [tipo, setTipo] = useState<"LECTURA" | "REINICIO" | "SUSTITUCION">("LECTURA");
  const [fecha, setFecha] = useState("");
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ mensaje: string; contexto?: Contexto } | null>(null);
  const [advertencia, setAdvertencia] = useState<{ mensaje: string; contexto: Contexto } | null>(null);

  async function enviar(confirmar: boolean) {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/readings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meterId,
        value: Number(value),
        tipo,
        readingAt: fecha ? new Date(fecha).toISOString() : undefined,
        ...(tipo === "LECTURA" ? {} : { justificacion: motivo }),
        ...(confirmar ? { confirmar: true, justificacion: motivo } : {}),
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.status === 409 && data.details?.requiereConfirmacion) {
      setAdvertencia({ mensaje: data.error, contexto: data.details.validacion.contexto });
      return;
    }
    if (!res.ok) {
      setError({ mensaje: data.error ?? "No fue posible registrar la lectura", contexto: data.details?.validacion?.contexto });
      return;
    }
    setValue("");
    setFecha("");
    setMotivo("");
    setTipo("LECTURA");
    setAdvertencia(null);
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void enviar(false);
      }}
      className="grid gap-1.5"
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          type="number"
          step="any"
          min={0}
          className="field"
          placeholder={tipo !== "LECTURA" ? `Valor inicial del medidor (${unit})` : current === null ? `Nueva lectura (${unit})` : `Lectura (actual ${formatNumber(current, 0)} ${unit})`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setAdvertencia(null);
          }}
        />
        <Button type="submit" size="sm" disabled={loading || !value || (tipo !== "LECTURA" && !motivo.trim())}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Registrar
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <select className="field" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} aria-label="Tipo de registro">
          <option value="LECTURA">Lectura normal</option>
          <option value="REINICIO">Reinicio del medidor</option>
          <option value="SUSTITUCION">Sustitución del medidor</option>
        </select>
        <input
          type="datetime-local"
          className="field"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          aria-label="Fecha de la lectura (vacío = ahora)"
          title="Fecha de la lectura (vacío = ahora)"
        />
      </div>
      {tipo !== "LECTURA" ? (
        <input
          className="field"
          placeholder="Motivo (obligatorio): p. ej. se cambió el horómetro dañado"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      ) : null}

      {advertencia ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-900">
          <p className="flex items-start gap-1.5 text-[0.6875rem] font-medium">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Lectura atípica: {advertencia.mensaje}
          </p>
          <DetalleValidacion contexto={advertencia.contexto} />
          <textarea
            className="field mt-2"
            rows={2}
            placeholder="Justificación (obligatoria): qué explica este uso"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <div className="mt-1.5 flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setAdvertencia(null)}>
              Revisar la lectura
            </Button>
            <Button type="button" size="sm" disabled={loading || !motivo.trim()} onClick={() => void enviar(true)}>
              Confirmar lectura atípica
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-[0.6875rem] text-red-700">
          <p>{error.mensaje}</p>
          {error.contexto ? <DetalleValidacion contexto={error.contexto} /> : null}
        </div>
      ) : null}
    </form>
  );
}
