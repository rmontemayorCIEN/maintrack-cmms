"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui";
import { Dialogo } from "@/components/ui/dialogo";
import { TIPOS_MEDIDOR as TIPOS } from "@/lib/constants";

/** Tipo del medidor y uso maximo por dia: de aqui sale que lectura es atipica. */
export function ConfigMedidor({
  meterId,
  unit,
  tipo,
  maxIncrementoDiario,
}: {
  meterId: string;
  unit: string;
  tipo: string;
  maxIncrementoDiario: number | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [t, setT] = useState(tipo);
  const [max, setMax] = useState(maxIncrementoDiario === null ? "" : String(maxIncrementoDiario));
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    const res = await fetch(`/api/meters/${meterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: t, maxIncrementoDiario: max === "" ? null : Number(max) }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "No fue posible guardar");
      return;
    }
    setAbierto(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1 text-[0.6875rem] text-slate-500 hover:text-brand-600"
      >
        <Settings2 className="h-3 w-3" /> {TIPOS[tipo as keyof typeof TIPOS] ?? tipo}
        {maxIncrementoDiario ? ` · máx. ${maxIncrementoDiario} ${unit}/día` : ""}
      </button>
      {abierto ? (
        <Dialogo
          titulo="Validación de lecturas"
          descripcion="Un horómetro nunca acepta más horas que las transcurridas. El máximo diario marca como atípica cualquier lectura que lo supere: se acepta solo con justificación."
          onCerrar={() => setAbierto(false)}
          ancho="sm"
          onSubmit={(e) => {
            e.preventDefault();
            void guardar();
          }}
        >
          <div className="grid gap-3">
            <div>
              <label className="label">Tipo de medidor</label>
              <select className="field" value={t} onChange={(e) => setT(e.target.value)}>
                {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Uso máximo por día ({unit}) — vacío: sin límite</label>
              <input type="number" step="any" min={0} className="field" value={max} onChange={(e) => setMax(e.target.value)} />
            </div>
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button type="submit" size="sm">Guardar</Button>
            </div>
          </div>
        </Dialogo>
      ) : null}
    </>
  );
}
