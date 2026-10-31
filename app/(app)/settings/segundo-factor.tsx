"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { Button, Card } from "@/components/ui";

/**
 * Segundo factor del operador de la plataforma (ISO 27001, 8.5). Sin él, sus
 * pantallas de empresas cliente, la Torre y el conector de Claude no abren.
 *
 * Se activa en dos pasos —la clave y luego un código— para que nadie quede con
 * un segundo factor que su teléfono no conoce. Los códigos de respaldo se
 * muestran una sola vez.
 */
export function SegundoFactorOperador({ activo, respaldos }: { activo: boolean; respaldos: number }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [alta, setAlta] = useState<{ qr: string; clave: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [nuevos, setNuevos] = useState<string[] | null>(null);
  const [quitando, setQuitando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function llamar(cuerpo: Record<string, string>) {
    setCargando(true);
    setError(null);
    const r = await fetch("/api/account/segundo-factor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    const d = await r.json().catch(() => ({}));
    setCargando(false);
    if (!r.ok) {
      setError(d.error ?? "No se pudo completar. Intente de nuevo.");
      return null;
    }
    return d;
  }

  async function empezar() {
    const d = await llamar({ accion: "empezar", password });
    if (d) { setAlta({ qr: d.qr, clave: d.clave }); setPassword(""); }
  }
  async function confirmar() {
    const d = await llamar({ accion: "confirmar", codigo });
    if (d) { setNuevos(d.respaldos); setAlta(null); setCodigo(""); }
  }
  async function quitar() {
    const d = await llamar({ accion: "quitar", password });
    if (d) { setQuitando(false); setPassword(""); router.refresh(); }
  }

  return (
    <Card>
      <p className="flex items-center gap-2 text-xs font-semibold text-slate-800"><KeyRound className="h-4 w-4" /> Segundo factor</p>
      <p className="mt-1 text-xs text-slate-500">
        {activo && !nuevos
          ? `Activo: al entrar se le pide el código de su aplicación autenticadora. Le quedan ${respaldos} ${respaldos === 1 ? "código" : "códigos"} de respaldo.`
          : "Obligatorio para el operador de la plataforma: entra a los datos de todas las empresas. Además de la contraseña se pide el código que cambia cada 30 segundos en su teléfono."}
      </p>

      {nuevos ? (
        <div className="mt-3 grid gap-2">
          <p className="text-xs font-medium text-slate-800">Listo. Guarde estos códigos de respaldo en un lugar seguro: cada uno sirve una vez si pierde el teléfono y no se vuelven a mostrar.</p>
          <div className="grid grid-cols-2 gap-1 font-mono text-xs">
            {nuevos.map((c) => <span key={c} className="rounded bg-slate-100 px-2 py-1 text-center">{c}</span>)}
          </div>
          <Button onClick={() => { setNuevos(null); router.refresh(); }}>Ya los guardé</Button>
        </div>
      ) : null}

      {!activo && !alta && !nuevos ? (
        <div className="mt-3 grid gap-2">
          <label className="label" htmlFor="sf-password">Su contraseña, para confirmar que es usted</label>
          <input id="sf-password" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button onClick={empezar} disabled={cargando || !password}>
            {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Activar segundo factor
          </Button>
        </div>
      ) : null}

      {alta ? (
        <div className="mt-3 grid gap-3">
          <p className="text-xs text-slate-600">1. Escanee el código con su aplicación autenticadora (Google Authenticator, Authy, 1Password…).</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- imagen generada en el servidor como data: URL */}
          <img src={alta.qr} alt="Código QR para la aplicación autenticadora" width={180} height={180} className="rounded-lg border border-slate-200 bg-white p-2" />
          <p className="text-xs text-slate-600">¿Sin cámara? Escriba esta clave a mano (es de tiempo):</p>
          <code className="select-all rounded bg-slate-100 px-3 py-2 text-sm tracking-wider">{alta.clave}</code>
          <label className="label" htmlFor="sf-codigo">2. El código de 6 dígitos que muestra la aplicación</label>
          <input id="sf-codigo" className="field" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          <Button onClick={confirmar} disabled={cargando || codigo.replace(/\s/g, "").length !== 6}>
            {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Confirmar y activar
          </Button>
        </div>
      ) : null}

      {activo && !nuevos && !quitando ? (
        <button type="button" className="mt-3 text-xs text-slate-500 hover:underline" onClick={() => setQuitando(true)}>Apagar el segundo factor</button>
      ) : null}
      {activo && quitando ? (
        <div className="mt-3 grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-900">Sin segundo factor, sus pantallas de empresas cliente, la Torre de Control y el conector de Claude dejan de abrir hasta que lo vuelva a activar.</p>
          <label className="label" htmlFor="sf-quitar">Su contraseña, para confirmar</label>
          <input id="sf-quitar" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={quitar} disabled={cargando || !password}>Sí, apagarlo</Button>
            <Button variant="secondary" onClick={() => { setQuitando(false); setPassword(""); }}>Cancelar</Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
    </Card>
  );
}
