"use client";

import type { FormEvent, ReactNode } from "react";
import { X } from "lucide-react";

/**
 * La ventana que se abre encima de la pantalla.
 *
 * Vive en un solo lugar porque el mismo armazon estaba copiado en 21 pantallas
 * y en 12 de ellas quedo mal. El error no se ve hasta que el contenido crece:
 *
 *   - centrada sin deslizar (`grid place-items-center` y nada mas) es la peor.
 *     Mientras la ventana cabe se ve perfecta; cuando no cabe se desborda por
 *     ARRIBA y por ABAJO en partes iguales, y como el desplazamiento no puede
 *     ser negativo, no hay forma de alcanzar ninguno de los dos extremos. En
 *     el cierre tecnico de una orden con varias actividades correctivas eso
 *     dejaba el boton de completar fuera del alcance: la orden no se podia
 *     cerrar y nada en pantalla explicaba por que.
 *   - centrada Y deslizable se ve arreglada pero solo salva el extremo de
 *     abajo; el de arriba se sigue perdiendo.
 *
 * Lo que si funciona es esto: el fondo desliza, y adentro un contenedor de
 * altura minima completa centra por flex. Cuando la ventana cabe queda
 * centrada; cuando no cabe, se recorre desde arriba sin cortar nada.
 *
 * Con `pie`, ademas, el encabezado y los botones se quedan fijos y solo se
 * desliza el contenido. Es para formas largas: tener «Completar orden»
 * siempre a la vista evita recorrer toda la forma para encontrarlo.
 */

const ANCHOS = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-xl",
  xl: "max-w-2xl",
  xxl: "max-w-4xl",
} as const;

export function Dialogo({
  titulo,
  descripcion,
  onCerrar,
  ancho = "md",
  onSubmit,
  pie,
  children,
}: {
  titulo: ReactNode;
  descripcion?: ReactNode;
  onCerrar?: () => void;
  ancho?: keyof typeof ANCHOS;
  /** Si se da, el armazon es un <form> y no un <div>. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  /** Botones de accion. Al darlos, quedan fijos abajo y el cuerpo se desliza. */
  pie?: ReactNode;
  children: ReactNode;
}) {
  const encabezado = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-slate-900">{titulo}</h3>
        {descripcion ? <p className="mt-0.5 text-xs text-slate-500">{descripcion}</p> : null}
      </div>
      {onCerrar ? (
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );

  const cuerpo = pie ? (
    <>
      <div className="shrink-0 border-b border-slate-100 px-4 pb-4 pt-5 sm:px-6 sm:pt-6">{encabezado}</div>
      {/* min-h-0: sin esto el hijo de un flex no se encoge y el deslizamiento nunca ocurre. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
      <div className="shrink-0 border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4">{pie}</div>
    </>
  ) : (
    <div className="p-4 sm:p-6">
      <div className="mb-5">{encabezado}</div>
      {children}
    </div>
  );

  const clases = `w-full ${ANCHOS[ancho]} rounded-2xl bg-white shadow-xl${
    pie ? " flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden sm:max-h-[calc(100dvh-2rem)]" : ""
  }`;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-slate-900/40" role="dialog" aria-modal="true">
      <div className="flex min-h-full items-center justify-center p-2 sm:p-4">
        {onSubmit ? (
          <form onSubmit={onSubmit} className={clases}>
            {cuerpo}
          </form>
        ) : (
          <div className={clases}>{cuerpo}</div>
        )}
      </div>
    </div>
  );
}
