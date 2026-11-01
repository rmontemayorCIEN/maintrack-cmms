"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";

/**
 * Ajustes › Consultor del Sistema: encenderlo o apagarlo para toda la empresa.
 * Apagado de fabrica (gasta IA). Apagar no borra sus notas ni la conversacion.
 */
export function PanelConsultorAjustes({ encendidoInicial, puedeEditar, iaConfigurada, cupo }: { encendidoInicial: boolean; puedeEditar: boolean; iaConfigurada: boolean; cupo: number }) {
  const router = useRouter();
  const [encendido, setEncendido] = useState(encendidoInicial);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cambiar(valor: boolean) {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    setMensaje(null);
    const res = await fetch("/api/consultor/activar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ encendido: valor }) });
    const datos = await res.json().catch(() => null);
    setGuardando(false);
    if (!res.ok) { setError((datos as { error?: string } | null)?.error ?? "No fue posible guardar."); return; }
    setEncendido(valor);
    setMensaje(valor ? "Consultor encendido: ya aparece en el menú, en «Ayuda»." : "Consultor apagado. Sus notas se conservan.");
    router.refresh();
  }

  return (
    <Card>
      <div className="grid gap-3">
        <div>
          <h2 className="titulo-seccion">Consultor del Sistema</h2>
          <p className="mt-1 text-sm">Acompaña a su equipo mientras deja MainTrack operando y después en el día a día: dice qué sigue y por qué, explica cómo se hace cada cosa y recuerda dónde se quedó cada quien y lo que necesitan.</p>
        </div>
        <ul className="grid list-disc gap-1 pl-5 text-sm text-slate-600">
          <li>Solo habla del sistema. Si le preguntan otra cosa, o una decisión de ingeniería, seguridad o legal, contesta que eso no le toca.</li>
          <li>El avance es el mismo de la puesta en marcha: no hay un segundo número.</li>
          <li>Usa IA, sin datos personales: correos, teléfonos, CURP, RFC y nombres del equipo se quitan antes. La conversación se guarda 180 días.</li>
          <li>Hasta 40 preguntas por persona al día, dentro de una bolsa de {cupo} consultas al mes para la empresa (cada pregunta usa dos).</li>
        </ul>
        {!iaConfigurada ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm">La IA no está configurada en este servidor: el plan y el avance funcionan, la conversación no.</p> : null}
        <p className="text-sm"><b>Estado:</b> {encendido ? "encendido" : "apagado"}.</p>
        {puedeEditar ? (
          <div className="flex flex-wrap gap-2">
            <Button variant={encendido ? "secondary" : "primary"} disabled={guardando} onClick={() => cambiar(!encendido)}>
              {encendido ? "Apagar el Consultor" : "Encender el Consultor"}
            </Button>
            {encendido ? <Link className="inline-flex items-center text-sm font-semibold text-brand-700 underline" href="/consultor">Abrir el Consultor</Link> : null}
          </div>
        ) : <p className="text-sm text-slate-500">Lo enciende o apaga quien administra la empresa.</p>}
        {mensaje ? <p className="text-sm text-emerald-700" role="status">{mensaje}</p> : null}
        {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
      </div>
    </Card>
  );
}
