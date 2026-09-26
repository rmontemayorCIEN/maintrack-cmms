import Link from "next/link";
import { Badge } from "@/components/ui";
import { MAINTENANCE_TYPE_COLORS, MAINTENANCE_TYPE_LABELS, PRIORITY_COLORS, PRIORITY_LABELS, WO_STATUS_COLORS, WO_STATUS_LABELS } from "@/lib/constants";
import { AlertTriangle, Check, MapPin, ShieldAlert } from "lucide-react";

/**
 * Lo primero que ve quien ejecuta la orden desde el teléfono: qué, dónde,
 * para cuándo, qué tan urgente, los riesgos, y cuánto lleva. En computadora
 * esto ya está en la columna de la derecha, así que aquí solo se muestra en
 * pantallas angostas.
 */
export function FichaDeEjecucion(p: {
  estado: string; prioridad: string; tipo: string; aceptada: string | null;
  compromiso: string | null; vencida: boolean;
  activo: { id: string; texto: string } | null; puedeVerActivo: boolean;
  ubicacion: string | null; responsable: string | null;
  requiereParo: boolean; conSeguridad: boolean;
  actividades: { hechas: number; total: number };
}) {
  return (
    <div className="grid min-w-0 gap-2 rounded-xl border border-slate-200 bg-white p-3 lg:hidden">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">Equipo</dt>
        <dd className="min-w-0 break-words font-medium text-slate-900">
          {p.activo ? (p.puedeVerActivo ? <Link href={`/assets/${p.activo.id}`} className="text-brand-700 underline-offset-2 hover:underline">{p.activo.texto}</Link> : p.activo.texto) : "Sin equipo"}
        </dd>
        <dt className="text-slate-500">Dónde</dt>
        <dd className="flex min-w-0 items-start gap-1 text-slate-800"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />{p.ubicacion ?? "Sin ubicación"}</dd>
        <dt className="text-slate-500">Estado</dt>
        <dd className="flex flex-wrap gap-1.5">
          <Badge className={WO_STATUS_COLORS[p.estado]}>{WO_STATUS_LABELS[p.estado]}</Badge>
          <Badge className={PRIORITY_COLORS[p.prioridad]}>Prioridad {PRIORITY_LABELS[p.prioridad]}</Badge>
          <Badge className={MAINTENANCE_TYPE_COLORS[p.tipo]}>{MAINTENANCE_TYPE_LABELS[p.tipo]}</Badge>
        </dd>
        <dt className="text-slate-500">Para</dt>
        <dd className={p.vencida ? "font-medium text-red-700" : "text-slate-800"}>{p.compromiso ?? "Sin fecha"}{p.vencida ? " · vencida" : ""}</dd>
        <dt className="text-slate-500">A cargo</dt>
        <dd className="text-slate-800">{p.responsable ?? "Sin responsable"}</dd>
        <dt className="text-slate-500">Actividades</dt>
        <dd className="text-slate-800">{p.actividades.total ? `${p.actividades.hechas} de ${p.actividades.total}` : "Sin actividades"}</dd>
      </dl>
      {p.aceptada ? <p className="text-xs font-medium text-emerald-700">{p.aceptada}</p> : null}
      {p.requiereParo || p.conSeguridad ? (
        <a href="#seguridad" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {p.requiereParo ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{p.requiereParo ? "Requiere paro del equipo. " : ""}{p.conSeguridad ? "Lea las instrucciones y la seguridad antes de empezar." : ""}</span>
        </a>
      ) : null}
    </div>
  );
}

/**
 * En qué va cada sección. Solo tres, y cada una significa algo:
 *
 *  - `falta`  — esta sección DETIENE el cierre. Sale de `faltantesDeCierre`.
 *  - `hecho`  — ya está lista; no hace falta entrar.
 *  - `neutro` — ni completa ni pendiente, porque no tiene noción de completa:
 *               la bitácora o las lecturas no «se terminan».
 *
 * No hay un cuarto color a propósito. Ocho secciones con ocho tonos dejan de
 * distinguir a la semana, y compiten con los colores que en MainTrack ya
 * significan algo: el ámbar de «requiere paro», el rojo de vencida, la
 * criticidad del equipo. El color se gasta donde contesta la única pregunta
 * que alguien se hace frente a esta pantalla: qué me falta para cerrar.
 */
export type EstadoDeSeccion = "falta" | "hecho" | "neutro";

export type SeccionDelIndice = { id: string; texto: string; estado: EstadoDeSeccion };

const CHIP: Record<EstadoDeSeccion, string> = {
  falta: "border-amber-300 bg-amber-50 text-amber-900",
  hecho: "border-emerald-200 bg-emerald-50 text-emerald-800",
  neutro: "border-slate-200 bg-white text-slate-700",
};

/**
 * El índice de la orden en el teléfono: la secuencia del trabajo, a un toque
 * cada paso. Se desliza de lado dentro de sí mismo; la página no.
 *
 * Además de llevar, ahora MARCA: de un vistazo se ve qué sección detiene el
 * cierre sin recorrer las nueve tarjetas. El número de paso se queda porque es
 * la secuencia real del trabajo, y el ícono se acompaña de texto para quien no
 * distingue los colores.
 */
export function IndiceDeSecciones({ secciones }: { secciones: SeccionDelIndice[] }) {
  return (
    <nav aria-label="Secciones de la orden" className="sticky top-14 z-10 -mx-3 border-b border-slate-200 bg-slate-50/95 px-3 py-2 sm:-mx-4 sm:px-4 lg:hidden">
      <ol className="flex gap-1.5 overflow-x-auto pb-0.5">
        {secciones.map((s, i) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium ${CHIP[s.estado]}`}
            >
              <span className={`mr-1 ${s.estado === "neutro" ? "text-slate-400" : "opacity-70"}`}>{i + 1}.</span>
              {s.texto}
              {s.estado === "falta" ? <AlertTriangle className="ml-1 h-3.5 w-3.5" aria-label="falta algo aquí" /> : null}
              {s.estado === "hecho" ? <Check className="ml-1 h-3.5 w-3.5" aria-label="listo" /> : null}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
