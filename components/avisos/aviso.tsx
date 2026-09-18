"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import { ETIQUETA_MODULO, ETIQUETA_PRIORIDAD, type Modulo, type Prioridad } from "@/lib/avisos/catalogo";
import { formatDateTime } from "@/lib/utils";

export type AvisoVista = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  kind: string;
  read: boolean;
  createdAt: string;
  prioridad?: string;
  modulo?: string | null;
  requiereAccion?: boolean;
  atendidaEl?: string | null;
  atendidaMotivo?: string | null;
  porQue?: string | null;
  accion?: string | null;
  veces?: number;
  actualizadaEl?: string | null;
};

const TONO: Record<string, "danger" | "warning" | "info" | "muted"> = {
  CRITICA: "danger", ALTA: "warning", MEDIA: "info", BAJA: "muted", INFORMATIVA: "muted",
};

/** Punto de color por prioridad: se lee de reojo en la campana. */
export function PuntoPrioridad({ prioridad }: { prioridad?: string }) {
  const color = prioridad === "CRITICA" ? "bg-red-500" : prioridad === "ALTA" ? "bg-amber-500" : prioridad === "MEDIA" ? "bg-sky-500" : "bg-slate-300";
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`} aria-label={`Prioridad ${prioridad ?? "media"}`} />;
}

export function EstadoAviso({ a }: { a: AvisoVista }) {
  if (a.requiereAccion && !a.atendidaEl) return <Badge tone="warning">Pendiente</Badge>;
  if (a.atendidaEl) return <Badge tone="success">Atendida</Badge>;
  return null;
}

/** Un aviso completo: qué pasó, por qué importa, qué hacer, cuánto lleva. */
export function TarjetaAviso({
  a, zona, alAbrir, alReconocer, alMarcar, compacto = false,
}: {
  a: AvisoVista;
  zona: string;
  alAbrir?: () => void;
  alReconocer?: () => void;
  alMarcar?: (leida: boolean) => void;
  compacto?: boolean;
}) {
  const prioridad = (a.prioridad ?? "MEDIA") as Prioridad;
  return (
    <div className={`flex gap-2.5 ${a.read ? "" : "bg-brand-50/40"} px-3 py-2.5`}>
      <PuntoPrioridad prioridad={a.prioridad} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-1.5">
          <p className={`text-xs ${a.read ? "font-medium text-slate-700" : "font-semibold text-slate-900"}`}>{a.title}</p>
          <EstadoAviso a={a} />
        </div>
        {a.body ? <p className={`mt-0.5 whitespace-pre-line text-[0.6875rem] text-slate-600 ${compacto ? "line-clamp-2" : ""}`}>{a.body}</p> : null}
        {!compacto && a.porQue ? <p className="mt-1 text-[0.6875rem] text-slate-600"><span className="font-medium text-slate-500">Por qué importa · </span>{a.porQue}</p> : null}
        {!compacto && a.accion ? <p className="mt-0.5 text-[0.6875rem] text-slate-700"><span className="font-medium text-slate-500">Qué hacer · </span>{a.accion}</p> : null}
        {!compacto && a.atendidaEl && a.atendidaMotivo ? <p className="mt-0.5 text-[0.6875rem] text-emerald-700">Atendida: {a.atendidaMotivo}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.625rem] text-slate-400">
          <span>{formatDateTime(a.createdAt, zona)}</span>
          {!compacto ? <Badge tone={TONO[prioridad] ?? "muted"}>{ETIQUETA_PRIORIDAD[prioridad] ?? prioridad}</Badge> : null}
          {!compacto && a.modulo ? <span>{ETIQUETA_MODULO[a.modulo as Modulo] ?? a.modulo}</span> : null}
          {(a.veces ?? 1) > 1 ? <span>recordado {a.veces} veces{a.actualizadaEl ? `, último ${formatDateTime(a.actualizadaEl, zona)}` : ""}</span> : null}
        </div>
        {!compacto ? (
          <div className="mt-1.5 flex flex-wrap gap-2 text-[0.6875rem]">
            {a.link ? <Link href={a.link} onClick={alAbrir} className="font-medium text-brand-700 hover:underline">Abrir registro</Link> : null}
            {a.requiereAccion && !a.atendidaEl && alReconocer ? (
              <button type="button" onClick={alReconocer} className="text-slate-600 hover:text-brand-700 hover:underline" title="Deja dicho que ya lo vio; detiene los recordatorios cuando basta con eso">
                Enterado
              </button>
            ) : null}
            {alMarcar ? (
              <button type="button" onClick={() => alMarcar(!a.read)} className="text-slate-500 hover:text-brand-700 hover:underline">
                {a.read ? "Marcar como no leída" : "Marcar como leída"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
