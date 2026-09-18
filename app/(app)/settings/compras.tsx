"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, Card } from "@/components/ui";

/**
 * Como opera compras en esta cuenta.
 *
 * El interruptor existe porque la mayoria de las empresas ya compra en su ERP
 * y no lo va a mover. Apagado, la requisicion de compra guarda el folio de la
 * orden externa y salta a recepcion sin perder trazabilidad.
 */
export function ConfiguracionCompras({
  comprasInternas, montoAutorizacion, moneda, editable,
}: {
  comprasInternas: boolean;
  montoAutorizacion: number;
  moneda: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [internas, setInternas] = useState(comprasInternas);
  const [monto, setMonto] = useState(String(montoAutorizacion));
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true); setMensaje(null);
    const res = await fetch("/api/compras/config", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comprasInternas: internas, montoAutorizacion: Number(monto) || 0 }),
    });
    setGuardando(false);
    setMensaje(res.ok ? "Guardado" : "No fue posible guardar");
    if (res.ok) router.refresh();
  }

  return (
    <Card>
      <p className="text-sm font-semibold text-slate-800">Proceso de compras</p>
      <p className="mt-0.5 text-xs text-slate-500">
        Define hasta dónde llega MainTrack en el ciclo de compra.
      </p>

      <div className="mt-3 grid gap-3">
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-3">
          <input
            type="checkbox" checked={internas} disabled={!editable}
            onChange={(e) => setInternas(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            <span className="block text-xs font-medium text-slate-800">
              Cotizaciones y orden de compra dentro de MainTrack
            </span>
            <span className="mt-0.5 block text-[0.6875rem] text-slate-500">
              {internas
                ? "El ciclo completo corre aquí: cotizar, comparar, autorizar y emitir la orden."
                : "Apagado. La requisición se autoriza aquí, la compra la hace su sistema externo, y al recibir se anota el folio de esa orden. La trazabilidad no se rompe."}
            </span>
          </span>
        </label>

        <div>
          <label className="text-[0.6875rem] font-medium text-slate-600">
            Monto a partir del cual se necesita autorización ({moneda})
          </label>
          <input
            type="number" inputMode="decimal" min="0" step="any" value={monto} disabled={!editable}
            onChange={(e) => setMonto(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs tabular-nums sm:max-w-48"
          />
          <p className="mt-0.5 text-[0.625rem] text-slate-400">
            En cero, todas necesitan firma. Un umbral alto deja pasar las compras chicas sin trámite.
          </p>
        </div>
      </div>

      {editable ? (
        <div className="mt-3 flex items-center gap-2">
          <Button type="button" onClick={guardar} disabled={guardando}>
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar
          </Button>
          {mensaje ? <span className="text-xs text-slate-500">{mensaje}</span> : null}
        </div>
      ) : (
        <p className="mt-3 text-[0.6875rem] text-slate-400">Solo un administrador puede cambiar esto.</p>
      )}
    </Card>
  );
}
