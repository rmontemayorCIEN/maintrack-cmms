"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { MESES, type RenglonPresupuesto } from "@/lib/presupuestos";

/**
 * El comparativo, y la captura en el mismo lugar.
 *
 * Se captura donde se compara a proposito: quien ajusta un presupuesto lo hace
 * mirando lo que se lleva gastado, no en una pantalla aparte. Cada celda se
 * guarda al salir de ella, sin boton de guardar y sin formulario que se pueda
 * abandonar a medias.
 */
export function TablaPresupuesto({
  renglones, anio, mes, moneda, puedeCapturar,
}: {
  renglones: RenglonPresupuesto[];
  anio: number;
  /** Null cuando se esta viendo el año completo: ahi no se captura. */
  mes: number | null;
  moneda: string;
  puedeCapturar: boolean;
}) {
  const router = useRouter();
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function guardar(centroDeCostoId: string, valor: string, previo: number | null) {
    const texto = valor.trim();
    // Vaciar la celda QUITA el presupuesto; escribir 0 lo deja en cero. Son
    // cosas distintas y la pantalla las trata distinto.
    const monto = texto === "" ? null : Number(texto.replace(/[^\d.-]/g, ""));
    if (monto !== null && (!Number.isFinite(monto) || monto < 0)) {
      setError("El monto no puede ser negativo ni texto");
      return;
    }
    if (monto === previo || (monto === null && previo === null)) return;
    if (mes === null) return;

    setGuardando(centroDeCostoId); setError(null);
    const r = monto === null
      ? await fetch(`/api/presupuestos?centroDeCostoId=${encodeURIComponent(centroDeCostoId)}&anio=${anio}&mes=${mes}`, { method: "DELETE" })
      : await fetch("/api/presupuestos", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ centroDeCostoId, anio, mes, monto }),
        });
    setGuardando(null);
    if (!r.ok) {
      const datos = await r.json().catch(() => null);
      setError(datos?.error ?? "No fue posible guardar el presupuesto");
      return;
    }
    router.refresh();
  }

  const tono = (r: RenglonPresupuesto) => {
    if (r.ejercido === null) return null;
    if (r.ejercido > 100) return "danger" as const;
    if (r.ejercido >= 90) return "warning" as const;
    return "success" as const;
  };

  return (
    <>
      {error ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="alert">{error}</p>
      ) : null}

      <Card padded={false}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Centro de costo</th>
                <th className="text-right">Presupuesto</th>
                <th className="text-right">Gastado</th>
                <th className="text-right">Diferencia</th>
                <th className="text-right">Ejercido</th>
                <th className="text-right">Órdenes</th>
                <th>En qué se fue</th>
              </tr>
            </thead>
            <tbody>
              {renglones.map((r) => (
                <tr key={r.centroDeCostoId}>
                  <td>
                    <p className="font-medium text-slate-800">{r.name}</p>
                    <p className="text-[0.625rem] text-slate-500">{r.code}</p>
                  </td>
                  <td className="text-right">
                    {puedeCapturar && mes !== null ? (
                      <div className="flex items-center justify-end gap-1">
                        {guardando === r.centroDeCostoId ? <Loader2 className="h-3 w-3 animate-spin text-slate-400" /> : null}
                        <input
                          type="text"
                          inputMode="decimal"
                          defaultValue={r.presupuesto === null ? "" : String(r.presupuesto)}
                          onBlur={(e) => guardar(r.centroDeCostoId, e.target.value, r.presupuesto)}
                          placeholder="Sin presupuestar"
                          aria-label={`Presupuesto de ${r.name} en ${MESES[mes - 1]}`}
                          className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs tabular-nums"
                        />
                      </div>
                    ) : r.presupuesto === null ? (
                      <span className="text-xs text-slate-400">Sin presupuestar</span>
                    ) : (
                      <span className="text-xs tabular-nums text-slate-700">{formatCurrency(r.presupuesto, moneda)}</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums text-xs text-slate-800">{formatCurrency(r.gastado, moneda)}</td>
                  <td className="text-right tabular-nums text-xs">
                    {r.diferencia === null ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <span className={r.diferencia < 0 ? "font-medium text-red-700" : "text-slate-700"}>
                        {formatCurrency(r.diferencia, moneda)}
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    {r.ejercido === null ? (
                      <span className="text-xs text-slate-300">—</span>
                    ) : (
                      <Badge tone={tono(r)!}>{formatNumber(r.ejercido, 0)}%</Badge>
                    )}
                  </td>
                  <td className="text-right tabular-nums text-xs text-slate-600">{r.ordenes}</td>
                  <td className="text-[0.6875rem] text-slate-500">
                    {r.gastado > 0 ? (
                      <>
                        Mano de obra {formatCurrency(r.manoDeObra, moneda)} · Refacciones {formatCurrency(r.refacciones, moneda)}
                        {r.servicios > 0 ? ` · Servicios ${formatCurrency(r.servicios, moneda)}` : ""}
                        {r.otros > 0 ? ` · Otros ${formatCurrency(r.otros, moneda)}` : ""}
                      </>
                    ) : (
                      <span className="text-slate-300">Sin gasto en el periodo</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {puedeCapturar && mes !== null ? (
        <p className="mt-2 text-xs text-slate-500">
          Escriba el monto y salga de la casilla: se guarda solo. Dejarla vacía quita el presupuesto,
          que no es lo mismo que poner cero — cero significa «este centro no gasta este mes».
        </p>
      ) : null}
    </>
  );
}
