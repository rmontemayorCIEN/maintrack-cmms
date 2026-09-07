"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, Card } from "@/components/ui";

/**
 * Como se arman las ordenes de trabajo en esta organizacion.
 *
 * Dos decisiones que cambian segun la planta y que antes estaban fijas en el
 * codigo: si una orden puede juntar trabajo de varios origenes, y que tan
 * lejos se puede adelantar un preventivo para aprovechar la vuelta.
 */
export function ConfiguracionOrdenes({
  multiOrigen, horizonteDias, editable,
}: {
  multiOrigen: boolean;
  horizonteDias: number;
  editable: boolean;
}) {
  const router = useRouter();
  const [mezcla, setMezcla] = useState(multiOrigen);
  const [dias, setDias] = useState(String(horizonteDias));
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    const res = await fetch("/api/work-orders/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otMultiOrigen: mezcla, otHorizonteDias: Number(dias) || 0 }),
    });
    setGuardando(false);
    setMensaje(res.ok ? "Guardado." : "No fue posible guardar.");
    if (res.ok) router.refresh();
  }

  return (
    <Card>
      <div className="grid gap-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Como se arman las órdenes</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            De aquí sale que puede juntar el generador de órdenes y que tanto se puede
            adelantar un preventivo.
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={mezcla}
            disabled={!editable}
            onChange={(e) => setMezcla(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="block text-xs font-medium text-slate-800">
              Una orden puede juntar trabajo de varios origenes
            </span>
            <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-slate-500">
              El técnico baja a la bomba por el preventivo del mes y de paso atiende la fuga
              que reportaron: todo en una orden, en un viaje. Cada actividad conserva de donde
              vino, asi que los indicadores no se mezclan.
              <br />
              Apagado, cada origen lleva su propia orden y el generador solo deja elegir de un
              grupo a la vez.
            </span>
          </span>
        </label>

        <div>
          <label className="label">Cuanto se puede adelantar un preventivo (días)</label>
          <input
            type="number"
            min="0"
            max="365"
            className="field max-w-32"
            value={dias}
            disabled={!editable}
            onChange={(e) => setDias(e.target.value)}
          />
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-slate-500">
            Al armar una orden se ofrecen los planes que vencen dentro de este plazo, además
            de los ya vencidos. Si el técnico ya va a bajar, adelantar el que vence en unos
            días sale mas barato que un segundo viaje.
            <br />
            En cero solo se ofrece lo que ya vencio. Adelantar de mas gasta el mantenimiento
            antes de tiempo, asi que conviene un plazo corto salvo que la planta pare pocas
            veces al ano.
          </p>
        </div>

        {editable ? (
          <div className="flex items-center gap-3">
            <Button onClick={guardar} disabled={guardando}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
            {mensaje ? <span className="text-xs text-slate-500">{mensaje}</span> : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
