"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, Loader2, Printer, RotateCcw, X } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

type Cargo = {
  id: string; folio: string; empresa: string; periodo: string; plan: string;
  importe: number; moneda: string; status: string;
  emitidaEl: string; venceEl: string; pagadaEl: string | null;
  formaPago: string | null; referenciaPago: string | null;
};

const FILTROS = [
  { clave: "TODOS", texto: "Todos" },
  { clave: "PENDING", texto: "Pendientes" },
  { clave: "PAID", texto: "Pagados" },
  { clave: "CANCELLED", texto: "Cancelados" },
];

export function PanelCobranza({
  cargos, periodoActual, filtro,
}: {
  cargos: Cargo[]; periodoActual: string; filtro: string;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pagando, setPagando] = useState<Cargo | null>(null);
  const [pago, setPago] = useState({ formaPago: "Transferencia", referenciaPago: "", nota: "" });
  const [periodo, setPeriodo] = useState(periodoActual);

  async function emitir() {
    setOcupado("emitir"); setError(null); setAviso(null);
    const res = await fetch("/api/billing/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodo }),
    });
    const d = await res.json();
    setOcupado(null);
    if (!res.ok) { setError(d.error ?? "No fue posible emitir"); return; }
    setAviso(
      d.emitidos > 0
        ? `${d.emitidos} cargo(s) emitidos. ${d.omitidos.length} empresa(s) omitidas.`
        : `No habia cargos por emitir. ${d.omitidos.length} empresa(s) omitidas: ${d.omitidos.slice(0, 3).map((o: { empresa: string; motivo: string }) => `${o.empresa} (${o.motivo})`).join("; ")}`,
    );
    router.refresh();
  }

  async function resolver(c: Cargo, accion: "PAGAR" | "CANCELAR" | "REABRIR") {
    setOcupado(c.id); setError(null);
    const res = await fetch(`/api/billing/${c.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        accion === "PAGAR"
          ? { accion, formaPago: pago.formaPago || null, referenciaPago: pago.referenciaPago || null, nota: pago.nota || null }
          : { accion },
      ),
    });
    const d = await res.json();
    setOcupado(null);
    if (!res.ok) { setError(d.error ?? "No fue posible actualizar"); return; }
    setPagando(null);
    setPago({ formaPago: "Transferencia", referenciaPago: "", nota: "" });
    setAviso(accion === "PAGAR" ? `${c.folio} marcado como pagado.` : `${c.folio} actualizado.`);
    setTimeout(() => setAviso(null), 4000);
    router.refresh();
  }

  const hoy = new Date();

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Periodo a emitir</label>
            <input
              type="month" className="field max-w-44"
              value={periodo} onChange={(e) => setPeriodo(e.target.value)}
            />
          </div>
          <Button onClick={emitir} disabled={ocupado !== null}>
            {ocupado === "emitir" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
            Emitir cargos del periodo
          </Button>
          <p className="max-w-md text-xs text-slate-500">
            Se omiten las empresas en plan Free, las canceladas, las que siguen en prueba y las que
            ya tienen cargo del periodo. Volver a emitir no duplica nada.
          </p>
        </div>
        {aviso ? (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{aviso}</p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}
      </Card>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <Link
            key={f.clave}
            href={`/clients/cobranza${f.clave === "TODOS" ? "" : `?estado=${f.clave}`}`}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              filtro === f.clave
                ? "border-brand-300 bg-brand-50 text-brand-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {f.texto}
          </Link>
        ))}
      </div>

      {cargos.length === 0 ? (
        <EmptyState
          title="Sin cargos"
          description="Emita los del periodo con el boton de arriba."
        />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Folio</th><th>Empresa</th><th>Periodo</th><th>Plan</th>
                  <th className="text-right">Importe</th><th>Vence</th><th>Estado</th><th />
                </tr>
              </thead>
              <tbody>
                {cargos.map((c) => {
                  const atrasado = c.status === "PENDING" && new Date(c.venceEl) < hoy;
                  return (
                    <tr key={c.id}>
                      <td className="font-medium text-slate-700">{c.folio}</td>
                      <td className="text-slate-800">{c.empresa}</td>
                      <td className="text-xs text-slate-600">{c.periodo}</td>
                      <td className="text-xs text-slate-500">{c.plan}</td>
                      <td className="text-right tabular-nums text-sm font-medium">
                        {formatCurrency(c.importe, c.moneda)}
                      </td>
                      <td className={`text-xs ${atrasado ? "font-medium text-red-600" : "text-slate-500"}`}>
                        {formatDate(c.venceEl)}
                      </td>
                      <td>
                        <Badge tone={c.status === "PAID" ? "success" : atrasado ? "danger" : c.status === "CANCELLED" ? "muted" : "warning"}>
                          {c.status === "PAID" ? "Pagado" : c.status === "CANCELLED" ? "Cancelado" : atrasado ? "Vencido" : "Pendiente"}
                        </Badge>
                        {c.pagadaEl ? (
                          <p className="mt-0.5 text-[0.625rem] text-slate-400">
                            {formatDate(c.pagadaEl)}{c.formaPago ? ` · ${c.formaPago}` : ""}
                          </p>
                        ) : null}
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Link
                            href={`/billing/${c.id}/print`}
                            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            title="Ver nota de cobro"
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Link>
                          {c.status === "PENDING" ? (
                            <>
                              <button
                                type="button" onClick={() => setPagando(c)} disabled={ocupado === c.id}
                                title="Marcar como pagado"
                                className="grid h-7 w-7 place-items-center rounded-lg text-emerald-600 hover:bg-emerald-50"
                              >
                                {ocupado === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-4 w-4" />}
                              </button>
                              <button
                                type="button" onClick={() => resolver(c, "CANCELAR")} disabled={ocupado === c.id}
                                title="Cancelar cargo"
                                className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button" onClick={() => resolver(c, "REABRIR")} disabled={ocupado === c.id}
                              title="Reabrir como pendiente"
                              className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {pagando ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              Registrar pago de {pagando.folio}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {pagando.empresa} · {formatCurrency(pagando.importe, pagando.moneda)}
            </p>

            <div className="mt-4 grid gap-3">
              <div>
                <label className="label">Forma de pago</label>
                <select className="field" value={pago.formaPago} onChange={(e) => setPago((p) => ({ ...p, formaPago: e.target.value }))}>
                  {["Transferencia", "Deposito", "Efectivo", "Cheque", "Tarjeta", "Otro"].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Referencia</label>
                <input
                  className="field" placeholder="Folio de la transferencia, ultimos digitos…"
                  value={pago.referenciaPago}
                  onChange={(e) => setPago((p) => ({ ...p, referenciaPago: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Nota</label>
                <input
                  className="field" value={pago.nota}
                  onChange={(e) => setPago((p) => ({ ...p, nota: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPagando(null)}>Cancelar</Button>
              <Button variant="success" onClick={() => resolver(pagando, "PAGAR")} disabled={ocupado !== null}>
                {ocupado === pagando.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Marcar como pagado
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
