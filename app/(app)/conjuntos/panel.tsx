"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Boxes, CircleAlert, CircleCheck, CircleMinus, LayoutGrid, Loader2, Map as IconoMapa, Pencil, Plus, Trash2, Unlink } from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { Dialogo } from "@/components/ui/dialogo";
import { SelectorBuscable } from "@/components/selector-buscable";
import { SelectorMultiple } from "@/components/selector-multiple";
import { claveSugerida, type ConjuntoEnLista, type EstadoConjunto, type Residual } from "@/lib/conjuntos";
import { LENTES, rampa, tonoEstado, tonoPendiente, type Lente } from "@/lib/mapa-lentes";
import { PERIODOS, type ClavePeriodo } from "@/lib/costo-de-parar";
import { formatCurrency } from "@/lib/utils";
import { CLAVE_ULTIMO_MAPA, type TerminoConjunto } from "@/lib/instalaciones";

type Equipo = {
  id: string; code: string; name: string; status: string;
  area: string | null; categoria: string | null;
};

type Fila = ConjuntoEnLista & { assetIds: string[] };

/**
 * La miniatura del mapa: el mismo acomodo, sin nombres, con el color del
 * estado de cada equipo. Es la invitación a entrar: antes el mapa —lo que más
 * vale de esta pantalla— solo se encontraba tocando el nombre.
 */
function MiniMapa({ plano, sinColocar, lente, maxHoras }: { plano: Fila["plano"]; sinColocar: number; lente: Lente; maxHoras: number }) {
  if (!plano.length) {
    return (
      <div className="grid h-24 place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-[0.6875rem] text-slate-500">
        {sinColocar ? "Todavía sin dibujar: entre y acomode sus equipos" : "Sin equipos todavía"}
      </div>
    );
  }
  const minX = Math.min(...plano.map((p) => p.x));
  const minY = Math.min(...plano.map((p) => p.y));
  const ancho = Math.max(...plano.map((p) => p.x + p.w)) - minX;
  const alto = Math.max(...plano.map((p) => p.y + p.h)) - minY;
  // Los mismos colores que el mapa de la línea. En «lo que costó» la escala es
  // contra el equipo con más paro de TODAS las líneas a la vista: así se
  // comparan entre sí, que es la pregunta de esta pantalla.
  const color = (p: Fila["plano"][number]) =>
    lente === "AHORA" ? tonoEstado(p.status) : lente === "COSTO" ? rampa(p.horas / maxHoras) : tonoPendiente(p.planesVencidos, p.ordenesAbiertas);
  return (
    <svg viewBox={`${minX - 0.5} ${minY - 0.5} ${ancho + 1} ${alto + 1}`} preserveAspectRatio="xMidYMid meet"
      className="h-24 w-full rounded-lg bg-slate-50" role="img" aria-label="Miniatura del mapa">
      {plano.map((p, i) => (
        <rect key={i} x={p.x + 0.1} y={p.y + 0.1} width={p.w - 0.2} height={p.h - 0.2} rx={0.3} fill={color(p)} />
      ))}
    </svg>
  );
}

