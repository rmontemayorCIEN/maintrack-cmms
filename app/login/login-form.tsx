"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity, Loader2, ShieldCheck, TrendingUp, Wrench } from "lucide-react";
import { Button } from "@/components/ui";
import { LEMA, MARCA, SUBLEMA, TEXTO_PRUEBA } from "@/lib/comercial";

/**
 * La pantalla de acceso no anuncia cuentas ni prellena credenciales.
 *
 * Antes traia tres correos de demostracion y su contrasena escrita a la vista.
 * Aunque esas cuentas no existan, una pantalla de acceso que publica una clave
 * es lo primero que mira quien evalua el sistema, y ademas obligaba a todo
 * usuario real a borrar dos campos antes de poder entrar.
 *
 * Al sistema entra solo quien fue dado de alta desde Configuracion.
 */
export function LoginForm({ permiteAlta = false, destino = "/dashboard" }: { permiteAlta?: boolean; destino?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "No fue posible iniciar sesión");
      return;
    }
    router.push(destino);
    router.refresh();
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-slate-900 p-12 text-white lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_20%_10%,rgba(52,93,249,0.35),transparent)]" />
        <div className="relative">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600">
              <Wrench className="h-5 w-5" />
            </span>
            {MARCA}
          </div>
          <p className="mt-10 max-w-md text-3xl font-semibold leading-tight">{LEMA}</p>
          <p className="mt-4 max-w-md text-sm text-slate-300">{SUBLEMA}</p>
        </div>
        <div className="relative grid gap-4 text-sm text-slate-300">
          <Feature icon={<Activity className="h-4 w-4" />} text="Disponibilidad, cumplimiento preventivo y costo por equipo, al día" />
          <Feature icon={<TrendingUp className="h-4 w-4" />} text="Alertas por tendencia antes de que el equipo falle" />
          <Feature icon={<ShieldCheck className="h-4 w-4" />} text="Cada rol ve lo suyo; cada empresa, solo su información" />
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 text-lg font-semibold text-slate-900 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white">
              <Wrench className="h-5 w-5" />
            </span>
            {MARCA}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Iniciar sesión</h1>
          <p className="mt-1 text-sm text-slate-500">Entre con el correo y la contraseña que le dio su empresa.</p>

          <form onSubmit={submit} className="mt-6 grid gap-4">
            <div>
              <label className="label" htmlFor="email">Correo</label>
              <input
                id="email"
                className="field"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">Contraseña</label>
              <input
                id="password"
                className="field"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
            ) : null}
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Entrar
            </Button>
          </form>

          {/*
            El alta publica esta apagada salvo que la instancia la habilite.
            Invitar a registrarse cuando el servidor lo va a rechazar manda a la
            persona a llenar un formulario que termina en error.
          */}
          <p className="mt-6 text-center text-xs text-slate-500">
            ¿Aún no usa {MARCA}?{" "}
            <Link href="/#demostracion" className="font-medium text-brand-600 hover:underline">Solicite una demostración</Link>
            {" "}o{" "}<Link href="/contratar" className="font-medium text-brand-600 hover:underline">{permiteAlta ? `pruébelo ${TEXTO_PRUEBA}` : "solicite su contratación"}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10">{icon}</span>
      {text}
    </div>
  );
}
