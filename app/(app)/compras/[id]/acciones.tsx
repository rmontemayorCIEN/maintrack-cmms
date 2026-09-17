"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, PackagePlus, ShoppingCart, X } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { SelectorBuscable } from "@/components/selector-buscable";

export type RenglonCompra = {
  id: string; partId: string | null; descripcion: string;
  solicitada: number; recibida: number; costoEstimado: number; unidad: string;
};

export function AccionesCompra({
  compraId, estado, renglones, proveedores, ordenCompra, esPropia,
  puedeAutorizar, puedeRecibir, puedeColocar, comprasInternas,
}: {
  compraId: string;
  estado: string;
  renglones: RenglonCompra[];
  proveedores: { id: string; name: string }[];
  ordenCompra: string | null;
  /** Si el usuario es quien la solicito: no puede firmar su propia compra. */
  esPropia: boolean;
  puedeAutorizar: boolean;
  puedeRecibir: boolean;
  puedeColocar: boolean;
  comprasInternas: boolean;
}) {
  const router = useRouter();
  const [modo, setModo] = useState<"RECHAZAR" | "COLOCAR" | "RECIBIR" | null>(null);
  const [motivo, setMotivo] = useState("");
  const [folioOC, setFolioOC] = useState(ordenCompra ?? "");
  const [remision, setRemision] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [nota, setNota] = useState("");
  const [recepcion, setRecepcion] = useState<Record<string, { cantidad: string; costo: string; conforme: boolean; obs: string }>>({});
  const [ocupado, setOcupado] = useState(false);
  /**
   * Clave del recibo que se esta capturando. Viaja con el envio: si el boton
   * se presiona dos veces o el navegador reintenta, el servidor reconoce la
   * clave y devuelve la recepcion que ya hizo, sin volver a entrar material.
   */
  const [claveRecepcion, setClaveRecepcion] = useState("");
  const [error, setError] = useState<string | null>(null);

  const porRecibir = renglones.filter((r) => r.partId && r.solicitada - r.recibida > 0.0001);

  function abrirRecepcion() {
    const previas: typeof recepcion = {};
    for (const r of porRecibir) {
      previas[r.id] = {
        cantidad: String(r.solicitada - r.recibida),
        costo: String(r.costoEstimado || 0),
        conforme: true, obs: "",
      };
    }
    setRecepcion(previas); setError(null);
    setClaveRecepcion(crypto.randomUUID());
    setModo("RECIBIR");
  }

  async function enviar(cuerpo: Record<string, unknown>) {
    if (ocupado) return;
    setOcupado(true); setError(null);
    const res = await fetch(`/api/compras/${compraId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
    });
    const data = await res.json().catch(() => ({}));
    setOcupado(false);
    if (!res.ok) { setError(data.error ?? "No fue posible completar la operación"); return; }
    setModo(null);
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {estado === "SOLICITADA" && puedeAutorizar && !esPropia ? (
          <>
            <Button type="button" onClick={() => enviar({ accion: "AUTORIZAR" })} disabled={ocupado}>
              <Check className="h-3.5 w-3.5" /> Autorizar
            </Button>
            <Button type="button" variant="secondary" onClick={() => setModo("RECHAZAR")}>
              <X className="h-3.5 w-3.5" /> Rechazar
            </Button>
          </>
        ) : null}

        {estado === "AUTORIZADA" && !puedeColocar ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Autorizada. Falta que compras la coloque con el proveedor.
          </p>
        ) : null}

        {estado === "SOLICITADA" && puedeAutorizar && esPropia ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Usted la solicitó: la autorización la firma otra persona.
          </p>
        ) : null}

        {/* Colocar es sobre una compra ya firmada: ofrecerlo antes solo lleva al
            rechazo del servidor («Falta autorizar la requisición»). */}
        {estado === "AUTORIZADA" && puedeColocar ? (
          <Button type="button" variant="secondary" onClick={() => setModo("COLOCAR")}>
            <ShoppingCart className="h-3.5 w-3.5" />
            {comprasInternas ? "Registrar orden de compra" : "Anotar orden del ERP"}
          </Button>
        ) : null}

        {/* Y se recibe lo que ya se colocó: antes de eso no hay nada en camino. */}
        {porRecibir.length && puedeRecibir && ["EN_COMPRA", "RECIBIDA_PARCIAL"].includes(estado) ? (
          <Button type="button" onClick={abrirRecepcion}>
            <PackagePlus className="h-3.5 w-3.5" /> Recibir material
          </Button>
        ) : null}

        {["RECIBIDA", "RECIBIDA_PARCIAL"].includes(estado) && puedeColocar ? (
          <Button type="button" variant="secondary" onClick={() => enviar({ accion: "CERRAR" })} disabled={ocupado}>
            Cerrar
          </Button>
        ) : null}
      </div>

      {error && !modo ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
      ) : null}

      {modo === "RECHAZAR" ? (
        <Card>
          <p className="text-xs font-semibold text-slate-800">Rechazar la compra</p>
          <p className="mt-0.5 text-[0.6875rem] text-slate-500">
            El motivo le llega a quien la pidió. Sin él tendría que ir a preguntar.
          </p>
          <input
            value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ya hay en el otro almacén, el monto no se justifica…"
            className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          />
          {error ? <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModo(null)}>Cancelar</Button>
            <Button type="button" variant="danger" onClick={() => enviar({ accion: "RECHAZAR", motivo })} disabled={ocupado}>
              {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Rechazar
            </Button>
          </div>
        </Card>
      ) : null}

      {modo === "COLOCAR" ? (
        <Card>
          <p className="text-xs font-semibold text-slate-800">
            {comprasInternas ? "Orden de compra" : "Orden de compra del sistema externo"}
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-slate-500">
            {comprasInternas
              ? "El folio con el que se comprometió al proveedor."
              : "El folio de la orden que emitió su ERP. Con esto la trazabilidad no se rompe aunque compras viva afuera."}
          </p>
          <input
            value={folioOC} onChange={(e) => setFolioOC(e.target.value)}
            placeholder="OC-2026-0451"
            className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs sm:max-w-xs"
          />
          {error ? <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModo(null)}>Cancelar</Button>
            <Button type="button" onClick={() => enviar({ accion: "COLOCAR", ordenCompra: folioOC })} disabled={ocupado}>
              {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar
            </Button>
          </div>
        </Card>
      ) : null}

      {modo === "RECIBIR" ? (
        <Card>
          <p className="text-xs font-semibold text-slate-800">Recepción de material</p>
          <p className="mt-0.5 text-[0.6875rem] text-slate-500">
            Revise contra lo que se pidió antes de firmar. Lo que no venga conforme se recibe igual,
            pero queda señalado: devolverlo es una conversación con el proveedor, no un borrado.
          </p>

          <div className="mt-3 grid gap-2">
            {porRecibir.map((r) => {
              const v = recepcion[r.id] ?? { cantidad: "", costo: "", conforme: true, obs: "" };
              const set = (c: Partial<typeof v>) => setRecepcion((p) => ({ ...p, [r.id]: { ...v, ...c } }));
              return (
                <div key={r.id} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-44 flex-1">
                      <p className="text-xs font-medium text-slate-800">{r.descripcion}</p>
                      <p className="text-[0.625rem] text-slate-500">
                        faltan {r.solicitada - r.recibida} {r.unidad}
                      </p>
                    </div>
                    <label className="text-[0.625rem] text-slate-500">
                      Cantidad
                      <input type="number" min="0" step="any" value={v.cantidad}
                        onChange={(e) => set({ cantidad: e.target.value })}
                        className="mt-0.5 block w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs tabular-nums" />
                    </label>
                    <label className="text-[0.625rem] text-slate-500">
                      Costo unit.
                      <input type="number" min="0" step="any" value={v.costo}
                        onChange={(e) => set({ costo: e.target.value })}
                        className="mt-0.5 block w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs tabular-nums" />
                    </label>
                    <label className="flex items-center gap-1.5 text-[0.6875rem] text-slate-600">
                      <input type="checkbox" checked={v.conforme}
                        onChange={(e) => set({ conforme: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-slate-300" />
                      Conforme
                    </label>
                  </div>
                  {!v.conforme ? (
                    <input value={v.obs} onChange={(e) => set({ obs: e.target.value })}
                      placeholder="Qué se encontró: empaque golpeado, modelo distinto, faltan piezas…"
                      className="mt-1.5 w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs" />
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div>
              <label className="text-[0.6875rem] font-medium text-slate-600">Remisión o factura</label>
              <input value={remision} onChange={(e) => setRemision(e.target.value)} placeholder="R-4471"
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
            </div>
            <div>
              <label className="text-[0.6875rem] font-medium text-slate-600">Proveedor</label>
              <SelectorBuscable
                className="mt-0.5"
                valor={supplierId}
                onCambio={setSupplierId}
                vacio="Sin indicar"
                marcador="Busque por nombre del proveedor"
                opciones={proveedores.map((p) => ({ id: p.id, etiqueta: p.name }))}
              />
            </div>
            <div>
              <label className="text-[0.6875rem] font-medium text-slate-600">Nota</label>
              <input value={nota} onChange={(e) => setNota(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
            </div>
          </div>

          {error ? <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}

          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModo(null)}>Cancelar</Button>
            <Button
              type="button" disabled={ocupado}
              onClick={() => enviar({
                accion: "RECIBIR", clave: claveRecepcion, remision: remision || null,
                supplierId: supplierId || null, nota: nota || null,
                renglones: porRecibir
                  .map((r) => {
                    const v = recepcion[r.id];
                    return {
                      requestLineId: r.id, partId: r.partId!,
                      cantidad: Number(v?.cantidad) || 0,
                      costoUnitario: Number(v?.costo) || 0,
                      conforme: v?.conforme ?? true,
                      observacion: v?.obs || null,
                    };
                  })
                  .filter((x) => x.cantidad > 0),
              })}
            >
              {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Registrar entrada
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
