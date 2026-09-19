"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { SIN_RED } from "@/lib/cliente/borrador";

type Sev = { clave: string; nombre: string; cuando: string; respuesta: string };

/** Los datos técnicos que se adjuntan si la persona lo acepta: se muestran antes de enviarlos. */
function datosTecnicos() {
  return {
    navegador: navigator.userAgent.slice(0, 200),
    pantalla: `${window.screen.width}×${window.screen.height}`,
    ventana: `${window.innerWidth}×${window.innerHeight}`,
    idioma: navigator.language,
    conexion: navigator.onLine ? "en línea" : "sin conexión",
    hora: new Date().toISOString(),
  };
}

export function FormularioSoporte({ pantallaInicial, severidades }: { pantallaInicial: string; severidades: Sev[] }) {
  const router = useRouter();
  const [v, setV] = useState({ asunto: "", descripcion: "", severidad: "MEDIA", pantalla: pantallaInicial, adjuntar: true });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ folio: string; respuestaObjetivo: string } | null>(null);
  const set = (c: Partial<typeof v>) => setV((x) => ({ ...x, ...c }));
  const sev = severidades.find((s) => s.clave === v.severidad)!;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true); setError(null);
    try {
      const r = await fetch("/api/soporte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asunto: v.asunto, descripcion: v.descripcion, severidad: v.severidad, pantalla: v.pantalla || null, datosTecnicos: v.adjuntar ? datosTecnicos() : null }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo enviar."); return; }
      setListo(d.solicitud); setV((x) => ({ ...x, asunto: "", descripcion: "" }));
      router.refresh();
    } catch { setError(SIN_RED); } finally { setEnviando(false); }
  }

  return (
    <form onSubmit={enviar} className="mt-3 grid gap-3">
      {listo ? <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />Solicitud {listo.folio} recibida. Respuesta objetivo: {listo.respuestaObjetivo}. Le avisamos en la campana cuando haya respuesta.</p> : null}
      <div><label htmlFor="s-asunto" className="label">Asunto</label><input id="s-asunto" className="field" required minLength={5} maxLength={140} value={v.asunto} onChange={(e) => set({ asunto: e.target.value })} placeholder="Ej. No puedo cerrar una orden de trabajo" /></div>
      <div><label htmlFor="s-desc" className="label">Qué intentaba hacer y qué pasó</label><textarea id="s-desc" className="field min-h-28" required minLength={10} maxLength={4000} value={v.descripcion} onChange={(e) => set({ descripcion: e.target.value })} placeholder="Qué pantalla, qué hizo, qué esperaba, qué salió, desde cuándo y a quién afecta." /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="s-sev" className="label">Severidad</label>
          <select id="s-sev" className="field" value={v.severidad} onChange={(e) => set({ severidad: e.target.value })}>{severidades.map((s) => <option key={s.clave} value={s.clave}>{s.nombre}</option>)}</select>
          <p className="mt-1 text-xs text-slate-500">{sev.cuando} Respuesta objetivo: {sev.respuesta}.</p>
        </div>
        <div><label htmlFor="s-pantalla" className="label">Pantalla <span className="font-normal text-slate-400">(opcional)</span></label><input id="s-pantalla" className="field" maxLength={200} value={v.pantalla} onChange={(e) => set({ pantalla: e.target.value })} placeholder="Ej. Órdenes de trabajo › OT-000123" /></div>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={v.adjuntar} onChange={(e) => set({ adjuntar: e.target.checked })} />
        <span>Adjuntar datos técnicos básicos: navegador, tamaño de pantalla, idioma, conexión y hora. No incluye contraseñas ni datos de su operación.</span>
      </label>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button type="submit" disabled={enviando} className="inline-flex min-h-11 items-center justify-center gap-2 justify-self-start rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Enviar solicitud
      </button>
    </form>
  );
}

/** Agregar información, subir la severidad o confirmar que ya se resolvió. */
export function Seguimiento({ id, estado, severidad }: { id: string; estado: string; severidad: string }) {
  const router = useRouter();
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mandar = async (cuerpo: Record<string, unknown>) => {
    if (enviando) return;
    setEnviando(true); setError(null);
    try {
      const r = await fetch(`/api/soporte/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo guardar."); return; }
      setNota(""); router.refresh();
    } catch { setError(SIN_RED); } finally { setEnviando(false); }
  };
  return (
    <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3">
      {estado === "RESUELTA" ? <button type="button" disabled={enviando} onClick={() => mandar({ confirmarResuelta: true })} className="inline-flex min-h-10 items-center justify-self-start rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700">Confirmar que quedó resuelto</button> : null}
      <div className="flex gap-2">
        <label htmlFor={`nota-${id}`} className="sr-only">Agregar información</label>
        <input id={`nota-${id}`} className="field" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Agregar información" maxLength={2000} />
        <button type="button" disabled={enviando || !nota.trim()} onClick={() => mandar({ nota })} className="min-h-11 shrink-0 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Agregar</button>
      </div>
      {severidad !== "CRITICA" ? <button type="button" disabled={enviando} onClick={() => mandar({ severidad: severidad === "BAJA" ? "MEDIA" : severidad === "MEDIA" ? "ALTA" : "CRITICA" })} className="justify-self-start text-xs text-slate-600 underline underline-offset-2">Subir la severidad (escalar)</button> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
