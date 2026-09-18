"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Search, X } from "lucide-react";

type Detector = { detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
declare global {
  interface Window { BarcodeDetector?: new (o: { formats: string[] }) => Detector }
}

/**
 * La cámara se pide SOLO cuando la persona toca «Abrir cámara», y se apaga
 * al leer, al cerrar o al salir de la pantalla. Donde el navegador no lee QR
 * (el iPhone), se explica cómo usar la cámara del teléfono, que ya lo hace.
 */
export function Escaner() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const flujo = useRef<MediaStream | null>(null);
  const [soportado, setSoportado] = useState<boolean | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [yendo, setYendo] = useState(false);

  useEffect(() => { setSoportado(typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices); }, []);
  useEffect(() => () => apagar(), []);

  function apagar() {
    flujo.current?.getTracks().forEach((t) => t.stop());
    flujo.current = null;
    setAbierta(false);
  }

  /** Un código de MainTrack lleva a su portal; cualquier otro texto se busca. */
  function ir(valor: string) {
    const texto = valor.trim();
    if (!texto) return;
    setYendo(true);
    try {
      const url = new URL(texto);
      if (url.origin === window.location.origin || url.pathname.startsWith("/reportar/")) {
        router.push(url.pathname + url.search);
        return;
      }
      setError("Ese código no es de MainTrack. Si es de un equipo, escriba su clave abajo.");
      setYendo(false);
      return;
    } catch {
      router.push(`/search?q=${encodeURIComponent(texto)}`);
    }
  }

  async function abrir() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      flujo.current = stream;
      setAbierta(true);
      requestAnimationFrame(async () => {
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play().catch(() => undefined);
        const detector = new window.BarcodeDetector!({ formats: ["qr_code"] });
        const leer = async () => {
          if (!flujo.current || !video.current) return;
          try {
            const [primero] = await detector.detect(video.current);
            if (primero?.rawValue) { apagar(); ir(primero.rawValue); return; }
          } catch { /* un cuadro que no se pudo leer: se intenta con el siguiente */ }
          setTimeout(leer, 250);
        };
        leer();
      });
    } catch (e) {
      const negado = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      setError(negado
        ? "No se dio permiso para usar la cámara. Puede permitirlo en los ajustes del navegador, o escribir el código abajo."
        : "No se pudo abrir la cámara. Escriba el código abajo.");
      apagar();
    }
  }

  return (
    <div className="grid max-w-lg gap-4">
      {soportado ? (
        abierta ? (
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video ref={video} playsInline muted className="aspect-[3/4] w-full object-cover" aria-label="Vista de la cámara" />
            <button type="button" onClick={apagar} className="absolute right-2 top-2 inline-flex min-h-11 items-center gap-1 rounded-lg bg-white/90 px-3 text-sm font-medium text-slate-800">
              <X className="h-4 w-4" /> Cerrar cámara
            </button>
            <p className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-center text-sm text-white">Apunte al código QR</p>
          </div>
        ) : (
          <button type="button" onClick={abrir} disabled={yendo} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
            {yendo ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />} Abrir cámara
          </button>
        )
      ) : soportado === false ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          En este teléfono, abra la <strong>cámara</strong>, apunte al código QR y toque el enlace que aparece: le trae aquí, con su usuario.
        </p>
      ) : null}

      {error ? <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p> : null}

      <form onSubmit={(e) => { e.preventDefault(); ir(codigo); }} className="grid gap-2">
        <label htmlFor="codigo-equipo" className="label">O escriba el código del equipo o el folio</label>
        <div className="flex gap-2">
          <input id="codigo-equipo" className="field" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej. BO-01 u OT-000123" autoCapitalize="characters" autoComplete="off" enterKeyHint="go" />
          <button type="submit" disabled={!codigo.trim() || yendo} aria-label="Buscar" className="grid min-h-11 min-w-11 place-items-center rounded-lg bg-brand-600 text-white disabled:opacity-50">
            <Search className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
