"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";

export type AlmacenOpcion = { id: string; code: string; name: string };
export type RefaccionOpcion = {
  id: string; code: string; name: string; unit: string;
  /** Existencia por almacen. Sin entrada significa cero. */
  porAlmacen: Record<string, number>;
};

type Renglon = { partId: string; cantidad: string };

export function TraspasoDialog({
  almacenes, refacciones,
}: {
  almacenes: AlmacenOpcion[];
  refacciones: RefaccionOpcion[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [origenId, setOrigenId] = useState(almacenes[0]?.id ?? "");
  const [destinoId, setDestinoId] = useState(almacenes[1]?.id ?? "");
  const [nota, setNota] = useState("");
  const [renglones, setRenglones] = useState<Renglon[]>([{ partId: "", cantidad: "" }]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Solo se ofrecen las refacciones que existen en el origen: traspasar algo
  // que no esta ahi es el error mas facil de cometer y el mas molesto de
  // descubrir hasta que el servidor lo rechaza.
  const disponibles = useMemo(
    () => refacciones.filter((r) => (r.porAlmacen[origenId] ?? 0) > 0),
    [refacciones, origenId],
  );
  const porId = useMemo(() => new Map(refacciones.map((r) => [r.id, r])), [refacciones]);

  /**
   * El destino que realmente aplica.
   *
   * Un <select> cuyo valor no esta entre sus opciones muestra la primera pero
   * conserva el valor viejo: al cambiar el origen al almacen que estaba de
   * destino, la pantalla decia una cosa y el estado guardaba otra, y el envio
   * se rechazaba por origen igual a destino aunque en pantalla fueran
   * distintos. Derivandolo en cada render, lo que se ve es lo que se manda.
   */
  const destinos = useMemo(() => almacenes.filter((a) => a.id !== origenId), [almacenes, origenId]);
  const destinoEfectivo = destinos.some((d) => d.id === destinoId) ? destinoId : (destinos[0]?.id ?? "");

  function actualizar(i: number, cambios: Partial<Renglon>) {
    setRenglones((prev) => prev.map((r, j) => (j === i ? { ...r, ...cambios } : r)));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const validos = renglones
      .filter((r) => r.partId && Number(r.cantidad) > 0)
      .map((r) => ({ partId: r.partId, cantidad: Number(r.cantidad) }));

    if (!validos.length) { setError("Agregue al menos un renglon con cantidad"); return; }
    if (!destinoEfectivo || origenId === destinoEfectivo) {
      setError("El origen y el destino no pueden ser el mismo almacen");
      return;
    }

    const excedido = validos.find((v) => v.cantidad > (porId.get(v.partId)?.porAlmacen[origenId] ?? 0));
    if (excedido) {
      const r = porId.get(excedido.partId);
      setError(`En el origen solo hay ${r?.porAlmacen[origenId] ?? 0} de ${r?.code}`);
      return;
    }

    setGuardando(true); setError(null);
    const res = await fetch("/api/traspasos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origenId, destinoId: destinoEfectivo, nota: nota || null, renglones: validos }),
    });
    const data = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible registrar el traspaso"); return; }

    setAbierto(false);
    setRenglones([{ partId: "", cantidad: "" }]);
    setNota("");
    router.refresh();
  }

  if (almacenes.length < 2) {
    return (
      <p className="text-xs text-slate-500">
        Necesita al menos dos almacenes para traspasar. Dé de alta el segundo en Catálogos → Almacenes.
      </p>
    );
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setAbierto(true)}>
        <Plus className="h-3.5 w-3.5" /> Nuevo traspaso
      </Button>

      {abierto ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 text-left">
          <form onSubmit={enviar} className="mt-10 w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-800">Traspaso entre almacenes</h2>

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-44 flex-1">
                <label className="text-[0.6875rem] font-medium text-slate-600">Sale de</label>
                <select
                  value={origenId}
                  onChange={(e) => {
                    setOrigenId(e.target.value);
                    setRenglones([{ partId: "", cantidad: "" }]);
                    setError(null);
                  }}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                >
                  {almacenes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <ArrowRight className="mb-2 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-44 flex-1">
                <label className="text-[0.6875rem] font-medium text-slate-600">Entra a</label>
                <select
                  value={destinoEfectivo}
                  onChange={(e) => setDestinoId(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                >
                  {destinos.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 grid gap-1.5">
              <label className="text-[0.6875rem] font-medium text-slate-600">
                Refacciones {disponibles.length ? `(${disponibles.length} con existencia en el origen)` : ""}
              </label>
              {disponibles.length === 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Ese almacén no tiene existencia de nada. Elija otro origen.
                </p>
              ) : (
                renglones.map((r, i) => {
                  const hay = r.partId ? porId.get(r.partId)?.porAlmacen[origenId] ?? 0 : null;
                  return (
                    <div key={i} className="flex items-center gap-1.5">
                      <select
                        value={r.partId}
                        onChange={(e) => actualizar(i, { partId: e.target.value })}
                        className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                      >
                        <option value="">Elija refacción…</option>
                        {disponibles.map((d) => (
                          <option key={d.id} value={d.id}>{d.code} — {d.name}</option>
                        ))}
                      </select>
                      <input
                        type="number" min="0" step="any" value={r.cantidad}
                        onChange={(e) => actualizar(i, { cantidad: e.target.value })}
                        placeholder={hay !== null ? `de ${hay}` : "cantidad"}
                        className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-xs tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => setRenglones((prev) => (prev.length === 1 ? prev : prev.filter((_, j) => j !== i)))}
                        disabled={renglones.length === 1}
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-25"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
              {disponibles.length ? (
                <button
                  type="button"
                  onClick={() => setRenglones((prev) => [...prev, { partId: "", cantidad: "" }])}
                  className="mt-0.5 w-fit text-xs font-medium text-brand-600 hover:underline"
                >
                  + Agregar renglón
                </button>
              ) : null}
            </div>

            <div className="mt-3">
              <label className="text-[0.6875rem] font-medium text-slate-600">Nota</label>
              <input
                value={nota} onChange={(e) => setNota(e.target.value)}
                placeholder="Por qué se mueve, quién lo pidió, quién lo lleva…"
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
            </div>

            {error ? (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button type="submit" disabled={guardando || !disponibles.length}>
                {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Registrar traspaso
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
