"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

type Plan = { clave: string; nombre: string; descripcion: string; precio: string; limites: string[] };
type Opcion = { clave: string; nombre: string };

const GIROS = ["Manufactura", "Alimentos y bebidas", "Automotriz", "Minería", "Energía", "Logística", "Inmobiliario", "Salud", "Otro"];

/**
 * Contratación en pasos cortos, en una sola pantalla: plan, empresa,
 * responsable, cómo empezar y documentos. Si el alta está cerrada no se pide
 * contraseña y el resultado es «solicitud recibida, validación pendiente».
 */
export function FormularioContratacion(p: {
  abierta: boolean; planes: Plan[]; planInicial: string;
  complemento: { nombre: string; precio: string; descripcion: string };
  cobro: string; prueba: string; instalaciones: Opcion[]; rangos: readonly string[];
  modos: Array<{ modo: string; titulo: string; texto: string }>;
}) {
  const router = useRouter();
  const [v, setV] = useState({
    plan: p.planInicial, complementoIa: false, empresa: "", giro: GIROS[0], tipoInstalacion: p.instalaciones[0]?.clave ?? "", rangoActivos: "",
    nombre: "", correo: "", telefono: "", contrasena: "", modo: "RECOMENDADA", problema: "", aceptaDocumentos: false, sitioWeb: "",
  });
  const [estado, setEstado] = useState<"captura" | "enviando" | "recibida">("captura");
  const [error, setError] = useState<string | null>(null);
  const set = (c: Partial<typeof v>) => setV((x) => ({ ...x, ...c }));
  const elegido = p.planes.find((x) => x.clave === v.plan)!;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (estado === "enviando") return;
    setEstado("enviando"); setError(null);
    try {
      const r = await fetch("/api/contratar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...v, contrasena: p.abierta ? v.contrasena : undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo enviar. Revise los datos."); setEstado("captura"); return; }
      if (d.creada) { router.push(d.destino); return; }
      setEstado("recibida");
    } catch {
      setError("No hay conexión. No se envió; sus datos siguen aquí.");
      setEstado("captura");
    }
  }

  if (estado === "recibida") {
    return (
      <div role="status" className="mt-8 grid gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950">
        <p className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 className="h-5 w-5" /> Solicitud recibida</p>
        <p className="text-sm"><strong>Estado:</strong> validación pendiente. No se ha hecho ningún cargo.</p>
        <p className="text-sm"><strong>Qué sigue:</strong> el equipo de MainTrack revisa la solicitud y le escribe a {v.correo} para confirmar el plan {elegido.nombre}. Al confirmarse se crea su cuenta con el periodo de prueba y le llegan sus datos de acceso para empezar la puesta en marcha.</p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="relative mt-8 grid gap-8">
      <fieldset className="grid gap-3">
        <legend className="text-lg font-semibold text-slate-900">1. Plan</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {p.planes.map((pl) => (
            <label key={pl.clave} className={`grid cursor-pointer gap-1 rounded-2xl border p-4 ${v.plan === pl.clave ? "border-brand-500 ring-2 ring-brand-200" : "border-slate-200"}`}>
              <span className="flex items-center gap-2"><input type="radio" name="plan" value={pl.clave} checked={v.plan === pl.clave} onChange={() => set({ plan: pl.clave })} className="h-5 w-5" /><span className="font-semibold text-slate-900">{pl.nombre}</span></span>
              <span data-precio className="text-xl font-semibold tabular-nums text-slate-900">{pl.precio} <span className="text-sm font-normal text-slate-500">al mes</span></span>
              <span className="text-sm text-slate-600">{pl.descripcion}</span>
              <span className="text-xs text-slate-500">Incluye: {pl.limites.join(" · ")}</span>
            </label>
          ))}
        </div>
        <label className="flex items-start gap-2 rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={v.complementoIa} onChange={(e) => set({ complementoIa: e.target.checked })} />
          <span><strong>Complemento {p.complemento.nombre}</strong> · {p.complemento.precio} al mes, aparte del plan. {p.complemento.descripcion} Se confirma con el equipo de MainTrack.</span>
        </label>
        <p className="text-xs text-slate-500">{p.cobro}</p>
        <p className="text-xs text-slate-500">{p.prueba} <Link href="/#planes" className="underline">Ver la comparación completa</Link>.</p>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-lg font-semibold text-slate-900">2. Empresa</legend>
        <div className="sm:col-span-2"><label htmlFor="c-empresa" className="label">Nombre de la empresa</label><input id="c-empresa" className="field" required minLength={2} maxLength={160} value={v.empresa} onChange={(e) => set({ empresa: e.target.value })} /></div>
        <div><label htmlFor="c-giro" className="label">Giro</label><select id="c-giro" className="field" value={v.giro} onChange={(e) => set({ giro: e.target.value })}>{GIROS.map((g) => <option key={g}>{g}</option>)}</select></div>
        <div><label htmlFor="c-tipo" className="label">Tipo de instalación</label><select id="c-tipo" className="field" value={v.tipoInstalacion} onChange={(e) => set({ tipoInstalacion: e.target.value })}>{p.instalaciones.map((i) => <option key={i.clave} value={i.clave}>{i.nombre}</option>)}</select></div>
        <div><label htmlFor="c-activos" className="label">Equipos que mantiene (aprox.)</label><select id="c-activos" className="field" value={v.rangoActivos} onChange={(e) => set({ rangoActivos: e.target.value })}><option value="">Elija un rango</option>{p.rangos.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-lg font-semibold text-slate-900">3. Responsable principal</legend>
        <div><label htmlFor="c-nombre" className="label">Nombre</label><input id="c-nombre" className="field" required minLength={2} maxLength={120} autoComplete="name" value={v.nombre} onChange={(e) => set({ nombre: e.target.value })} /></div>
        <div><label htmlFor="c-correo" className="label">Correo</label><input id="c-correo" type="email" className="field" required maxLength={160} autoComplete="email" value={v.correo} onChange={(e) => set({ correo: e.target.value })} /></div>
        <div><label htmlFor="c-telefono" className="label">Teléfono <span className="font-normal text-slate-400">(opcional)</span></label><input id="c-telefono" type="tel" inputMode="tel" className="field" maxLength={25} value={v.telefono} onChange={(e) => set({ telefono: e.target.value })} /></div>
        {p.abierta ? <div><label htmlFor="c-contrasena" className="label">Contraseña</label><input id="c-contrasena" type="password" className="field" required minLength={8} autoComplete="new-password" value={v.contrasena} onChange={(e) => set({ contrasena: e.target.value })} /></div> : null}
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-lg font-semibold text-slate-900">4. Cómo quiere empezar</legend>
        {p.modos.map((m) => (
          <label key={m.modo} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm ${v.modo === m.modo ? "border-brand-500 bg-brand-50/40" : "border-slate-200"}`}>
            <input type="radio" name="modo" value={m.modo} className="mt-0.5 h-5 w-5 shrink-0" checked={v.modo === m.modo} onChange={() => set({ modo: m.modo })} />
            <span><strong className="text-slate-900">{m.titulo}.</strong> <span className="text-slate-600">{m.texto}</span></span>
          </label>
        ))}
        <div><label htmlFor="c-problema" className="label">¿Qué le gustaría resolver primero? <span className="font-normal text-slate-400">(opcional)</span></label><textarea id="c-problema" className="field min-h-20" maxLength={600} value={v.problema} onChange={(e) => set({ problema: e.target.value })} /></div>
      </fieldset>

      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label htmlFor="c-sitio">Sitio web</label><input id="c-sitio" tabIndex={-1} autoComplete="off" value={v.sitioWeb} onChange={(e) => set({ sitioWeb: e.target.value })} /></div>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-lg font-semibold text-slate-900">5. Documentos</legend>
        <p className="text-sm text-slate-600">Léalos antes de continuar: <Link href="/legal/contrato" target="_blank" className="underline">contrato</Link>, <Link href="/legal/terminos" target="_blank" className="underline">términos y condiciones</Link>, <Link href="/legal/privacidad" target="_blank" className="underline">aviso de privacidad</Link> y <Link href="/legal/sla" target="_blank" className="underline">niveles de servicio</Link>.</p>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" required checked={v.aceptaDocumentos} onChange={(e) => set({ aceptaDocumentos: e.target.checked })} />
          <span>Acepto el contrato, los términos y condiciones y el aviso de privacidad a nombre de la empresa.</span>
        </label>
      </fieldset>

      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <button type="submit" disabled={estado === "enviando"} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {estado === "enviando" ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        {p.abierta ? `Crear mi cuenta · plan ${elegido.nombre}` : `Enviar solicitud · plan ${elegido.nombre}`}
      </button>
    </form>
  );
}
