"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS } from "@/lib/constants";

export function UserRowActions({
  userId,
  active,
  role,
}: {
  userId: string;
  active: boolean;
  role: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

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
    </div>
  );
}
