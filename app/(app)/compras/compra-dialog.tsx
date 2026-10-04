"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { URGENCIAS } from "@/lib/requisiciones-datos";
import { SelectorBuscable } from "@/components/selector-buscable";
import { formatCurrency } from "@/lib/utils";

export type RefaccionCompra = { id: string; code: string; name: string; unit: string; costo: number };
type Renglon = { partId: string; descripcion: string; cantidad: string; costo: string; materialRequestLineId?: string | null };

/**
 * Alta de requisicion de compra.
 *
 * Acepta renglones precargados: la via normal es desde una requisicion de
 * material que el almacen no pudo surtir, no capturar todo de nuevo.
 */
export function CompraDialog({
  almacenes, refacciones, proveedores, materialRequestId, precargados, etiqueta, moneda,
}: {
  almacenes: { id: string; name: string }[];
  moneda: string;
  refacciones: RefaccionCompra[];
  proveedores: { id: string; name: string }[];
  materialRequestId?: string;
  precargados?: Array<{ partId: string | null; descripcion: string; cantidad: number; materialRequestLineId?: string }>;
  etiqueta?: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [warehouseId, setWarehouseId] = useState(almacenes[0]?.id ?? "");
  const [urgencia, setUrgencia] = useState<keyof typeof URGENCIAS>("NORMAL");
  const [proveedorSugeridoId, setProveedor] = useState("");
  const [justificacion, setJustificacion] = useState("");
  const porId = useMemo(() => new Map(refacciones.map((r) => [r.id, r])), [refacciones]);

  /**
   * Con que se podria resolver sin comprar.
   *
   * Se consulta al elegir la refaccion: antes de mandar a comprar conviene
   * saber si el equivalente de otra marca ya esta en el almacen. Comprar lo
   * que ya se tiene es dinero parado en un anaquel.
   */
  const [equivalentes, setEquivalentes] = useState<Record<string, { code: string; unit: string; hay: number; tipo: string }[]>>({});

  async function buscarEquivalentes(partId: string) {
    if (equivalentes[partId]) return;
    const res = await fetch(`/api/refacciones/equivalencias?partId=${partId}`);
    if (!res.ok) { setEquivalentes((e) => ({ ...e, [partId]: [] })); return; }
    const cuerpo = await res.json().catch(() => null);
    setEquivalentes((e) => ({
      ...e,
      [partId]: (cuerpo?.equivalencias ?? [])
        .filter((x: { hay: number }) => x.hay > 0)
        .map((x: { hay: number; tipo: string; refaccion: { code: string; unit: string } }) => ({
          code: x.refaccion.code, unit: x.refaccion.unit, hay: x.hay, tipo: x.tipo,
        })),
    }));
  }
  const [renglones, setRenglones] = useState<Renglon[]>(
    precargados?.length
      ? precargados.map((p) => ({
          partId: p.partId ?? "",
          descripcion: p.descripcion,
          cantidad: String(p.cantidad),
          costo: String(p.partId ? porId.get(p.partId)?.costo ?? 0 : 0),
          // De que renglon del vale viene: asi la compra queda ligada al
          // faltante y el sistema puede impedir que se compre dos veces.
          materialRequestLineId: p.materialRequestLineId ?? null,
        }))
      : [{ partId: "", descripcion: "", cantidad: "", costo: "" }],
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = renglones.reduce((s, r) => s + (Number(r.cantidad) || 0) * (Number(r.costo) || 0), 0);

  function actualizar(i: number, c: Partial<Renglon>) {
    setRenglones((prev) => prev.map((r, j) => (j === i ? { ...r, ...c } : r)));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const validos = renglones
      .filter((r) => Number(r.cantidad) > 0 && (r.partId || r.descripcion.trim().length >= 2))
      .map((r) => ({
        partId: r.partId || null,
        descripcion: r.partId ? `${porId.get(r.partId)?.code} — ${porId.get(r.partId)?.name}` : r.descripcion.trim(),
        cantidadSolicitada: Number(r.cantidad),
        costoEstimado: Number(r.costo) || 0,
        materialRequestLineId: r.materialRequestLineId ?? null,
      }));
    if (!validos.length) { setError("Agregue al menos un renglón con cantidad"); return; }

    setGuardando(true); setError(null);
    const res = await fetch("/api/compras", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        warehouseId, materialRequestId: materialRequestId ?? null,
        proveedorSugeridoId: proveedorSugeridoId || null,
        urgencia, justificacion: justificacion || null, renglones: validos,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible crear la requisición"); return; }
    setAbierto(false);
    router.push(`/compras/${data.id}`);
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setAbierto(true)}>
        <Plus className="h-3.5 w-3.5" /> {etiqueta ?? "Nueva requisición de compra"}
      </Button>

      {abierto ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 text-left">
          <form onSubmit={enviar} className="mt-8 w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-800">Requisición de compra</h2>
            <p className="mt-0.5 text-[0.6875rem] text-slate-500">
              Lo que el almacén no tuvo y hay que adquirir. Se avisa a quien compra en cuanto se guarda.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Entra al almacén</label>
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                  {almacenes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Urgencia</label>
                <select value={urgencia} onChange={(e) => setUrgencia(e.target.value as keyof typeof URGENCIAS)}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                  {Object.entries(URGENCIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Proveedor sugerido</label>
                <SelectorBuscable
                  className="mt-0.5"
                  valor={proveedorSugeridoId}
                  onCambio={setProveedor}
                  vacio="Sin sugerir"
                  marcador="Busque por nombre del proveedor"
                  opciones={proveedores.map((p) => ({ id: p.id, etiqueta: p.name }))}
                />
              </div>
            </div>

            <div className="mt-4 grid gap-1.5">
              <label className="text-[0.6875rem] font-medium text-slate-600">Qué hay que comprar</label>
              {renglones.map((r, i) => (
                <div key={i} className="grid gap-1.5 sm:grid-cols-[1fr_auto_auto_auto]">
                  <div className="grid gap-1">
                    <SelectorBuscable
                      valor={r.partId}
                      onCambio={(id) => {
                        actualizar(i, {
                          partId: id,
                          descripcion: "",
                          costo: id ? String(porId.get(id)?.costo ?? 0) : r.costo,
                        });
                        if (id) buscarEquivalentes(id);
                      }}
                      vacio="Del catálogo…"
                      marcador="Busque por clave o descripción"
                      opciones={refacciones.map((d) => ({ id: d.id, etiqueta: `${d.code} — ${d.name}` }))}
                    />
                    {r.partId && equivalentes[r.partId]?.length ? (
                      <p className="text-[0.625rem] text-emerald-700">
                        Ya hay en almacén un equivalente:{" "}
                        {equivalentes[r.partId].map((e, k) => (
                          <span key={e.code}>
                            {k > 0 ? ", " : ""}
                            <b>{e.code}</b> ({e.hay} {e.unit}{e.tipo === "SUSTITUTO" ? ", sustituto" : ""})
                          </span>
                        ))}
                        . Revise si de verdad hace falta comprar.
                      </p>
                    ) : null}
                    {!r.partId ? (
                      <input value={r.descripcion} onChange={(e) => actualizar(i, { descripcion: e.target.value })}
                        placeholder="…o descríbalo: todavía no está en el catálogo"
                        className="w-full rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-xs" />
                    ) : null}
                  </div>
                  <input type="number" inputMode="decimal" min="0" step="any" value={r.cantidad}
                    onChange={(e) => actualizar(i, { cantidad: e.target.value })} placeholder="cant."
                    className="h-fit w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-xs tabular-nums" />
                  <input type="number" inputMode="decimal" min="0" step="any" value={r.costo}
                    onChange={(e) => actualizar(i, { costo: e.target.value })} placeholder="costo est."
                    className="h-fit w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-xs tabular-nums" />
                  <button type="button"
                    onClick={() => setRenglones((p) => (p.length === 1 ? p : p.filter((_, j) => j !== i)))}
                    disabled={renglones.length === 1}
                    className="h-fit rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-25">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <button type="button"
                  onClick={() => setRenglones((p) => [...p, { partId: "", descripcion: "", cantidad: "", costo: "" }])}
                  className="text-xs font-medium text-brand-600 hover:underline">
                  + Agregar renglón
                </button>
                <span className="text-xs text-slate-500">
                  Estimado: <span className="font-medium tabular-nums text-slate-800">{formatCurrency(total, moneda)}</span>
                </span>
              </div>
            </div>

            <div className="mt-3">
              <label className="text-[0.6875rem] font-medium text-slate-600">Justificación</label>
              <input value={justificacion} onChange={(e) => setJustificacion(e.target.value)}
                placeholder="Por qué se necesita y qué pasa si no llega"
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
            </div>

            {error ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Solicitar compra
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
