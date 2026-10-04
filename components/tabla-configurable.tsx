"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ChevronUp, Columns3, Loader2,
  RotateCcw, Search, X,
} from "lucide-react";
import { Button, Card } from "@/components/ui";
import { RegistrarLista } from "@/components/paso-registros";
import { compararValores, siguienteOrden, type Orden } from "@/lib/orden-tabla";

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
  /**
   * Con que se ordena, cuando el texto no sirve.
   *
   * El texto de una columna de dinero es «$1,200» y el de una fecha
   * «26 sep 2026»: ordenarlos como palabras pone el 1,200 antes que el 900 y
   * los meses en orden alfabetico. Las columnas de numero y de fecha declaran
   * aqui su valor real —el numero, o la fecha en milisegundos— y las de texto
   * no necesitan nada.
   */
  ordenPor?: (f: T) => string | number;
  /** Presentacion. Si falta, se pinta el texto. */
  pinta?: (f: T) => React.ReactNode;
};

export type { Orden } from "@/lib/orden-tabla";
export type Vista = { columnas?: string[]; grupos?: string[]; orden?: Orden | null };

const sinAcentos = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** En el teléfono se muestran de a poco: doscientas tarjetas de golpe se sienten. */
const TARJETAS_POR_TANDA = 40;

export function TablaConfigurable<T extends { id: string }>({
  filas, fijas, columnas, deFabrica, vistaInicial, clave, total,
  ejemploFiltro, paso, acciones, sustantivo = "registros", busquedaInicial = "",
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
  /**
   * Para pasar de un registro a otro desde el detalle sin volver aquí
   * (components/paso-registros.tsx): la ruta base del detalle y cómo se
   * nombra cada renglón. La secuencia que se guarda es la que se ve: con su
   * filtro, su orden y sus grupos.
   */
  paso?: { base: string; etiqueta: (f: T) => string };
  /**
   * Cuantos hay en la base, si son mas de los que se trajeron.
   *
   * Sin esto el pie decia «200 de 200» aunque hubiera 3 000: el tope de la
   * consulta se veia igual que «ya no hay mas», y quien buscaba una orden que
   * si existia concluia que el sistema la habia perdido.
   */
  total?: number;
  acciones?: (f: T) => React.ReactNode;
  sustantivo?: string;
  /** Texto con que arranca el filtro: el que trae una liga (un aviso, un pendiente). */
  busquedaInicial?: string;
}) {
  const router = useRouter();
  const porId = useMemo(() => new Map(columnas.map((c) => [c.id, c])), [columnas]);
  /**
   * Para ordenar hacen falta TAMBIEN las columnas fijas.
   *
   * `porId` es de las que se pueden mostrar u ocultar, y el folio o el codigo
   * no estan ahi. Tocar el encabezado de una fija movia el indicador y dejaba
   * la lista intacta: cambiaba el estado, pero al ordenar no se encontraba la
   * columna y se devolvia la lista sin tocar. Compilaba y el `aria-sort` decia
   * la verdad; lo unico que lo delataba era leer las filas despues del clic,
   * que es lo que hace la prueba de interfaz.
   */
  const paraOrdenar = useMemo(
    () => new Map([...fijas, ...columnas].map((c) => [c.id, c])),
    [fijas, columnas],
  );

  const [seleccion, setSeleccion] = useState<string[]>(
    vistaInicial.columnas?.filter((id) => porId.has(id)) ?? deFabrica,
  );
  const [grupos, setGrupos] = useState<string[]>(
    (vistaInicial.grupos ?? []).filter((id) => porId.get(id)?.agrupable).slice(0, 3),
  );
  const [orden, setOrden] = useState<Orden | null>(
    vistaInicial.orden && paraOrdenar.has(vistaInicial.orden.id) ? vistaInicial.orden : null,
  );
  const [busqueda, setBusqueda] = useState(busquedaInicial);
  const [panel, setPanel] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cerrados, setCerrados] = useState<Set<string>>(new Set());
  const [mostradas, setMostradas] = useState(TARJETAS_POR_TANDA);

  /**
   * El filtro vive también en la dirección (?f=), sin navegar: al abrir un
   * registro y regresar con «atrás», la lista vuelve filtrada como estaba.
   */
  const leido = useRef(false);
  useEffect(() => {
    if (leido.current) return;
    leido.current = true;
    if (busquedaInicial) return;
    const f = new URLSearchParams(window.location.search).get("f");
    if (f) setBusqueda(f);
  }, [busquedaInicial]);
  useEffect(() => {
    if (!leido.current) return;
    const t = setTimeout(() => {
      const url = new URL(window.location.href);
      if (busqueda.trim()) url.searchParams.set("f", busqueda.trim()); else url.searchParams.delete("f");
      if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const visibles = seleccion.map((id) => porId.get(id)!).filter(Boolean);
  const agrupables = columnas.filter((c) => c.agrupable);

  // ── Filtro ────────────────────────────────────────────────────────────
  const filtrados = useMemo(() => {
    const q = sinAcentos(busqueda.trim());
    if (!q) return filas;
    // Se busca sobre TODAS las columnas, no solo las visibles: esconder una
    // columna es una decision de presentacion, no de que se puede encontrar.
    // Sin acentos ni mayúsculas: «bomba» encuentra «Bomba», «valvula» encuentra «válvula».
    return filas.filter((f) =>
      sinAcentos([...fijas, ...columnas].map((c) => c.texto(f)).join(" ")).includes(q),
    );
  }, [filas, busqueda, columnas, fijas]);

  // ── Orden ─────────────────────────────────────────────────────────────
  const ordenados = useMemo(() => {
    if (!orden) return filtrados;
    const col = paraOrdenar.get(orden.id);
    if (!col) return filtrados;
    const clave = col.ordenPor ?? col.texto;
    const signo = orden.dir === "asc" ? 1 : -1;
    // Copia: `filtrados` puede ser el mismo arreglo que `filas`, y ordenarlo
    // en su lugar cambiaria el orden de la lista de quien la paso.
    return [...filtrados].sort((a, b) => signo * compararValores(clave(a), clave(b)));
  }, [filtrados, orden, paraOrdenar]);

  /**
   * Un clic ordena, el segundo invierte, el tercero lo quita.
   *
   * El tercer estado no es un adorno: sin el, una vez que se toca una columna
   * ya no se puede volver al orden con que llego la lista, que muchas veces
   * es el que importa —lo mas reciente primero, o el orden del folio—.
   */
  function alternarOrden(id: string) {
    setOrden((prev) => siguienteOrden(prev, id));
  }

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
    return grupos.length ? armar(ordenados, grupos, 0, "") : [];
  }, [ordenados, grupos, porId]);

  // La secuencia tal como se ve: agrupada si hay grupos, filtrada siempre.
  const secuencia = useMemo(() => {
    if (!paso) return [];
    const salida: T[] = [];
    if (grupos.length) (function recorrer(nodos: Nodo[]) { for (const n of nodos) { if (n.hijos.length) recorrer(n.hijos); else salida.push(...n.filas); } })(arbol);
    else salida.push(...ordenados);
    return salida.map((f) => ({ id: f.id, etiqueta: paso.etiqueta(f) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, arbol, ordenados, grupos]);

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
    if (!vista) { setSeleccion(deFabrica); setGrupos([]); setCerrados(new Set()); setOrden(null); }
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

  /**
   * La misma fila, como tarjeta, para pantallas angostas: el identificador y la
   * descripción arriba, luego las primeras columnas de la vista con su
   * etiqueta, y el resto en «Más datos». Nada se pierde; solo se acomoda.
   */
  function Tarjeta({ f }: { f: T }) {
    const principales = visibles.slice(0, 4);
    const resto = visibles.slice(4);
    const dato = (c: Columna<T>) => (
      <div key={c.id} className="min-w-0">
        <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-slate-400">{c.etiqueta}</dt>
        <dd className="mt-0.5 break-words text-xs text-slate-700">{c.pinta ? c.pinta(f) : c.texto(f)}</dd>
      </div>
    );
    return (
      <li className="tarjeta-tabla rounded-xl border border-slate-200 bg-white p-3">
        <div className="grid gap-0.5 text-sm">
          {fijas.map((c) => <div key={c.id} className="min-w-0 break-words">{c.pinta ? c.pinta(f) : c.texto(f)}</div>)}
        </div>
        {principales.length ? <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">{principales.map(dato)}</dl> : null}
        {resto.length ? (
          <details className="mt-2">
            <summary className="min-h-9 cursor-pointer py-2 text-xs font-medium text-brand-700">Más datos ({resto.length})</summary>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2">{resto.map(dato)}</dl>
          </details>
        ) : null}
        {acciones ? <div className="mt-2 flex justify-end border-t border-slate-100 pt-2">{acciones(f)}</div> : null}
      </li>
    );
  }

  function GruposEnTarjetas({ nodos }: { nodos: Nodo[] }) {
    return (
      <>
        {nodos.map((n) => (
          <li key={n.clave} className="grid gap-2">
            <p className="px-1 pt-1 text-xs font-semibold text-slate-700" style={{ paddingLeft: `${4 + n.nivel * 12}px` }}>
              {n.etiqueta} <span className="font-normal text-slate-400">({n.filas.length})</span>
            </p>
            <ul className="grid gap-2">
              {n.hijos.length ? <GruposEnTarjetas nodos={n.hijos} /> : n.filas.map((f) => <Tarjeta key={f.id} f={f} />)}
            </ul>
          </li>
        ))}
      </>
    );
  }

  /**
   * `minmax(0,1fr)` no es adorno: sin el, la pantalla se sale de lado en el
   * telefono.
   *
   * Una rejilla sin columnas declaradas arma una columna implicita de tamano
   * `auto`, y una pista `auto` se mide por el CONTENIDO, no por la pantalla.
   * La tabla de aqui abajo mide mil trescientos pixeles, asi que la pista
   * crecia a mil trescientos y arrastraba consigo a la barra de filtros, a la
   * tarjeta y al documento entero —el `overflow-x: auto` de .table-wrap nunca
   * alcanzaba a desplazarse porque su contenedor tambien habia crecido—.
   * Peor: con el documento desbordado, los dialogos `position: fixed` se
   * miden contra ese ancho inflado y sus campos terminan fuera de la pantalla.
   *
   * Con `minmax(0,1fr)` la pista se queda del ancho disponible y el
   * desplazamiento lateral vuelve a ocurrir donde debe: dentro de la tabla.
   */
  return (
    <>
    {paso ? <RegistrarLista base={paso.base} items={secuencia} /> : null}
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {/* ── Barra de control ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:min-w-56 sm:basis-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={ejemploFiltro ?? "Filtrar…"}
            aria-label="Filtrar la lista"
            type="search"
            className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-8 text-sm md:py-1.5 md:text-xs"
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
            aria-label={n === 0 ? "Agrupar por" : `Agrupar, nivel ${n + 1}`}
            className="hidden rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700 disabled:bg-slate-50 disabled:text-slate-400 md:block"
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

        {/* Elegir columnas es de computadora: en el teléfono la tarjeta ya acomoda la vista. */}
        <span className="hidden md:inline-flex">
          <Button type="button" variant="secondary" onClick={() => setPanel((v) => !v)}>
            <Columns3 className="h-3.5 w-3.5" /> Columnas ({visibles.length})
          </Button>
        </span>
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
              <Button type="button" onClick={() => guardar({ columnas: seleccion, grupos, orden })} disabled={guardando}>
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
                        className="rounded px-1 text-slate-400 hover:text-slate-700 disabled:opacity-25" title="Mover después">↓</button>
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

      {/* ── Teléfono: tarjetas ───────────────────────────────────────── */}
      <div className="md:hidden">
        {filtrados.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">Ningún registro coincide con «{busqueda}».</p>
        ) : (
          <ul className="grid gap-2">
            {grupos.length ? <GruposEnTarjetas nodos={arbol} /> : ordenados.slice(0, mostradas).map((f) => <Tarjeta key={f.id} f={f} />)}
          </ul>
        )}
        {!grupos.length && filtrados.length > mostradas ? (
          <button type="button" onClick={() => setMostradas((m) => m + TARJETAS_POR_TANDA)} className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white text-sm font-medium text-brand-700">
            Mostrar más ({filtrados.length - mostradas} restantes)
          </button>
        ) : null}
      </div>

      {/* ── Tabla ────────────────────────────────────────────────────── */}
      <Card padded={false} className="hidden md:block">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {[...fijas, ...visibles].map((c) => {
                  const suyo = orden?.id === c.id ? orden.dir : null;
                  return (
                    <th
                      key={c.id}
                      className={c.alineaDerecha ? "text-right" : undefined}
                      /* Para quien usa lector de pantalla, y para las pruebas. */
                      aria-sort={suyo === "asc" ? "ascending" : suyo === "desc" ? "descending" : "none"}
                    >
                      <button
                        type="button"
                        onClick={() => alternarOrden(c.id)}
                        title={
                          suyo === null
                            ? `Ordenar por ${c.etiqueta}`
                            : suyo === "asc"
                              ? `Invertir el orden por ${c.etiqueta}`
                              : `Quitar el orden por ${c.etiqueta}`
                        }
                        className={`inline-flex min-h-8 items-center gap-1 rounded px-1 text-left hover:text-slate-900 ${
                          c.alineaDerecha ? "flex-row-reverse" : ""
                        } ${suyo ? "text-slate-900" : ""}`}
                      >
                        <span>{c.etiqueta}</span>
                        {/*
                          La flecha solo aparece en la columna que manda. Un
                          indicador gris en todas —el patron de «se puede
                          ordenar»— llena el encabezado de simbolos y deja de
                          verse cual esta activo, que es el unico dato util.
                        */}
                        {suyo ? (
                          <ChevronUp
                            aria-hidden="true"
                            className={`h-3 w-3 shrink-0 transition-transform ${suyo === "desc" ? "rotate-180" : ""}`}
                          />
                        ) : null}
                      </button>
                    </th>
                  );
                })}
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
                ordenados.map((f) => <Fila key={f.id} f={f} />)
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-[0.6875rem] text-slate-500">
        {filtrados.length} de {filas.length} {sustantivo}
        {total !== undefined && total > filas.length ? ` · hay ${Number(total).toLocaleString("es-MX")} en total; afine la búsqueda para ver el resto` : ""}
        {grupos.length ? ` · agrupados por ${grupos.map((g) => porId.get(g)?.etiqueta).join(" › ")}` : ""}
      </p>
    </div>
    </>
  );
}
