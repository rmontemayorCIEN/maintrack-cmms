"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, ScanLine, Search, X } from "lucide-react";

type Detector = { detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
declare global {
  interface Window { BarcodeDetector?: new (o: { formats: string[] }) => Detector }
}

/**
 * Escanear con la cámara del teléfono, dentro de MainTrack.
 *
 * - La cámara se pide SOLO al tocar «Abrir cámara y escanear», nunca al
 *   cargar la pantalla, y se apaga al leer, al cancelar o al salir.
 * - Cámara trasera cuando la hay.
 * - Lee con el detector del navegador si existe (Android/Chrome) y, si no
 *   (iPhone/Safari), con jsQR sobre los cuadros del video. jsQR se descarga
 *   solo en ese momento.
 * - Lo leído se valida en el servidor (lib/qr.ts): que sea de MainTrack, de
 *   esta empresa y que el rol pueda abrir el destino. Si no, se dice por qué y
 *   se puede volver a intentar o escribir el código.
 */
export function Escaner() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const flujo = useRef<MediaStream | null>(null);
  const activo = useRef(false);
  const [estado, setEstado] = useState<"inactiva" | "abriendo" | "leyendo" | "validando">("inactiva");
  const [error, setError] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [hayCamara, setHayCamara] = useState(true);

  useEffect(() => { setHayCamara(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia); }, []);
  useEffect(() => () => apagar(), []);

  function apagar() {
    activo.current = false;
    flujo.current?.getTracks().forEach((t) => t.stop());
    flujo.current = null;
    if (video.current) video.current.srcObject = null;
  }

  function cancelar() {
    apagar();
    setEstado("inactiva");
  }

  /** Pregunta al servidor a dónde lleva el código y va ahí; si no sirve, lo dice. */
  async function abrir(valor: string) {
    setEstado("validando");
    setError(null);
    try {
      const r = await fetch(`/api/qr?codigo=${encodeURIComponent(valor)}`);
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.destino) {
        router.push(d.destino);
        return;
      }
      setError(d.error ?? "No se pudo abrir ese código.");
    } catch {
      setError("No hay conexión: no se pudo validar el código. Intente de nuevo al tener señal.");
    }
    setEstado("inactiva");
  }

  async function escanear() {
    setError(null);
    setEstado("abriendo");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (e) {
      const nombre = e instanceof DOMException ? e.name : "";
      setError(
        nombre === "NotAllowedError" || nombre === "SecurityError"
          ? "No se dio permiso para usar la cámara. Puede permitirlo en los ajustes del navegador para este sitio, o escribir el código abajo."
          : nombre === "NotFoundError" || nombre === "OverconstrainedError"
            ? "Este dispositivo no tiene cámara disponible. Escriba el código abajo."
            : "No se pudo abrir la cámara. Escriba el código abajo.",
      );
      setEstado("inactiva");
      return;
    }
    flujo.current = stream;
    activo.current = true;
    setEstado("leyendo");
    // El <video> ya está en pantalla en el siguiente cuadro.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const v = video.current;
    if (!v) return;
    v.srcObject = stream;
    await v.play().catch(() => undefined);

    const nativo = typeof window.BarcodeDetector === "function" ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
    const jsQR = nativo ? null : (await import("jsqr")).default;
    const lienzo = document.createElement("canvas");
    const ctx = lienzo.getContext("2d", { willReadFrequently: true });

    const leer = async () => {
      if (!activo.current || !video.current) return;
      const cuadro = video.current;
      let leido: string | null = null;
      try {
        if (cuadro.readyState >= 2 && cuadro.videoWidth) {
          if (nativo) {
            leido = (await nativo.detect(cuadro))[0]?.rawValue ?? null;
          } else if (jsQR && ctx) {
            // Se reduce el cuadro: más rápido y suficiente para un QR impreso.
            const escala = Math.min(1, 640 / Math.max(cuadro.videoWidth, cuadro.videoHeight));
            lienzo.width = Math.round(cuadro.videoWidth * escala);
            lienzo.height = Math.round(cuadro.videoHeight * escala);
            ctx.drawImage(cuadro, 0, 0, lienzo.width, lienzo.height);
            const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
            leido = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
          }
        }
      } catch { /* un cuadro que no se pudo leer: se intenta con el siguiente */ }
      if (leido) {
        apagar();
        await abrir(leido);
        return;
      }
      setTimeout(leer, 200);
    };
    leer();
  }

  const leyendo = estado === "leyendo" || estado === "abriendo";

  return (
    <div className="grid max-w-lg gap-4">
      {leyendo ? (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={video} playsInline muted autoPlay className="aspect-[3/4] w-full object-cover" aria-label="Vista de la cámara" />
          <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/80" aria-hidden />
          <p className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-center text-sm text-white" role="status">
            {estado === "abriendo" ? "Abriendo la cámara…" : "Apunte al código QR dentro del recuadro"}
          </p>
          <button type="button" onClick={cancelar} className="absolute right-2 top-2 inline-flex min-h-11 items-center gap-1 rounded-lg bg-white/95 px-3 text-sm font-medium text-slate-800">
            <X className="h-4 w-4" /> Cancelar
          </button>
        </div>
      ) : hayCamara ? (
        <button
          type="button" onClick={escanear} disabled={estado === "validando"}
          className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {estado === "validando" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          {estado === "validando" ? "Abriendo…" : "Abrir cámara y escanear"}
        </button>
      ) : (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          Este navegador no permite usar la cámara aquí. Escanee con la cámara normal del teléfono y toque el enlace, o escriba el código abajo.
        </p>
      )}

      {error ? (
        <div role="alert" className="grid gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>{error}</p>
          {hayCamara ? (
            <button type="button" onClick={escanear} className="inline-flex min-h-10 items-center gap-1.5 justify-self-start rounded-lg border border-amber-400 bg-white px-3 text-sm font-medium">
              <ScanLine className="h-4 w-4" /> Escanear otro código
            </button>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={(e) => { e.preventDefault(); if (codigo.trim()) abrir(codigo); }} className="grid gap-2">
        <label htmlFor="codigo-equipo" className="label">O escriba el código del equipo o el folio</label>
        <div className="flex gap-2">
          <input id="codigo-equipo" className="field" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej. BO-01 u OT-000123" autoCapitalize="characters" autoComplete="off" enterKeyHint="go" />
          <button type="submit" disabled={!codigo.trim() || estado === "validando"} aria-label="Abrir" className="grid min-h-11 min-w-11 place-items-center rounded-lg bg-brand-600 text-white disabled:opacity-50">
            <Search className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
