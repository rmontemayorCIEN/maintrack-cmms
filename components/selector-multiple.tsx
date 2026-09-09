"use client";

import { X } from "lucide-react";
import { SelectorBuscable, type OpcionBuscable } from "./selector-buscable";

/**
 * Escoger varios de una lista larga.
 *
 * Fichas arriba con lo ya elegido y abajo el desplegable buscable, que al
 * escoger agrega y se vacia. Con doscientos equipos, una lista de casillas
 * obliga a recorrerla entera; escribiendo "bomba" quedan tres.
 *
 * Vive aparte porque esta misma combinacion ya estaba escrita a mano en
 * plans/equipos-del-plan.tsx y ahora la necesitan los conjuntos. Copiarla
 * habria sido la segunda copia, y la segunda copia es la que se desincroniza.
 */
export function SelectorMultiple({
  valores,
  onCambio,
  opciones,
  marcador = "Busque por clave o nombre",
  vacio = "Agregar",
  deshabilitado,
  /** Que decir cuando no hay nada elegido. Null no dice nada. */
  sinNada = null,
}: {
  valores: string[];
  onCambio: (ids: string[]) => void;
  opciones: OpcionBuscable[];
  marcador?: string;
  vacio?: string;
  deshabilitado?: boolean;
  sinNada?: string | null;
}) {
  const elegidas = valores
    .map((id) => opciones.find((o) => o.id === id))
    .filter((o): o is OpcionBuscable => Boolean(o));

  // Lo ya elegido sale del desplegable: ofrecerlo otra vez invita a un clic
  // que no hace nada, y quien lo intenta cree que la pantalla se trabo.
  const disponibles = opciones.filter((o) => !valores.includes(o.id));

  return (
    <div className="grid gap-2">
      {elegidas.length ? (
        <div className="flex flex-wrap gap-1.5">
          {elegidas.map((o) => (
            <span
              key={o.id}
              className="inline-flex max-w-full items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700"
            >
              <span className="truncate">{o.etiqueta}</span>
              <button
                type="button"
                disabled={deshabilitado}
                onClick={() => onCambio(valores.filter((v) => v !== o.id))}
                aria-label={`Quitar ${o.etiqueta}`}
                className="shrink-0 rounded hover:bg-brand-100 disabled:opacity-40"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : sinNada ? (
        <p className="text-xs text-slate-400">{sinNada}</p>
      ) : null}

      <SelectorBuscable
        valor=""
        onCambio={(id) => { if (id) onCambio([...valores, id]); }}
        opciones={disponibles}
        vacio={vacio}
        marcador={marcador}
        deshabilitado={deshabilitado || disponibles.length === 0}
      />
    </div>
  );
}