/** «Volver al mapa: …»: el último que abrió esta persona, en este navegador. */
function UltimoMapa({ conjuntos }: { conjuntos: Fila[] }) {
  const [ultimo, setUltimo] = useState<{ id: string; nombre: string } | null>(null);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(CLAVE_ULTIMO_MAPA) ?? "null");
      // Solo si sigue existiendo en esta empresa.
      if (v?.id && conjuntos.some((c) => c.id === v.id)) setUltimo({ id: v.id, nombre: conjuntos.find((c) => c.id === v.id)!.name });
    } catch { /* sin almacenamiento */ }
  }, [conjuntos]);
  if (!ultimo) return null;
  return (
    <Link href={`/conjuntos/${ultimo.id}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100">
      <IconoMapa className="h-3.5 w-3.5" /> Volver al mapa: {ultimo.nombre} <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

/**
 * El dictamen, concordado.
 *
 * El adjetivo describe al conjunto, y el conjunto cambia de genero segun la
 * instalacion: una linea esta "Detenida" y un sistema esta "Detenido". Sin
 * esto, la pantalla se lee como un sistema mal traducido justo en la palabra
 * que mas se mira.
 */
const SELLOS: Record<
  EstadoConjunto,
  { texto: (f: boolean) => string; tono: "success" | "warning" | "danger" | "muted"; Icono: typeof CircleCheck }
> = {
  COMPLETO:  { texto: (f) => (f ? "Completa" : "Completo"),   tono: "success", Icono: CircleCheck },
  DEGRADADO: { texto: (f) => (f ? "Degradada" : "Degradado"), tono: "warning", Icono: CircleAlert },
  DETENIDO:  { texto: (f) => (f ? "Detenida" : "Detenido"),   tono: "danger",  Icono: CircleAlert },
  VACIO:     { texto: () => "Sin equipos",                    tono: "muted",   Icono: CircleMinus },
};

export function Panel({
  termino, conjuntos, residual, equipos, personas, clasificados, editable,
  lente, periodo, sitios, filtroSitio, filtroClase, moneda,
}: {
  termino: TerminoConjunto;
  conjuntos: Fila[];
  lente: Lente;
  periodo: ClavePeriodo;
  sitios: { id: string; name: string }[];
  filtroSitio: string | null;
  filtroClase: string | null;
  moneda: string;
  residual: Residual;
  equipos: Equipo[];
  personas: { id: string; name: string }[];
  /** Cuantos equipos tienen familia asignada. */
  clasificados: number;
  editable: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<Fila | "nuevo" | null>(null);

  // Vista, periodo y filtros viven en la URL: se comparten y sobreviven a recargar.
  const ir = (cambios: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const actual = { lente, p: periodo, sitio: filtroSitio, clase: filtroClase, ...cambios };
    if (actual.lente && actual.lente !== "AHORA") q.set("lente", actual.lente);
    if (actual.lente === "COSTO" && actual.p && actual.p !== "TRIMESTRE") q.set("p", actual.p);
    if (actual.sitio) q.set("sitio", actual.sitio);
    if (actual.clase) q.set("clase", actual.clase);
    router.push(`/conjuntos${q.size ? `?${q}` : ""}`);
  };
  const clases = useMemo(() => [...new Set(conjuntos.map((c) => c.clasificacion).filter((x): x is string => Boolean(x)))].sort(), [conjuntos]);
  const visibles = conjuntos.filter((c) =>
    (!filtroSitio || c.sitio?.id === filtroSitio) &&
    (!filtroClase || (filtroClase === "__sin" ? !c.clasificacion : c.clasificacion === filtroClase)));
  const maxHoras = Math.max(1, ...visibles.flatMap((c) => c.plano.map((p) => p.horas)));
  const enlaceMapa = (id: string) => `/conjuntos/${id}${lente !== "AHORA" ? `?lente=${lente}${lente === "COSTO" ? `&p=${periodo}` : ""}` : ""}`;
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  const opcionesEquipo = useMemo(
    () => equipos.map((a) => ({
      id: a.id,
      etiqueta: `${a.code} — ${a.name}`,
      detalle: [a.area, a.categoria].filter(Boolean).join(" · ") || null,
    })),
    [equipos],
  );

  const enAlgunConjunto = useMemo(
    () => new Set(conjuntos.flatMap((c) => c.assetIds)),
    [conjuntos],
  );
  const acomodados = enAlgunConjunto.size;

  async function borrar(f: Fila) {
    setBorrando(f.id);
    setError(null);
    const res = await fetch(`/api/conjuntos/${f.id}`, { method: "DELETE" });
    setBorrando(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "No fue posible eliminarlo");
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid gap-5">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}

      <UltimoMapa conjuntos={conjuntos} />

      {conjuntos.length ? (
        <div className="card grid gap-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(LENTES) as Lente[]).map((l) => (
              <button key={l} type="button" onClick={() => ir({ lente: l })} aria-pressed={lente === l}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${lente === l ? "bg-brand-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                {LENTES[l].etiqueta}
              </button>
            ))}
            {lente === "COSTO" ? (
              <div className="flex flex-wrap gap-1">
                {(Object.keys(PERIODOS) as ClavePeriodo[]).map((p) => (
                  <button key={p} type="button" onClick={() => ir({ p })} aria-pressed={periodo === p}
                    className={`rounded-lg px-2 py-1 text-[0.6875rem] transition ${periodo === p ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
                    {PERIODOS[p].etiqueta}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <p className="text-[0.6875rem] text-slate-500">{LENTES[lente].ayuda}</p>
          {sitios.length > 1 || clases.length ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 text-xs">
              {sitios.length > 1 ? (
                <label className="flex items-center gap-1.5 text-slate-600">
                  Sitio
                  <select className="field w-auto py-1 text-xs" value={filtroSitio ?? ""} onChange={(e) => ir({ sitio: e.target.value || null })}>
                    <option value="">Todos</option>
                    {sitios.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
              ) : null}
              {clases.length ? (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-slate-600">Clasificación</span>
                  {[{ v: null, t: "Todas" }, ...clases.map((c) => ({ v: c, t: c })), { v: "__sin", t: "Sin clasificar" }].map((o) => (
                    <button key={o.t} type="button" onClick={() => ir({ clase: o.v })} aria-pressed={filtroClase === o.v}
                      className={`rounded-full px-2.5 py-0.5 text-[0.6875rem] transition ${filtroClase === o.v ? "bg-brand-100 font-medium text-brand-800" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      {o.t}
                    </button>
                  ))}
                </div>
              ) : null}
              {filtroSitio || filtroClase ? (
                <span className="text-slate-500">{visibles.length} de {conjuntos.length} {termino.plural.toLowerCase()}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {residual.total > 0 ? (
            <>
              <span className="font-semibold text-slate-700 tabular-nums">{acomodados}</span> de{" "}
              <span className="tabular-nums">{residual.total}</span> equipos están en{" "}
              {termino.algun} {termino.singular.toLowerCase()}.
            </>
          ) : (
            "Todavía no hay equipos dados de alta."
          )}
        </p>
        {editable ? (
          <Button onClick={() => { setEditando("nuevo"); setError(null); }}>
            <Plus className="h-4 w-4" /> {termino.nuevo} {termino.singular.toLowerCase()}
          </Button>
        ) : null}
      </div>

      {conjuntos.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-6 w-6" />}
          title={`Todavía no hay ${termino.plural.toLowerCase()}`}
          description={`${termino.un.charAt(0).toUpperCase()}${termino.un.slice(1)} ${termino.singular.toLowerCase()} agrupa los equipos que sirven o no sirven juntos —la línea de producción, la alberca, los elevadores— aunque estén en áreas distintas. Al entrar, los acomoda en un lienzo como de verdad están y el color le dice cuáles operan, cuánto costaron y qué traen pendiente.`}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visibles.length === 0 ? (
            <p className="col-span-full rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-500">
              Nada coincide con estos filtros.
            </p>
          ) : null}
          {visibles.map((f) => {
            const sello = SELLOS[f.estado];
            return (
              <div key={f.id} className="card grid gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/conjuntos/${f.id}`}
                      className="block truncate text-sm font-semibold text-brand-700 hover:underline"
                    >
                      {f.name}
                    </Link>
                    <p className="truncate text-[0.6875rem] text-slate-400">
                      <span className="font-mono">{f.code}</span>
                      {f.sitio ? <span title={f.sitio.asignado ? undefined : "Según la mayoría de sus equipos"}> · {f.sitio.name}{f.sitio.asignado ? "" : "*"}</span> : null}
                      {f.clasificacion ? <span> · {f.clasificacion}</span> : null}
                    </p>
                  </div>
                  <Badge tone={sello.tono}>
                    <sello.Icono className="mr-1 inline h-3 w-3" />
                    {sello.texto(termino.genero === "f")}
                  </Badge>
                </div>

                {lente === "AHORA" ? (
                <p className="text-xs text-slate-600">
                  <span className="tabular-nums font-medium">{f.equipos}</span> equipo
                  {f.equipos === 1 ? "" : "s"}
                  {f.abajo > 0 ? (
                    <>
                      {" · "}
                      <span className="font-medium text-red-700 tabular-nums">{f.abajo} abajo</span>
                      {f.abajoQueDetienen > 0 ? (
                        <span className="text-red-700">
                          {" "}({f.abajoQueDetienen} detiene{f.abajoQueDetienen === 1 ? "" : "n"} la producción)
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  {f.aMedias > 0 ? ` · ${f.aMedias} degradado${f.aMedias === 1 ? "" : "s"}` : ""}
                </p>
                ) : lente === "COSTO" ? (
                  <p className="text-xs text-slate-600">
                    <span className="font-medium tabular-nums">{Math.round(f.horasParo * 10) / 10} h</span> de paro
                    {f.perdida > 0 ? <> · <span className="font-medium tabular-nums text-red-700">{formatCurrency(f.perdida, moneda)}</span> perdidos</> : null}
                    <span className="text-slate-400"> · {PERIODOS[periodo].etiqueta.toLowerCase()}</span>
                  </p>
                ) : (
                  <p className="text-xs text-slate-600">
                    <span className={`font-medium tabular-nums ${f.planesVencidos ? "text-red-700" : ""}`}>{f.planesVencidos}</span> plan{f.planesVencidos === 1 ? "" : "es"} vencido{f.planesVencidos === 1 ? "" : "s"}
                    {" · "}<span className="font-medium tabular-nums">{f.ordenesAbiertas}</span> orden{f.ordenesAbiertas === 1 ? "" : "es"} abierta{f.ordenesAbiertas === 1 ? "" : "s"}
                  </p>
                )}

                <Link href={enlaceMapa(f.id)} className="block rounded-lg ring-brand-300 transition hover:ring-2" title="Abrir el mapa">
                  <MiniMapa plano={f.plano} sinColocar={f.sinColocar} lente={lente} maxHoras={maxHoras} />
                </Link>

                <p className="text-[0.6875rem] text-slate-500">
                  {f.responsable ? (
                    <>Responsable: <span className="text-slate-700">{f.responsable.name}</span></>
                  ) : (
                    <span className="italic text-amber-700">Sin responsable asignado</span>
                  )}
                </p>

                {/*
                  El lienzo es LO QUE VALE de esta pantalla, y estaba escondido
                  detras del nombre en color. Rafael abrio Lineas y pregunto
                  "como visualizo": si el dueno del sistema no lo encuentra,
                  nadie lo va a encontrar. Es la misma leccion de Almacen, donde
                  el boton de editar no se hallaba.

                  Va fuera del `editable` a proposito: quien solo mira es
                  precisamente quien mas necesita el dibujo, y antes no tenia
                  ninguna accion visible.
                */}
                <div className="mt-1 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                  <Link
                    href={enlaceMapa(f.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1 text-[0.6875rem] font-medium text-white hover:bg-brand-700"
                  >
                    <LayoutGrid className="h-3 w-3" /> Ver mapa
                  </Link>
                  {editable ? (
                    <>
                    <button
                      type="button"
                      onClick={() => { setEditando(f); setError(null); }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] text-slate-600 hover:bg-slate-50"
                    >
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => borrar(f)}
                      disabled={borrando === f.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] text-slate-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                    >
                      {borrando === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      Eliminar
                    </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Residuo termino={termino} residual={residual} editable={editable} />

      {/*
        La carencia como tarea, no como silencio.

        Un boton que simplemente no esta no ensena nada: el usuario nunca sabe
        que existe ni que le falta para tenerlo. Aqui se dice que se gana y
        cuanto falta, con una razon de HOY —el filtro dentro del lienzo— y no
        con la promesa de una funcion que todavia no existe.
      */}
      {residual.total > 0 && clasificados < residual.total ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          Con la familia del equipo capturada puede ver <strong>«solo compresores»</strong> dentro
          de {termino.el} {termino.singular.toLowerCase()}, sin perder de vista dónde están. Van{" "}
          <span className="font-semibold tabular-nums">{clasificados}</span> de{" "}
          <span className="tabular-nums">{residual.total}</span> equipos con familia.{" "}
          <Link href="/assets" className="text-brand-600 underline underline-offset-2">
            Completarla en Activos
          </Link>
          . Es también lo que hará falta el día que el sistema proponga las agrupaciones por su
          cuenta.
        </p>
      ) : null}

      {editando ? (
        <FichaConjunto
          termino={termino}
          fila={editando === "nuevo" ? null : editando}
          opcionesEquipo={opcionesEquipo}
          personas={personas}
          sitios={sitios}
          clases={clases}
          onCerrar={() => setEditando(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Los equipos que no estan en ningun conjunto.
 *
 * Se calcula, no se crea: un conjunto llamado "Equipos varios" habria que
 * mantenerlo a mano, y el dia que se de de alta un compresor nuevo no
 * pertenecerian a nada sin que nadie se entere.
 *
 * Viene partido en dos porque un equipo aislado A PROPOSITO no es lo mismo que
 * uno que nadie ha acomodado. Si el calentador del bano aparece por siempre
 * como pendiente, la lista se vuelve ruido y deja de mirarse.
 */
function Residuo({
  termino, residual, editable,
}: {
  termino: TerminoConjunto;
  residual: Residual;
  editable: boolean;
}) {
  const router = useRouter();
  const [marcando, setMarcando] = useState<string | null>(null);
  const [verIndependientes, setVerIndependientes] = useState(false);

  async function marcar(id: string, independiente: boolean) {
    setMarcando(id);
    await fetch(`/api/assets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ independiente }),
    });
    setMarcando(null);
    router.refresh();
  }

  if (!residual.sinAcomodar.length && !residual.independientes.length) return null;

  return (
    <div className="card grid gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Equipos fuera de todo</h2>
        <p className="text-[0.6875rem] leading-relaxed text-slate-500">
          No están en {termino.ningun} {termino.singular.toLowerCase()}. Esta lista se calcula sola: un equipo
          nuevo aparece aquí sin que nadie lo ponga. Si alguno va solo a propósito, márquelo como
          independiente y deja de contar como pendiente.
        </p>
      </div>

      {residual.sinAcomodar.length ? (
        <div className="grid gap-1.5">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-amber-700">
            Sin acomodar · {residual.sinAcomodar.length}
          </p>
          {residual.sinAcomodar.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
              <div className="min-w-0">
                <Link href={`/assets/${a.id}`} className="font-mono text-xs font-medium text-brand-600 hover:underline">
                  {a.code}
                </Link>
                <span className="ml-1.5 text-xs text-slate-700">{a.name}</span>
                {a.area || a.categoria ? (
                  <span className="ml-1.5 text-[0.625rem] text-slate-400">
                    {[a.area, a.categoria].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </div>
              {editable ? (
                <button
                  type="button"
                  onClick={() => marcar(a.id, true)}
                  disabled={marcando === a.id}
                  title="Este equipo va solo, a propósito"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-0.5 text-[0.625rem] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {marcando === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
                  Va solo
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Todos los equipos están acomodados o marcados como independientes.
        </p>
      )}

      {residual.independientes.length ? (
        <div className="grid gap-1.5">
          <button
            type="button"
            onClick={() => setVerIndependientes((v) => !v)}
            className="text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800"
          >
            Independientes · {residual.independientes.length}
            <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">
              {verIndependientes ? "(ocultar)" : "(ver)"}
            </span>
          </button>
          {verIndependientes
            ? residual.independientes.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5">
                  <div className="min-w-0">
                    <Link href={`/assets/${a.id}`} className="font-mono text-xs font-medium text-brand-600 hover:underline">
                      {a.code}
                    </Link>
                    <span className="ml-1.5 text-xs text-slate-600">{a.name}</span>
                  </div>
                  {editable ? (
                    <button
                      type="button"
                      onClick={() => marcar(a.id, false)}
                      disabled={marcando === a.id}
                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[0.625rem] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Volver a pendiente
                    </button>
                  ) : null}
                </div>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function FichaConjunto({
  termino, fila, opcionesEquipo, personas, sitios, clases, onCerrar,
}: {
  termino: TerminoConjunto;
  fila: Fila | null;
  opcionesEquipo: { id: string; etiqueta: string; detalle: string | null }[];
  personas: { id: string; name: string }[];
  sitios: { id: string; name: string }[];
  clases: string[];
  onCerrar: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(fila?.name ?? "");
  // La clave se deriva del nombre mientras nadie la haya tocado. Depender de
  // onBlur dejaba el campo vacio si el usuario guardaba sin salir de el.
  const [code, setCode] = useState(fila?.code ?? "");
  const [claveTocada, setClaveTocada] = useState(Boolean(fila));
  const claveEfectiva = claveTocada ? code : claveSugerida(name);
  const [descripcion, setDescripcion] = useState(fila?.descripcion ?? "");
  const [responsableId, setResponsableId] = useState(fila?.responsable?.id ?? "");
  // Solo el sitio ASIGNADO se edita; el deducido de sus equipos se muestra como sugerencia.
  const [siteId, setSiteId] = useState(fila?.sitio?.asignado ? fila.sitio.id : "");
  const [clasificacion, setClasificacion] = useState(fila?.clasificacion ?? "");
  const [assetIds, setAssetIds] = useState<string[]>(fila?.assetIds ?? []);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (name.trim().length < 2) {
      setError("Póngale un nombre.");
      return;
    }
    setGuardando(true);
    setError(null);

    const cuerpo = {
      name: name.trim(),
      code: claveEfectiva.trim() || undefined,
      descripcion: descripcion.trim() || null,
      responsableId: responsableId || null,
      siteId: siteId || null,
      clasificacion: clasificacion.trim() || null,
    };

    const res = fila
      ? await fetch(`/api/conjuntos/${fila.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpo),
        })
      : await fetch("/api/conjuntos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...cuerpo, assetIds }),
        });

    const datos = await res.json().catch(() => ({}));
    if (!res.ok) {
      setGuardando(false);
      setError(datos.error ?? "No fue posible guardar");
      return;
    }

    // Al editar, los equipos se fijan aparte: la lista completa es su propia
    // operacion para que no queden membresias a medias si algo falla.
    if (fila) {
      const r2 = await fetch(`/api/conjuntos/${fila.id}/equipos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds }),
      });
      if (!r2.ok) {
        const d2 = await r2.json().catch(() => ({}));
        setGuardando(false);
        setError(d2.error ?? "Se guardó el nombre, pero no los equipos");
        return;
      }
    }

    setGuardando(false);
    onCerrar();
    router.refresh();
  }

  const bajo = termino.singular.toLowerCase();

  return (
    <Dialogo
      titulo={fila ? `Editar ${fila.name}` : `${termino.nuevo} ${bajo}`}
      descripcion={`Los equipos pueden estar en ${termino.varios} ${termino.plural.toLowerCase()} a la vez: la subestación alimenta a todos.`}
      onCerrar={onCerrar}
      ancho="lg"
      pie={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Guardar
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        <div>
          <label className="label">Nombre</label>
          <input
            className="field"
            value={name}
            placeholder="Línea 4 · La alberca · Los elevadores"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {!fila ? (
          <div>
            <label className="label">Clave</label>
            <input
              className="field font-mono"
              value={claveEfectiva}
              placeholder="L-4"
              onChange={(e) => { setClaveTocada(true); setCode(e.target.value.toUpperCase()); }}
            />
            <p className="mt-1 text-[0.6875rem] text-slate-500">
              Se genera del nombre; cámbiela si su instalación ya usa las suyas. No se
              puede cambiar después.
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Sitio</label>
            <select className="field" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">{fila?.sitio && !fila.sitio.asignado ? `Según sus equipos (${fila.sitio.name})` : "Según sus equipos"}</option>
              {sitios.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <p className="mt-1 text-[0.6875rem] text-slate-500">La planta o sede. Sirve para ver solo los mapas de un sitio.</p>
          </div>
          <div>
            <label className="label">Clasificación</label>
            <input className="field" list="clases-de-linea" value={clasificacion} onChange={(e) => setClasificacion(e.target.value)}
              placeholder="Producción · Servicios auxiliares · Utilidades" maxLength={60} />
            <datalist id="clases-de-linea">
              {[...new Set([...clases, "Producción", "Servicios auxiliares", "Utilidades", "Empaque"])].map((c) => <option key={c} value={c} />)}
            </datalist>
            <p className="mt-1 text-[0.6875rem] text-slate-500">Para enfocarse dentro de un sitio. Opcional.</p>
          </div>
        </div>

        <div>
          <label className="label">Responsable</label>
          <SelectorBuscable
            valor={responsableId}
            onCambio={setResponsableId}
            opciones={personas.map((p) => ({ id: p.id, etiqueta: p.name }))}
            vacio="Sin responsable"
            marcador="Busque por nombre"
          />
          <p className="mt-1 text-[0.6875rem] text-slate-500">
            Quién responde por que {termino.el} {bajo} funcione. Sin un nombre, vuelve a ser una etiqueta.
          </p>
        </div>

        <div>
          <label className="label">Equipos</label>
          <SelectorMultiple
            valores={assetIds}
            onCambio={setAssetIds}
            opciones={opcionesEquipo}
            marcador="Busque por clave, nombre o área"
            vacio="Agregar equipo"
            sinNada="Todavía sin equipos."
          />
        </div>

        <div>
          <label className="label">Descripción</label>
          <textarea
            className="field"
            rows={2}
            value={descripcion}
            placeholder="Desde dónde empieza y dónde termina, o qué depende de esto."
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </div>
      </div>
    </Dialogo>
  );
}
