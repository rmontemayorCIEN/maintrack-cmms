"use client";

import { useZona } from "@/components/zona-empresa";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileText, Film, Image as ImgIcon, Loader2, Trash2, Upload } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

export type Adjunto = {
  id: string;
  name: string;
  kind: string;
  size: number;
  mimeType: string | null;
  createdAt: string;
  subidoPor: string | null;
};

type Destino =
  | { workOrderId: string } | { assetId: string }
  | { workRequestId: string } | { partId: string };

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
 * La subida va DIRECTA al almacen con una URL firmada que pide el servidor.
 * El archivo no pasa por la aplicacion, asi que un video de 150 MB no topa
 * con los limites de tamaño de peticion.
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
  const archivo = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function subir(files: FileList | null) {
    if (!files?.length) return;
    setError(null);

    for (const file of Array.from(files)) {
      setSubiendo(file.name);
      setProgreso(0);
      try {
        const base = {
          ...destino,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
        };

        // 1. Permiso y destino de subida.
        const permiso = await fetch("/api/attachments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(base),
        });
        const datos = await permiso.json();
        if (!permiso.ok) throw new Error(datos.error ?? "No fue posible preparar la subida");

        // 2. Subida directa, con progreso real.
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(datos.metodo, datos.url, true);
          xhr.setRequestHeader("Content-Type", base.mimeType);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgreso(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`El almacen rechazo el archivo (${xhr.status})`)));
          xhr.onerror = () => reject(new Error("Se interrumpio la conexion durante la subida"));
          xhr.send(file);
        });

        // 3. Confirmacion: el servidor verifica que el archivo llego.
        const alta = await fetch("/api/attachments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...base, storagePath: datos.storagePath }),
        });
        const resultado = await alta.json();
        if (!alta.ok) throw new Error(resultado.error ?? "No fue posible registrar el archivo");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al subir");
        break;
      }
    }

    setSubiendo(null);
    setProgreso(0);
    if (archivo.current) archivo.current.value = "";
    if (camara.current) camara.current.value = "";
    router.refresh();
  }

  async function borrar(a: Adjunto) {
    if (!confirm(`¿Eliminar "${a.name}"? No se puede deshacer.`)) return;
    const res = await fetch(`/api/attachments/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "No fue posible eliminar");
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
        {editable ? (
          <div className="flex gap-1.5">
            {/* capture="environment" abre la camara trasera en el celular */}
            <input
              ref={camara} type="file" accept="image/*" capture="environment"
              className="hidden" onChange={(e) => subir(e.target.files)}
            />
            <button
              type="button" onClick={() => camara.current?.click()} disabled={subiendo !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:hidden"
            >
              <Camera className="h-3.5 w-3.5" /> Foto
            </button>
            <input
              ref={archivo} type="file" multiple className="hidden"
              onChange={(e) => subir(e.target.files)}
            />
            <button
              type="button" onClick={() => archivo.current?.click()} disabled={subiendo !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {subiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Subir
            </button>
          </div>
        ) : null}
      </div>

      {subiendo ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex justify-between text-[0.6875rem] text-slate-600">
            <span className="truncate">{subiendo}</span>
            <span className="tabular-nums">{progreso}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${progreso}%` }} />
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}

      {adjuntos.length === 0 && !subiendo ? (
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
                <button
                  type="button" onClick={() => borrar(a)} aria-label={`Eliminar ${a.name}`}
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-lg bg-white/90 text-slate-500 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
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
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
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
