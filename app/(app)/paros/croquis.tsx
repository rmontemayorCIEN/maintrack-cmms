"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Move, PencilRuler, RotateCcw, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  REJILLA, acomodoInicial, primerHueco, resolverSoltada, tamanoQueCabe,
  type CajaCroquis, type AreaParaCroquis,
} from "@/lib/croquis";

export type AreaEnCroquis = AreaParaCroquis & {
  horasQueDetienen: number;
  perdida: number;
};

/**
 * La planta como la ve su dueno, no como la ordena una grafica.
 *
 * La tira proporcional dice donde duele, pero no se parece a la planta de
 * nadie. Un director piensa en lugares —"el area de tornos, alla al fondo"— y
 * cuando el dibujo coincide con esa geografia mental deja de ser una grafica y
 * pasa a ser SU planta. Eso es lo que hace que se quede viendola.
 *
 * ── El costo de esta decision, dicho de frente ──
 *
 * En la tira, el TAMANO era el dano. Aqui el tamano es geografia, asi que ese
 * canal se pierde y todo el peso queda en el color. Se compensa poniendo horas
 * y pesos dentro de cada caja: la magnitud se lee, aunque ya no se vea de
 * lejos. Vale la pena porque reconocer la propia planta importa mas que
 * comparar areas por area.
 *
 * ── Como se acomoda ──
 *
 * Rejilla de 12x8 y no pixeles libres: nadie acomoda cajas al pixel con el
 * dedo en una tableta, y la rejilla hace que un croquis armado de prisa se vea
 * ordenado. Un mismo puntero para dedo y raton, para no escribir dos caminos
 * que se desincronizan.
 */
