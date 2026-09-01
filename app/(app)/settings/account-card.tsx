"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, UserCog } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/constants";

type Aviso = { tipo: "ok" | "error"; texto: string } | null;

export function AccountCard({
  usuario,
}: {
  usuario: { name: string; email: string; role: string; phone: string | null; jobTitle: string | null };
}) {
  const router = useRouter();

  const [perfil, setPerfil] = useState({
    name: usuario.name,
    email: usuario.email,
    phone: usuario.phone ?? "",
    jobTitle: usuario.jobTitle ?? "",
  });
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);
  const [avisoPerfil, setAvisoPerfil] = useState<Aviso>(null);

  const [claves, setClaves] = useState({ actual: "", nueva: "", repetir: "" });
  const [guardandoClave, setGuardandoClave] = useState(false);
  const [avisoClave, setAvisoClave] = useState<Aviso>(null);

  async function guardarPerfil(event: React.FormEvent) {
    event.preventDefault();
    setGuardandoPerfil(true);
    setAvisoPerfil(null);
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: perfil.name,
        email: perfil.email,
        phone: perfil.phone || null,
        jobTitle: perfil.jobTitle || null,
      }),
    });
    const data = await res.json();
    setGuardandoPerfil(false);
    if (!res.ok) {
      setAvisoPerfil({ tipo: "error", texto: data.error ?? "No fue posible guardar" });
      return;
    }
    setAvisoPerfil({ tipo: "ok", texto: "Datos actualizados. Su proximo acceso usa el correo nuevo." });
    router.refresh();
  }

  async function cambiarClave(event: React.FormEvent) {
    event.preventDefault();
    if (claves.nueva !== claves.repetir) {
      setAvisoClave({ tipo: "error", texto: "La contraseña nueva y su repeticion no coinciden" });
      return;
    }
    setGuardandoClave(true);
    setAvisoClave(null);
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: claves.actual, newPassword: claves.nueva }),
    });
    const data = await res.json();
    setGuardandoClave(false);
    if (!res.ok) {
      setAvisoClave({ tipo: "error", texto: data.error ?? "No fue posible cambiar la contraseña" });
      return;
    }
    setClaves({ actual: "", nueva: "", repetir: "" });
    setAvisoClave({ tipo: "ok", texto: "Contraseña cambiada. Usela en su proximo acceso." });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <UserCog className="h-4 w-4 text-slate-400" /> Mi cuenta
            </span>
          }
          subtitle={`Datos con los que entra al sistema · ${ROLE_LABELS[usuario.role] ?? usuario.role}`}
        />
        <form onSubmit={guardarPerfil} className="grid gap-4">
          <div>
            <label className="label">Nombre</label>
            <input className="field" value={perfil.name} onChange={(e) => setPerfil((p) => ({ ...p, name: e.target.value }))} required minLength={2} />
          </div>
          <div>
            <label className="label">Correo de acceso</label>
            <input className="field" type="email" value={perfil.email} onChange={(e) => setPerfil((p) => ({ ...p, email: e.target.value }))} required />
            <p className="mt-1 text-[0.6875rem] text-slate-500">Es su usuario para iniciar sesion.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Puesto</label>
              <input className="field" value={perfil.jobTitle} onChange={(e) => setPerfil((p) => ({ ...p, jobTitle: e.target.value }))} />
            </div>
            <div>
              <label className="label">Telefono</label>
              <input className="field" value={perfil.phone} onChange={(e) => setPerfil((p) => ({ ...p, phone: e.target.value }))} />
            </div>
          </div>
          {avisoPerfil ? (
            <p className={avisoPerfil.tipo === "ok"
              ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
              : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"}>
              {avisoPerfil.texto}
            </p>
          ) : null}
          <div>
            <Button type="submit" size="sm" disabled={guardandoPerfil}>
              {guardandoPerfil ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Guardar datos
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-slate-400" /> Cambiar contraseña
            </span>
          }
          subtitle="Se pide la actual para evitar que alguien con su sesion abierta lo deje fuera"
        />
        <form onSubmit={cambiarClave} className="grid gap-4">
          <div>
            <label className="label">Contraseña actual</label>
            <input className="field" type="password" autoComplete="current-password" value={claves.actual} onChange={(e) => setClaves((c) => ({ ...c, actual: e.target.value }))} required />
          </div>
          <div>
            <label className="label">Contraseña nueva (min. 8 caracteres)</label>
            <input className="field" type="password" autoComplete="new-password" minLength={8} value={claves.nueva} onChange={(e) => setClaves((c) => ({ ...c, nueva: e.target.value }))} required />
          </div>
          <div>
            <label className="label">Repita la nueva</label>
            <input className="field" type="password" autoComplete="new-password" minLength={8} value={claves.repetir} onChange={(e) => setClaves((c) => ({ ...c, repetir: e.target.value }))} required />
          </div>
          {avisoClave ? (
            <p className={avisoClave.tipo === "ok"
              ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
              : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"}>
              {avisoClave.texto}
            </p>
          ) : null}
          <div>
            <Button type="submit" size="sm" disabled={guardandoClave}>
              {guardandoClave ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Cambiar contraseña
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
