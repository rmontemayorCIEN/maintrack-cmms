"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";

type Opcion = { clave: string; nombre: string };

/**
 * «Solicitar una demostración»: lo mínimo para preparar la llamada.
 * El campo «sitioWeb» es una trampa para robots: no se ve ni se anuncia.
 */
export function FormularioDemo({ instalaciones, rangos, origen }: { instalaciones: Opcion[]; rangos: readonly string[]; origen?: string }) {
  const [v, setV] = useState({ nombre: "", empresa: "", correo: "", telefono: "", tipoInstalacion: "", rangoActivos: "", problema: "", aceptaPrivacidad: false, sitioWeb: "" });
  const [estado, setEstado] = useState<"captura" | "enviando" | "listo">("captura");
  const [error, setError] = useState<string | null>(null);
  const set = (c: Partial<typeof v>) => setV((p) => ({ ...p, ...c }));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (estado === "enviando") return;
    setEstado("enviando"); setError(null);
    try {
      const r = await fetch("/api/prospectos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...v, origen }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo enviar. Intente de nuevo."); setEstado("captura"); return; }
      setEstado("listo");
    } catch {
      setError("No hay conexión. No se envió; sus datos siguen aquí para intentarlo de nuevo.");
      setEstado("captura");
    }
  }

  if (estado === "listo") {
    return (
      <div role="status" className="grid gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
        <p className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 className="h-5 w-5" /> Solicitud recibida</p>
        <p className="text-sm">Gracias, {v.nombre.split(" ")[0]}. Le escribiremos a {v.correo} para acordar la demostración. Dura entre 20 y 30 minutos y se hace sobre el sistema real, con una empresa de ejemplo.</p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="relative grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" noValidate={false}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="d-nombre" className="label">Nombre</label><input id="d-nombre" className="field" required minLength={2} maxLength={120} autoComplete="name" value={v.nombre} onChange={(e) => set({ nombre: e.target.value })} /></div>
        <div><label htmlFor="d-empresa" className="label">Empresa</label><input id="d-empresa" className="field" required minLength={2} maxLength={160} autoComplete="organization" value={v.empresa} onChange={(e) => set({ empresa: e.target.value })} /></div>
        <div><label htmlFor="d-correo" className="label">Correo</label><input id="d-correo" type="email" className="field" required maxLength={160} autoComplete="email" value={v.correo} onChange={(e) => set({ correo: e.target.value })} /></div>
        <div><label htmlFor="d-telefono" className="label">Teléfono <span className="font-normal text-slate-400">(opcional)</span></label><input id="d-telefono" type="tel" inputMode="tel" className="field" maxLength={25} pattern="[\d\s()+-]*" autoComplete="tel" value={v.telefono} onChange={(e) => set({ telefono: e.target.value })} /></div>
        <div>
          <label htmlFor="d-tipo" className="label">Tipo de instalación</label>
          <select id="d-tipo" className="field" value={v.tipoInstalacion} onChange={(e) => set({ tipoInstalacion: e.target.value })}>
            <option value="">Elija una opción</option>
            {instalaciones.map((i) => <option key={i.clave} value={i.clave}>{i.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="d-activos" className="label">Equipos que mantiene (aprox.)</label>
          <select id="d-activos" className="field" value={v.rangoActivos} onChange={(e) => set({ rangoActivos: e.target.value })}>
            <option value="">Elija un rango</option>
            {rangos.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>
      <div><label htmlFor="d-problema" className="label">¿Cuál es su principal problema de mantenimiento?</label><textarea id="d-problema" className="field min-h-24" maxLength={1000} value={v.problema} onChange={(e) => set({ problema: e.target.value })} placeholder="Ej. los preventivos se atrasan y nos enteramos de las fallas cuando la línea ya paró" /></div>
      {/* Trampa para robots: fuera de la vista y del teclado. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="d-sitio">Sitio web</label><input id="d-sitio" tabIndex={-1} autoComplete="off" value={v.sitioWeb} onChange={(e) => set({ sitioWeb: e.target.value })} />
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" required checked={v.aceptaPrivacidad} onChange={(e) => set({ aceptaPrivacidad: e.target.checked })} />
        <span>Acepto el <Link href="/legal/privacidad" className="font-medium text-brand-700 underline" target="_blank">aviso de privacidad</Link>. Sus datos se usan solo para atender esta solicitud.</span>
      </label>
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <button type="submit" disabled={estado === "enviando"} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {estado === "enviando" ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Solicitar demostración
      </button>
    </form>
  );
}
