"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui";

export function NuevoConteo({
  almacenes, familias,
}: {
  almacenes: { id: string; name: string }[];
  familias: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [warehouseId, setWarehouseId] = useState(almacenes[0]?.id ?? "");
  const [familia, setFamilia] = useState("");
  const [incluirEnCero, setIncluirEnCero] = useState(false);
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true); setError(null);
    const res = await fetch("/api/conteos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ warehouseId, familia: familia || null, incluirEnCero, nota: nota || null }),
    });
    const data = await res.json().catch(() => ({}));
    setOcupado(false);
    if (!res.ok) { setError(data.error ?? "No fue posible abrir el conteo"); return; }
    setAbierto(false);
    router.push(`/inventory/conteos/${data.id}`);
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setAbierto(true)}>
        <Plus className="h-3.5 w-3.5" /> Abrir conteo
      </Button>

      {abierto ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 text-left">
          <form onSubmit={crear} className="mt-16 w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-800">Abrir conteo cíclico</h2>
            <p className="mt-0.5 text-[0.6875rem] text-slate-500">
              Se toma una foto de lo que el sistema cree que hay. Contar por familias, unas pocas
              cada semana, funciona mejor que parar el almacén una vez al año.
            </p>

            <div className="mt-3 grid gap-3">
              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Almacén</label>
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                  {almacenes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Alcance</label>
                <select value={familia} onChange={(e) => setFamilia(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                  <option value="">Todo el almacén</option>
                  {familias.map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
                </select>
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={incluirEnCero} onChange={(e) => setIncluirEnCero(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300" />
                <span>
                  Incluir las que el sistema dice que están en cero
                  <span className="block text-[0.625rem] text-slate-500">
                    Sirve para encontrar lo que sí está en el anaquel y el sistema no sabe.
                  </span>
                </span>
              </label>
              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Nota</label>
                <input value={nota} onChange={(e) => setNota(e.target.value)}
                  placeholder="Conteo mensual, quién lo hace…"
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
              </div>
            </div>

            {error ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button type="submit" disabled={ocupado}>
                {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Abrir
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
