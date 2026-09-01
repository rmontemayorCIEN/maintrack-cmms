"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/constants";

export function UserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "TECHNICIAN",
    jobTitle: "",
    hourlyRate: "0",
    phone: "",
  });

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, hourlyRate: Number(form.hourlyRate) }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "No fue posible crear el usuario");
      return;
    }
    setOpen(false);
    setForm({ name: "", email: "", password: "", role: "TECHNICIAN", jobTitle: "", hourlyRate: "0", phone: "" });
    router.refresh();
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Agregar usuario
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Nuevo usuario</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              La tarifa por hora se usa para costear la mano de obra en las ordenes.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Nombre completo</label>
            <input className="field" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div>
            <label className="label">Correo</label>
            <input type="email" className="field" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          </div>
          <div>
            <label className="label">Contraseña temporal</label>
            <input type="text" minLength={8} className="field" value={form.password} onChange={(e) => set("password", e.target.value)} required />
          </div>
          <div>
            <label className="label">Rol</label>
            <select className="field" value={form.role} onChange={(e) => set("role", e.target.value)}>
              {["ADMIN", "SUPERVISOR", "TECHNICIAN", "REQUESTER", "VIEWER"].map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Puesto</label>
            <input className="field" value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
          </div>
          <div>
            <label className="label">Tarifa por hora</label>
            <input type="number" min="0" className="field" value={form.hourlyRate} onChange={(e) => set("hourlyRate", e.target.value)} />
          </div>
          <div>
            <label className="label">Telefono</label>
            <input className="field" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Crear usuario
          </Button>
        </div>
      </form>
    </div>
  );
}
