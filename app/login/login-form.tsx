"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity, Loader2, ShieldCheck, TrendingUp, Wrench } from "lucide-react";
import { Button } from "@/components/ui";

const DEMO = [
  { email: "director@aceroindustrial.mx", role: "Propietario / Dirección" },
  { email: "supervisor@aceroindustrial.mx", role: "Supervisor de mantenimiento" },
  { email: "tecnico@aceroindustrial.mx", role: "Tecnico" },
];

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("director@aceroindustrial.mx");
  const [password, setPassword] = useState("demo1234");
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
    router.push("/dashboard");
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
            MainTrack CMMS
          </div>
          <p className="mt-10 max-w-md text-3xl font-semibold leading-tight">
            Mantenimiento preventivo, correctivo y predictivo en una sola plataforma.
          </p>
          <p className="mt-4 max-w-md text-sm text-slate-300">
            Programe planes por calendario o por medidor, controle el backlog de fallas y
            anticipe averias con monitoreo de condicion y proyeccion de vida util.
          </p>
        </div>
        <div className="relative grid gap-4 text-sm text-slate-300">
          <Feature icon={<Activity className="h-4 w-4" />} text="Indicadores MTTR, MTBF, disponibilidad y cumplimiento de PM" />
          <Feature icon={<TrendingUp className="h-4 w-4" />} text="Alertas predictivas con tendencia y fecha estimada de falla" />
          <Feature icon={<ShieldCheck className="h-4 w-4" />} text="Multiempresa, roles, bitácora de auditoria y API REST" />
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 text-lg font-semibold text-slate-900 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white">
              <Wrench className="h-5 w-5" />
            </span>
            MainTrack CMMS
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Iniciar sesion</h1>
          <p className="mt-1 text-sm text-slate-500">Acceda a su espacio de trabajo.</p>

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

          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold text-slate-700">Cuentas de demostracion</p>
            <p className="mt-1 text-[0.6875rem] text-slate-500">Contraseña para todas: <code className="rounded bg-slate-100 px-1">demo1234</code></p>
            <div className="mt-3 grid gap-1.5">
              {DEMO.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => { setEmail(account.email); setPassword("demo1234"); }}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-1.5 text-left text-[0.6875rem] hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-700">{account.email}</span>
                  <span className="text-slate-400">{account.role}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            ¿Nueva empresa?{" "}
            <Link href="/register" className="font-medium text-brand-600 hover:underline">
              Cree su espacio de trabajo
            </Link>
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
