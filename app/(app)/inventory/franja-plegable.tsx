"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * La franja del almacen, que se puede plegar.
 *
 * Quien entra a buscar una clave concreta no quiere el panorama encima cada
 * vez: quiere la tabla. Y quien entra a ver como esta el almacen si lo quiere.
 * En vez de elegir por los dos, se pliega y se recuerda.
 *
 * La preferencia vive en el navegador de cada quien —igual que el ultimo mapa
 * de conjuntos— porque es una comodidad personal, no un dato de la empresa:
 * no tiene por que viajar a la base ni ser igual para todos. Se lee dentro de
 * un `try` porque en una ventana privada, o con el almacenamiento bloqueado,
 * `localStorage` truena al tocarlo.
 *
 * Arranca SIEMPRE desplegada aunque la preferencia diga lo contrario, y se
 * pliega despues de leerla. Si arrancara plegada, quien no tenga
 * almacenamiento veria la franja desaparecer y aparecer en cada carga.
 */
const CLAVE = "maintrack:franja-almacen-plegada";

export function FranjaPlegable({ children, resumen }: { children: React.ReactNode; resumen: string }) {
  const [plegada, setPlegada] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(CLAVE) === "1") setPlegada(true);
    } catch { /* sin almacenamiento: se queda desplegada */ }
  }, []);

  function alternar() {
    const siguiente = !plegada;
    setPlegada(siguiente);
    try {
      if (siguiente) localStorage.setItem(CLAVE, "1");
      else localStorage.removeItem(CLAVE);
    } catch { /* no se pudo recordar; al menos se pliega ahora */ }
  }

  return (
    <div className="mb-5">
      {plegada ? (
        // Plegada NO quiere decir muda: se sigue diciendo lo esencial en una
        // linea, porque esconder por completo lo que necesita atencion es
        // justo lo que la franja vino a evitar.
        <button
          type="button"
          onClick={alternar}
          aria-expanded={false}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left hover:bg-slate-50"
        >
          <span className="min-w-0 truncate text-xs text-slate-600">{resumen}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-700">
            Ver el almacén <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </span>
        </button>
      ) : (
        // El boton va DEBAJO y en el flujo, no encima de la franja.
        //
        // Flotaba con `absolute` sobre la esquina y quedaba tapado por el
        // primer renglon, que es un enlace que ocupa todo su ancho: al tocarlo
        // se abria esa familia en vez de plegar. Por codigo funcionaba —de ahi
        // que pareciera bien— y con el dedo no. Encima de una lista de enlaces
        // no se pone nada.
        <div>
          {children}
          {/* Sin margen negativo: subirlo lo metia debajo de la leyenda de la
              franja y volvia a quedar intocable, que era el mismo defecto con
              otra cara. */}
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={alternar}
              aria-expanded
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              Ocultar el almacén <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
