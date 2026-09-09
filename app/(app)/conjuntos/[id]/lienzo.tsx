"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, CircleMinus, X } from "lucide-react";
import { Badge } from "@/components/ui";
import { LienzoRejilla } from "@/components/lienzo-rejilla";
import { WO_STATUS_LABELS } from "@/lib/constants";
import type { EstadoConjunto } from "@/lib/conjuntos";
import type { TerminoConjunto } from "@/lib/instalaciones";

type Equipo = {
  id: string; code: string; name: string;
  status: string; criticality: string; detieneLinea: boolean | null;
  area: string | null; categoria: string | null;
  planoX: number | null; planoY: number | null;
  planoAncho: number; planoAlto: number;
};

type Orden = {
  id: string; number: string; title: string; status: string; priority: string;
  maintenanceType: string; assetId: string | null;
  dueDate: string | null; completadaEl: string | null;
};

/**
 * El conjunto dibujado como lo acomoda quien responde por el.
 *
 * El croquis de planta le dio al director su geografia; esto se la da un nivel
 * mas abajo, donde vive el trabajo: los equipos de la linea, en el orden en
 * que estan. Si su linea es una cadena, la va a acomodar de izquierda a
 * derecha y el dibujo lo dice sin que el sistema guarde ninguna secuencia —no
 * adivinamos su planta, el la dibuja—.
 *
 * El color es el estado de AHORA, y ese dato se mantiene solo: cuando entra a
 * ejecucion una orden que requiere paro, el equipo se marca abajo, y al
 * completarse vuelve. Nadie tiene que acordarse de actualizarlo.
 */
export function Lienzo({
  conjuntoId, nombre, termino, estado, abajoQueDetienen, aMedias, equipos, ordenes, editable,
}: {
  conjuntoId: string;
  nombre: string;
  termino: TerminoConjunto;
  estado: EstadoConjunto;
  abajoQueDetienen: number;
  aMedias: number;
  equipos: Equipo[];
  ordenes: Orden[];
  editable: boolean;
}) {
  const router = useRouter();
  const [viendo, setViendo] = useState<string | null>(null);

  const elegido = equipos.find((e) => e.id === viendo) ?? null;
  const suyas = elegido ? ordenes.filter((o) => o.assetId === elegido.id) : [];
  const abiertas = suyas.filter((o) => !["COMPLETED", "CLOSED"].includes(o.status));
  const cerradas = suyas.filter((o) => ["COMPLETED", "CLOSED"].includes(o.status));

  if (!equipos.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
        {termino.el.charAt(0).toUpperCase() + termino.el.slice(1)} {nombre} todavía no tiene equipos.
        Agréguelos desde la lista de {termino.plural.toLowerCase()} y aquí podrá acomodarlos.
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      <Dictamen
        estado={estado}
        genero={termino.genero}
        equipos={equipos}
        abajoQueDetienen={abajoQueDetienen}
        aMedias={aMedias}
      />

      <div className="card p-4">
        <LienzoRejilla
          items={equipos}
          titulo="Cómo está ahora"
          ayuda="El color es el estado de cada equipo en este momento. Toque uno para ver sus órdenes."
          ayudaEditando="Arrastre cada equipo a donde de verdad está. Jale la esquina para cambiar su tamaño."
          etiquetaEditar="Acomodar"
          etiquetaGuardar="Guardar acomodo"
          editable={editable}
          activo={viendo}
          onTocar={(id) => setViendo((v) => (v === id ? null : id))}
          nombreDe={(e) => `${e.code} ${e.name}`}
          color={(e) => tono(e.status)}
          contenido={(e) => (
            <>
              <span className="min-w-0">
                <span className="block truncate font-mono text-[0.6875rem] font-semibold text-white drop-shadow-sm">
                  {e.code}
                </span>
                <span
                  className="block text-[0.6875rem] leading-tight text-white/90"
                  style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                >
                  {e.name}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1 text-white/95">
                <span className="text-[0.625rem] font-medium uppercase tracking-wide drop-shadow-sm">
                  {ESTADO_EQUIPO[e.status] ?? e.status}
                </span>
                {e.detieneLinea === true ? (
                  <span
                    title="Cuando este equipo para, la producción para"
                    className="rounded-sm bg-white/25 px-1 text-[0.5625rem] font-semibold uppercase"
                  >
                    detiene
                  </span>
                ) : null}
              </span>
            </>
          )}
          onGuardar={async (cajas) => {
            const res = await fetch(`/api/conjuntos/${conjuntoId}/croquis`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ equipos: cajas }),
            });
            if (!res.ok) {
              const d = await res.json().catch(() => ({}));
              return d.error ?? "No fue posible guardar el acomodo";
            }
            router.refresh();
            return null;
          }}
          leyenda={
            <>
              {(["OPERATIONAL", "DEGRADED", "DOWN", "STANDBY"] as const).map((s) => (
                <span key={s} className="inline-flex items-center gap-1">
                  <i className="block h-2.5 w-4 rounded-sm" style={{ background: tono(s) }} />
                  {ESTADO_EQUIPO[s]}
                </span>
              ))}
            </>
          }
        />
      </div>

      {elegido ? (
        <div className="card grid gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">
                <Link href={`/assets/${elegido.id}`} className="font-mono text-brand-600 hover:underline">
                  {elegido.code}
                </Link>{" "}
                · {elegido.name}
              </p>
              <p className="text-[0.6875rem] text-slate-500">
                {[elegido.area, elegido.categoria, `criticidad ${elegido.criticality}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setViendo(null)}
              aria-label="Cerrar"
              className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {suyas.length === 0 ? (
            <p className="text-xs italic text-slate-500">
              Este equipo no tiene órdenes registradas. Sin órdenes no hay historia que consultar
              después, y es lo que le quita fuerza al análisis.
            </p>
          ) : (
            <div className="grid gap-3">
              <Ordenes titulo="Abiertas" lista={abiertas} vacio="Ninguna abierta." />
              <Ordenes titulo="Últimas cerradas" lista={cerradas.slice(0, 6)} vacio="Ninguna cerrada todavía." />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Ordenes({ titulo, lista, vacio }: { titulo: string; lista: Orden[]; vacio: string }) {
  return (
    <div className="grid gap-1">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      {lista.length === 0 ? (
        <p className="text-[0.6875rem] text-slate-400">{vacio}</p>
      ) : (
        lista.map((o) => (
          <Link
            key={o.id}
            href={`/work-orders/${o.id}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 hover:border-brand-300 hover:bg-brand-50/40"
          >
            <span className="min-w-0">
              <span className="font-mono text-[0.6875rem] font-medium text-brand-600">{o.number}</span>
              <span className="ml-1.5 text-xs text-slate-700">{o.title}</span>
            </span>
            <Badge tone={o.status === "IN_PROGRESS" ? "info" : o.priority === "CRITICAL" ? "danger" : "muted"}>
              {WO_STATUS_LABELS[o.status] ?? o.status}
            </Badge>
          </Link>
        ))
      )}
    </div>
  );
}

