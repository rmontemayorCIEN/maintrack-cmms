"use client";

import { useState } from "react";
import { CLAVES_INSTALACION, INSTALACIONES } from "@/lib/instalaciones";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui";

export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    organizationName: "",
    industry: "Manufactura",
    tipoInstalacion: "PLANTA",
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "No fue posible crear la cuenta");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="w-full max-w-md">
      <div className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white">
          <Wrench className="h-5 w-5" />
        </span>
        MainTrack CMMS
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Cree su espacio de trabajo</h1>
      <p className="mt-1 text-sm text-slate-500">
        Se creara una organización independiente con su usuario como propietario. Prueba de 30 días.
      </p>

      <form onSubmit={submit} className="mt-6 grid gap-4">
        <div>
          <label className="label">Nombre de la empresa</label>
          <input className="field" value={form.organizationName} onChange={(e) => set("organizationName", e.target.value)} required />
        </div>
        <div>
          <label className="label">Giro</label>
          <select className="field" value={form.industry} onChange={(e) => set("industry", e.target.value)}>
            {["Manufactura", "Alimentos y bebidas", "Automotriz", "Mineria", "Energia", "Logistica", "Inmobiliario", "Salud", "Otro"].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Tipo de instalación</label>
          <select className="field" value={form.tipoInstalacion} onChange={(e) => set("tipoInstalacion", e.target.value)}>
            {CLAVES_INSTALACION.map((c) => (
              <option key={c} value={c}>{INSTALACIONES[c].nombre}</option>
            ))}
          </select>
          <p className="mt-1 text-[0.6875rem] text-slate-500">
            Con esto el sistema adapta sus ejemplos y sugerencias a lo que usted mantiene.
          </p>
        </div>
        <div>
          <label className="label">Su nombre</label>
          <input className="field" value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </div>
        <div>
          <label className="label">Correo corporativo</label>
          <input className="field" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
        </div>
        <div>
          <label className="label">Contraseña (min. 8 caracteres)</label>
          <input className="field" type="password" minLength={8} value={form.password} onChange={(e) => set("password", e.target.value)} required />
        </div>
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Crear cuenta
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-slate-500">
        ¿Ya tiene cuenta?{" "}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">Inicie sesión</Link>
      </p>
    </div>
  );
}
