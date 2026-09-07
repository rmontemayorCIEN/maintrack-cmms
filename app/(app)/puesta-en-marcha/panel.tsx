"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, Circle, CircleDot, Loader2, Sparkles, Wand2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Progress } from "@/components/ui";

type Paso = {
  clave: string; titulo: string; porQue: string;
  estado: "LISTO" | "EN_PROGRESO" | "PENDIENTE";
  progreso: { hecho: number; meta: number } | null;
  falta: string; enlace: string; textoEnlace: string;
};

type Revision = {
  veredicto: "LISTA" | "CASI" | "FALTA_BASE";
  resumen: string;
  observaciones: Array<{ titulo: string; severidad: "ALTA" | "MEDIA" | "BAJA"; porQueImporta: string; queHacer: string }>;
  siguientePaso: string;
};

const TONO_SEVERIDAD = { ALTA: "danger", MEDIA: "warning", BAJA: "muted" } as const;

/**
 * Lista de puesta en marcha.
 *
 * El estado de cada paso es una cuenta sobre la base, no una opinion: carga
 * instantaneo, es gratis y siempre da lo mismo. La revision con IA va aparte y
 * bajo demanda, y se anuncia como lo que es —una segunda opinion— para que
 * nadie confunda un hecho con una sugerencia.
 */
export function PanelPuestaEnMarcha({
  pasos,
  porcentaje,
  completa,
  saludDatos,
  faltanCatalogos,
  puedeSembrar,
  iaDisponible,
}: {
  pasos: Paso[];
  porcentaje: number;
  completa: boolean;
  saludDatos: number;
  faltanCatalogos: boolean;
  puedeSembrar: boolean;
  iaDisponible: boolean;
}) {
  const router = useRouter();
  const [sembrando, setSembrando] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [revision, setRevision] = useState<Revision | null>(null);

  async function sembrarCatalogos() {
    setSembrando(true); setError(null);
    const res = await fetch("/api/catalogs/estandar", { method: "POST" });
    const data = await res.json();
    setSembrando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible cargar los catálogos"); return; }
    setAviso(`Se cargaron ${data.total} registros en sus catalogos. Revise y quite lo que no aplique a su operacion.`);
    router.refresh();
  }

  async function revisar() {
    setRevisando(true); setError(null);
    const res = await fetch("/api/ia/revision", { method: "POST" });
    const data = await res.json();
    setRevisando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible revisar la configuración"); return; }
    setRevision(data.revision);
  }

  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-2xl font-semibold tabular-nums text-slate-900">{porcentaje}%</p>
              {completa ? <Badge tone="success">Lista para operar</Badge> : null}
            </div>
            <p className="mt-1 max-w-xl text-xs text-slate-600">
              {completa
                ? `Su cuenta ya tiene lo necesario para operar. De aqui en adelante lo que importa es la calidad de la captura, que hoy va en ${saludDatos} de 100.`
                : "Estos son los pasos para que el sistema le sirva de verdad. No bloquean nada: puede usar cualquier pantalla cuando quiera."}
            </p>
          </div>
          {iaDisponible ? (
            <Button variant="secondary" size="sm" onClick={revisar} disabled={revisando}>
              {revisando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {revisando ? "Revisando…" : "Revise como voy"}
            </Button>
          ) : null}
        </div>
        <div className="mt-3">
          <Progress value={porcentaje} tone={porcentaje >= 80 ? "good" : porcentaje >= 40 ? "warn" : "bad"} />
        </div>
        {aviso ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{aviso}</p> : null}
        {error ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      </Card>

      {revision ? (
        <Card>
          <CardHeader
            title="Segunda opinion"
            subtitle="Esto no es una cuenta sino una interpretacion: lo que el cruce de sus datos sugiere, mas alla de la lista."
            action={
              <Badge tone={revision.veredicto === "LISTA" ? "success" : revision.veredicto === "CASI" ? "warning" : "danger"}>
                {revision.veredicto === "LISTA" ? "lista" : revision.veredicto === "CASI" ? "casi" : "falta base"}
              </Badge>
            }
          />
          <p className="text-sm leading-relaxed text-slate-700">{revision.resumen}</p>
          <ul className="mt-3 grid gap-2">
            {revision.observaciones.map((o, i) => (
              <li key={i} className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={TONO_SEVERIDAD[o.severidad]}>{o.severidad.toLowerCase()}</Badge>
                  <span className="text-xs font-semibold text-slate-800">{o.titulo}</span>
                </div>
                <p className="mt-1 text-[0.6875rem] text-slate-600">{o.porQueImporta}</p>
                <p className="mt-0.5 text-[0.6875rem] text-slate-700"><span className="font-medium text-slate-500">Que hacer · </span>{o.queHacer}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs text-brand-900">
            <strong>Si solo hace una cosa esta semana:</strong> {revision.siguientePaso}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-2.5">
        {pasos.map((p, i) => (
          <Card key={p.clave} className={p.estado === "LISTO" ? "opacity-70" : ""}>
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold ${
                p.estado === "LISTO" ? "bg-emerald-100 text-emerald-700"
                  : p.estado === "EN_PROGRESO" ? "bg-amber-100 text-amber-700"
                  : "bg-slate-100 text-slate-400"
              }`}>
                {p.estado === "LISTO" ? <Check className="h-3.5 w-3.5" />
                  : p.estado === "EN_PROGRESO" ? <CircleDot className="h-3.5 w-3.5" />
                  : <Circle className="h-3 w-3" />}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">
                    <span className="text-slate-400">{i + 1}.</span> {p.titulo}
                  </p>
                  {p.progreso ? (
                    <span className="text-[0.6875rem] tabular-nums text-slate-500">
                      {p.progreso.hecho} de {p.progreso.meta}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-slate-500">{p.porQue}</p>

                {p.progreso && p.estado !== "LISTO" ? (
                  <div className="mt-1.5 max-w-xs">
                    <Progress value={(p.progreso.hecho / p.progreso.meta) * 100} tone="warn" />
                  </div>
                ) : null}

                {p.falta ? <p className="mt-1.5 text-xs text-slate-700">{p.falta}</p> : null}

                {p.estado !== "LISTO" ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Link
                      href={p.enlace}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-[0.6875rem] font-medium text-white hover:bg-brand-700"
                    >
                      {p.textoEnlace} <ArrowRight className="h-3 w-3" />
                    </Link>
                    {p.clave === "catalogos" && faltanCatalogos && puedeSembrar ? (
                      <button
                        type="button"
                        onClick={sembrarCatalogos}
                        disabled={sembrando}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[0.6875rem] font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
                      >
                        {sembrando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                        Cargar catalogos estandar
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <p className="max-w-3xl text-xs text-slate-500">
        <strong className="text-slate-700">El estado de cada paso es una cuenta sobre sus datos</strong>, no una
        opinion: carga al instante, no cuesta nada y siempre da lo mismo. Cuando termine, esta pantalla cede su
        lugar al indice de calidad de captura, que es la fase que sigue.
      </p>
    </div>
  );
}
