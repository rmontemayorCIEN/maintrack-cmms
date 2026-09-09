"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, Move, PencilRuler, RotateCcw, X } from "lucide-react";
import {
  REJILLA, acomodoInicial, primerHueco, resolverSoltada, tamanoQueCabe,
  type CajaCroquis,
} from "@/lib/croquis";

/**
 * Una rejilla de cajas que el usuario acomoda arrastrando.
 *
 * Nacio como el croquis de la planta —las areas dibujadas donde de verdad
 * estan— y ahora tambien dibuja los equipos de un conjunto. Lo que las dos
 * comparten es todo el gesto: la rejilla, el arrastre, el intercambio al
 * soltar, la esquina que se jala, el modo de acomodo. Lo que cambia es que se
 * dibuja adentro de cada caja y adonde se guarda.
 *
 * Vive aqui porque copiarla habria sido la segunda copia, y la segunda copia
 * es la que se desincroniza: el dia que se arregle un gesto en una, la otra se
 * queda con el error. Ya paso con el armazon de las ventanas, en 12 pantallas.
 *
 * La aritmetica —acomodo inicial, intercambio, tope contra la vecina— vive en
 * lib/croquis.ts y tiene su propia prueba. Aqui solo esta el gesto.
 */

export type ItemLienzo = {
  id: string;
  planoX: number | null;
  planoY: number | null;
  planoAncho: number;
  planoAlto: number;
};

