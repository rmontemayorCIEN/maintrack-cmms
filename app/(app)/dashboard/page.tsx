import { Suspense } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { inicioDe, type Bloque, type Cifra, type Renglon, type Tono } from "@/lib/inicio";
import { PRIORITY_LABELS, WO_STATUS_LABELS } from "@/lib/constants";
import { IconoMenu } from "@/components/shell/iconos";
import { cn } from "@/lib/utils";
import { PanelIndicadores } from "./panel-indicadores";

export const metadata = { title: "Inicio" };
export const dynamic = "force-dynamic";

/**
 * El inicio, distinto para cada rol (lib/inicio.ts). Esta pantalla no decide
 * nada: pinta el resumen, las acciones rápidas y los bloques que le tocan a
 * quien entra. En el teléfono todo va en una columna, con lo urgente arriba.
 */
export default async function InicioPage() {
  const user = await requireUser();
  const inicio = await inicioDe(user);

  return (
    <>
      <header className="mb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Hola, {user.name.split(" ")[0]}</p>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{inicio.titulo}</h1>
      </header>

      {inicio.acciones.length ? (
        <nav aria-label="Acciones rápidas" className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {inicio.acciones.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:border-brand-300 hover:bg-brand-50"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><IconoMenu nombre={a.icono} /></span>
              <span className="min-w-0 leading-tight">{a.etiqueta}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      {inicio.puesta ? (
        <Link href="/puesta-en-marcha" className="mb-4 flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3 hover:bg-brand-50">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-900" data-porcentaje={inicio.puesta.porcentaje}>
              Puesta en marcha al {inicio.puesta.porcentaje}% <span className="text-xs font-medium text-brand-800/80">· {inicio.puesta.estado}</span>
            </p>
            {inicio.puesta.siguiente ? <p className="text-xs text-brand-800/80">{inicio.puesta.siguiente}</p> : null}
            <div className="mt-1.5 h-1.5 max-w-md overflow-hidden rounded-full bg-white">
              <div className="h-full bg-brand-500" style={{ width: `${inicio.puesta.porcentaje}%` }} />
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
        </Link>
      ) : null}

      {inicio.resumen.length ? (
        <section aria-label="Resumen" className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {inicio.resumen.map((c) => <TarjetaCifra key={c.etiqueta} cifra={c} />)}
        </section>
      ) : null}

      {inicio.alDia ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-800">
          Todo al día: no hay pendientes que pidan su atención.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {inicio.bloques.map((b) => <TarjetaBloque key={b.id} bloque={b} />)}
        </div>
      )}

      {inicio.conIndicadores ? (
        <Suspense fallback={<p className="mt-8 text-sm text-slate-500" role="status">Cargando resultados…</p>}>
          <PanelIndicadores />
        </Suspense>
      ) : null}
    </>
  );
}

const TONO: Record<Tono, string> = {
  normal: "border-slate-200",
  bien: "border-emerald-200",
  atencion: "border-amber-300",
  critico: "border-red-300",
};
const MARCA: Record<Tono, string> = {
  normal: "bg-slate-300",
  bien: "bg-emerald-500",
  atencion: "bg-amber-500",
  critico: "bg-red-600",
};
/** El estado no se dice solo con color: también con palabras. */
const PALABRA: Record<Tono, string> = { normal: "", bien: "Al día", atencion: "Revisar", critico: "Urgente" };

function TarjetaCifra({ cifra }: { cifra: Cifra }) {
  const contenido = (
    <>
      <p className="text-[0.6875rem] font-medium leading-tight text-slate-500">{cifra.etiqueta}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{cifra.valor}</p>
      {PALABRA[cifra.tono] ? (
        <p className="mt-0.5 flex items-center gap-1 text-[0.6875rem] font-medium text-slate-600">
          <span className={cn("h-2 w-2 rounded-full", MARCA[cifra.tono])} aria-hidden />{PALABRA[cifra.tono]}
        </p>
      ) : null}
    </>
  );
  const clase = cn("block rounded-xl border bg-white p-3", TONO[cifra.tono]);
  return cifra.enlace ? <Link href={cifra.enlace} className={cn(clase, "hover:bg-slate-50")}>{contenido}</Link> : <div className={clase}>{contenido}</div>;
}

function TarjetaBloque({ bloque }: { bloque: Bloque }) {
  return (
    <section id={bloque.id} aria-labelledby={`t-${bloque.id}`} className="scroll-mt-20 rounded-xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h2 id={`t-${bloque.id}`} className="text-sm font-semibold text-slate-900">
            {bloque.titulo} <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{bloque.total}</span>
          </h2>
          {bloque.descripcion ? <p className="mt-0.5 text-xs text-slate-500">{bloque.descripcion}</p> : null}
        </div>
        {bloque.verTodo ? (
          <Link href={bloque.verTodo.enlace} className="inline-flex min-h-9 shrink-0 items-center text-xs font-medium text-brand-700 hover:underline">{bloque.verTodo.texto}</Link>
        ) : null}
      </div>
      <ul className="divide-y divide-slate-100">
        {bloque.renglones.map((r) => <FilaInicio key={r.id} r={r} />)}
      </ul>
      {bloque.total > bloque.renglones.length ? (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">y {bloque.total - bloque.renglones.length} más</p>
      ) : null}
    </section>
  );
}

function FilaInicio({ r }: { r: Renglon }) {
  const cuerpo = (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", MARCA[r.tono])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{r.folio}</span>
          {r.estado ? <span>{WO_STATUS_LABELS[r.estado] ?? r.estado}</span> : null}
          {r.prioridad ? <span>· Prioridad {PRIORITY_LABELS[r.prioridad] ?? r.prioridad}</span> : null}
          {r.tono === "critico" ? <span className="font-semibold text-red-700">· Urgente</span> : null}
        </p>
        <p className="mt-0.5 break-words text-sm font-medium text-slate-900">{r.titulo}</p>
        {r.detalle ? <p className="mt-0.5 break-words text-xs text-slate-500">{r.detalle}</p> : null}
        {r.fecha ? <p className={cn("mt-0.5 text-xs", r.fecha.startsWith("Venció") ? "font-medium text-red-700" : "text-slate-500")}>{r.fecha}</p> : null}
      </div>
    </div>
  );
  return (
    <li className="flex items-center gap-2 px-4 py-3">
      {r.enlace ? <Link href={r.enlace} className="flex min-w-0 flex-1 items-start gap-2 hover:opacity-90">{cuerpo}</Link> : cuerpo}
      {r.accion ? (
        <Link href={r.accion.enlace} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-brand-700 hover:bg-brand-50">
          {r.accion.texto}<ChevronRight className="h-3.5 w-3.5" />
        </Link>
      ) : r.enlace ? <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden /> : null}
    </li>
  );
}
