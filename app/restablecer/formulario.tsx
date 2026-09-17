"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function FormularioRestablecer({ token }: { token: string }) {
  const router = useRouter();
  const [clave, setClave] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [listo, setListo] = useState(false);

  async function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (clave !== repetida) return setError("Las dos contraseñas no coinciden.");
    if (clave.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    setGuardando(true);
    try {
      const r = await fetch("/api/auth/restablecer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: clave }),
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(datos.error ?? "No se pudo guardar la contraseña.");
        return;
      }
      setListo(true);
      setTimeout(() => router.push("/login"), 1800);
    } catch {
      setError("No se pudo conectar. Revise su conexión e intente de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  if (listo) {
    return (
      <p className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">
        Contraseña actualizada. Lo llevamos a la pantalla de acceso…
      </p>
    );
  }

  return (
    <form onSubmit={guardar} className="grid gap-3">
      <label className="grid gap-1 text-xs text-slate-600">
        Contraseña nueva
        <input className="field" type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" required />
      </label>
      <label className="grid gap-1 text-xs text-slate-600">
        Repítala
        <input className="field" type="password" value={repetida} onChange={(e) => setRepetida(e.target.value)} autoComplete="new-password" required />
      </label>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      <Button type="submit" disabled={guardando}>{guardando ? "Guardando…" : "Guardar contraseña"}</Button>
    </form>
  );
}
