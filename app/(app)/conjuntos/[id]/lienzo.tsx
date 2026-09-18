"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, CircleCheck, CircleMinus, X } from "lucide-react";
import { Badge } from "@/components/ui";
import { LienzoRejilla } from "@/components/lienzo-rejilla";
import { WO_STATUS_LABELS } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";
import { PERIODOS, type ClavePeriodo } from "@/lib/costo-de-parar";
import type { EstadoConjunto } from "@/lib/conjuntos";
import { CLAVE_ULTIMO_MAPA } from "@/lib/instalaciones";
import { LENTES, esLente, rampa, tonoEstado, tonoPendiente, type Lente } from "@/lib/mapa-lentes";
import type { TerminoConjunto } from "@/lib/instalaciones";

type Equipo = {
  id: string; code: string; name: string;
  status: string; criticality: string; detieneLinea: boolean | null;
  area: string | null; categoriaId: string | null; categoria: string | null;
  horas: number; perdida: number;
  planesVencidos: number; ordenesAbiertas: number;
  planoX: number | null; planoY: number | null;
  planoAncho: number; planoAlto: number;
};

type Orden = {
  id: string; number: string; title: string; status: string; priority: string;
  maintenanceType: string; assetId: string | null;
  dueDate: string | null; completadaEl: string | null;
};

/**
 * Los tres lentes.
 *
 * Es el mismo acomodo visto de tres maneras, y eso es lo que convierte el
 * lienzo de reporte en tablero. El de en medio es el que vale: "cómo está
 * ahora" no existe en un reporte, y su dato se mantiene solo.
 *
 * Cruzado con el filtro por tipo de equipo, cada combinacion es la pregunta de
 * alguien: "solo compresores + cómo están ahora" es la mañana de un jefe de
 * mantenimiento; "solo bombas + lo que costó" es su junta de presupuesto.
 */


