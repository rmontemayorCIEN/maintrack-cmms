"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

/** Deja de recordar este celular en este dispositivo. */
export function Olvidarme() {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  return (
    <button
      type="button"
      disabled={saliendo}
      onClick={async () => {
        setSaliendo(true);
        await fetch("/api/publico/olvidar", { method: "POST" });
        router.push("/consultar");
      }}
      className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
    >
      <LogOut className="mr-1 inline h-3 w-3" /> Olvidar
    </button>
  );
}
