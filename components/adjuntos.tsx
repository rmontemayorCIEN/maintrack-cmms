"use client";

import { useZona } from "@/components/zona-empresa";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Film, Image as ImgIcon, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import type { Destino } from "@/lib/cliente/subida";
import { BotonSubir, FotosPorSubir, subirPendientes, type PorSubir } from "@/components/fotos-por-subir";

export type Adjunto = {
  id: string;
  name: string;
  kind: string;
  size: number;
  mimeType: string | null;
  createdAt: string;
  subidoPor: string | null;
};

const MB = 1_048_576;

function pesoLegible(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

function Icono({ kind }: { kind: string }) {
  if (kind === "PHOTO") return <ImgIcon className="h-4 w-4" />;
  if (kind === "VIDEO") return <Film className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

/**
 * Adjuntos de un registro: fotos, videos y documentos.
 *
 * Se eligen primero (con vista previa, quitando lo que salió mal) y se suben
 * al confirmar: nada se sube solo. La subida va DIRECTA al almacén con una URL
 * firmada (lib/cliente/subida.ts); las fotos se orientan y se reducen antes.
 */
export function Adjuntos({
  destino,
  adjuntos,
  editable,
  titulo = "Archivos y evidencia",
  ayuda,
}: {
  destino: Destino;
  adjuntos: Adjunto[];
  editable: boolean;
  titulo?: string;
  ayuda?: string;
}) {
  const zona = useZona();
  const router = useRouter();
  const [porSubir, setPorSubir] = useState<PorSubir[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subir() {
    setSubiendo(true);
    setError(null);
    const fallidos = await subirPendientes(destino as Destino, porSubir, setPorSubir);
    setSubiendo(false);
    if (fallidos) {
      setError(`${fallidos} ${fallidos === 1 ? "archivo no se subió" : "archivos no se subieron"}. Los demás ya quedaron guardados; puede reintentar.`);
    } else {
      setPorSubir([]);
    }
    router.refresh();
  }

  async function borrar(a: Adjunto) {
    if (!confirm(`¿Eliminar «${a.name}»?\n\nSe quita de este registro para todos y no se puede deshacer.`)) return;
    try {
      const res = await fetch(`/api/attachments/${a.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "No fue posible eliminar el archivo.");
        return;
      }
    } catch {
      setError("No hay conexión. El archivo no se eliminó.");
      return;
    }
    router.refresh();
  }

  const fotos = adjuntos.filter((a) => a.kind === "PHOTO");
  const resto = adjuntos.filter((a) => a.kind !== "PHOTO");

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{titulo}</h3>
          <p className="text-xs text-slate-500">
            {ayuda ?? "Fotos, videos y documentos. Máximo 200 MB por archivo."}
          </p>
        </div>
      </div>

      {editable ? (
        <div className="grid gap-2">
          <FotosPorSubir
            archivos={porSubir} onCambio={setPorSubir} deshabilitado={subiendo}
            yaSubidos={adjuntos.map((a) => ({ name: a.name, size: a.size }))}
          />
          <div><BotonSubir archivos={porSubir} subiendo={subiendo} onSubir={subir} /></div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}

      {adjuntos.length === 0 && !porSubir.length ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
          Sin archivos adjuntos
        </p>
      ) : null}

      {fotos.length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {fotos.map((a) => (
            <figure key={a.id} className="group relative overflow-hidden rounded-lg border border-slate-200">
              <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" title={a.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/attachments/${a.id}`} alt={a.name} loading="lazy"
                  className="aspect-square w-full bg-slate-100 object-cover transition-transform group-hover:scale-105"
                />
              </a>
              {editable ? (
                // Visible siempre en pantallas táctiles (no hay «pasar el cursor»); en computadora, al pasar.
                <button
                  type="button" onClick={() => borrar(a)} aria-label={`Eliminar ${a.name}`}
                  className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-lg bg-white/90 text-slate-500 transition-opacity hover:text-red-600 focus:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </figure>
          ))}
        </div>
      ) : null}

      {resto.length ? (
        <ul className="grid gap-1.5">
          {resto.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-2.5 py-2">
              <span className="text-slate-400"><Icono kind={a.kind} /></span>
              <div className="min-w-0 flex-1">
                <a
                  href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer"
                  className="block truncate text-xs font-medium text-brand-600 hover:underline"
                >
                  {a.name}
                </a>
                <p className="text-[0.625rem] text-slate-400">
                  {pesoLegible(a.size)} · {formatDateTime(a.createdAt, zona)}
                  {a.subidoPor ? ` · ${a.subidoPor}` : ""}
                </p>
              </div>
              {editable ? (
                <button
                  type="button" onClick={() => borrar(a)} aria-label={`Eliminar ${a.name}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
