"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackageCheck, Undo2, X } from "lucide-react";
import { Button, Card } from "@/components/ui";

export type RenglonVale = {
  id: string; descripcion: string; unidad: string;
  solicitada: number; surtida: number; devuelta: number;
  /** Existencia en el almacen de la requisicion. Null si no esta en catalogo. */
  disponible: number | null;
};

export function AccionesRequisicion({
  requestId, estado, renglones, puedeSurtir, solicitante,
}: {
  requestId: string;
  estado: string;
  renglones: RenglonVale[];
  puedeSurtir: boolean;
  solicitante: string;
}) {
  const router = useRouter();
  const [modo, setModo] = useState<"SURTIR" | "DEVOLVER" | null>(null);
  const [entregadoA, setEntregadoA] = useState(solicitante);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cerrada = estado === "CERRADA" || estado === "CANCELADA";
  const porSurtir = renglones.filter((r) => r.solicitada - r.surtida > 0.0001);
  const enPoder = renglones.filter((r) => r.surtida - r.devuelta > 0.0001);

  function abrir(m: "SURTIR" | "DEVOLVER") {
    // Se propone surtir lo que falta: es lo que el almacenista hace nueve de
    // cada diez veces, y teclear la misma cifra que ya esta en pantalla es
    // trabajo que el sistema puede ahorrarse.
    const lista = m === "SURTIR" ? porSurtir : enPoder;
    const previas: Record<string, string> = {};
    for (const r of lista) {
      const falta = m === "SURTIR" ? r.solicitada - r.surtida : r.surtida - r.devuelta;
      const tope = m === "SURTIR" && r.disponible !== null ? Math.min(falta, r.disponible) : falta;
      previas[r.id] = String(Math.max(0, tope));
    }
    setCantidades(previas);
    setError(null);
    setModo(m);
  }

  async function enviar(accion: "SURTIR" | "DEVOLVER" | "CERRAR" | "CANCELAR") {
    setOcupado(true); setError(null);
    const cuerpo: Record<string, unknown> = { accion };
    if (accion === "SURTIR" || accion === "DEVOLVER") {
      const lista = Object.entries(cantidades)
        .map(([lineId, v]) => ({ lineId, cantidad: Number(v) || 0 }))
        .filter((x) => x.cantidad > 0);
      if (!lista.length) { setOcupado(false); setError("No hay cantidades que registrar"); return; }
      cuerpo.renglones = lista;
      if (accion === "SURTIR") cuerpo.entregadoA = entregadoA;
      else cuerpo.devuelvePor = entregadoA;
    }

    const res = await fetch(`/api/requisiciones/${requestId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
    });
    const data = await res.json().catch(() => ({}));
    setOcupado(false);
    if (!res.ok) { setError(data.error ?? "No fue posible completar la operacion"); return; }
    setModo(null);
    router.refresh();
  }

  if (!puedeSurtir) {
    return (
      <p className="text-xs text-slate-500">
        Surtir y recibir devoluciones requiere permiso de almacén. Quien pide no es quien entrega.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {!cerrada && porSurtir.length ? (
          <Button type="button" onClick={() => abrir("SURTIR")}>
            <PackageCheck className="h-3.5 w-3.5" /> Surtir
          </Button>
        ) : null}
        {estado !== "CANCELADA" && enPoder.length ? (
          <Button type="button" variant="secondary" onClick={() => abrir("DEVOLVER")}>
            <Undo2 className="h-3.5 w-3.5" /> Registrar devolución
          </Button>
        ) : null}
        {!cerrada ? (
          <Button type="button" variant="secondary" onClick={() => enviar("CERRAR")} disabled={ocupado}>
            Cerrar requisición
          </Button>
        ) : null}
        {estado === "SOLICITADA" ? (
          <Button type="button" variant="ghost" onClick={() => enviar("CANCELAR")} disabled={ocupado}>
            <X className="h-3.5 w-3.5" /> Cancelar
          </Button>
        ) : null}
      </div>

      {error && !modo ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
      ) : null}

      {modo ? (
        <Card>
          <p className="text-xs font-semibold text-slate-800">
            {modo === "SURTIR" ? "Salida de almacén" : "Devolución al almacén"}
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-slate-500">
            {modo === "SURTIR"
              ? "Se descuenta del almacén y queda ligado a la orden de trabajo."
              : "Lo que se pidió y no se usó regresa al inventario."}
          </p>

          <div className="mt-3 grid gap-1.5">
            {(modo === "SURTIR" ? porSurtir : enPoder).map((r) => {
              const falta = modo === "SURTIR" ? r.solicitada - r.surtida : r.surtida - r.devuelta;
              const sinExistencia = modo === "SURTIR" && r.disponible !== null && r.disponible <= 0;
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-2">
                  <div className="min-w-48 flex-1">
                    <p className="text-xs font-medium text-slate-800">{r.descripcion}</p>
                    <p className="text-[0.625rem] text-slate-500">
                      {modo === "SURTIR" ? `faltan ${falta} ${r.unidad}` : `tiene ${falta} ${r.unidad}`}
                      {modo === "SURTIR" && r.disponible !== null ? ` · hay ${r.disponible} en almacén` : ""}
                      {r.disponible === null ? " · no está en el catálogo" : ""}
                    </p>
                  </div>
                  <input
                    type="number" min="0" step="any"
                    value={cantidades[r.id] ?? ""}
                    onChange={(e) => setCantidades((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    disabled={sinExistencia || r.disponible === null}
                    className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-xs tabular-nums disabled:bg-slate-50"
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-3">
            <label className="text-[0.6875rem] font-medium text-slate-600">
              {modo === "SURTIR" ? "Se entrega a" : "Quien devuelve"}
            </label>
            <input
              value={entregadoA}
              onChange={(e) => setEntregadoA(e.target.value)}
              placeholder="Nombre de quien recibe"
              className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs sm:max-w-xs"
            />
            <p className="mt-0.5 text-[0.625rem] text-slate-400">
              Queda en el vale. Puede no ser quien pidió: a veces pasa un ayudante.
            </p>
          </div>

          {error ? (
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
          ) : null}

          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModo(null)}>Cancelar</Button>
            <Button type="button" onClick={() => enviar(modo)} disabled={ocupado}>
              {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {modo === "SURTIR" ? "Registrar salida" : "Registrar devolución"}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
