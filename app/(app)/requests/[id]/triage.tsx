"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, Loader2, Sparkles } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { MAINTENANCE_TYPE_LABELS, PRIORITY_LABELS } from "@/lib/constants";

export type TriageGuardado = {
  titulo: string | null;
  prioridad: string | null;
  tipo: string | null;
  resumen: string | null;
  duplicadoDe: string | null;
  el: string | null;
};

/**
 * Triage de la solicitud.
 *
 * Lo que sale de la IA es una PROPUESTA. Nada se aplica solo: una solicitud
 * mal clasificada por una maquina sin que nadie mire es peor que una sin
 * clasificar, porque nadie la vuelve a revisar.
 */
export function TriageSolicitud({
  requestId, guardado, riesgo, riesgoMotivo, disponible, editable, duplicadoId,
}: {
  requestId: string;
  guardado: TriageGuardado;
  riesgo: string;
  riesgoMotivo: string | null;
  disponible: boolean;
  editable: boolean;
  duplicadoId: string | null;
}) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analizar() {
    setCargando(true); setError(null);
    const res = await fetch("/api/ia/triage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
    const data = await res.json().catch(() => ({}));
    setCargando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible analizar"); return; }
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      {riesgo === "ALTO" ? (
        <div className="flex items-start gap-2 rounded-lg border-2 border-rose-300 bg-rose-50 p-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <div>
            <p className="text-sm font-semibold text-rose-900">Posible condición de riesgo</p>
            <p className="mt-0.5 text-xs leading-relaxed text-rose-800">
              Lo que se reportó menciona <strong>{riesgoMotivo}</strong>. Se detectó al recibirlo y
              se avisó de inmediato, sin esperar a que nadie abriera la bandeja. Revise antes de
              programar cualquier otra cosa.
            </p>
          </div>
        </div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand-600" />
            <p className="text-sm font-semibold text-slate-800">Triage</p>
          </div>
          {disponible && editable ? (
            <Button type="button" size="sm" variant="secondary" onClick={analizar} disabled={cargando}>
              {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {guardado.el ? "Volver a analizar" : "Analizar con IA"}
            </Button>
          ) : null}
        </div>

        {!guardado.el ? (
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {disponible
              ? "Lee lo que se reportó y la foto, y propone título, prioridad, tipo y si duplica otra solicitud abierta. Usted decide si lo aplica."
              : "El triage con IA no está incluido en el plan de esta cuenta."}
          </p>
        ) : (
          <div className="mt-3 grid gap-3">
            {duplicadoId && guardado.duplicadoDe ? (
              <Link
                href={`/requests/${duplicadoId}`}
                className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 transition hover:border-amber-400"
              >
                <Copy className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  <span className="block text-xs font-semibold text-amber-900">
                    Posible duplicado de {guardado.duplicadoDe}
                  </span>
                  <span className="mt-0.5 block text-[0.6875rem] text-amber-800">
                    Si es el mismo problema, atiéndalas como una sola y rechace esta indicándolo.
                  </span>
                </span>
              </Link>
            ) : null}

            <div>
              <p className="text-[0.625rem] font-medium uppercase tracking-wide text-slate-400">Título propuesto</p>
              <p className="mt-0.5 text-sm font-medium text-slate-900">{guardado.titulo}</p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {guardado.prioridad ? (
                <Badge tone={guardado.prioridad === "CRITICAL" ? "danger" : guardado.prioridad === "HIGH" ? "warning" : "muted"}>
                  Prioridad {PRIORITY_LABELS[guardado.prioridad] ?? guardado.prioridad}
                </Badge>
              ) : null}
              {guardado.tipo ? (
                <Badge tone={guardado.tipo === "SAFETY" ? "danger" : "info"}>
                  {MAINTENANCE_TYPE_LABELS[guardado.tipo] ?? guardado.tipo}
                </Badge>
              ) : null}
            </div>

            {guardado.resumen ? (
              <div>
                <p className="text-[0.625rem] font-medium uppercase tracking-wide text-slate-400">Para quien lo atienda</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{guardado.resumen}</p>
              </div>
            ) : null}

            <p className="border-t border-slate-100 pt-2 text-[0.625rem] text-slate-400">
              Es una propuesta. Al aprobar la solicitud puede tomarla o corregirla.
            </p>
          </div>
        )}

        {error ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
        ) : null}
      </Card>
    </div>
  );
}
