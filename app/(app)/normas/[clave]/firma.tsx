"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Info, X } from "lucide-react";
import { Button } from "@/components/ui";

const entrada = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none";
const etiqueta = "block text-xs font-medium text-slate-600";

/**
 * La firma de quien reviso esta norma en la empresa del cliente.
 *
 * Es la pieza que convierte el catalogo de una propuesta en algo presentable.
 * Nosotros nunca revisamos ese contenido —lo redacto una IA— y no tendria caso
 * que lo hicieramos: que obligaciones aplican y cada cuando depende de la
 * instalacion, y eso lo sabe quien la conoce.
 *
 * Por eso el nombre es libre y no un usuario del sistema: el especialista en
 * seguridad e higiene casi siempre es externo. Lo que un inspector quiere ver
 * es quien responde por el contenido, no que software lo propuso.
 */
export function FirmaDeRevision({
  normaId, nombre, cargo, fecha, editable, zona,
}: {
  normaId: string;
  nombre: string | null;
  cargo: string | null;
  fecha: string | null;
  editable: boolean;
  zona: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [n, setN] = useState(nombre ?? "");
  const [c, setC] = useState(cargo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar(retirar = false) {
    if (!retirar && !n.trim()) { setError("Escriba el nombre de quien la revisó."); return; }
    setOcupado(true); setError(null);
    const r = await fetch(`/api/normas/${normaId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisadaPorNombre: retirar ? null : n, revisadaPorCargo: retirar ? null : c }),
    });
    setOcupado(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? "No se pudo guardar.");
      return;
    }
    setAbierto(false);
    router.refresh();
  }

  const fechaLegible = fecha
    ? new Date(fecha).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: zona })
    : null;

  if (abierto) {
    return (
      <div className="mt-3 rounded-lg border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Quién revisó esta norma</span>
          <button type="button" onClick={() => setAbierto(false)} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Cerrar">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          El especialista que confirmó que estas obligaciones son las que aplican a su instalación.
          Puede ser externo: va su nombre, no una cuenta del sistema.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <label className={etiqueta} htmlFor="firma-nombre">Nombre</label>
            <input id="firma-nombre" className={entrada} value={n} maxLength={120}
              placeholder="Ing. María Elena Cantú" onChange={(e) => setN(e.target.value)} />
          </div>
          <div>
            <label className={etiqueta} htmlFor="firma-cargo">Puesto o cédula</label>
            <input id="firma-cargo" className={entrada} value={c} maxLength={120}
              placeholder="Responsable de Seguridad e Higiene" onChange={(e) => setC(e.target.value)} />
          </div>
        </div>
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => guardar()} disabled={ocupado}>{ocupado ? "Guardando…" : "Firmar la revisión"}</Button>
          <Button size="sm" variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button>
          {nombre ? (
            <button type="button" onClick={() => guardar(true)} disabled={ocupado}
              className="text-xs text-slate-500 underline hover:text-rose-600">
              Retirar la firma
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // Firmada: se dice quién y cuándo. Eso es lo que sale en el expediente.
  if (nombre) {
    return (
      <p className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
        <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          Revisada por <strong>{nombre}</strong>
          {cargo ? ` — ${cargo}` : ""}
          {fechaLegible ? `, el ${fechaLegible}` : ""}.
        </span>
        {editable ? (
          <button type="button" onClick={() => setAbierto(true)} className="underline hover:text-emerald-700">Cambiar</button>
        ) : null}
      </p>
    );
  }

  // Sin firmar: el aviso NO se suaviza. Es lo que separa una lista util de una
  // que alguien podria presentar creyendo que esta validada.
  return (
    <p className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
      <Info className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        <strong>Nadie ha revisado esta norma todavía.</strong> Le sirve para organizarse;
        antes de presentarla, pida a su especialista que confirme que estas obligaciones
        son las que le aplican.
      </span>
      {editable ? (
        <button type="button" onClick={() => setAbierto(true)} className="underline hover:text-amber-700">
          Registrar quién la revisó
        </button>
      ) : null}
    </p>
  );
}