/**
 * El dictamen, arriba de todo.
 *
 * Quien responde por esto quiere un veredicto, no una tabla. Se reporta lo que
 * se sabe y no se juzga si el servicio esta disponible: que uno de dos
 * elevadores este abajo puede significar "sigue habiendo servicio" o "no
 * cumple", y eso depende del edificio, no del sistema.
 */
function Dictamen({
  estado, genero, equipos, abajoQueDetienen, aMedias,
}: {
  estado: EstadoConjunto;
  genero: "f" | "m";
  equipos: Equipo[];
  abajoQueDetienen: number;
  aMedias: number;
}) {
  const f = genero === "f";
  const abajo = equipos.filter((e) => e.status === "DOWN");
  const sello = {
    COMPLETO:  { texto: f ? "Completa" : "Completo",   clase: "bg-emerald-50 text-emerald-800 border-emerald-200", Icono: CircleCheck },
    DEGRADADO: { texto: f ? "Degradada" : "Degradado", clase: "bg-amber-50 text-amber-900 border-amber-200",       Icono: CircleAlert },
    DETENIDO:  { texto: f ? "Detenida" : "Detenido",   clase: "bg-red-50 text-red-800 border-red-200",             Icono: CircleAlert },
    VACIO:     { texto: "Sin equipos",                 clase: "bg-slate-50 text-slate-600 border-slate-200",       Icono: CircleMinus },
  }[estado];

  return (
    <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border px-4 py-3 ${sello.clase}`}>
      <span className="inline-flex items-center gap-1.5 text-base font-semibold">
        <sello.Icono className="h-4 w-4" />
        {sello.texto}
      </span>
      <span className="text-xs">
        {equipos.length} equipo{equipos.length === 1 ? "" : "s"}
        {abajo.length > 0 ? (
          <>
            {" · "}
            {abajo.map((e) => e.code).join(", ")} {abajo.length === 1 ? "está" : "están"} abajo
            {abajoQueDetienen > 0
              ? ` (${abajoQueDetienen} detiene${abajoQueDetienen === 1 ? "" : "n"} la producción)`
              : ""}
          </>
        ) : null}
        {aMedias > 0 ? ` · ${aMedias} degradado${aMedias === 1 ? "" : "s"}` : ""}
      </span>
      {/*
        El limite, escrito donde se ve. Un tablero que se presenta como la
        realidad y no lo es, se cae solo el primer dia que alguien lo comprueba.
      */}
      <span className="w-full text-[0.6875rem] opacity-80">
        Un equipo descompuesto del que nadie levantó orden sigue apareciendo como operando.
      </span>
    </div>
  );
}

const ESTADO_EQUIPO: Record<string, string> = {
  OPERATIONAL: "Operando",
  DEGRADED: "Degradado",
  DOWN: "Detenido",
  STANDBY: "En espera",
  RETIRED: "Retirado",
};

/** El color es el estado de ahora, no el histórico. */
function tono(status: string): string {
  switch (status) {
    case "DOWN": return "#a32a12";
    case "DEGRADED": return "#c07818";
    case "STANDBY": return "#8592a6";
    case "RETIRED": return "#b9c2d0";
    default: return "#2f7d5d";
  }
}
