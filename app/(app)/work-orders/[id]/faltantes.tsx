import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { FaltanteDeCierre, SeccionDeOrden } from "@/lib/reglas-ot";

/**
 * Lo que le falta a la orden para poder cerrarse, dicho al principio.
 *
 * ── Por que existe ──
 *
 * El sistema ya sabia todo esto: `faltantesDeCierre` lo calcula desde siempre y
 * redacta cada punto para que una persona lo entienda. Pero solo aparecia
 * DESPUES de intentar completar la orden, como un rechazo. El tecnico
 * terminaba el trabajo, picaba el boton, y ahi se enteraba de que le faltaban
 * las horas y una foto —muchas veces ya lejos del equipo—.
 *
 * Aqui se muestra desde que la orden se inicia, que es cuando sirve: deja de
 * ser un regaño al final y se vuelve la lista de pendientes del trabajo.
 *
 * ── Por que no aparece antes de iniciar ──
 *
 * Una orden que nadie ha empezado no «le falta» nada: no se han registrado
 * horas porque no se ha trabajado. Enseñar la lista ahi convertia la pantalla
 * en una regañina de entrada, y a la tercera vez nadie la lee.
 */

/**
 * La misma seccion tiene ancla distinta en telefono y en computadora: el
 * Resultado vive en la columna principal en pantallas chicas y en la lateral
 * en grandes, y dos elementos no pueden compartir identificador. Se pintan los
 * dos enlaces y el CSS deja ver el que corresponde; el oculto se marca para
 * que un lector de pantalla no lea cada punto dos veces.
 */
const ANCLA_ESCRITORIO: Partial<Record<SeccionDeOrden, string>> = { resultado: "resultado" };
const ANCLA_MOVIL: Partial<Record<SeccionDeOrden, string>> = { resultado: "resultado-movil" };

export function FaltaParaCerrar({ faltantes }: { faltantes: FaltanteDeCierre[] }) {
  if (!faltantes.length) {
    return (
      <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 no-print">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>No falta nada para cerrar esta orden. Lo esencial ya está registrado.</span>
      </div>
    );
  }
  return (
    <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 no-print">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {faltantes.length === 1 ? "Falta una cosa para poder cerrar:" : `Faltan ${faltantes.length} cosas para poder cerrar:`}
      </p>
      <ul className="mt-1 grid gap-1 pl-6">
        {faltantes.map((f) => (
          <li key={f.texto} className="list-disc">
            <a href={`#${ANCLA_MOVIL[f.seccion] ?? f.seccion}`} className="underline underline-offset-2 hover:no-underline lg:hidden">
              {f.texto}
            </a>
            <a href={`#${ANCLA_ESCRITORIO[f.seccion] ?? f.seccion}`} aria-hidden className="hidden underline underline-offset-2 hover:no-underline lg:inline">
              {f.texto}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
