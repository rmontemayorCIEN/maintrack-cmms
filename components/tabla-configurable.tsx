"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns3, Loader2,
  RotateCcw, Search, X,
} from "lucide-react";
import { Button, Card } from "@/components/ui";

/**
 * Tabla de lista configurable por usuario.
 *
 * Cada pantalla trae sus datos y su catalogo de columnas; lo que vive aqui es
 * el comportamiento comun: elegir columnas, acomodarlas, filtrar, agrupar
 * hasta en tres niveles y guardar el arreglo. Se escribio una sola vez a
 * proposito: cinco copias de esto se desincronizan en el primer arreglo que
 * alguien haga en una y olvide en las otras.
 */

export type Columna<T> = {
  id: string;
  etiqueta: string;
  /** Si puede usarse como criterio de agrupacion. Solo tiene sentido en campos que se repiten. */
  agrupable?: boolean;
  alineaDerecha?: boolean;
  /** Texto plano. Es lo que se agrupa, se filtra y se ordena. */
  texto: (f: T) => string;
  /** Presentacion. Si falta, se pinta el texto. */
  pinta?: (f: T) => React.ReactNode;
};

export type Vista = { columnas?: string[]; grupos?: string[] };

export function TablaConfigurable<T extends { id: string }>({
  filas, fijas, columnas, deFabrica, vistaInicial, clave,
  ejemploFiltro, acciones, sustantivo = "registros",
}: {
  filas: T[];
  /** Columnas que siempre van al frente. Sin ellas la tabla deja de identificar de que habla. */
  fijas: Columna<T>[];
  /** Las opcionales, que el usuario prende, apaga y acomoda. */
  columnas: Columna<T>[];
  deFabrica: string[];
  vistaInicial: Vista;
  /** Con que nombre se guarda la preferencia de esta tabla. */
  clave: string;
  ejemploFiltro?: string;
  acciones?: (f: T) => React.ReactNode;
  sustantivo?: string;
}) {
  const router = useRouter();
  const porId = useMemo(() => new Map(columnas.map((c) => [c.id, c])), [columnas]);

  const [seleccion, setSeleccion] = useState<string[]>(
    vistaInicial.columnas?.filter((id) => porId.has(id)) ?? deFabrica,
  );
  const [grupos, setGrupos] = useState<string[]>(
    (vistaInicial.grupos ?? []).filter((id) => porId.get(id)?.agrupable).slice(0, 3),
  );
  const [busqueda, setBusqueda] = useState("");
  const [panel, setPanel] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cerrados, setCerrados] = useState<Set<string>>(new Set());

  const visibles = seleccion.map((id) => porId.get(id)!).filter(Boolean);
  const agrupables = columnas.filter((c) => c.agrupable);

  // ── Filtro ────────────────────────────────────────────────────────────
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return filas;
    // Se busca sobre TODAS las columnas, no solo las visibles: esconder una
    // columna es una decision de presentacion, no de que se puede encontrar.
    return filas.filter((f) =>
      [...fijas, ...columnas].map((c) => c.texto(f)).join(" ").toLowerCase().includes(q),
    );
  }, [filas, busqueda, columnas, fijas]);

  // ── Agrupacion en hasta tres niveles ──────────────────────────────────
  type Nodo = { clave: string; etiqueta: string; nivel: number; filas: T[]; hijos: Nodo[] };

  const arbol = useMemo(() => {
    function armar(items: T[], niveles: string[], nivel: number, prefijo: string): Nodo[] {
      if (!niveles.length) return [];
      const [actual, ...resto] = niveles;
      const col = porId.get(actual);
      if (!col) return [];
      const cubos = new Map<string, T[]>();
      for (const f of items) {
        const k = col.texto(f);
        (cubos.get(k) ?? cubos.set(k, []).get(k)!).push(f);
      }
      return [...cubos.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "es"))
        .map(([etiqueta, suyas]) => {
          const k = `${prefijo}/${actual}:${etiqueta}`;
          return { clave: k, etiqueta, nivel, filas: suyas, hijos: armar(suyas, resto, nivel + 1, k) };
        });
    }
    return grupos.length ? armar(filtrados, grupos, 0, "") : [];
  }, [filtrados, grupos, porId]);

  const todasLasClaves = useMemo(() => {
    const salida: string[] = [];
    (function recorrer(nodos: Nodo[]) {
      for (const n of nodos) { salida.push(n.clave); recorrer(n.hijos); }
    })(arbol);
    return salida;
  }, [arbol]);

  // Contraer cierra todos los niveles, no solo el primero: al volver a abrir un
  // grupo se baja de nivel en nivel, que es como se recorre una lista larga.
  const todoCerrado = todasLasClaves.length > 0 && todasLasClaves.every((k) => cerrados.has(k));

  // ── Preferencia ───────────────────────────────────────────────────────
  async function guardar(vista: Vista | null) {
    setGuardando(true); setError(null);
    const r = await fetch("/api/apariencia/vista-tabla", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clave, vista }),
    });
    setGuardando(false);
    if (!r.ok) { setError("No fue posible guardar la vista"); return; }
    if (!vista) { setSeleccion(deFabrica); setGrupos([]); setCerrados(new Set()); }
    router.refresh();
  }

  function mover(id: string, delta: number) {
    setSeleccion((prev) => {
      const i = prev.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const copia = [...prev];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
  }

  function alternar(k: string) {
    setCerrados((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k); else s.add(k);
      return s;
    });
  }

  const totalColumnas = fijas.length + visibles.length + (acciones ? 1 : 0);

  function Fila({ f, sangria = 0 }: { f: T; sangria?: number }) {
    return (
      <tr>
        {fijas.map((c, i) => (
          <td
            key={c.id}
            className={c.alineaDerecha ? "text-right tabular-nums" : undefined}
            style={i === 0 && sangria ? { paddingLeft: `${12 + sangria * 18}px` } : undefined}
          >
            {c.pinta ? c.pinta(f) : c.texto(f)}
          </td>
        ))}
        {visibles.map((c) => (
          <td key={c.id} className={`text-xs text-slate-600 ${c.alineaDerecha ? "text-right tabular-nums" : ""}`}>
            {c.pinta ? c.pinta(f) : c.texto(f)}
          </td>
        ))}
        {acciones ? <td className="text-right">{acciones(f)}</td> : null}
      </tr>
    );
  }

  function Grupos({ nodos }: { nodos: Nodo[] }) {
    return (
      <>
        {nodos.map((n) => {
          const cerrado = cerrados.has(n.clave);
          return (
            <Fragment key={n.clave}>
              <tr className="bg-slate-50/80">
                <td colSpan={totalColumnas} className="!py-1.5">
                  <button
                    type="button"
                    onClick={() => alternar(n.clave)}
                    className="flex items-center gap-1.5 text-left"
                    style={{ paddingLeft: `${n.nivel * 18}px` }}
                  >
                    {cerrado
                      ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                      : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                    <span className={n.nivel === 0 ? "text-xs font-semibold text-slate-800" : "text-xs font-medium text-slate-600"}>
                      {n.etiqueta}
                    </span>
                    <span className="text-[0.6875rem] text-slate-400">({n.filas.length})</span>
                  </button>
                </td>
              </tr>
              {!cerrado && (n.hijos.length
                ? <Grupos nodos={n.hijos} />
                : n.filas.map((f) => <Fila key={f.id} f={f} sangria={n.nivel + 1} />))}
            </Fragment>
          );
        })}
      </>
    );
  }

  return (
    <div className="grid gap-3">
      {/* ── Barra de control ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={ejemploFiltro ?? "Filtrar…"}
            className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-8 text-xs"
          />
          {busqueda ? (
            <button type="button" onClick={() => setBusqueda("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {[0, 1, 2].map((n) => (
          <select
            key={n}
            value={grupos[n] ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setGrupos((prev) => {
                // Vaciar un nivel corta tambien los de abajo: no existe un
                // tercer criterio de agrupacion sin un segundo.
                if (!v) return prev.slice(0, n);
                const siguientes = prev.slice(n + 1).filter((g) => g !== v);
                return [...prev.slice(0, n), v, ...siguientes].slice(0, 3);
              });
            }}
            disabled={n > grupos.length}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">{n === 0 ? "Agrupar por…" : `+ nivel ${n + 1}`}</option>
            {agrupables.filter((c) => !grupos.includes(c.id) || grupos[n] === c.id).map((c) => (
              <option key={c.id} value={c.id}>{c.etiqueta}</option>
            ))}
          </select>
        ))}

        {grupos.length ? (
          <Button
            type="button" variant="secondary"
            onClick={() => setCerrados(todoCerrado ? new Set() : new Set(todasLasClaves))}
            title={todoCerrado ? "Abrir todos los grupos" : "Cerrar todos los grupos"}
          >
            {todoCerrado
              ? <><ChevronsUpDown className="h-3.5 w-3.5" /> Expandir todo</>
              : <><ChevronsDownUp className="h-3.5 w-3.5" /> Contraer todo</>}
          </Button>
        ) : null}

        <Button type="button" variant="secondary" onClick={() => setPanel((v) => !v)}>
          <Columns3 className="h-3.5 w-3.5" /> Columnas ({visibles.length})
        </Button>
      </div>

      {/* ── Panel de columnas ────────────────────────────────────────── */}
      {panel ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-slate-800">Columnas de la vista</p>
              <p className="text-[0.6875rem] text-slate-500">
                {fijas.map((c) => c.etiqueta).join(" y ")} {fijas.length > 1 ? "son fijas" : "es fija"}.
                Las demas se prenden, se apagan y se acomodan con las flechas.
              </p>
            </div>
            <div className="flex gap-1.5">
              <Button type="button" variant="secondary" onClick={() => guardar(null)} disabled={guardando}>
                <RotateCcw className="h-3.5 w-3.5" /> De fabrica
              </Button>
              <Button type="button" onClick={() => guardar({ columnas: seleccion, grupos })} disabled={guardando}>
                {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar vista
              </Button>
            </div>
          </div>

          <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {columnas.map((c) => {
              const activa = seleccion.includes(c.id);
              const pos = seleccion.indexOf(c.id);
              return (
                <div key={c.id} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${activa ? "border-brand-200 bg-brand-50/40" : "border-slate-200"}`}>
                  <label className="flex flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={activa}
                      onChange={() => setSeleccion((prev) => (activa ? prev.filter((x) => x !== c.id) : [...prev, c.id]))}
                      className="h-3.5 w-3.5 rounded border-slate-300"
                    />
                    <span className="text-xs text-slate-700">{c.etiqueta}</span>
                  </label>
                  {activa ? (
                    <>
                      <button type="button" onClick={() => mover(c.id, -1)} disabled={pos === 0}
                        className="rounded px-1 text-slate-400 hover:text-slate-700 disabled:opacity-25" title="Mover antes">↑</button>
                      <button type="button" onClick={() => mover(c.id, 1)} disabled={pos === seleccion.length - 1}
                        className="rounded px-1 text-slate-400 hover:text-slate-700 disabled:opacity-25" title="Mover despues">↓</button>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
      ) : null}

      {/* ── Tabla ────────────────────────────────────────────────────── */}
      <Card padded={false}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {fijas.map((c) => (
                  <th key={c.id} className={c.alineaDerecha ? "text-right" : undefined}>{c.etiqueta}</th>
                ))}
                {visibles.map((c) => (
                  <th key={c.id} className={c.alineaDerecha ? "text-right" : undefined}>{c.etiqueta}</th>
                ))}
                {acciones ? <th className="w-10" /> : null}
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr>
                  <td colSpan={totalColumnas} className="py-6 text-center text-xs text-slate-500">
                    Ningun registro coincide con “{busqueda}”.
                  </td>
                </tr>
              ) : grupos.length ? (
                <Grupos nodos={arbol} />
              ) : (
                filtrados.map((f) => <Fila key={f.id} f={f} />)
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-[0.6875rem] text-slate-500">
        {filtrados.length} de {filas.length} {sustantivo}
        {grupos.length ? ` · agrupados por ${grupos.map((g) => porId.get(g)?.etiqueta).join(" › ")}` : ""}
      </p>
    </div>
  );
}
