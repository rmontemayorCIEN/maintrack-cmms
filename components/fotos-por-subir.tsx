"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, FileText, ImagePlus, Loader2, RotateCcw, X } from "lucide-react";
import { huella, problemaDe, subirArchivo, ErrorDeSubida, type Destino } from "@/lib/cliente/subida";

/**
 * Elegir fotos y archivos ANTES de subirlos: tomar una foto o escoger de la
 * galería, verla, quitar la que salió mal, y subir cuando la persona lo
 * confirma. Cada archivo lleva su propio progreso y, si falla, su botón de
 * reintentar: una foto que no subió no se pierde en silencio.
 */
export type PorSubir = {
  id: string;
  file: File;
  previa: string | null;
  estado: "lista" | "subiendo" | "error" | "subida";
  progreso: number;
  error?: string;
};

let consecutivo = 0;

export function FotosPorSubir({
  archivos, onCambio, maximo = 10, soloImagenes = false, deshabilitado = false, yaSubidos = [],
}: {
  archivos: PorSubir[];
  onCambio: (a: PorSubir[] | ((prev: PorSubir[]) => PorSubir[])) => void;
  maximo?: number;
  soloImagenes?: boolean;
  deshabilitado?: boolean;
  /** Nombre y tamaño de lo que ya está adjunto, para no subirlo dos veces. */
  yaSubidos?: Array<{ name: string; size: number }>;
}) {
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Las vistas previas ocupan memoria: se liberan al quitar el archivo o salir.
  useEffect(() => () => { for (const a of archivos) if (a.previa) URL.revokeObjectURL(a.previa); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  function agregar(lista: FileList | null) {
    if (!lista?.length) return;
    const avisos: string[] = [];
    const nuevos: PorSubir[] = [];
    const vistas = new Set(archivos.map((a) => huella(a.file)));
    for (const file of Array.from(lista)) {
      const problema = problemaDe(file);
      if (problema) { avisos.push(`${file.name}: ${problema}`); continue; }
      if (vistas.has(huella(file)) || yaSubidos.some((y) => y.name === file.name && y.size === file.size)) {
        avisos.push(`${file.name} ya estaba agregado.`);
        continue;
      }
      if (archivos.length + nuevos.length >= maximo) { avisos.push(`Máximo ${maximo} archivos por envío.`); break; }
      vistas.add(huella(file));
      nuevos.push({
        id: `f${++consecutivo}`, file, estado: "lista", progreso: 0,
        previa: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      });
    }
    setAviso(avisos.length ? avisos.join(" ") : null);
    if (nuevos.length) onCambio((prev) => [...prev, ...nuevos]);
    if (camara.current) camara.current.value = "";
    if (galeria.current) galeria.current.value = "";
  }

  function quitar(id: string) {
    onCambio((prev) => {
      const a = prev.find((x) => x.id === id);
      if (a?.previa) URL.revokeObjectURL(a.previa);
      return prev.filter((x) => x.id !== id);
    });
  }

  const boton = "inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {/* capture abre la cámara trasera en el teléfono; en computadora abre el explorador. */}
        <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => agregar(e.target.files)} />
        <input ref={galeria} type="file" multiple accept={soloImagenes ? "image/*" : undefined} className="hidden" onChange={(e) => agregar(e.target.files)} />
        <button type="button" onClick={() => camara.current?.click()} disabled={deshabilitado} className={boton}>
          <Camera className="h-4 w-4" /> Tomar foto
        </button>
        <button type="button" onClick={() => galeria.current?.click()} disabled={deshabilitado} className={boton}>
          <ImagePlus className="h-4 w-4" /> {soloImagenes ? "Elegir imagen" : "Elegir archivo"}
        </button>
      </div>
      {aviso ? <p role="status" className="text-xs text-amber-800">{aviso}</p> : null}
      {archivos.length ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {archivos.map((a) => (
            <li key={a.id} className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {a.previa ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.previa} alt={a.file.name} className="aspect-square w-full object-cover" />
              ) : (
                <div className="grid aspect-square place-items-center p-2 text-center text-[0.6875rem] text-slate-500">
                  <FileText className="mb-1 h-5 w-5" />
                  <span className="line-clamp-2 break-all">{a.file.name}</span>
                </div>
              )}
              {a.estado === "subiendo" ? (
                <div className="absolute inset-x-0 bottom-0 bg-white/90 px-1.5 py-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full bg-brand-500 transition-all" style={{ width: `${a.progreso}%` }} />
                  </div>
                  <p className="mt-0.5 text-center text-[0.625rem] tabular-nums text-slate-600">{a.progreso}%</p>
                </div>
              ) : null}
              {a.estado === "error" ? (
                <p className="absolute inset-x-0 bottom-0 bg-red-50/95 px-1.5 py-1 text-[0.625rem] leading-tight text-red-700">{a.error ?? "No se subió"}</p>
              ) : null}
              {a.estado === "subida" ? (
                <p className="absolute inset-x-0 bottom-0 bg-emerald-50/95 px-1.5 py-1 text-center text-[0.625rem] font-medium text-emerald-700">Subida</p>
              ) : null}
              {a.estado === "lista" || a.estado === "error" ? (
                <button
                  type="button" onClick={() => quitar(a.id)} aria-label={`Quitar ${a.file.name}`}
                  className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full bg-white/95 text-slate-600 shadow hover:text-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Sube los que falten (listos o con error), uno por uno, marcando progreso y
 * resultado en cada uno. Devuelve cuántos quedaron sin subir.
 */
export async function subirPendientes(
  destino: Destino,
  archivos: PorSubir[],
  onCambio: (f: (prev: PorSubir[]) => PorSubir[]) => void,
): Promise<number> {
  let fallidos = 0;
  const marcar = (id: string, cambio: Partial<PorSubir>) => onCambio((prev) => prev.map((x) => (x.id === id ? { ...x, ...cambio } : x)));
  for (const a of archivos) {
    if (a.estado === "subida") continue;
    marcar(a.id, { estado: "subiendo", progreso: 0, error: undefined });
    try {
      await subirArchivo(destino, a.file, (p) => marcar(a.id, { progreso: p }));
      marcar(a.id, { estado: "subida", progreso: 100 });
    } catch (e) {
      fallidos++;
      marcar(a.id, { estado: "error", error: e instanceof ErrorDeSubida || e instanceof Error ? e.message : "No se subió" });
    }
  }
  return fallidos;
}

/** Botón de subir/reintentar con su estado. */
export function BotonSubir({ archivos, subiendo, onSubir, texto = "Adjuntar" }: {
  archivos: PorSubir[]; subiendo: boolean; onSubir: () => void; texto?: string;
}) {
  const faltan = archivos.filter((a) => a.estado !== "subida").length;
  if (!faltan) return null;
  const conError = archivos.some((a) => a.estado === "error");
  return (
    <button
      type="button" onClick={onSubir} disabled={subiendo}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
    >
      {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : conError ? <RotateCcw className="h-4 w-4" /> : null}
      {subiendo ? "Subiendo…" : conError ? `Reintentar (${faltan})` : `${texto} ${faltan} ${faltan === 1 ? "archivo" : "archivos"}`}
    </button>
  );
}
