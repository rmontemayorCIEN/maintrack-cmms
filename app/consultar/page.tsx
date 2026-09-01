"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";

/**
 * Recuperar el seguimiento cuando se perdio la liga.
 *
 * Va a pasar siempre: la gente cierra el navegador. Se piden folio y celular
 * juntos para que un folio adivinado no baste.
 */
export default function ConsultarPage() {
  const router = useRouter();
  const [folio, setFolio] = useState("");
  const [celular, setCelular] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setBuscando(true); setError(null);
    const res = await fetch("/api/publico", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "RECUPERAR", folio, celular }),
    });
    const data = await res.json().catch(() => ({}));
    setBuscando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible buscar"); return; }
    router.push("/mis-reportes");
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold text-slate-900">Consultar mi reporte</h1>
      <p className="mt-1 text-sm text-slate-600">
        Con el folio que le dimos al enviarlo y el celular con el que lo reportó. Después de esto,
        este dispositivo lo va a recordar y no tendrá que volver a teclearlo.
      </p>

      <form onSubmit={buscar} className="mt-5 grid gap-4">
        <div>
          <label className="text-sm font-medium text-slate-800">Folio</label>
          <input
            value={folio} onChange={(e) => setFolio(e.target.value)} required
            placeholder="SS-000123"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono text-base uppercase"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-800">Su celular</label>
          <input
            type="tel" inputMode="tel" value={celular} onChange={(e) => setCelular(e.target.value)} required
            placeholder="81 1234 5678"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
          />
        </div>

        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{error}</p>
        ) : null}

        <button
          type="submit" disabled={buscando}
          className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-base font-medium text-white disabled:opacity-50"
        >
          {buscando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
          Buscar mi reporte
        </button>
      </form>
    </main>
  );
}
