"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Link2, Plus, X } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { SelectorBuscable, type OpcionBuscable } from "@/components/selector-buscable";
import {
  ETIQUETA_ESTADO_OBLIGACION, TONO_ESTADO_OBLIGACION,
  definicionDeObligacion, type EstadoObligacion, type PiezaDeCumplimiento,
} from "@/lib/normas-tipos";

export type AmarreEnPantalla = {
  id: string;
  pieza: string;
  etiqueta: string;
  href: string | null;
  estado: EstadoObligacion;
  porque: string;
};

export type ObligacionEnPantalla = {
  id: string;
  titulo: string;
  detalle: string | null;
  tipo: string;
  cadaDias: number | null;
  evidencia: string | null;
  aplica: boolean;
  razonNoAplica: string | null;
  estado: EstadoObligacion;
  amarres: AmarreEnPantalla[];
};

export type OpcionesPorPieza = Partial<Record<PiezaDeCumplimiento, OpcionBuscable[]>>;

const ETIQUETA_PIEZA: Record<string, string> = {
  plan: "Plan", vigencia: "Documento", tabla: "Registro propio", rondin: "Rondín", orden: "Orden de trabajo",
};

/**
 * Una obligación con lo que la respalda.
 *
 * El botón dice «con qué se cumple» y no «agregar»: lo que se está declarando
 * es que ESA pieza del sistema es la que responde a esta obligación. La
 * diferencia importa cuando alguien revisa el expediente meses después.
 */
