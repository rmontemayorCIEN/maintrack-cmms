"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Sparkles, TrendingDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/utils";

export type Cifras = {
  fallas: number;
  diasEntreFallas: number | null;
  tendencia: "ACELERANDO" | "ESTABLE" | "ESPACIANDO" | null;
  costoTotal: number;
  costoAnualizado: number;
  porcentajeDeReposicion: number | null;
  paroHoras: number;
  sinCausaRaiz: number;
  periodoDias: number;
};

export type Analisis = {
  patron: string;
  causaProbable: string;
  tratandoElSintoma: boolean;
  porQue: string;
  acciones: string[];
  faltaCapturar: string | null;
  confianza: "ALTA" | "MEDIA" | "BAJA";
};

const TENDENCIA: Record<string, { texto: string; tono: "danger" | "muted" | "success" }> = {
  ACELERANDO: { texto: "Las fallas se están acercando", tono: "danger" },
  ESTABLE: { texto: "Ritmo estable", tono: "muted" },
  ESPACIANDO: { texto: "Las fallas se están espaciando", tono: "success" },
};

/**
 * Recurrencia de fallas del equipo.
 *
 * Las cifras salen del sistema y estan siempre visibles, con o sin IA. El
 * analisis es lo unico que cuesta, y explica lo que las cifras no pueden:
 * si se esta cambiando la misma pieza sin corregir lo que la destruye.
 */
export function Recurrencia({
  assetId, cifras, analisis, analizadoEl, moneda, disponible,
}: {
  assetId: string;
  cifras: Cifras;
  analisis: Analisis | null;
  analizadoEl: string | null;
  moneda: string;
  disponible: boolean;
}) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analizar() {
    setCargando(true); setError(null);
    const res = await fetch("/api/ia/recurrencia", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId, dias: cifras.periodoDias }),
    });
    const data = await res.json().catch(() => ({}));
    setCargando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible analizar"); return; }
    router.refresh();
  }

  const t = cifras.tendencia ? TENDENCIA[cifras.tendencia] : null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">Recurrencia de fallas</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {cifras.fallas} {cifras.fallas === 1 ? "falla correctiva" : "fallas correctivas"} en{" "}
            {cifras.periodoDias} días
          </p>
        </div>
        {disponible && cifras.fallas >= 3 ? (
          <Button type="button" size="sm" variant="secondary" onClick={analizar} disabled={cargando}>
            {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {analisis ? "Volver a analizar" : "Analizar patrón"}
          </Button>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-[0.625rem] uppercase tracking-wide text-slate-400">Entre fallas</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900">
            {cifras.diasEntreFallas !== null ? `${cifras.diasEntreFallas} días` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[0.625rem] uppercase tracking-wide text-slate-400">Costo del periodo</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900">{formatCurrency(cifras.costoTotal, moneda)}</dd>
        </div>
        <div>
          <dt className="text-[0.625rem] uppercase tracking-wide text-slate-400">Al año, a este ritmo</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900">
            {formatCurrency(cifras.costoAnualizado, moneda)}
            {cifras.porcentajeDeReposicion !== null ? (
              <span className={`block text-[0.625rem] font-normal ${cifras.porcentajeDeReposicion > 50 ? "text-rose-700" : "text-slate-400"}`}>
                {cifras.porcentajeDeReposicion}% de reponerlo
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-[0.625rem] uppercase tracking-wide text-slate-400">Paro acumulado</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900">{formatNumber(cifras.paroHoras, 0)} h</dd>
        </div>
      </dl>

      {t ? (
        <p className="mt-3">
          <Badge tone={t.tono}>
            {t.tono === "danger" ? <TrendingDown className="mr-1 inline h-3 w-3" /> : null}
            {t.texto}
          </Badge>
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
      ) : null}

      {analisis ? (
        <div className="mt-4 border-t border-slate-100 pt-3">
          {analisis.tratandoElSintoma ? (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs font-medium leading-relaxed text-amber-900">
                Se está atendiendo la consecuencia, no el origen. Al ritmo actual esto se repite.
              </p>
            </div>
          ) : null}

          <div className="grid gap-3">
            <div>
              <p className="text-[0.625rem] font-medium uppercase tracking-wide text-slate-400">El patrón</p>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-800">{analisis.patron}</p>
            </div>
            <div>
              <p className="text-[0.625rem] font-medium uppercase tracking-wide text-slate-400">Causa probable</p>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-800">{analisis.causaProbable}</p>
            </div>
            <div>
              <p className="text-[0.625rem] font-medium uppercase tracking-wide text-slate-400">En qué se basa</p>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{analisis.porQue}</p>
            </div>
            {analisis.acciones.length ? (
              <div>
                <p className="text-[0.625rem] font-medium uppercase tracking-wide text-slate-400">Qué hacer</p>
                <ol className="mt-1 grid gap-1.5">
                  {analisis.acciones.map((a, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                      <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-slate-900 text-[0.5625rem] font-bold text-white">
                        {i + 1}
                      </span>
                      {a}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
            <Badge tone={analisis.confianza === "ALTA" ? "success" : analisis.confianza === "MEDIA" ? "warning" : "danger"}>
              Confianza {analisis.confianza.toLowerCase()}
            </Badge>
            {analizadoEl ? (
              <span className="text-[0.625rem] text-slate-400">
                Analizado el {new Date(analizadoEl).toLocaleDateString("es-MX")}
              </span>
            ) : null}
          </div>

          {analisis.faltaCapturar ? (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[0.6875rem] leading-relaxed text-slate-600">
              <strong className="text-slate-800">Para afinarlo:</strong> {analisis.faltaCapturar}
            </p>
          ) : null}
        </div>
      ) : cifras.fallas < 3 ? (
        <p className="mt-3 text-xs text-slate-500">
          Con menos de tres fallas no hay patrón que analizar. Las cifras de arriba salen del historial
          y no necesitan IA.
        </p>
      ) : null}
    </Card>
  );
}
