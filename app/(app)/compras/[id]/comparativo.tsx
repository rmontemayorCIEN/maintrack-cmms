"use client";

import { useZona } from "@/components/zona-empresa";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Loader2, Plus, Trophy } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/utils";
import { SelectorBuscable } from "@/components/selector-buscable";

export type RenglonPedido = {
  id: string; partId: string | null; descripcion: string; cantidad: number; unidad: string;
};

export type Cotizacion = {
  id: string; proveedor: string; proveedorId: string;
  folioProveedor: string | null;
  diasEntrega: number | null; condicionesPago: string | null; garantia: string | null;
  vigenciaHasta: string | null; total: number;
  seleccionada: boolean; motivoSeleccion: string | null; nota: string | null;
  capturadaPor: string | null; createdAt: string;
  renglones: Array<{ requestLineId: string | null; descripcion: string; marca: string | null; cantidad: number; costoUnitario: number; disponible: boolean }>;
};

type Captura = { cantidad: string; costo: string; marca: string; disponible: boolean };

/**
 * Cuadro comparativo.
 *
 * No se guarda: se dibuja con las cotizaciones cada vez. Lo unico que se
 * conserva es cual gano y por que, porque eso es lo que alguien va a querer
 * saber dentro de dos años.
 */
export function Comparativo({
  compraId, estado, renglones, cotizaciones, proveedores, moneda, editable, ordenEmitida,
}: {
  compraId: string;
  estado: string;
  renglones: RenglonPedido[];
  cotizaciones: Cotizacion[];
  proveedores: { id: string; name: string; leadTimeDays: number }[];
  moneda: string;
  editable: boolean;
  ordenEmitida: string | null;
}) {
  const zona = useZona();
  const router = useRouter();
  const [modo, setModo] = useState<"COTIZAR" | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [folioProveedor, setFolio] = useState("");
  const [diasEntrega, setDias] = useState("");
  const [condicionesPago, setPago] = useState("");
  const [garantia, setGarantia] = useState("");
  const [captura, setCaptura] = useState<Record<string, Captura>>({});
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cerrada = ["RECHAZADA", "CANCELADA", "CERRADA"].includes(estado);
  const ganadora = cotizaciones.find((c) => c.seleccionada);
  const masBarata = cotizaciones.length
    ? cotizaciones.reduce((a, b) => (b.total < a.total ? b : a))
    : null;

  function abrirCaptura() {
    const previas: Record<string, Captura> = {};
    for (const r of renglones) previas[r.id] = { cantidad: String(r.cantidad), costo: "", marca: "", disponible: true };
    setCaptura(previas);
    setSupplierId(proveedores[0]?.id ?? "");
    setFolio(""); setDias(""); setPago(""); setGarantia("");
    setError(null); setModo("COTIZAR");
  }

  async function llamar(cuerpo: Record<string, unknown>) {
    setOcupado(true); setError(null);
    const res = await fetch(`/api/compras/${compraId}/cotizaciones`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
    });
    const data = await res.json().catch(() => ({}));
    setOcupado(false);
    if (!res.ok) { setError(data.error ?? "No fue posible completar la operación"); return false; }
    setModo(null); setEligiendo(null); setMotivo("");
    router.refresh();
    return true;
  }

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-800">Cuadro comparativo</p>
          <p className="mt-0.5 text-[0.6875rem] text-slate-500">
            {cotizaciones.length
              ? `${cotizaciones.length} ${cotizaciones.length === 1 ? "cotización" : "cotizaciones"}. No siempre gana la más barata: gana la de mejor relación costo-entrega-calidad, y el porqué queda escrito.`
              : "Capture las cotizaciones de dos o tres proveedores para poder comparar."}
          </p>
        </div>
        {editable && !cerrada && !ordenEmitida ? (
          <Button type="button" size="sm" variant="secondary" onClick={abrirCaptura}>
            <Plus className="h-3.5 w-3.5" /> Capturar cotización
          </Button>
        ) : null}
      </div>

      {error && !modo && !eligiendo ? (
        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
      ) : null}

      {cotizaciones.length ? (
        <div className="table-wrap mt-3">
          <table className="data">
            <thead>
              <tr>
                <th>Concepto</th>
                {cotizaciones.map((c) => (
                  <th key={c.id} className="text-right">
                    <span className="block font-semibold text-slate-800">{c.proveedor}</span>
                    {c.folioProveedor ? <span className="block font-normal text-slate-400">{c.folioProveedor}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renglones.map((r) => (
                <tr key={r.id}>
                  <td className="text-xs text-slate-700">
                    {r.descripcion}
                    <span className="block text-[0.625rem] text-slate-400">{r.cantidad} {r.unidad}</span>
                  </td>
                  {cotizaciones.map((c) => {
                    const l = c.renglones.find((x) => x.requestLineId === r.id);
                    if (!l || !l.disponible) {
                      return <td key={c.id} className="text-right text-[0.6875rem] text-slate-400">no lo surte</td>;
                    }
                    return (
                      <td key={c.id} className="text-right tabular-nums text-xs text-slate-700">
                        {formatCurrency(l.costoUnitario, moneda)}
                        {l.marca ? <span className="block text-[0.625rem] text-slate-400">{l.marca}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}

              <tr className="bg-slate-50/80">
                <td className="text-xs font-semibold text-slate-800">Total</td>
                {cotizaciones.map((c) => (
                  <td key={c.id} className="text-right tabular-nums text-xs font-semibold text-slate-900">
                    {formatCurrency(c.total, moneda)}
                    {masBarata?.id === c.id && cotizaciones.length > 1 ? (
                      <span className="block text-[0.625rem] font-normal text-emerald-700">la más barata</span>
                    ) : null}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-xs text-slate-600">Entrega</td>
                {cotizaciones.map((c) => (
                  <td key={c.id} className="text-right text-xs text-slate-600">
                    {c.diasEntrega != null ? `${c.diasEntrega} días` : "—"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-xs text-slate-600">Pago</td>
                {cotizaciones.map((c) => <td key={c.id} className="text-right text-xs text-slate-600">{c.condicionesPago ?? "—"}</td>)}
              </tr>
              <tr>
                <td className="text-xs text-slate-600">Garantía</td>
                {cotizaciones.map((c) => <td key={c.id} className="text-right text-xs text-slate-600">{c.garantia ?? "—"}</td>)}
              </tr>
              <tr>
                <td className="text-xs text-slate-600">Vigencia</td>
                {cotizaciones.map((c) => (
                  <td key={c.id} className="text-right text-xs text-slate-600">
                    {c.vigenciaHasta ? formatDate(new Date(c.vigenciaHasta), zona) : "—"}
                  </td>
                ))}
              </tr>
              {editable && !cerrada && !ordenEmitida ? (
                <tr>
                  <td />
                  {cotizaciones.map((c) => (
                    <td key={c.id} className="text-right">
                      {c.seleccionada ? (
                        <Badge tone="success"><Trophy className="mr-1 inline h-3 w-3" />Elegida</Badge>
                      ) : (
                        <button type="button" onClick={() => { setEligiendo(c.id); setMotivo(""); setError(null); }}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] font-medium text-slate-700 hover:bg-slate-50">
                          Elegir esta
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {ganadora?.motivoSeleccion ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <strong>Por qué {ganadora.proveedor}:</strong> {ganadora.motivoSeleccion}
        </p>
      ) : null}

      {eligiendo ? (
        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <p className="text-xs font-semibold text-slate-800">
            Elegir a {cotizaciones.find((c) => c.id === eligiendo)?.proveedor}
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-slate-500">
            {masBarata?.id === eligiendo
              ? "Es la más barata: el precio ya explica la decisión."
              : "No es la más barata. Explique por qué se elige — entrega, marca, garantía o disponibilidad."}
          </p>
          {masBarata?.id !== eligiendo ? (
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Única con 12 meses de garantía y surte los dos renglones"
              className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
          ) : null}
          {error ? <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setEligiendo(null)}>Cancelar</Button>
            <Button type="button" size="sm" disabled={ocupado}
              onClick={() => llamar({ accion: "ELEGIR", quoteId: eligiendo, motivo: motivo || null })}>
              {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirmar
            </Button>
          </div>
        </div>
      ) : null}

      {ganadora && estado === "AUTORIZADA" && !ordenEmitida && editable ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2.5">
          <p className="text-xs text-slate-700">
            Listo para emitir la orden a <strong>{ganadora.proveedor}</strong> por {formatCurrency(ganadora.total, moneda)}.
          </p>
          <Button type="button" size="sm" disabled={ocupado} onClick={() => llamar({ accion: "EMITIR" })}>
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Emitir orden de compra
          </Button>
        </div>
      ) : null}

      {modo === "COTIZAR" ? (
        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <p className="text-xs font-semibold text-slate-800">Cotización de un proveedor</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div>
              <label className="text-[0.625rem] font-medium text-slate-600">Proveedor</label>
              <SelectorBuscable
                className="mt-0.5"
                valor={supplierId}
                onCambio={setSupplierId}
                vacio={null}
                marcador="Busque por nombre del proveedor"
                opciones={proveedores.map((p) => ({ id: p.id, etiqueta: p.name }))}
              />
            </div>
            <div>
              <label className="text-[0.625rem] font-medium text-slate-600">Folio del proveedor</label>
              <input value={folioProveedor} onChange={(e) => setFolio(e.target.value)} placeholder="COT-8841"
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
            </div>
            <div>
              <label className="text-[0.625rem] font-medium text-slate-600">Días de entrega</label>
              <input type="number" inputMode="decimal" min="0" value={diasEntrega} onChange={(e) => setDias(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs tabular-nums" />
            </div>
            <div>
              <label className="text-[0.625rem] font-medium text-slate-600">Condiciones de pago</label>
              <input value={condicionesPago} onChange={(e) => setPago(e.target.value)} placeholder="Contado, 30 días…"
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[0.625rem] font-medium text-slate-600">Garantía</label>
              <input value={garantia} onChange={(e) => setGarantia(e.target.value)} placeholder="6 meses, 1 año…"
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
            </div>
          </div>

          <div className="mt-3 grid gap-1.5">
            {renglones.map((r) => {
              const v = captura[r.id] ?? { cantidad: String(r.cantidad), costo: "", marca: "", disponible: true };
              const set = (c: Partial<Captura>) => setCaptura((p) => ({ ...p, [r.id]: { ...v, ...c } }));
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
                  <span className="min-w-40 flex-1 text-xs text-slate-700">{r.descripcion}</span>
                  <label className="flex items-center gap-1.5 text-[0.625rem] text-slate-600">
                    <input type="checkbox" checked={v.disponible} onChange={(e) => set({ disponible: e.target.checked })}
                      className="h-3.5 w-3.5 rounded border-slate-300" />
                    Lo surte
                  </label>
                  <input value={v.marca} onChange={(e) => set({ marca: e.target.value })} disabled={!v.disponible}
                    placeholder="marca" className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-50" />
                  <input type="number" inputMode="decimal" min="0" step="any" value={v.cantidad} onChange={(e) => set({ cantidad: e.target.value })}
                    disabled={!v.disponible} className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-xs tabular-nums disabled:bg-slate-50" />
                  <input type="number" inputMode="decimal" min="0" step="any" value={v.costo} onChange={(e) => set({ costo: e.target.value })}
                    disabled={!v.disponible} placeholder="costo"
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs tabular-nums disabled:bg-slate-50" />
                </div>
              );
            })}
          </div>

          {error ? <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}

          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setModo(null)}>Cancelar</Button>
            <Button type="button" size="sm" disabled={ocupado || !supplierId}
              onClick={() => llamar({
                accion: "COTIZAR", supplierId,
                folioProveedor: folioProveedor || null,
                diasEntrega: diasEntrega ? Number(diasEntrega) : null,
                condicionesPago: condicionesPago || null,
                garantia: garantia || null,
                renglones: renglones.map((r) => {
                  const v = captura[r.id];
                  return {
                    requestLineId: r.id, partId: r.partId,
                    descripcion: r.descripcion,
                    marca: v?.marca || null,
                    cantidad: Number(v?.cantidad) || 0,
                    costoUnitario: Number(v?.costo) || 0,
                    disponible: v?.disponible ?? true,
                  };
                }),
              })}>
              {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar cotización
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