export function Obligacion({
  normaId,
  obligacion,
  opciones,
  editable,
}: {
  normaId: string;
  obligacion: ObligacionEnPantalla;
  opciones: OpcionesPorPieza;
  editable: boolean;
}) {
  const router = useRouter();
  const def = definicionDeObligacion(obligacion.tipo);
  const [abierto, setAbierto] = useState(false);
  const [pieza, setPieza] = useState<PiezaDeCumplimiento>(def.pieza as PiezaDeCumplimiento);
  const [piezaId, setPiezaId] = useState("");
  const [razon, setRazon] = useState(obligacion.razonNoAplica ?? "");
  const [pidiendoRazon, setPidiendoRazon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function llamar(url: string, init: RequestInit) {
    setOcupado(true);
    setError(null);
    const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    setOcupado(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? "No se pudo.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function amarrar() {
    if (!piezaId) { setError("Elija con qué se cumple."); return; }
    if (await llamar(`/api/normas/${normaId}/amarres`, {
      method: "POST",
      body: JSON.stringify({ obligacionId: obligacion.id, pieza, piezaId }),
    })) { setAbierto(false); setPiezaId(""); }
  }

  const quitar = (amarreId: string) =>
    llamar(`/api/normas/${normaId}/amarres/${amarreId}`, { method: "DELETE" });

  async function noAplica() {
    if (!razon.trim()) { setError("Escriba por qué no aplica: eso también es evidencia."); return; }
    if (await llamar(`/api/normas/${normaId}/obligaciones/${obligacion.id}`, {
      method: "PATCH", body: JSON.stringify({ aplica: false, razon }),
    })) setPidiendoRazon(false);
  }

  const volverAConsiderar = () =>
    llamar(`/api/normas/${normaId}/obligaciones/${obligacion.id}`, {
      method: "PATCH", body: JSON.stringify({ aplica: true }),
    });

  return (
    <div className="border-b border-slate-100 py-4 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800">{obligacion.titulo}</p>
          {obligacion.detalle ? <p className="mt-0.5 text-xs text-slate-600">{obligacion.detalle}</p> : null}
          <p className="mt-1 text-[0.6875rem] text-slate-400">
            {def.nombre}
            {obligacion.cadaDias ? ` · cada ${obligacion.cadaDias} días` : ""}
            {` · se cumple con ${def.seCumpleCon}`}
          </p>
          {obligacion.evidencia ? (
            <p className="mt-1 text-[0.6875rem] text-slate-500">Evidencia: {obligacion.evidencia}</p>
          ) : null}
        </div>
        <Badge tone={TONO_ESTADO_OBLIGACION[obligacion.estado]}>{ETIQUETA_ESTADO_OBLIGACION[obligacion.estado]}</Badge>
      </div>

      {!obligacion.aplica ? (
        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-600">
            <span className="font-medium">No aplica:</span> {obligacion.razonNoAplica}
          </p>
          {editable ? (
            <button type="button" onClick={volverAConsiderar} disabled={ocupado} className="mt-1 text-[0.6875rem] text-slate-500 underline">
              Volver a considerarla
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {obligacion.amarres.length ? (
            <ul className="mt-2 space-y-1">
              {obligacion.amarres.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                  <Link2 className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                  <span className="text-slate-500">{ETIQUETA_PIEZA[a.pieza] ?? a.pieza}:</span>
                  {a.href ? (
                    <Link href={a.href} className="font-medium text-slate-700 hover:underline">{a.etiqueta}</Link>
                  ) : <span className="font-medium text-slate-700">{a.etiqueta}</span>}
                  <span className="text-slate-400">· {a.porque}</span>
                  {editable ? (
                    <button type="button" onClick={() => quitar(a.id)} disabled={ocupado}
                      className="ml-auto rounded p-0.5 text-slate-400 hover:text-rose-600" aria-label="Quitar respaldo">
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              Nada la respalda todavía. Mientras no haya con qué, el sistema no opina sobre ella.
            </p>
          )}

          {editable ? (
            abierto ? (
              <div className="mt-3 rounded-lg border border-slate-200 p-3">
                <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto]">
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={pieza}
                    onChange={(e) => { setPieza(e.target.value as PiezaDeCumplimiento); setPiezaId(""); }}
                  >
                    {(Object.keys(ETIQUETA_PIEZA) as PiezaDeCumplimiento[]).map((p) => (
                      <option key={p} value={p}>{ETIQUETA_PIEZA[p]}</option>
                    ))}
                  </select>
                  <SelectorBuscable
                    valor={piezaId}
                    onCambio={setPiezaId}
                    opciones={opciones[pieza] ?? []}
                    vacio="Elija cuál"
                  />
                  <Button size="sm" onClick={amarrar} disabled={ocupado}>Amarrar</Button>
                </div>
                {!(opciones[pieza] ?? []).length ? (
                  <p className="mt-2 text-[0.6875rem] text-slate-500">
                    No hay {ETIQUETA_PIEZA[pieza].toLowerCase()} que ofrecer todavía. Créelo en su módulo y vuelva.
                  </p>
                ) : null}
                <button type="button" onClick={() => setAbierto(false)} className="mt-2 text-[0.6875rem] text-slate-500 underline">
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-3">
                <button type="button" onClick={() => setAbierto(true)} className="inline-flex items-center gap-1 text-xs text-slate-600 underline">
                  <Plus className="h-3 w-3" aria-hidden /> Decir con qué se cumple
                </button>
                {pidiendoRazon ? null : (
                  <button type="button" onClick={() => setPidiendoRazon(true)} className="text-xs text-slate-500 underline">
                    No nos aplica
                  </button>
                )}
              </div>
            )
          ) : null}

          {pidiendoRazon && editable ? (
            <div className="mt-2 rounded-lg border border-slate-200 p-3">
              <label className="block text-xs font-medium text-slate-600" htmlFor={`razon-${obligacion.id}`}>
                ¿Por qué no aplica?
              </label>
              <input
                id={`razon-${obligacion.id}`}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={razon} onChange={(e) => setRazon(e.target.value)}
                placeholder="La planta no tiene recipientes sujetos a presión."
              />
              <p className="mt-1 text-[0.6875rem] text-slate-500">
                En una inspección preguntan por qué NO tiene algo. Esto queda escrito y fechado.
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={noAplica} disabled={ocupado}>Guardar</Button>
                <Button size="sm" variant="secondary" onClick={() => setPidiendoRazon(false)}>Cancelar</Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
