"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, HardHat, Loader2, Sparkles, Wrench } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";

type Paso = {
  titulo: string; detalle: string | null;
  tipo: "CHECK" | "MEASURE" | "REPLACE" | "TEXT";
  unidad: string | null; minimo: number | null; maximo: number | null;
};
type Procedimiento = {
  pasos: Paso[];
  seguridad: string[];
  herramientas: string[];
  refaccionesProbables: Array<{ codigo: string; porQue: string }>;
  advertencia: string | null;
};

const TIPO: Record<string, string> = {
  CHECK: "Verificar", MEASURE: "Medir", REPLACE: "Cambiar", TEXT: "Anotar",
};

/**
 * Preparacion del trabajo de una correctiva.
 *
 * Una preventiva nace de un plan con sus actividades escritas; una correctiva
 * nace vacia. Esto la prepara, pero nada se aplica solo: el jefe revisa y
 * decide, porque un procedimiento equivocado en un equipo energizado no es un
 * error de captura.
 */
export function ProcedimientoIa({
  workOrderId, disponible, editable, yaTieneActividades,
}: {
  workOrderId: string;
  disponible: boolean;
  editable: boolean;
  yaTieneActividades: boolean;
}) {
  const router = useRouter();
  const [p, setP] = useState<Procedimiento | null>(null);
  const [generando, setGenerando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!disponible || !editable) return null;

  async function llamar(cuerpo: Record<string, unknown>, cual: "gen" | "apl") {
    cual === "gen" ? setGenerando(true) : setAplicando(true);
    setError(null);
    const res = await fetch("/api/ia/procedimiento", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
    });
    const data = await res.json().catch(() => ({}));
    cual === "gen" ? setGenerando(false) : setAplicando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible completar la operación"); return null; }
    return data;
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">Preparar el trabajo</p>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-slate-500">
            {yaTieneActividades
              ? "Esta orden ya tiene actividades. Lo que se genere se agrega debajo, sin borrar nada de lo capturado."
              : "Una correctiva nace sin pasos. Esto propone cómo asegurar el equipo, qué hacer en orden, qué medir y qué llevar."}
          </p>
        </div>
        <Button type="button" size="sm" variant="secondary" disabled={generando}
          onClick={async () => {
            const d = await llamar({ accion: "GENERAR", workOrderId }, "gen");
            if (d) setP(d.procedimiento);
          }}>
          {generando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {p ? "Generar de nuevo" : "Generar procedimiento"}
        </Button>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
      ) : null}

      {p ? (
        <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4">
          {p.seguridad.length ? (
            <section className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <div className="flex items-center gap-1.5">
                <HardHat className="h-4 w-4 text-amber-700" />
                <p className="text-xs font-semibold text-amber-900">Antes de tocar el equipo</p>
              </div>
              <ul className="mt-1.5 grid gap-1">
                {p.seguridad.map((s, i) => (
                  <li key={i} className="text-xs leading-relaxed text-amber-900">· {s}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <p className="text-[0.625rem] font-medium uppercase tracking-wide text-slate-400">
              Pasos ({p.pasos.length})
            </p>
            <ol className="mt-1.5 grid gap-2">
              {p.pasos.map((paso, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-900 text-[0.625rem] font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug text-slate-900">
                      {paso.titulo}
                      <Badge tone={paso.tipo === "MEASURE" ? "info" : "muted"} className="ml-1.5">
                        {TIPO[paso.tipo]}
                      </Badge>
                    </p>
                    {paso.detalle ? <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{paso.detalle}</p> : null}
                    {paso.tipo === "MEASURE" && (paso.minimo !== null || paso.maximo !== null) ? (
                      <p className="mt-0.5 text-[0.6875rem] tabular-nums text-slate-500">
                        Aceptable: {paso.minimo ?? "—"} a {paso.maximo ?? "—"} {paso.unidad ?? ""}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            {p.herramientas.length ? (
              <section>
                <p className="text-[0.625rem] font-medium uppercase tracking-wide text-slate-400">
                  <Wrench className="mr-1 inline h-3 w-3" /> Qué bajar
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-700">{p.herramientas.join(" · ")}</p>
              </section>
            ) : null}

            {p.refaccionesProbables.length ? (
              <section>
                <p className="text-[0.625rem] font-medium uppercase tracking-wide text-slate-400">
                  Refacciones que podrían hacer falta
                </p>
                <ul className="mt-0.5 grid gap-1">
                  {p.refaccionesProbables.map((r, i) => (
                    <li key={i} className="text-xs text-slate-700">
                      <span className="font-medium">{r.codigo}</span>
                      <span className="text-slate-500"> — {r.porQue}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          {p.advertencia ? (
            <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              {p.advertencia}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <p className="text-[0.6875rem] text-slate-500">
              Al aplicar, los pasos se vuelven actividades que el técnico va palomeando.
            </p>
            <Button type="button" size="sm" disabled={aplicando}
              onClick={async () => {
                const d = await llamar({ accion: "APLICAR", workOrderId, procedimiento: p }, "apl");
                if (d) { setP(null); router.refresh(); }
              }}>
              {aplicando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Aplicar a la orden
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
