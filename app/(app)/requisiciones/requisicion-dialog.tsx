"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { MOTIVOS, URGENCIAS } from "@/lib/requisiciones";
import { SelectorBuscable } from "@/components/selector-buscable";

export type Opcion = { id: string; etiqueta: string };
export type OpcionOrden = Opcion & { activo: string | null };
export type RefaccionOpcion = { id: string; code: string; name: string; unit: string };
/** Existencia por almacen y por refaccion. Sin entrada significa cero. */
export type Existencias = Record<string, Record<string, number>>;
/** Renglones que llegan ya armados, por ejemplo del plan de una orden. */
export type Precargado = { partId: string; cantidad: number };

type Renglon = { partId: string; descripcion: string; cantidad: string };

export function RequisicionDialog({
  almacenes, ordenes, activos, refacciones, existencias,
  ordenFija, precargados, etiqueta,
}: {
  almacenes: Opcion[];
  ordenes: OpcionOrden[];
  activos: Opcion[];
  /** El catalogo completo: se puede pedir algo que no hay, para que escale a compras. */
  refacciones: RefaccionOpcion[];
  existencias: Existencias;
  /** Cuando se pide desde una orden, la orden no se elige. */
  ordenFija?: OpcionOrden;
  precargados?: Precargado[];
  etiqueta?: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [warehouseId, setWarehouseId] = useState(almacenes[0]?.id ?? "");
  const [workOrderId, setWorkOrderId] = useState(ordenFija?.id ?? "");
  const [assetId, setAssetId] = useState("");
  const [motivo, setMotivo] = useState<keyof typeof MOTIVOS>("CORRECTIVO");
  const [urgencia, setUrgencia] = useState<keyof typeof URGENCIAS>("NORMAL");
  const [nota, setNota] = useState("");
  const [renglones, setRenglones] = useState<Renglon[]>(
    precargados?.length
      ? precargados.map((p) => ({ partId: p.partId, descripcion: "", cantidad: String(p.cantidad) }))
      : [{ partId: "", descripcion: "", cantidad: "" }],
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orden = useMemo(
    () => ordenFija ?? ordenes.find((o) => o.id === workOrderId) ?? null,
    [ordenFija, ordenes, workOrderId],
  );
  const porId = useMemo(() => new Map(refacciones.map((r) => [r.id, r])), [refacciones]);

  /**
   * Con que mas se puede resolver un renglon que no se cubre.
   *
   * Se consulta solo cuando de verdad falta material —que es el caso raro— y
   * se recuerda: dos renglones del mismo balero no preguntan dos veces.
   */
  const [equivalentes, setEquivalentes] = useState<Record<string, { code: string; name: string; unit: string; hay: number; tipo: string; nota: string | null }[]>>({});

  async function buscarEquivalentes(partId: string) {
    if (equivalentes[partId]) return;
    const res = await fetch(`/api/refacciones/equivalencias?partId=${partId}`);
    if (!res.ok) { setEquivalentes((e) => ({ ...e, [partId]: [] })); return; }
    const cuerpo = await res.json().catch(() => null);
    setEquivalentes((e) => ({
      ...e,
      [partId]: (cuerpo?.equivalencias ?? [])
        .filter((x: { hay: number }) => x.hay > 0)
        .map((x: { hay: number; tipo: string; nota: string | null; refaccion: { code: string; name: string; unit: string } }) => ({
          code: x.refaccion.code, name: x.refaccion.name, unit: x.refaccion.unit,
          hay: x.hay, tipo: x.tipo, nota: x.nota,
        })),
    }));
  }
  const hay = (partId: string) => existencias[warehouseId]?.[partId] ?? 0;

  /**
   * Cuanto de lo pedido puede cubrir el almacen ahora mismo.
   *
   * Se calcula antes de enviar y no despues: saber que solo hay tres de cinco
   * permite empezar a trabajar con lo que hay y mandar el resto a compras, en
   * vez de descubrirlo cuando el tecnico ya bajo por el material.
   */
  const cobertura = useMemo(() => {
    const conParte = renglones.filter((r) => r.partId && Number(r.cantidad) > 0);
    let completos = 0, parciales = 0, sin = 0;
    for (const r of conParte) {
      const disponible = hay(r.partId);
      const pedido = Number(r.cantidad);
      if (disponible >= pedido) completos++;
      else if (disponible > 0) parciales++;
      else sin++;
    }
    return { total: conParte.length, completos, parciales, sin };
  }, [renglones, existencias, warehouseId]);

  function actualizar(i: number, cambios: Partial<Renglon>) {
    setRenglones((prev) => prev.map((r, j) => (j === i ? { ...r, ...cambios } : r)));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!workOrderId && !assetId) {
      setError("Indique la orden de trabajo o el activo al que se destina el material");
      return;
    }
    const validos = renglones
      .filter((r) => Number(r.cantidad) > 0 && (r.partId || r.descripcion.trim().length >= 2))
      .map((r) => ({
        partId: r.partId || null,
        descripcion: r.partId ? `${porId.get(r.partId)?.code} — ${porId.get(r.partId)?.name}` : r.descripcion.trim(),
        cantidadSolicitada: Number(r.cantidad),
      }));
    if (!validos.length) { setError("Agregue al menos un renglon con cantidad"); return; }

    setGuardando(true); setError(null);
    const res = await fetch("/api/requisiciones", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        warehouseId, workOrderId: workOrderId || null, assetId: assetId || null,
        motivo, urgencia, nota: nota || null, renglones: validos,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible crear la requisicion"); return; }
    setAbierto(false);
    router.push(`/requisiciones/${data.id}`);
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setAbierto(true)}>
        <Plus className="h-3.5 w-3.5" /> {etiqueta ?? "Nueva requisición"}
      </Button>

      {abierto ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 text-left">
          <form onSubmit={enviar} className="mt-8 w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-800">Requisición de material</h2>
            <p className="mt-0.5 text-[0.6875rem] text-slate-500">
              Lo que mantenimiento le pide al almacén. Pedir no descuenta existencia: eso pasa al surtir.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Almacén</label>
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                  {almacenes.map((a) => <option key={a.id} value={a.id}>{a.etiqueta}</option>)}
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
                <label className="text-[0.6875rem] font-medium text-slate-600">Orden de trabajo</label>
                {ordenFija ? (
                  <div className="mt-0.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                    {ordenFija.etiqueta}
                  </div>
                ) : (
                  <SelectorBuscable
                    className="mt-0.5"
                    valor={workOrderId}
                    onCambio={(id) => { setWorkOrderId(id); setAssetId(""); setError(null); }}
                    vacio="Sin orden"
                    marcador="Busque por folio o titulo"
                    opciones={ordenes.map((o) => ({ id: o.id, etiqueta: o.etiqueta }))}
                  />
                )}
              </div>
              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Activo</label>
                {orden ? (
                  // El activo viene de la orden. Volver a preguntarlo seria
                  // pedir un dato que el sistema ya tiene, y abrir la puerta a
                  // que los dos se contradigan.
                  <div className="mt-0.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                    {orden.activo ?? "La orden no tiene activo asignado"}
                    <span className="mt-0.5 block text-[0.625rem] text-slate-400">
                      Lo toma de la orden de trabajo
                    </span>
                  </div>
                ) : (
                  <SelectorBuscable
                    className="mt-0.5"
                    valor={assetId}
                    onCambio={(id) => { setAssetId(id); setError(null); }}
                    vacio="Sin activo"
                    marcador="Busque por clave o nombre del equipo"
                    opciones={activos.map((a) => ({ id: a.id, etiqueta: a.etiqueta }))}
                  />
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="text-[0.6875rem] font-medium text-slate-600">Motivo</label>
                <select value={motivo} onChange={(e) => setMotivo(e.target.value as keyof typeof MOTIVOS)}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                  {Object.entries(MOTIVOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-4 grid gap-1.5">
              <label className="text-[0.6875rem] font-medium text-slate-600">Qué se necesita</label>
              {renglones.map((r, i) => {
                const ref = r.partId ? porId.get(r.partId) : null;
                const disponible = r.partId ? hay(r.partId) : 0;
                const pedido = Number(r.cantidad) || 0;
                // El semaforo por renglon: cubre, alcanza para empezar, o no hay.
                const estado = !r.partId || !pedido
                  ? null
                  : disponible >= pedido
                    ? { texto: "Se cubre completo", clase: "text-emerald-700" }
                    : disponible > 0
                      ? { texto: `Solo hay ${disponible} de ${pedido} — puede empezar con eso`, clase: "text-amber-700" }
                      : { texto: "No hay existencia — va a compras", clase: "text-rose-700" };
                return (
                  <div key={i} className="grid gap-1.5 sm:grid-cols-[1fr_auto_auto]">
                    <div className="grid gap-1">
                      <SelectorBuscable
                        valor={r.partId}
                        onCambio={(id) => {
                          actualizar(i, { partId: id, descripcion: "" });
                          if (id) buscarEquivalentes(id);
                        }}
                        vacio="Del catálogo…"
                        marcador="Busque por clave o descripcion"
                        opciones={refacciones.map((d) => ({
                          id: d.id,
                          etiqueta: `${d.code} — ${d.name}`,
                          detalle: `hay ${hay(d.id)} ${d.unit}`,
                        }))}
                      />
                      {estado ? <p className={`text-[0.625rem] ${estado.clase}`}>{estado.texto}</p> : null}
                      {r.partId && pedido > disponible && equivalentes[r.partId]?.length ? (
                        <p className="text-[0.625rem] text-emerald-700">
                          Se puede resolver con{" "}
                          {equivalentes[r.partId].map((e, k) => (
                            <span key={e.code}>
                              {k > 0 ? ", " : ""}
                              <b>{e.code}</b> ({e.hay} {e.unit}
                              {e.tipo === "SUSTITUTO" ? ", sustituto" : ""})
                            </span>
                          ))}
                          {equivalentes[r.partId].find((e) => e.nota) ? (
                            <span className="mt-0.5 block text-amber-800">
                              ⚠ {equivalentes[r.partId].find((e) => e.nota)?.nota}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                      {!r.partId ? (
                        // Se puede pedir lo que no esta en el catalogo: es como
                        // llega a compras lo que todavia nadie ha dado de alta.
                        <input
                          value={r.descripcion}
                          onChange={(e) => actualizar(i, { descripcion: e.target.value })}
                          placeholder="…o descríbalo: no está en el catálogo"
                          className="w-full rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-xs"
                        />
                      ) : null}
                    </div>
                    <input
                      type="number" min="0" step="any" value={r.cantidad}
                      onChange={(e) => actualizar(i, { cantidad: e.target.value })}
                      placeholder={ref ? `hay ${disponible}` : "cantidad"}
                      className="h-fit w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-xs tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => setRenglones((prev) => (prev.length === 1 ? prev : prev.filter((_, j) => j !== i)))}
                      disabled={renglones.length === 1}
                      className="h-fit rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-25"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => setRenglones((prev) => [...prev, { partId: "", descripcion: "", cantidad: "" }])}
                className="w-fit text-xs font-medium text-brand-600 hover:underline"
              >
                + Agregar renglón
              </button>
            </div>

            <div className="mt-3">
              <label className="text-[0.6875rem] font-medium text-slate-600">Nota</label>
              <input value={nota} onChange={(e) => setNota(e.target.value)}
                placeholder="Para cuándo se necesita, dónde entregarlo…"
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
            </div>

            {cobertura.total ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[0.6875rem] font-medium text-slate-700">
                  El almacén cubre {cobertura.completos} de {cobertura.total}{" "}
                  {cobertura.total === 1 ? "renglón" : "renglones"}
                </p>
                {cobertura.parciales || cobertura.sin ? (
                  <p className="mt-0.5 text-[0.625rem] leading-relaxed text-slate-500">
                    {cobertura.parciales ? `${cobertura.parciales} alcanza${cobertura.parciales === 1 ? "" : "n"} solo en parte. ` : ""}
                    {cobertura.sin ? `${cobertura.sin} sin existencia. ` : ""}
                    Se puede surtir lo que hay para empezar, y lo que falte se manda a compras desde
                    la requisición.
                  </p>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Crear requisición
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