export function Croquis({
  areas,
  moneda,
  editable,
  areaViendo,
  onVerArea,
}: {
  areas: AreaEnCroquis[];
  moneda: string;
  editable: boolean;
  areaViendo: string | null;
  onVerArea: (locationId: string | null) => void;
}) {
  const router = useRouter();
  const lienzo = useRef<HTMLDivElement>(null);
  const [editando, setEditando] = useState(false);
  const [cajas, setCajas] = useState<CajaCroquis[]>([]);
  const [moviendo, setMoviendo] = useState<{ id: string; dx: number; dy: number; x0: number; y0: number } | null>(null);
  const [escalando, setEscalando] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conId = areas.filter((a): a is AreaEnCroquis & { locationId: string } => Boolean(a.locationId));
  const maxHoras = Math.max(...conId.map((a) => a.horasQueDetienen), 1);

  /** Se rearma al entrar a editar y cuando cambian las areas. */
  useEffect(() => {
    const colocadas = conId
      .filter((a) => a.planoX !== null && a.planoY !== null)
      .map((a) => ({
        locationId: a.locationId,
        x: a.planoX as number,
        y: a.planoY as number,
        ancho: a.planoAncho,
        alto: a.planoAlto,
      }));
    const faltantes = conId.filter((a) => a.planoX === null || a.planoY === null);
    if (!faltantes.length) {
      setCajas(colocadas);
      return;
    }
    // Las que nunca se colocaron entran por el primer hueco libre, no encimadas.
    const nuevas = acomodoInicial(faltantes.map((a) => ({ ...a })));
    const acumulado = [...colocadas];
    for (const n of nuevas) {
      const { x, y } = primerHueco(acumulado, n);
      acumulado.push({ ...n, x, y });
    }
    setCajas(acumulado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas]);

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
    // Se guarda desde que celda de la caja se agarro, para que no brinque al
    // pulgar cada vez que se toma de una esquina.
    // x0/y0: de donde salio, para poder intercambiarla con la que estorbe.
    setMoviendo({ id: c.locationId, dx: cx - c.x, dy: cy - c.y, x0: c.x, y0: c.y });
  }

  function alMover(e: React.PointerEvent) {
    const { cx, cy } = celdaEn(e.clientX, e.clientY);

    // Jalando la esquina: la celda bajo el dedo es la ultima que ocupa la caja.
    if (escalando) {
      setCajas((cs) =>
        cs.map((c) =>
          c.locationId !== escalando
            ? c
            : { ...c, ...tamanoQueCabe(cs, { ...c, ancho: cx - c.x + 1, alto: cy - c.y + 1 }) },
        ),
      );
      return;
    }

    if (!moviendo) return;
    setCajas((cs) =>
      cs.map((c) => {
        if (c.locationId !== moviendo.id) return c;
        return {
          ...c,
          x: Math.min(Math.max(cx - moviendo.dx, 0), REJILLA.columnas - c.ancho),
          y: Math.min(Math.max(cy - moviendo.dy, 0), REJILLA.filas - c.alto),
        };
      }),
    );
  }

  function alSoltar() {
    // Al terminar de estirar se revisa lo mismo que al mover: una caja que
    // crecio encima de otra tapa un area completa sin que nadie lo note.
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
        if (c.locationId !== id) return c;
        const pedido = { ...c, ancho: c.ancho + (d.ancho ?? 0), alto: c.alto + (d.alto ?? 0) };
        return { ...c, ...tamanoQueCabe(cs, pedido) };
      }),
    );
  }

  function alBajarTamano(e: React.PointerEvent, c: CajaCroquis) {
    // Se detiene aqui o el gesto lo toma la caja y en vez de cambiar el tamano
    // se arrastraria el area completa.
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setEscalando(c.locationId);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    const res = await fetch("/api/organizacion/croquis", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ areas: cajas }),
    });
    setGuardando(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "No fue posible guardar el croquis");
      return;
    }
    setEditando(false);
    router.refresh();
  }

  const porId = new Map(conId.map((a) => [a.locationId, a]));

  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Su planta</h2>
          <p className="text-[0.6875rem] leading-relaxed text-slate-500">
            {editando
              ? "Arrastre cada área a donde de verdad está. Jale la esquina para cambiar su tamaño."
              : "El color es lo que dolió. Toque un área para ver qué la detuvo."}
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
                  Guardar croquis
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditando(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                <PencilRuler className="h-3.5 w-3.5" /> Acomodar mi planta
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
        onPointerCancel={() => setMoviendo(null)}
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
          const a = porId.get(c.locationId);
          if (!a) return null;
          const activa = areaViendo === c.locationId;
          const arrastrando = moviendo?.id === c.locationId;
          return (
            <div
              key={c.locationId}
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
                onClick={() => !editando && onVerArea(c.locationId)}
                aria-pressed={!editando && activa}
                className={`flex h-full w-full flex-col justify-between overflow-hidden rounded-lg p-2 text-left outline-offset-[-2px] transition ${
                  editando ? "cursor-move" : "cursor-pointer hover:brightness-105"
                } ${activa && !editando ? "outline outline-2 outline-slate-900" : ""} ${
                  arrastrando ? "scale-[1.02] shadow-lg" : ""
                }`}
                style={{ background: tono(a.horasQueDetienen, maxHoras) }}
              >
                <span
                  className="text-[0.75rem] font-semibold leading-tight text-white drop-shadow-sm"
                  style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                >
                  {a.area}
                </span>
                {/*
                  El tamano de la caja ya no dice el dano —dice geografia—, asi
                  que la magnitud se pone por escrito. Sin esto se pierde el
                  canal que la tira proporcional si tenia.
                */}
                <span className="text-white/95">
                  <span className="block text-base font-semibold leading-none tabular-nums drop-shadow-sm">
                    {a.horasQueDetienen}
                    <span className="text-[0.6875rem] font-medium opacity-85"> h</span>
                  </span>
                  {a.perdida > 0 ? (
                    <span className="block text-[0.625rem] leading-tight">
                      {formatCurrency(a.perdida, moneda)}
                    </span>
                  ) : null}
                </span>
              </button>

              {editando ? (
                <Esquina
                  onBajar={(e) => alBajarTamano(e, c)}
                  onTecla={(d) => redimensionar(c.locationId, d)}
                  area={a.area}
                />
              ) : null}
              {editando ? (
                <Move className="pointer-events-none absolute left-1.5 top-1.5 h-3 w-3 text-white/70" />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.625rem] text-slate-500">
        <span>Menos paro</span>
        <span className="flex gap-0.5" aria-hidden="true">
          {[0, 0.15, 0.35, 0.6, 1].map((p) => (
            <i key={p} className="block h-2.5 w-6 rounded-sm" style={{ background: tono(p, 1) }} />
          ))}
        </span>
        <span>Más paro</span>
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
    </div>
  );
}

/**
 * La esquina que se jala para cambiar el tamano del area.
 *
 * Antes eran cuatro botones de flecha. No caben: en un telefono una columna de
 * la rejilla mide unos 29 px, asi que una caja de dos columnas es mas angosta
 * que la fila de botones y estos se salian de su propia area. La esquina es un
 * solo blanco, es el gesto que todo mundo ya conoce de una ventana, y cambia
 * ancho y alto en un movimiento.
 *
 * Las flechas del teclado quedan como camino alterno: una esquina que se jala
 * no existe para quien no usa raton ni dedo.
 */
function Esquina({
  onBajar, onTecla, area,
}: {
  onBajar: (e: React.PointerEvent) => void;
  onTecla: (d: { ancho?: number; alto?: number }) => void;
  area: string;
}) {
  return (
    <button
      type="button"
      title="Jale para cambiar el tamaño"
      aria-label={`Cambiar el tamaño de ${area}. Use las flechas del teclado.`}
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

/** La rampa de calor, contra el area que mas paro. */
function tono(horas: number, max: number): string {
  const p = max > 0 ? horas / max : 0;
  if (p >= 0.75) return "#9e2f12";
  if (p >= 0.45) return "#c4522a";
  if (p >= 0.2) return "#d9622c";
  if (p > 0) return "#e08b4f";
  return "#b9c2d0";
}