export function LienzoRejilla<T extends ItemLienzo>({
  items,
  titulo,
  ayuda,
  ayudaEditando,
  etiquetaEditar,
  etiquetaGuardar,
  editable,
  activo,
  onTocar,
  color,
  contenido,
  nombreDe,
  onGuardar,
  leyenda,
}: {
  items: T[];
  titulo: string;
  /** Que dice el subtitulo cuando solo se mira. */
  ayuda: string;
  /** Que dice cuando se esta acomodando. */
  ayudaEditando: string;
  etiquetaEditar: string;
  etiquetaGuardar: string;
  editable: boolean;
  /** Cual esta seleccionado, para resaltarlo. */
  activo: string | null;
  onTocar: (id: string) => void;
  /** El color de fondo de cada caja. Es el canal que dice lo que pasa. */
  color: (item: T) => string;
  /** Lo que va escrito adentro. */
  contenido: (item: T) => ReactNode;
  /** Para las etiquetas de accesibilidad. */
  nombreDe: (item: T) => string;
  /** Devuelve un mensaje de error, o null si guardo bien. */
  onGuardar: (cajas: CajaCroquis[]) => Promise<string | null>;
  leyenda?: ReactNode;
}) {
  const lienzo = useRef<HTMLDivElement>(null);
  const [editando, setEditando] = useState(false);
  const [cajas, setCajas] = useState<CajaCroquis[]>([]);
  const [moviendo, setMoviendo] = useState<{ id: string; dx: number; dy: number; x0: number; y0: number } | null>(null);
  const [escalando, setEscalando] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Se rearma cuando cambian los elementos. */
  useEffect(() => {
    const colocadas: CajaCroquis[] = items
      .filter((i) => i.planoX !== null && i.planoY !== null)
      .map((i) => ({
        id: i.id,
        x: i.planoX as number,
        y: i.planoY as number,
        ancho: i.planoAncho,
        alto: i.planoAlto,
      }));
    const faltantes = items.filter((i) => i.planoX === null || i.planoY === null);
    if (!faltantes.length) {
      setCajas(colocadas);
      return;
    }
    // Las que nunca se colocaron entran por el primer hueco libre, no encimadas.
    const nuevas = acomodoInicial(
      faltantes.map((i) => ({
        locationId: i.id, area: i.id,
        planoX: null, planoY: null,
        planoAncho: i.planoAncho, planoAlto: i.planoAlto,
      })),
    );
    const acumulado = [...colocadas];
    for (const n of nuevas) {
      const { x, y } = primerHueco(acumulado, n);
      acumulado.push({ ...n, x, y });
    }
    setCajas(acumulado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  function celdaEn(clientX: number, clientY: number) {
    const caja = lienzo.current?.getBoundingClientRect();
    if (!caja) return { cx: 0, cy: 0 };
    return {
      cx: Math.floor(((clientX - caja.left) / caja.width) * REJILLA.columnas),
      cy: Math.floor(((clientY - caja.top) / caja.height) * REJILLA.filas),
    };
  }

  function alBajar(e: React.PointerEvent, c: CajaCroquis) {
    if (!editando) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { cx, cy } = celdaEn(e.clientX, e.clientY);
    // Se guarda desde que celda se agarro, para que no brinque al pulgar cada
    // vez que se toma de una esquina. x0/y0: de donde salio, para el intercambio.
    setMoviendo({ id: c.id, dx: cx - c.x, dy: cy - c.y, x0: c.x, y0: c.y });
  }

  function alMover(e: React.PointerEvent) {
    const { cx, cy } = celdaEn(e.clientX, e.clientY);

    // Jalando la esquina: la celda bajo el dedo es la ultima que ocupa la caja.
    if (escalando) {
      setCajas((cs) =>
        cs.map((c) =>
          c.id !== escalando
            ? c
            : { ...c, ...tamanoQueCabe(cs, { ...c, ancho: cx - c.x + 1, alto: cy - c.y + 1 }) },
        ),
      );
      return;
    }

    if (!moviendo) return;
    setCajas((cs) =>
      cs.map((c) => {
        if (c.id !== moviendo.id) return c;
        return {
          ...c,
          x: Math.min(Math.max(cx - moviendo.dx, 0), REJILLA.columnas - c.ancho),
          y: Math.min(Math.max(cy - moviendo.dy, 0), REJILLA.filas - c.alto),
        };
      }),
    );
  }

  function alSoltar() {
    const salioDe = moviendo ? { x: moviendo.x0, y: moviendo.y0 } : null;
    const id = moviendo?.id ?? escalando;
    setMoviendo(null);
    setEscalando(null);
    if (!id) return;
    setCajas((cs) => resolverSoltada(cs, id, salioDe));
  }

  /** Solo para el teclado: la esquina que se jala no sirve sin raton ni dedo. */
  function redimensionar(id: string, d: { ancho?: number; alto?: number }) {
    setCajas((cs) =>
      cs.map((c) => {
        if (c.id !== id) return c;
        const pedido = { ...c, ancho: c.ancho + (d.ancho ?? 0), alto: c.alto + (d.alto ?? 0) };
        return { ...c, ...tamanoQueCabe(cs, pedido) };
      }),
    );
  }

  function alBajarTamano(e: React.PointerEvent, c: CajaCroquis) {
    // Se detiene aqui o el gesto lo toma la caja y en vez de cambiar el tamano
    // se arrastraria la caja completa.
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setEscalando(c.id);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    const problema = await onGuardar(cajas);
    setGuardando(false);
    if (problema) {
      setError(problema);
      return;
    }
    setEditando(false);
  }

  const porId = new Map(items.map((i) => [i.id, i]));

  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
          <p className="text-[0.6875rem] leading-relaxed text-slate-500">
            {editando ? ayudaEditando : ayuda}
          </p>
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {editando ? (
              <>
                <button
                  type="button"
                  onClick={() => setEditando(false)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  <X className="h-3.5 w-3.5" /> Cancelar
                </button>
                <button
                  type="button"
                  onClick={guardar}
                  disabled={guardando}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                >
                  {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {etiquetaGuardar}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditando(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                <PencilRuler className="h-3.5 w-3.5" /> {etiquetaEditar}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <div
        ref={lienzo}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={() => { setMoviendo(null); setEscalando(null); }}
        className={`relative w-full overflow-hidden rounded-xl border ${
          editando ? "border-brand-300 bg-brand-50/30" : "border-slate-200 bg-slate-50"
        }`}
        style={{
          aspectRatio: `${REJILLA.columnas} / ${REJILLA.filas}`,
          // Sin esto el navegador se lleva el gesto para desplazar la pagina y
          // en la tableta la caja nunca se mueve.
          touchAction: editando ? "none" : "auto",
          ...(editando
            ? {
                backgroundImage:
                  "linear-gradient(to right, rgba(31,62,238,.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(31,62,238,.10) 1px, transparent 1px)",
                backgroundSize: `${100 / REJILLA.columnas}% ${100 / REJILLA.filas}%`,
              }
            : {}),
        }}
      >
        {cajas.map((c) => {
          const item = porId.get(c.id);
          if (!item) return null;
          const seleccionada = activo === c.id;
          const arrastrando = moviendo?.id === c.id;
          return (
            <div
              key={c.id}
              className="absolute p-0.5"
              style={{
                left: `${(c.x / REJILLA.columnas) * 100}%`,
                top: `${(c.y / REJILLA.filas) * 100}%`,
                width: `${(c.ancho / REJILLA.columnas) * 100}%`,
                height: `${(c.alto / REJILLA.filas) * 100}%`,
                zIndex: arrastrando ? 20 : 1,
              }}
            >
              <button
                type="button"
                onPointerDown={(e) => alBajar(e, c)}
                onClick={() => !editando && onTocar(c.id)}
                aria-pressed={!editando && seleccionada}
                className={`flex h-full w-full flex-col justify-between overflow-hidden rounded-lg p-2 text-left outline-offset-[-2px] transition ${
                  editando ? "cursor-move" : "cursor-pointer hover:brightness-105"
                } ${seleccionada && !editando ? "outline outline-2 outline-slate-900" : ""} ${
                  arrastrando ? "scale-[1.02] shadow-lg" : ""
                }`}
                style={{ background: color(item) }}
              >
                {contenido(item)}
              </button>

              {editando ? (
                <>
                  <Esquina
                    onBajar={(e) => alBajarTamano(e, c)}
                    onTecla={(d) => redimensionar(c.id, d)}
                    nombre={nombreDe(item)}
                  />
                  <Move className="pointer-events-none absolute left-1.5 top-1.5 h-3 w-3 text-white/70" />
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      {leyenda || (editable && !editando) ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.625rem] text-slate-500">
          {leyenda}
          {editable && !editando ? (
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="inline-flex items-center gap-1 text-slate-500 underline underline-offset-2 hover:text-slate-800"
            >
              <RotateCcw className="h-3 w-3" /> Reacomodar
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * La esquina que se jala para cambiar el tamano.
 *
 * Antes eran cuatro botones de flecha. No caben: en un telefono una columna de
 * la rejilla mide unos 29 px, asi que una caja de dos columnas es mas angosta
 * que la fila de botones y estos se salian de su propia caja. La esquina es un
 * solo blanco, es el gesto que todo mundo ya conoce de una ventana, y cambia
 * ancho y alto en un movimiento.
 *
 * Las flechas del teclado quedan como camino alterno: una esquina que se jala
 * no existe para quien no usa raton ni dedo.
 */
function Esquina({
  onBajar, onTecla, nombre,
}: {
  onBajar: (e: React.PointerEvent) => void;
  onTecla: (d: { ancho?: number; alto?: number }) => void;
  nombre: string;
}) {
  return (
    <button
      type="button"
      title="Jale para cambiar el tamaño"
      aria-label={`Cambiar el tamaño de ${nombre}. Use las flechas del teclado.`}
      onPointerDown={onBajar}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const d =
          e.key === "ArrowRight" ? { ancho: 1 }
          : e.key === "ArrowLeft" ? { ancho: -1 }
          : e.key === "ArrowDown" ? { alto: 1 }
          : e.key === "ArrowUp" ? { alto: -1 }
          : null;
        if (!d) return;
        e.preventDefault();
        onTecla(d);
      }}
      className="absolute bottom-0.5 right-0.5 grid h-6 w-6 cursor-nwse-resize place-items-center rounded-br-lg rounded-tl-md bg-white/85 text-slate-700 hover:bg-white"
    >
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true" fill="currentColor">
        <path d="M9 1v8H1z" opacity=".35" />
        <path d="M9 5.5V9H5.5z" />
      </svg>
    </button>
  );
}
