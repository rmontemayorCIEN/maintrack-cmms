"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { URGENCIAS_PLAN, ORIGENES_DEMANDA } from "@/lib/planificador-tipos";
import type { Sugerencia } from "@/lib/planificador-compras";
import { CompraDialog } from "../compra-dialog";

/**
 * Lo que hay que comprar, para revisar y mandar a requisicion.
 *
 * Nace con TODO seleccionado menos lo que solo hay que vigilar: quien abre
 * esta pantalla viene a pedir, no a marcar casillas una por una. Lo que no
 * urge se deja fuera a proposito, para que meterlo sea una decision.
 */
export function TablaPlan({
  sugerencias, moneda, dias, diasDeHistoria, almacenes, refacciones, proveedores, puedePedir,
}: {
  sugerencias: Sugerencia[];
  moneda: string;
  dias: number;
  diasDeHistoria: number;
  almacenes: { id: string; name: string }[];
  refacciones: { id: string; code: string; name: string; unit: string; costo: number }[];
  proveedores: { id: string; name: string }[];
  puedePedir: boolean;
}) {
  const [elegidos, setElegidos] = useState<Set<string>>(
    () => new Set(sugerencias.filter((s) => s.urgencia !== "VIGILAR").map((s) => s.partId)),
  );
  const [abierto, setAbierto] = useState<string | null>(null);

  const seleccion = useMemo(
    () => sugerencias.filter((s) => elegidos.has(s.partId)),
    [sugerencias, elegidos],
  );
  const costo = seleccion.reduce((t, s) => t + s.costoSugerido, 0);

  function alternar(partId: string) {
    setElegidos((previo) => {
      const copia = new Set(previo);
      if (copia.has(partId)) copia.delete(partId); else copia.add(partId);
      return copia;
    });
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600" role="status">
          {seleccion.length} de {sugerencias.length} seleccionadas ·{" "}
          <strong className="tabular-nums text-slate-800">{formatCurrency(costo, moneda)}</strong>
        </p>
        {puedePedir && almacenes.length && seleccion.length ? (
          <CompraDialog
            /*
             * La `key` remonta el dialogo cuando cambia la seleccion: los
             * renglones precargados se leen una sola vez, al montarlo, asi que
             * sin esto el comprador cambiaria las casillas y el dialogo se
             * abriria con lo que habia al cargar la pagina.
             */
            key={[...elegidos].sort().join(",")}
            moneda={moneda}
            almacenes={almacenes}
            refacciones={refacciones}
            proveedores={proveedores}
            etiqueta={`Pedir lo seleccionado (${seleccion.length})`}
            precargados={seleccion.map((s) => ({
              partId: s.partId,
              descripcion: `${s.code} ${s.name}`,
              cantidad: s.sugerido,
            }))}
          />
        ) : null}
      </div>

      <Card padded={false}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="w-8" />
                <th>Refacción</th>
                <th>Cuándo</th>
                <th className="text-right">Hay</th>
                <th className="text-right">Mínimo</th>
                <th className="text-right">Viene</th>
                <th className="text-right">Va a hacer falta</th>
                <th className="text-right">Pedir</th>
                <th className="text-right">Costo</th>
                <th>Proveedor</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {sugerencias.map((s) => {
                const u = URGENCIAS_PLAN[s.urgencia];
                const abierta = abierto === s.partId;
                return (
                  <Fragment key={s.partId}>
                    <tr>
                      <td>
                        <input
                          type="checkbox"
                          id={`pedir-${s.partId}`}
                          checked={elegidos.has(s.partId)}
                          onChange={() => alternar(s.partId)}
                          aria-label={`Incluir ${s.code} en la requisición`}
                          className="h-4 w-4"
                        />
                      </td>
                      <td>
                        <p className="font-medium text-slate-800">{s.name}</p>
                        <p className="text-[0.625rem] text-slate-500">{s.code}</p>
                      </td>
                      <td>
                        <Badge tone={u.tono}>{u.etiqueta}</Badge>
                        {s.diasParaQuiebre !== null ? (
                          <p className="mt-0.5 text-[0.625rem] text-slate-500">
                            se acaba en {s.diasParaQuiebre} d · tarda {s.diasEntrega} d
                          </p>
                        ) : null}
                      </td>
                      <td className="text-right tabular-nums text-xs text-slate-700">
                        {formatNumber(s.existencia, 2)} {s.unit}
                      </td>
                      <td className="text-right tabular-nums text-xs text-slate-500">{formatNumber(s.minimo, 2)}</td>
                      <td className="text-right tabular-nums text-xs">
                        {s.enCamino > 0 ? (
                          <span className="text-brand-700">{formatNumber(s.enCamino, 2)}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="text-right tabular-nums text-xs text-slate-700">
                        {/*
                          Con demanda cero decia «0» al lado de «pedir 3», que
                          se lee como una contradiccion. No hay demanda que
                          mostrar: lo que manda es el minimo, y eso se dice.
                        */}
                        {s.origen === "MINIMO" ? (
                          <span className="text-slate-400">reponer mínimo</span>
                        ) : (
                          <>
                            {formatNumber(s.demanda, 2)}
                            <span className="ml-1 text-[0.625rem] text-slate-400">
                              {s.origen === "PLAN" ? "plan" : "uso"}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="text-right tabular-nums text-xs font-semibold text-slate-800">
                        {formatNumber(s.sugerido, 2)}
                      </td>
                      <td className="text-right tabular-nums text-xs text-slate-700">
                        {formatCurrency(s.costoSugerido, moneda)}
                      </td>
                      <td className="text-xs text-slate-600">{s.proveedor ?? <span className="text-slate-300">—</span>}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setAbierto(abierta ? null : s.partId)}
                          aria-expanded={abierta}
                          aria-label={`Por qué se propone ${s.code}`}
                          className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                        >
                          <ChevronDown className={`h-4 w-4 transition-transform ${abierta ? "rotate-180" : ""}`} />
                        </button>
                      </td>
                    </tr>
                    {abierta ? (
                      <tr>
                        <td />
                        <td colSpan={10} className="bg-slate-50 text-xs text-slate-700">
                          <p>{s.porQue}</p>
                          <p className="mt-1 text-slate-500">
                            La cantidad sale de {ORIGENES_DEMANDA[s.origen]}
                            {s.maximo > 0 ? `, reponiendo hasta el máximo de ${formatNumber(s.maximo, 2)}` : ""}.{" "}
                            {u.explica}
                          </p>
                          {s.equipos.length ? (
                            <p className="mt-1 text-slate-500">La piden: {s.equipos.join(", ")}</p>
                          ) : null}
                          {s.folios.length ? (
                            <p className="mt-1 text-slate-500">Ya viene en: {s.folios.join(", ")}</p>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/*
        La advertencia va DEBAJO de la tabla y en pantalla, no en la ayuda: es
        la diferencia entre una propuesta y un pronostico, y quien firma la
        compra tiene que leerla sin ir a buscarla.
      */}
      <p className="mt-3 text-xs text-slate-500">
        Esto es una propuesta, no un pronóstico. Lo que piden los preventivos sí tiene fecha;
        lo correctivo no se puede anticipar, así que se estima con lo que salió del almacén en
        los últimos {diasDeHistoria} días. De las dos se toma la mayor, nunca la suma, porque
        el consumo real ya incluye los preventivos que se hicieron. El horizonte es de {dias} días.
      </p>
    </>
  );
}
