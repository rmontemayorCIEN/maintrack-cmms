"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Camera, Check, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";

type Equipo = { nombre: string; cantidad: number; confianza: "SEGURO" | "PROBABLE" | "DUDOSO"; detalle: string };
export type Foto = {
  id: string;
  /** Identificador del adjunto en el servidor. Null si el almacen fallo. */
  fotoId: string | null;
  zona: string;
  vista: string;
  util: boolean;
  calidad: "BUENA" | "REGULAR" | "MALA";
  problema: string;
  comoMejorarla: string;
  descripcionDeLoQueVe: string;
  equipos: Equipo[];
  nota: string;
};

const LIMITE_MB = 5;
const TONO_CONFIANZA = { SEGURO: "success", PROBABLE: "info", DUDOSO: "muted" } as const;

/**
 * Recorrido fotografico del levantamiento.
 *
 * Lo que el usuario no supo describir, la camara lo muestra. Cada foto se
 * evalua por separado para poder decir cual sirvio y cual hay que repetir: si
 * se procesaran todas juntas, una foto mala arruinaria el lote sin que nadie
 * supiera cual fue.
 */
export function PasoFotos({
  fotos,
  onCambio,
}: {
  fotos: Foto[];
  onCambio: (fotos: Foto[]) => void;
}) {
  const archivo = useRef<HTMLInputElement>(null);
  const [zona, setZona] = useState("");
  const [analizando, setAnalizando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const lista = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!lista.length) return;
    setError(null);

    for (const f of lista) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
        setError("Use fotos en JPG, PNG o WEBP."); continue;
      }
      if (f.size > LIMITE_MB * 1024 * 1024) {
        setError(`"${f.name}" pesa ${(f.size / 1024 / 1024).toFixed(1)} MB; el limite son ${LIMITE_MB} MB.`); continue;
      }

      setAnalizando(true);
      const base64 = await new Promise<string>((res, rej) => {
        const l = new FileReader();
        l.onload = () => res(String(l.result).split(",")[1] ?? "");
        l.onerror = () => rej(new Error("no se pudo leer"));
        l.readAsDataURL(f);
      });

      const r = await fetch("/api/ia/foto-area", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, tipo: f.type, zona: zona || null }),
      });
      const data = await r.json();
      setAnalizando(false);
      if (!r.ok) { setError(data.error ?? "No fue posible analizar la foto"); continue; }

      onCambio([
        ...fotos,
        {
          id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          fotoId: data.fotoId ?? null,
          zona: zona || "sin indicar",
          vista: URL.createObjectURL(f),
          ...data.lectura,
        },
      ]);
    }
    setZona("");
  }

  const utiles = fotos.filter((f) => f.util);
  const totalEquipos = utiles.reduce((s, f) => s + f.equipos.length, 0);

  return (
    <div className="grid gap-3">
      <div className="rounded-lg border border-dashed border-slate-300 p-4">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">Como tomar las fotos</p>
        <ul className="mt-1.5 grid gap-0.5 text-xs text-slate-600">
          <li>· Una foto por area: cuarto de maquinas, azotea, subestacion, cocina, cuarto de bombas.</li>
          <li>· Parese en la puerta y abarque el cuarto completo. Si es grande, dos fotos desde esquinas opuestas.</li>
          <li>· Encienda la luz. Un cuarto de maquinas a oscuras no se puede leer.</li>
          <li>· Incluya el piso: las bases de bombas y tanques ayudan a identificarlos.</li>
        </ul>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            className="field"
            placeholder="Que area va a fotografiar (ej. cuarto de maquinas de alberca)"
            value={zona}
            onChange={(e) => setZona(e.target.value)}
            maxLength={120}
          />
          <Button variant="secondary" onClick={() => archivo.current?.click()} disabled={analizando}>
            {analizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {analizando ? "Analizando…" : "Agregar foto"}
          </Button>
        </div>
        <p className="mt-1 text-[0.6875rem] text-slate-400">
          Cada foto consume 1 operacion de IA. Puede seleccionar varias a la vez.
        </p>
      </div>

      <input
        ref={archivo}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        multiple
        className="hidden"
        onChange={alElegir}
      />

      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

      {fotos.map((f) => (
        <div key={f.id} className={`rounded-lg border p-3 ${f.util ? "border-slate-200" : "border-amber-300 bg-amber-50"}`}>
          <div className="flex gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.vista} alt={f.zona} className="h-20 w-24 shrink-0 rounded-lg border border-slate-200 object-cover" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-800">{f.zona}</span>
                <Badge tone={f.calidad === "BUENA" ? "success" : f.calidad === "REGULAR" ? "warning" : "danger"}>
                  {f.calidad.toLowerCase()}
                </Badge>
                {f.util ? <Badge tone="info">{f.equipos.length} equipos</Badge> : null}
              </div>

              {f.util ? (
                <p className="mt-0.5 text-[0.6875rem] text-slate-500">{f.descripcionDeLoQueVe}</p>
              ) : (
                <div className="mt-1">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
                    <AlertTriangle className="h-3.5 w-3.5" /> Esta foto no sirve
                  </p>
                  {f.problema ? <p className="mt-0.5 text-[0.6875rem] text-amber-900">{f.problema}</p> : null}
                  {f.comoMejorarla ? (
                    <p className="mt-1 rounded-md bg-white/70 px-2 py-1 text-[0.6875rem] font-medium text-amber-950">
                      Que hacer: {f.comoMejorarla}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onCambio(fotos.filter((x) => x.id !== f.id))}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
              title="Quitar"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {f.util && f.equipos.length ? (
            <ul className="mt-2 grid gap-1 border-t border-slate-100 pt-2">
              {f.equipos.map((e, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-[0.6875rem]">
                  <span className="min-w-0 text-slate-700">
                    {e.nombre}{e.cantidad > 1 ? ` × ${e.cantidad}` : ""}
                    <span className="text-slate-400"> · {e.detalle}</span>
                  </span>
                  <Badge tone={TONO_CONFIANZA[e.confianza]}>{e.confianza.toLowerCase()}</Badge>
                </li>
              ))}
            </ul>
          ) : null}

          {f.util && f.nota ? <p className="mt-1.5 text-[0.6875rem] italic text-slate-500">{f.nota}</p> : null}
        </div>
      ))}

      {utiles.length ? (
        <p className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <Check className="h-3.5 w-3.5" />
          {totalEquipos} equipos reconocidos en {utiles.length} {utiles.length === 1 ? "foto" : "fotos"}. Se van a
          incluir en el inventario aunque no se hayan mencionado en la entrevista.
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-[0.6875rem] text-slate-500">
          <Camera className="h-3.5 w-3.5" />
          Las fotos son opcionales. Sin ellas el inventario sale de la entrevista; con ellas queda mas completo.
        </p>
      )}
    </div>
  );
}