export function Lienzo({
  conjuntoId, nombre, termino, moneda, periodo, estado, abajoQueDetienen, aMedias,
  equipos, ordenes, editable,
}: {
  conjuntoId: string;
  nombre: string;
  termino: TerminoConjunto;
  moneda: string;
  periodo: ClavePeriodo;
  estado: EstadoConjunto;
  abajoQueDetienen: number;
  aMedias: number;
  equipos: Equipo[];
  ordenes: Orden[];
  editable: boolean;
}) {
  const router = useRouter();
  // El último mapa abierto: el listado ofrece volver a él de un toque. Es del
  // navegador de cada quien (el que usa el jefe de la línea 4 no es el del hotel).
  useEffect(() => {
    try { localStorage.setItem(CLAVE_ULTIMO_MAPA, JSON.stringify({ id: conjuntoId, nombre })); } catch { /* sin almacenamiento: no pasa nada */ }
  }, [conjuntoId, nombre]);
  const params = useSearchParams();
  // La vista con que se abre viene de la lista (?lente=): quien miraba «lo que costó» sigue viendo eso.
  const [lente, setLente] = useState<Lente>(() => { const l = params.get("lente"); return esLente(l) ? l : "AHORA"; });
  const [categoria, setCategoria] = useState<string | null>(null);
  const [viendo, setViendo] = useState<string | null>(null);

  const categorias = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of equipos) if (e.categoriaId && e.categoria) m.set(e.categoriaId, e.categoria);
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [equipos]);

  const maxHoras = Math.max(...equipos.map((e) => e.horas), 1);

  const elegido = equipos.find((e) => e.id === viendo) ?? null;
  const suyas = elegido ? ordenes.filter((o) => o.assetId === elegido.id) : [];
  const abiertas = suyas.filter((o) => !["COMPLETED", "CLOSED"].includes(o.status));
  const cerradas = suyas.filter((o) => ["COMPLETED", "CLOSED"].includes(o.status));

  /**
   * El filtro APAGA, no esconde.
   *
   * Quitar del lienzo lo que no coincide destruiria la geografia, que es lo
   * unico que este dibujo tiene y una lista no. Se ve donde estan los
   * compresores DENTRO de la planta, no una lista de compresores flotando.
   */
  const coincide = (e: Equipo) => !categoria || e.categoriaId === categoria;

  function verPeriodo(p: ClavePeriodo) {
    const q = new URLSearchParams(params.toString());
    q.set("p", p);
    router.push(`/conjuntos/${conjuntoId}?${q.toString()}`);
  }

  if (!equipos.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
        {termino.el.charAt(0).toUpperCase() + termino.el.slice(1)} {nombre} todavía no tiene equipos.
        Agréguelos desde la lista de {termino.plural.toLowerCase()} y aquí podrá acomodarlos.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <Dictamen
        estado={estado}
        genero={termino.genero}
        equipos={equipos}
        abajoQueDetienen={abajoQueDetienen}
        aMedias={aMedias}
        perdida={equipos.reduce((s, e) => s + e.perdida, 0)}
        moneda={moneda}
        periodo={periodo}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(LENTES) as Lente[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLente(l)}
            aria-pressed={lente === l}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
              lente === l
                ? "bg-slate-900 text-white"
                : "border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {LENTES[l].etiqueta}
          </button>
        ))}
        {lente === "COSTO" ? (
          <span className="ml-auto flex flex-wrap gap-1">
            {(Object.keys(PERIODOS) as ClavePeriodo[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => verPeriodo(p)}
                aria-pressed={periodo === p}
                className={`rounded-lg px-2 py-1 text-[0.6875rem] transition ${
                  periodo === p
                    ? "bg-brand-50 font-medium text-brand-700"
                    : "border border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {PERIODOS[p].etiqueta}
              </button>
            ))}
          </span>
        ) : null}
      </div>

      {categorias.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[0.6875rem] uppercase tracking-wide text-slate-400">Ver solo</span>
          <button
            type="button"
            onClick={() => setCategoria(null)}
            aria-pressed={categoria === null}
            className={`rounded-full px-2.5 py-0.5 text-[0.6875rem] transition ${
              categoria === null ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            Todos
          </button>
          {categorias.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoria((v) => (v === c.id ? null : c.id))}
              aria-pressed={categoria === c.id}
              className={`rounded-full px-2.5 py-0.5 text-[0.6875rem] transition ${
                categoria === c.id ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {c.nombre}
            </button>
          ))}
        </div>
      ) : null}

      <div className="card p-4">
        <LienzoRejilla
          items={equipos}
          titulo={LENTES[lente].etiqueta}
          ayuda={LENTES[lente].ayuda}
          ayudaEditando="Arrastre cada equipo a donde de verdad está. Jale la esquina para cambiar su tamaño."
          etiquetaEditar="Acomodar"
          etiquetaGuardar="Guardar acomodo"
          editable={editable}
          activo={viendo}
          onTocar={(id) => setViendo((v) => (v === id ? null : id))}
          nombreDe={(e) => `${e.code} ${e.name}`}
          color={(e) =>
            !coincide(e)
              ? "#dfe4ea"
              : lente === "AHORA"
                ? tonoEstado(e.status)
                : lente === "COSTO"
                  ? rampa(e.horas / maxHoras)
                  : tonoPendiente(e.planesVencidos, e.ordenesAbiertas)
          }
          contenido={(e) => {
            const apagado = !coincide(e);
            return (
              <>
                <span className={`min-w-0 ${apagado ? "opacity-45" : ""}`}>
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
                <span className={`flex flex-wrap items-center gap-1 text-white/95 ${apagado ? "opacity-45" : ""}`}>
                  {lente === "AHORA" ? (
                    <>
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
                    </>
                  ) : lente === "COSTO" ? (
                    <span className="block">
                      <span className="block text-sm font-semibold leading-none tabular-nums drop-shadow-sm">
                        {e.horas}
                        <span className="text-[0.625rem] font-medium opacity-85"> h</span>
                      </span>
                      {e.perdida > 0 ? (
                        <span className="block text-[0.625rem] leading-tight">
                          {formatCurrency(e.perdida, moneda)}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="block text-[0.625rem] leading-tight">
                      {e.planesVencidos > 0 ? (
                        <span className="block font-semibold">
                          {e.planesVencidos} plan{e.planesVencidos === 1 ? "" : "es"} vencido
                          {e.planesVencidos === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      {e.ordenesAbiertas > 0 ? (
                        <span className="block">
                          {e.ordenesAbiertas} orden{e.ordenesAbiertas === 1 ? "" : "es"} abierta
                          {e.ordenesAbiertas === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      {e.planesVencidos + e.ordenesAbiertas === 0 ? (
                        <span className="block opacity-80">Al día</span>
                      ) : null}
                    </span>
                  )}
                </span>
              </>
            );
          }}
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
            lente === "AHORA" ? (
              <>
                {(["OPERATIONAL", "DEGRADED", "DOWN", "STANDBY"] as const).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1">
                    <i className="block h-2.5 w-4 rounded-sm" style={{ background: tonoEstado(s) }} />
                    {ESTADO_EQUIPO[s]}
                  </span>
                ))}
              </>
            ) : (
              <>
                <span>{lente === "COSTO" ? "Menos paro" : "Al día"}</span>
                <span className="flex gap-0.5" aria-hidden="true">
                  {[0, 0.15, 0.35, 0.6, 1].map((p) => (
                    <i key={p} className="block h-2.5 w-5 rounded-sm" style={{ background: rampa(p) }} />
                  ))}
                </span>
                <span>{lente === "COSTO" ? "Más paro" : "Más pendiente"}</span>
              </>
            )
          }
        />
        {categoria ? (
          <p className="mt-2 text-[0.6875rem] text-slate-500">
            Los demás equipos siguen dibujados en gris: sin ellos se perdería dónde están los que
            está viendo.
          </p>
        ) : null}
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
                {elegido.horas > 0
                  ? ` · ${elegido.horas} h de paro en ${PERIODOS[periodo].etiqueta.toLowerCase()}`
                  : ""}
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
  estado, genero, equipos, abajoQueDetienen, aMedias, perdida, moneda, periodo,
}: {
  estado: EstadoConjunto;
  genero: "f" | "m";
  equipos: Equipo[];
  abajoQueDetienen: number;
  aMedias: number;
  perdida: number;
  moneda: string;
  periodo: ClavePeriodo;
}) {
  const f = genero === "f";
  const abajo = equipos.filter((e) => e.status === "DOWN");
  const vencidos = equipos.reduce((s, e) => s + e.planesVencidos, 0);
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
        {vencidos > 0 ? ` · ${vencidos} plan${vencidos === 1 ? "" : "es"} vencido${vencidos === 1 ? "" : "s"}` : ""}
        {perdida > 0
          ? ` · ${formatCurrency(perdida, moneda)} de paro en ${PERIODOS[periodo].etiqueta.toLowerCase()}`
          : ""}
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

