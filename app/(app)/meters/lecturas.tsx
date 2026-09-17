"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
import { Dialogo } from "@/components/ui/dialogo";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { DetalleValidacion } from "./reading-form";

export type LecturaVista = {
  id: string;
  value: number;
  delta: number;
  readingAt: string;
  usuario: string | null;
  tipo: string;
  estado: string;
  atipica: boolean;
  justificacion: string | null;
  valorOriginal: number | null;
  correccionMotivo: string | null;
  correccionPor: string | null;
  correccionEl: string | null;
};

/**
 * El historial reciente de un medidor, con su rastro: corregidas con el valor
 * original, anuladas tachadas con su motivo, atipicas con su justificacion.
 */
export function Lecturas({ lecturas, unit, puedeCorregir }: { lecturas: LecturaVista[]; unit: string; puedeCorregir: boolean }) {
  const [accion, setAccion] = useState<{ lectura: LecturaVista; tipo: "corregir" | "anular" } | null>(null);

  if (!lecturas.length) return null;
  return (
    <>
      <ul className="mt-3 grid gap-1.5 border-t border-slate-100 pt-3">
        {lecturas.map((l) => {
          const anulada = l.estado === "ANULADA";
          return (
            <li key={l.id} className="text-[0.6875rem] text-slate-500">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                <span className="min-w-0">
                  {formatDateTime(l.readingAt)} · {l.usuario ?? "Sistema"}
                </span>
                <span className={`tabular-nums ${anulada ? "line-through" : ""}`}>
                  {formatNumber(l.value, 1)} {unit}
                  {l.tipo === "LECTURA" && l.delta && !anulada ? ` (+${formatNumber(l.delta, 1)})` : ""}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                {l.tipo === "REINICIO" ? <Badge tone="info">Reinicio</Badge> : null}
                {l.tipo === "SUSTITUCION" ? <Badge tone="info">Sustitución</Badge> : null}
                {l.atipica ? <Badge tone="warning">Atípica</Badge> : null}
                {l.estado === "CORREGIDA" ? <Badge tone="muted">Corregida · original {formatNumber(l.valorOriginal ?? 0, 1)} {unit}</Badge> : null}
                {anulada ? <Badge tone="danger">Anulada</Badge> : null}
                {puedeCorregir && !anulada && l.tipo === "LECTURA" ? (
                  <span className="ml-auto flex gap-2">
                    <button type="button" className="text-brand-600 hover:underline" onClick={() => setAccion({ lectura: l, tipo: "corregir" })}>
                      Corregir
                    </button>
                    <button type="button" className="text-red-600 hover:underline" onClick={() => setAccion({ lectura: l, tipo: "anular" })}>
                      Anular
                    </button>
                  </span>
                ) : null}
              </div>
              {l.justificacion ? <p className="mt-0.5 text-slate-400">Justificación: {l.justificacion}</p> : null}
              {l.correccionMotivo ? (
                <p className="mt-0.5 text-slate-400">
                  {anulada ? "Anulada" : "Corregida"} por {l.correccionPor ?? "—"} el {l.correccionEl ? formatDateTime(l.correccionEl) : "—"}: {l.correccionMotivo}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {accion ? <Accion {...accion} unit={unit} onCerrar={() => setAccion(null)} /> : null}
    </>
  );
}

function Accion({ lectura, tipo, unit, onCerrar }: { lectura: LecturaVista; tipo: "corregir" | "anular"; unit: string; onCerrar: () => void }) {
  const router = useRouter();
  const [valor, setValor] = useState(String(lectura.value));
  const [motivo, setMotivo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ mensaje: string; contexto: Parameters<typeof DetalleValidacion>[0]["contexto"] } | null>(null);

  async function enviar(confirmar = false) {
    setCargando(true);
    setError(null);
    const res = await fetch(`/api/readings/${lectura.id}`, {
      method: tipo === "corregir" ? "PATCH" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tipo === "corregir" ? { value: Number(valor), motivo, confirmar } : { motivo }),
    });
    const data = await res.json();
    setCargando(false);
    if (res.status === 409 && data.details?.requiereConfirmacion) {
      setAviso({ mensaje: data.error, contexto: data.details.validacion.contexto });
      return;
    }
    if (!res.ok) {
      setError(data.error ?? "No fue posible guardar");
      return;
    }
    onCerrar();
    router.refresh();
  }

  return (
    <Dialogo
      titulo={tipo === "corregir" ? "Corregir lectura" : "Anular lectura"}
      descripcion={`${formatNumber(lectura.value, 1)} ${unit} del ${formatDateTime(lectura.readingAt)} — se conserva el valor original y queda en la bitácora; el promedio y los planes por uso se recalculan.`}
      onCerrar={onCerrar}
      ancho="sm"
      onSubmit={(e) => {
        e.preventDefault();
        void enviar(false);
      }}
    >
      <div className="grid gap-3">
        {tipo === "corregir" ? (
          <div>
            <label className="label">Valor correcto ({unit})</label>
            <input type="number" step="any" min={0} className="field" value={valor} onChange={(e) => { setValor(e.target.value); setAviso(null); }} />
          </div>
        ) : null}
        <div>
          <label className="label">Motivo</label>
          <textarea className="field" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={tipo === "corregir" ? "Se capturó un dígito de más" : "Lectura duplicada"} />
        </div>
        {aviso ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[0.6875rem] text-amber-900">
            <p>{aviso.mensaje}</p>
            <DetalleValidacion contexto={aviso.contexto} />
          </div>
        ) : null}
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onCerrar}>Cancelar</Button>
          {aviso ? (
            <Button type="button" size="sm" disabled={cargando || motivo.trim().length < 3} onClick={() => void enviar(true)}>
              Confirmar valor atípico
            </Button>
          ) : (
            <Button type="submit" size="sm" variant={tipo === "anular" ? "danger" : "primary"} disabled={cargando || motivo.trim().length < 3}>
              {tipo === "corregir" ? "Guardar corrección" : "Anular lectura"}
            </Button>
          )}
        </div>
      </div>
    </Dialogo>
  );
}
