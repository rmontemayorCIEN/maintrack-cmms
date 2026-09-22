"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

type Compra = { id: string; folio: string };

/**
 * Entrada, salida o ajuste rapido desde la tabla del almacen.
 *
 * Salida y ajuste se aplican de un toque, como siempre: se capturan de pie
 * junto al anaquel y ya llevan su documento.
 *
 * La ENTRADA pregunta antes de donde viene. Medido en produccion, las
 * entradas llevaban documento solo el 15% de las veces, y entre las sueltas
 * habia cinco que decian «compra de reposicion»: material que si venia de una
 * compra y entro sin quedar ligado a ella, dejando el kardex sin forma de
 * volver a la orden y el costo promedio movido por un dato sin respaldo.
 *
 * Si viene de una compra, NO se captura aqui: se va a recibirla a la compra,
 * que escribe el folio de recepcion, mueve el estado y avisa a quien la pidio.
 * Un segundo camino para recibir se desincroniza del primero.
 */
export function MovementForm({ partId, unit, warehouseId, compras = [] }: { partId: string; unit: string; warehouseId?: string | null; compras?: Compra[] }) {
  const router = useRouter();
  const [type, setType] = useState("IN");
  const [quantity, setQuantity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preguntando, setPreguntando] = useState(false);
  const [motivo, setMotivo] = useState("");

  async function aplicar(referencia: string) {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/parts/movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partId, warehouseId: warehouseId ?? null, movementType: type, quantity: Number(quantity), reference: referencia }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Error");
      return;
    }
    setQuantity("");
    setMotivo("");
    setPreguntando(false);
    router.refresh();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!quantity) return;
    // La entrada se detiene aqui y pregunta; lo demas sigue de un toque.
    if (type === "IN") { setError(null); setPreguntando(true); return; }
    await aplicar(type === "ADJUST" ? "Ajuste manual" : "Salida manual");
  }

  /*
   * Se captura de pie junto al anaquel, con el telefono en una mano.
   *
   * `shrink-0` NO es adorno. `.field` trae `width: 100%`, y en un contenedor
   * que se ajusta al contenido —una celda de tabla— flex encoge los controles
   * hasta el ancho minimo: quedaban en 24 px, un campo donde no cabe ni un
   * numero de dos digitos. Con shrink-0 conservan el ancho declarado.
   *
   * No se pone `text-xs`: `.field` ya fija 0.875rem y le gana por orden. La
   * clase quedaria ahi aparentando hacer algo.
   *
   * Estaba en 80 px de ancho y letra de 11 px: en un pulgar no se atina ni se
   * lee lo que uno acaba de escribir. Los tres controles crecen y el boton
   * pasa a 36 px, que es el minimo con el que una persona no falla el toque.
   * La tabla ya se desliza de lado, asi que el ancho extra no rompe nada.
   */
  if (preguntando) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="De dónde viene la entrada"
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 text-left"
        onClick={(e) => { if (e.target === e.currentTarget) setPreguntando(false); }}
      >
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <p className="text-sm font-semibold text-slate-900">¿De dónde viene esta entrada?</p>
          <p className="mt-1 text-xs text-slate-500">
            Entran {quantity} {unit}. Lo que llegó de una compra se recibe en la compra, para que quede ligado a ella.
          </p>

          {compras.length ? (
            <div className="mt-3">
              <p className="text-xs font-medium text-slate-700">Compras en camino con esta refacción</p>
              <div className="mt-1.5 grid gap-1.5">
                {compras.map((c) => (
                  <a
                    key={c.id}
                    href={`/compras/${c.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800 hover:bg-brand-100"
                  >
                    <span className="truncate">Recibir en {c.folio}</span>
                    <span aria-hidden>→</span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3">
            <label htmlFor={`motivo-${partId}`} className="text-xs font-medium text-slate-700">
              {compras.length ? "O si no viene de una compra, diga por qué entra" : "Diga por qué entra"}
            </label>
            <input
              id={`motivo-${partId}`}
              className="field mt-1"
              placeholder="Devolución de obra, sobrante de proyecto, donación…"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={120}
              autoFocus
            />
          </div>

          {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setPreguntando(false); setError(null); }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={loading || motivo.trim().length < 4}
              onClick={() => aplicar(motivo.trim())}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Registrar la entrada
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="field w-28 shrink-0 max-w-28 px-2 py-1.5"
      >
        <option value="IN">Entrada</option>
        <option value="OUT">Salida</option>
        <option value="ADJUST">Ajuste</option>
      </select>
      <input
        type="number"
        step="0.5"
        min="0"
        /* Abre el teclado numerico del telefono, con punto decimal. Sin esto
           el usuario recibe el teclado completo y tiene que cambiarlo a mano. */
        inputMode="decimal"
        className="field w-24 shrink-0 max-w-24 px-2 py-1.5"
        placeholder={unit}
        aria-label={`Cantidad en ${unit}`}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <button
        type="submit"
        disabled={loading || !quantity}
        aria-label="Aplicar movimiento"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        title={error ?? "Aplicar"}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "→"}
      </button>
    </form>
  );
}
