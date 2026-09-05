"use client";

/**
 * A que actividad de la orden se le carga un gasto.
 *
 * Vive aparte porque lo usan los tres paneles de captura —mano de obra,
 * refacciones y servicios— y el criterio tiene que ser el mismo en los tres.
 *
 * Se oculta solo cuando la orden trae una sola actividad o ninguna: ahi no hay
 * nada que elegir, y un desplegable con una sola opcion es ruido. Con varias,
 * elegir es lo que permite saber despues cuanto costo cada falla.
 */
export type ActividadCargable = {
  id: string;
  title: string;
  /** PREVENTIVE, CORRECTIVE, etc. Para distinguir de un vistazo. */
  maintenanceType: string;
};

export function SelectActividad({
  actividades,
  valor,
  onChange,
  etiqueta = "Cargar a",
}: {
  actividades: ActividadCargable[];
  valor: string;
  onChange: (v: string) => void;
  etiqueta?: string;
}) {
  if (actividades.length < 2) return null;

  return (
    <div>
      <label className="label">{etiqueta}</label>
      <select className="field" value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Gasto general de la orden</option>
        {actividades.map((a) => (
          <option key={a.id} value={a.id}>
            {a.title}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[0.6875rem] text-slate-500">
        Dejarlo en general esta bien para lo que no es de una actividad en particular,
        como el viaje o la grua.
      </p>
    </div>
  );
}
