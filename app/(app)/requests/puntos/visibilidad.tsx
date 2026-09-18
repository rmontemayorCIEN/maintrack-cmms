"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2 } from "lucide-react";

/**
 * Que enseña este QR a quien lo escanea.
 *
 * Un codigo pegado en un pasillo lo lee cualquiera: el repartidor, la visita,
 * quien pase por la banqueta. Por eso lo normal es que muestre lo minimo para
 * ubicar el reporte —el nombre del punto y la clave del equipo— y que el nombre
 * de la empresa, el de la planta y el del equipo completo se enciendan a
 * proposito, uno por uno, cuando la empresa decide que no le importa.
 */
export function VisibilidadDelPunto({
  puntoId,
  inicial,
  editable,
}: {
  puntoId: string;
  inicial: { mostrarEmpresa: boolean; mostrarPlanta: boolean; mostrarEquipo: boolean };
  editable: boolean;
}) {
  const router = useRouter();
  const [valores, setValores] = useState(inicial);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const OPCIONES: Array<[keyof typeof inicial, string]> = [
    ["mostrarEmpresa", "El nombre de la empresa"],
    ["mostrarPlanta", "La planta y la ubicación"],
    ["mostrarEquipo", "El nombre completo del equipo"],
  ];

  async function cambiar(campo: keyof typeof inicial, valor: boolean) {
    setGuardando(campo);
    setError(null);
    const previos = valores;
    setValores({ ...valores, [campo]: valor });
    try {
      const r = await fetch(`/api/puntos-reporte/${puntoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [campo]: valor }),
      });
      if (!r.ok) {
        setValores(previos);
        setError("No se pudo guardar. Intente de nuevo.");
        return;
      }
      router.refresh();
    } catch {
      setValores(previos);
      setError("No se pudo conectar.");
    } finally {
      setGuardando(null);
    }
  }

  const encendidas = OPCIONES.filter(([k]) => valores[k]).length;

  return (
    <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-2">
      <summary className="flex cursor-pointer items-center gap-1.5 text-[0.6875rem] text-slate-600">
        <Eye className="h-3.5 w-3.5 text-slate-400" />
        Qué muestra al escanear
        <span className="ml-auto text-slate-400">
          {encendidas === 0 ? "Solo lo mínimo" : `${encendidas} dato(s) más`}
        </span>
      </summary>
      <div className="mt-2 grid gap-1.5">
        {OPCIONES.map(([campo, titulo]) => (
          <label key={campo} className="flex items-center gap-2 text-[0.6875rem] text-slate-600">
            <input
              type="checkbox"
              checked={valores[campo]}
              disabled={!editable || guardando !== null}
              onChange={(e) => cambiar(campo, e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300"
            />
            {titulo}
            {guardando === campo ? <Loader2 className="h-3 w-3 animate-spin text-slate-400" /> : null}
          </label>
        ))}
        <p className="mt-1 text-[0.625rem] leading-relaxed text-slate-500">
          Apagado, el reporte sigue llegando con su equipo, su área y su planta: eso se guarda
          igual. Lo que cambia es lo que se le enseña a quien escanea.
        </p>
        {error ? <p className="text-[0.625rem] text-rose-600">{error}</p> : null}
      </div>
    </details>
  );
}
