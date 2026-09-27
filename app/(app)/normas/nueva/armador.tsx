"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card } from "@/components/ui";
import {
  ORDEN_TIPOS_OBLIGACION, ORIGENES_NORMA, TIPOS_OBLIGACION, definicionDeObligacion, type TipoObligacion,
} from "@/lib/normas-tipos";

/**
 * Dar de alta una norma que no está en el catálogo.
 *
 * El caso que esto desbloquea y que nunca va a estar en nuestro catálogo: los
 * requisitos corporativos y los de cliente. Una maquila con matriz afuera
 * tiene su estándar interno, y una planta automotriz tiene requisitos de su
 * armadora que se auditan igual de duro que una NOM.
 */

type ObligacionEnEdicion = {
  titulo: string;
  detalle: string;
  tipo: TipoObligacion;
  cadaDias: string;
  evidencia: string;
};

const vacia = (): ObligacionEnEdicion => ({ titulo: "", detalle: "", tipo: "ACTIVIDAD", cadaDias: "", evidencia: "" });

const entrada = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none";
const etiqueta = "block text-xs font-medium text-slate-600";

export function ArmadorDeNorma() {
  const router = useRouter();
  const [clave, setClave] = useState("");
  const [titulo, setTitulo] = useState("");
  const [emisor, setEmisor] = useState("");
  const [resumen, setResumen] = useState("");
  const [obligaciones, setObligaciones] = useState<ObligacionEnEdicion[]>([vacia()]);
  const [errores, setErrores] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);

  const cambiar = (i: number, cambios: Partial<ObligacionEnEdicion>) =>
    setObligaciones((os) => os.map((o, j) => (j === i ? { ...o, ...cambios } : o)));

  async function guardar() {
    setGuardando(true);
    setErrores([]);
    try {
      const r = await fetch("/api/normas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clave, titulo, emisor, resumen,
          obligaciones: obligaciones.map((o) => ({
            titulo: o.titulo,
            detalle: o.detalle || null,
            tipo: o.tipo,
            cadaDias: o.cadaDias ? Number(o.cadaDias) : null,
            evidencia: o.evidencia || null,
          })),
        }),
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErrores(Array.isArray(datos.details) ? datos.details : [datos.error ?? "No se pudo guardar."]);
        return;
      }
      router.push(`/normas/${encodeURIComponent(clave.trim().toUpperCase())}`);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* La promesa que NO se hace, dicha antes de que capture nada. */}
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {ORIGENES_NORMA.PROPIA.promesa}
      </p>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={etiqueta} htmlFor="clave">Cómo le llaman</label>
            <input id="clave" className={entrada} value={clave} maxLength={40}
              onChange={(e) => setClave(e.target.value)} placeholder="ISO 9001, COR-14, Requisito cliente A" />
            <p className="mt-1 text-[0.6875rem] text-slate-500">Es lo que va a ver en la lista y en la orden impresa.</p>
          </div>
          <div>
            <label className={etiqueta} htmlFor="titulo">Título</label>
            <input id="titulo" className={entrada} value={titulo} maxLength={120}
              onChange={(e) => setTitulo(e.target.value)} placeholder="Sistema de gestión de calidad" />
          </div>
          <div>
            <label className={etiqueta} htmlFor="emisor">Quién lo exige</label>
            <input id="emisor" className={entrada} value={emisor} maxLength={80}
              onChange={(e) => setEmisor(e.target.value)} placeholder="Corporativo, su cliente, ISO" />
          </div>
          <div>
            <label className={etiqueta} htmlFor="resumen">Qué busca</label>
            <input id="resumen" className={entrada} value={resumen} maxLength={300}
              onChange={(e) => setResumen(e.target.value)} placeholder="En una línea" />
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Qué exige</span>
          <span className="text-[0.6875rem] text-slate-400">{obligaciones.length}</span>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Una por cada cosa concreta que hay que hacer o tener. El tipo decide con qué pieza del sistema se
          cumple, así que conviene pensarlo: lo que se hace cada cierto tiempo es una actividad; lo que vence
          es un documento.
        </p>

        <div className="space-y-3">
          {obligaciones.map((o, i) => {
            const def = definicionDeObligacion(o.tipo);
            return (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <div>
                    <label className={etiqueta}>Qué exige</label>
                    <input className={entrada} value={o.titulo} maxLength={120}
                      onChange={(e) => cambiar(i, { titulo: e.target.value })} placeholder="Auditoría interna semestral" />
                  </div>
                  <div>
                    <label className={etiqueta}>De qué tipo</label>
                    <select className={entrada} value={o.tipo} onChange={(e) => cambiar(i, { tipo: e.target.value as TipoObligacion })}>
                      {ORDEN_TIPOS_OBLIGACION.map((t) => <option key={t} value={t}>{TIPOS_OBLIGACION[t].nombre}</option>)}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button type="button" onClick={() => setObligaciones((os) => os.filter((_, j) => j !== i))}
                      className="rounded border border-slate-300 p-2 text-slate-500 hover:text-rose-600" aria-label="Quitar">
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-[0.6875rem] text-slate-500">Se cumple con {def.seCumpleCon}.</p>

                <div className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr]">
                  <div>
                    <label className={etiqueta}>Cada cuántos días</label>
                    <input className={entrada} value={o.cadaDias} inputMode="numeric"
                      onChange={(e) => cambiar(i, { cadaDias: e.target.value.replace(/[^\d]/g, "") })} placeholder="180" />
                  </div>
                  <div>
                    <label className={etiqueta}>Qué evidencia debe quedar</label>
                    <input className={entrada} value={o.evidencia} maxLength={200}
                      onChange={(e) => cambiar(i, { evidencia: e.target.value })} placeholder="El informe firmado" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setObligaciones((os) => [...os, vacia()])}>
          <Plus className="mr-1 h-3 w-3" aria-hidden /> Agregar otra
        </Button>
      </Card>

      {errores.length ? (
        <Card>
          <p className="text-sm font-medium text-rose-700">Falta corregir esto:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-600">
            {errores.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Card>
      ) : null}

      <Button onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Agregar la norma"}</Button>
    </div>
  );
}
