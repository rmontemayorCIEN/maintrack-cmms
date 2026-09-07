"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Save, X } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { formatNumber } from "@/lib/utils";

export type RenglonConteo = {
  id: string; codigo: string; nombre: string; unidad: string; ubicacion: string | null;
  cantidadSistema: number; cantidadContada: number | null; cantidadAlCerrar: number | null; nota: string | null;
};

/**
 * Captura del conteo.
 *
 * La existencia del sistema NO se muestra mientras se cuenta, y esa es la
 * decision de fondo: si el almacenista ve el numero esperado, lo escribe. Un
 * conteo a ciegas es el unico que sirve para medir exactitud. La diferencia se
 * revela en cuanto se guarda.
 */
export function CapturaConteo({
  countId, estado, renglones, editable,
}: {
  countId: string;
  estado: string;
  renglones: RenglonConteo[];
  editable: boolean;
}) {
  const router = useRouter();
  const [valores, setValores] = useState<Record<string, string>>(
    Object.fromEntries(renglones.map((r) => [r.id, r.cantidadContada === null ? "" : String(r.cantidadContada)])),
  );
  const [aCiegas, setACiegas] = useState(estado === "ABIERTO");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  const abierto = estado === "ABIERTO";
  const capturados = useMemo(
    () => renglones.filter((r) => (valores[r.id] ?? "").trim() !== "").length,
    [renglones, valores],
  );

  async function llamar(cuerpo: Record<string, unknown>, exito?: (d: Record<string, number>) => string) {
    setOcupado(true); setError(null); setResultado(null);
    const res = await fetch(`/api/conteos/${countId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
    });
    const data = await res.json().catch(() => ({}));
    setOcupado(false);
    if (!res.ok) { setError(data.error ?? "No fue posible completar la operación"); return; }
    if (exito) setResultado(exito(data));
    router.refresh();
  }

  const guardar = () =>
    llamar({
      accion: "CAPTURAR",
      renglones: renglones.map((r) => ({
        lineId: r.id,
        cantidadContada: (valores[r.id] ?? "").trim() === "" ? null : Number(valores[r.id]),
      })),
    }, () => "Conteo guardado");

  const cerrar = () => {
    if (!confirm(`Cerrar el conteo?\n\nSe van a aplicar ajustes al inventario por cada diferencia. Esto queda en el kardex y no se deshace.`)) return;
    llamar({ accion: "CERRAR" }, (d) =>
      `Cerrado: ${d.contados} contados, ${d.ajustados} ajustados${d.movidosDuranteElConteo ? `, ${d.movidosDuranteElConteo} se movieron durante el conteo` : ""}`);
  };

  return (
    <div className="grid gap-3">
      {abierto && editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => setACiegas((v) => !v)}>
            {aCiegas ? <Lock className="h-3.5 w-3.5" /> : null}
            {aCiegas ? "Contando a ciegas" : "Mostrando el sistema"}
          </Button>
          <span className="text-[0.6875rem] text-slate-500">
            {aCiegas
              ? "No se ve lo que el sistema cree que hay. Es la única forma de medir exactitud."
              : "Se ve la existencia del sistema. Útil para revisar, no para contar."}
          </span>
          <span className="ml-auto text-xs text-slate-600">{capturados} de {renglones.length} capturados</span>
        </div>
      ) : null}

      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}
      {resultado ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{resultado}</p> : null}

      <Card padded={false}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Refacción</th>
                <th>Ubicación</th>
                {!aCiegas || !abierto ? <th className="text-right">Sistema</th> : null}
                <th className="text-right w-32">Contado</th>
                {!abierto ? <th className="text-right">Diferencia</th> : null}
              </tr>
            </thead>
            <tbody>
              {renglones.map((r) => {
                const referencia = r.cantidadAlCerrar ?? r.cantidadSistema;
                const dif = r.cantidadContada === null ? null : r.cantidadContada - referencia;
                return (
                  <tr key={r.id}>
                    <td>
                      <p className="font-medium text-slate-800">{r.codigo}</p>
                      <p className="text-xs text-slate-500">{r.nombre}</p>
                    </td>
                    <td className="text-xs text-slate-500">{r.ubicacion ?? "—"}</td>
                    {!aCiegas || !abierto ? (
                      <td className="text-right tabular-nums text-xs text-slate-600">
                        {formatNumber(referencia, 2)}
                        {r.cantidadAlCerrar !== null && Math.abs(r.cantidadAlCerrar - r.cantidadSistema) > 0.0001 ? (
                          <span className="block text-[0.625rem] text-amber-700">se movió durante el conteo</span>
                        ) : null}
                      </td>
                    ) : null}
                    <td className="text-right">
                      {abierto && editable ? (
                        <input
                          type="number" min="0" step="any"
                          value={valores[r.id] ?? ""}
                          onChange={(e) => setValores((p) => ({ ...p, [r.id]: e.target.value }))}
                          placeholder={r.unidad}
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs tabular-nums"
                        />
                      ) : (
                        <span className="tabular-nums text-xs text-slate-800">
                          {r.cantidadContada === null ? <span className="text-slate-300">sin contar</span> : formatNumber(r.cantidadContada, 2)}
                        </span>
                      )}
                    </td>
                    {!abierto ? (
                      <td className="text-right">
                        {dif === null ? <span className="text-slate-300">—</span>
                          : Math.abs(dif) < 0.0001 ? <Badge tone="success">cuadra</Badge>
                          : <span className={`tabular-nums text-xs font-medium ${dif > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                              {dif > 0 ? "+" : ""}{formatNumber(dif, 2)}
                            </span>}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {abierto && editable ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => llamar({ accion: "CANCELAR" })} disabled={ocupado}>
            <X className="h-3.5 w-3.5" /> Cancelar conteo
          </Button>
          <Button type="button" variant="secondary" onClick={guardar} disabled={ocupado}>
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Guardar avance
          </Button>
          <Button type="button" onClick={cerrar} disabled={ocupado || capturados === 0}>
            Cerrar y ajustar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
