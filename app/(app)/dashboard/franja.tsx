import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { barraDe, type FilaDePlanta, type FranjaDePlanta, type Segmento } from "@/lib/planta";
import { cn } from "@/lib/utils";

/**
 * Como esta la planta, por areas o por sistemas.
 *
 * Los datos y el dictamen salen de `lib/planta.ts`; aqui solo se pinta. El
 * color NUNCA es el unico portador: cada renglon dice en palabras que tiene
 * —«2 equipos fuera de servicio»— porque uno de cada doce hombres no
 * distingue el rojo del verde, y porque un color sin cifra no se puede leer
 * en una junta.
 */

const CUADRO: Record<Segmento, string> = {
  abajo: "bg-red-500",
  aMedias: "bg-amber-400",
  reserva: "bg-slate-300",
  operando: "bg-emerald-400",
};

const BORDE: Record<string, string> = {
  DETENIDO: "border-l-red-500",
  DEGRADADO: "border-l-amber-400",
  COMPLETO: "border-l-emerald-400",
  VACIO: "border-l-slate-200",
};

const TEXTO_NOTA: Record<string, string> = {
  DETENIDO: "text-red-700",
  DEGRADADO: "text-amber-700",
  COMPLETO: "text-slate-500",
  VACIO: "text-slate-500",
};

export function Franja({ franja }: { franja: FranjaDePlanta }) {
  const esSistema = franja.agrupadoPor === "sistema";
  return (
    <section aria-labelledby="t-franja" className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3">
        <h2 id="t-franja" className="text-sm font-semibold text-slate-900">
          {esSistema ? "Cómo están sus sistemas" : "Cómo está la planta, por área"}
        </h2>
        <div className="flex items-baseline gap-3 text-xs">
          <span className="text-slate-500">
            {franja.equipos} {franja.equipos === 1 ? "equipo" : "equipos"}
            {franja.sinGrupo ? ` · ${franja.sinGrupo} sin ${esSistema ? "sistema" : "área"}` : ""}
          </span>
          <Link href={franja.enlace.href} className="font-medium text-brand-700 hover:underline">
            {franja.enlace.texto}
          </Link>
        </div>
      </div>

      <ul>
        {franja.filas.map((f) => <FilaFranja key={f.id} f={f} />)}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-[0.6875rem] text-slate-500">
        <Leyenda clase={CUADRO.operando} texto="Operando" />
        <Leyenda clase={CUADRO.aMedias} texto="Degradado" />
        <Leyenda clase={CUADRO.abajo} texto="Fuera de servicio" />
        <Leyenda clase={CUADRO.reserva} texto="En reserva" />
        <span className="ml-auto text-right">
          {franja.vencidasSinEquipo ? (
            <Link href="/work-orders?vencidas=1" className="text-brand-700 hover:underline">
              {franja.vencidasSinEquipo} {franja.vencidasSinEquipo === 1 ? "vencida sin equipo" : "vencidas sin equipo"}
            </Link>
          ) : null}
          {franja.vencidasSinEquipo && franja.masGrupos ? " · " : ""}
          {franja.masGrupos ? `y ${franja.masGrupos} ${esSistema ? "sistemas" : "áreas"} más` : ""}
        </span>
      </div>
    </section>
  );
}

function Leyenda({ clase, texto }: { clase: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-sm", clase)} aria-hidden />{texto}
    </span>
  );
}

function FilaFranja({ f }: { f: FilaDePlanta }) {
  const barra = barraDe(f);
  return (
    <li className="border-b border-slate-100 last:border-b-0">
      <Link
        href={f.enlace}
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 border-l-4 px-4 py-3 hover:bg-slate-50 sm:flex-nowrap",
          BORDE[f.estado] ?? BORDE.VACIO,
        )}
      >
        <div className="min-w-0 basis-full sm:basis-48">
          <p className="truncate text-sm font-medium text-slate-900">{f.nombre}</p>
          <p className="text-[0.6875rem] text-slate-500">
            {f.equipos} {f.equipos === 1 ? "equipo" : "equipos"}
            {f.abiertas ? ` · ${f.abiertas} ${f.abiertas === 1 ? "orden abierta" : "órdenes abiertas"}` : ""}
          </p>
        </div>

        {/* Un cuadro por equipo, de ancho fijo: asi un area con doce equipos
            se ve mas larga que una con dos, que es informacion. Estirarlos
            para llenar el renglon convertia la barra en una de progreso y
            hacia ver iguales dos areas de tamano muy distinto. */}
        <div className="flex min-w-0 flex-1 flex-wrap gap-[3px]" role="img" aria-label={descripcion(f)}>
          {barra.map((s, i) => (
            <span key={i} className={cn("h-5 w-3.5 shrink-0 rounded-sm", CUADRO[s])} />
          ))}
        </div>

        {/* Siempre las dos lineas, siempre en el mismo lugar: como estan sus
            equipos y que trae pendiente. Ensenar solo «lo mas grave» hacia
            que los renglones no se pudieran sumar. */}
        <div className="shrink-0 text-right sm:w-52">
          <p className={cn("text-xs font-medium", TEXTO_NOTA[f.estado] ?? "text-slate-500")}>{f.comoEstan}</p>
          <p className="text-[0.6875rem] text-slate-500">{f.pendientes ?? "Sin pendientes"}</p>
        </div>

        <ChevronRight className="hidden h-4 w-4 shrink-0 text-slate-300 sm:block" aria-hidden />
      </Link>
    </li>
  );
}

/** Lo que oye quien usa lector de pantalla, donde la barra no existe. */
function descripcion(f: FilaDePlanta): string {
  const partes = [
    f.operando ? `${f.operando} operando` : null,
    f.aMedias ? `${f.aMedias} degradados` : null,
    f.abajo ? `${f.abajo} fuera de servicio` : null,
    f.reserva ? `${f.reserva} en reserva` : null,
  ].filter(Boolean);
  return `${f.nombre}: ${partes.join(", ")}`;
}
