"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { ROLE_LABELS } from "@/lib/constants";

export function UserRowActions({
  userId,
  userName,
  active,
  role,
}: {
  userId: string;
  userName: string;
  active: boolean;
  role: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reponiendo, setReponiendo] = useState(false);
  const [clave, setClave] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reponerClave() {
    setBusy(true);
    setError(null);
    setAviso(null);
    const res = await fetch(`/api/users/${userId}/clave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nuevaClave: clave }),
    });
    const datos = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(datos.error ?? "No fue posible reponer la contraseña");
      return;
    }
    setClave("");
    setReponiendo(false);
    setAviso(`Lista. Entréguesela a ${userName.split(" ")[0]} y pídale que la cambie desde «Mi cuenta».`);
    router.refresh();
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="grid justify-items-end gap-1.5">
      <div className="flex items-center justify-end gap-1.5">
      <select
        value={role}
        disabled={busy}
        onChange={(e) => patch({ role: e.target.value })}
        className="field max-w-32 px-1.5 py-1 text-[0.6875rem]"
      >
        {["ADMIN", "SUPERVISOR", "TECHNICIAN", "REQUESTER", "VIEWER"].map((option) => (
          <option key={option} value={option}>{ROLE_LABELS[option]}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy}
        onClick={() => patch({ active: !active })}
        className="rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] text-slate-600 hover:bg-slate-50"
      >
        {active ? "Desactivar" : "Activar"}
      </button>
      {/*
        Al propietario no se le repone la contraseña desde aqui: podria dejarlo
        fuera de su propia empresa. El la cambia en «Mi cuenta».
      */}
      {role !== "OWNER" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => { setReponiendo((v) => !v); setAviso(null); setError(null); }}
          title="Reponer contraseña"
          aria-label={`Reponer la contraseña de ${userName}`}
          className="rounded-lg border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        >
          <KeyRound className="h-3.5 w-3.5" />
        </button>
      ) : null}
      </div>

      {reponiendo ? (
        <div className="grid w-full max-w-72 gap-1.5 rounded-lg border border-slate-200 bg-slate-50/60 p-2">
          <label className="text-[0.6875rem] font-medium text-slate-700">
            Contraseña nueva para {userName}
          </label>
          <input
            type="text"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            minLength={8}
            placeholder="Al menos 8 caracteres"
            className="field px-2 py-1 text-[0.6875rem]"
          />
          {/*
            Se muestra en claro a proposito: quien la repone tiene que poder
            leersela a la persona. Ocultarla con puntitos obligaria a escribirla
            dos veces a ciegas y a dictar algo que no se ve.
          */}
          <p className="text-[0.625rem] leading-relaxed text-slate-500">
            Queda registrado en la bitácora quién la repuso y a quién, nunca cuál fue.
            Dígasela en persona y pídale que la cambie al entrar.
          </p>
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => { setReponiendo(false); setClave(""); setError(null); }}
              className="rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] text-slate-600 hover:bg-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy || clave.trim().length < 8}
              onClick={reponerClave}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-1 text-[0.6875rem] font-medium text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Reponer
            </button>
          </div>
          {error ? <p className="text-[0.625rem] text-red-600">{error}</p> : null}
        </div>
      ) : null}

      {aviso ? <p className="text-[0.625rem] text-emerald-700">{aviso}</p> : null}
    </div>
  );
}
