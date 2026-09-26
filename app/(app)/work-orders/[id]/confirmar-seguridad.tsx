"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui";
import type { EstadoSeguridad } from "@/lib/seguridad-ot";

/**
 * Confirmar que se leyó el procedimiento y las indicaciones de seguridad.
 *
 * No bloquea nada: obligar a marcarlo para iniciar invita a marcarlo sin leer,
 * y un registro que dice «leído» cuando nadie leyó es peor que no tenerlo.
 *
 * Si el texto cambia después de confirmarse, se dice con todas sus letras y se
 * pide confirmar otra vez: lo que esa persona leyó ya no es lo que la orden
 * dice hoy.
 */
export function ConfirmarSeguridad({
  workOrderId,
  estado,
  puedeConfirmar,
  cuandoTexto,
}: {
  workOrderId: string;
  estado: EstadoSeguridad;
  puedeConfirmar: boolean;
  /** La fecha ya formateada en la zona de la empresa. */
  cuandoTexto: string | null;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (estado.estado === "SIN_TEXTO") return null;

  async function confirmar() {
    setOcupado(true); setError(null);
    const r = await fetch(`/api/work-orders/${workOrderId}/seguridad`, { method: "POST" });
    setOcupado(false);
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      setError(d?.error ?? "No fue posible registrar la confirmación");
      return;
    }
    router.refresh();
  }

  if (estado.estado === "CONFIRMADO") {
    return (
      <p className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        <Check className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong>{estado.porQuien ?? "Alguien"}</strong> confirmó haber leído esto
          {cuandoTexto ? ` el ${cuandoTexto}` : ""}.
        </span>
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
      {estado.estado === "CAMBIO_DESPUES" ? (
        <p className="mb-2 flex items-start gap-2 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>Esto cambió después de confirmarse.</strong>{" "}
            {estado.porQuien ?? "Alguien"} lo leyó{cuandoTexto ? ` el ${cuandoTexto}` : ""}, pero el
            texto ya no es el mismo. Vuelva a leerlo y confirme.
          </span>
        </p>
      ) : (
        <p className="mb-2 text-xs text-amber-900">
          Léalo antes de intervenir el equipo. Queda registrado quién lo confirmó y cuándo.
        </p>
      )}
      {error ? <p className="mb-2 text-xs text-red-700">{error}</p> : null}
      {puedeConfirmar ? (
        <Button size="sm" variant="secondary" onClick={confirmar} disabled={ocupado}>
          {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Lo leí y lo entendí
        </Button>
      ) : (
        <p className="text-xs text-amber-800">Lo confirma quien va a hacer el trabajo.</p>
      )}
    </div>
  );
}
