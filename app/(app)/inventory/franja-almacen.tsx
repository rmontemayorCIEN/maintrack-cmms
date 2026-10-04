import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { barraDeAlmacen, type FilaDeAlmacen, type FranjaDeAlmacen } from "@/lib/almacen-vista";
import { ETIQUETA_ESTADO, type EstadoRefaccion } from "@/lib/almacen-estado";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * Como esta el almacen, por familia.
 *
 * Gemela de la franja de planta del Inicio, y a proposito: quien ya aprendio a
 * leer una no tiene que aprender la otra. Alli cada cuadro es un equipo, aqui
 * cada cuadro es una refaccion.
 *
 * El color nunca es el unico portador. Cada renglon dice en palabras lo que
 * tiene —«2 agotadas · 1 bajo mínimo»— porque uno de cada doce hombres no
 * distingue el rojo del verde, y porque un color sin cifra no se puede repetir
 * en una junta.
 *
 * El gris de «sin mínimo» no es un color tibio entre bueno y malo: es la
 * ausencia de dato. Nadie dijo cuanto deberia haber, asi que no se puede
 * opinar, y se dice con esa palabra.
 */

const CUADRO: Record<EstadoRefaccion, string> = {
  agotada: "bg-red-500",
  bajoMinimo: "bg-amber-400",
  sinControl: "bg-slate-300",
  excedida: "bg-sky-400",
  sana: "bg-emerald-400",
};

/** El borde izquierdo lo pinta lo mas grave que tenga el renglon. */
function bordeDe(f: FilaDeAlmacen): string {
  if (f.agotadas) return "border-l-red-500";
  if (f.bajoMinimo) return "border-l-amber-400";
  if (f.sinControl) return "border-l-slate-300";
  if (f.excedidas) return "border-l-sky-400";
  return "border-l-emerald-400";
}

function textoDe(f: FilaDeAlmacen): string {
  if (f.agotadas) return "text-red-700";
  if (f.bajoMinimo) return "text-amber-700";
  return "text-slate-500";
}

const TITULO: Record<FranjaDeAlmacen["agrupadoPor"], string> = {
  familia: "Cómo está el almacén, por familia",
  almacen: "Cómo está el almacén, por bodega",
  todo: "Cómo está el almacén",
};

export function FranjaAlmacen({ franja, moneda = "MXN" }: { franja: FranjaDeAlmacen; moneda?: string }) {
  return (
    <section aria-labelledby="t-franja-almacen" className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3">
        <h2 id="t-franja-almacen" className="text-sm font-semibold text-slate-900">{TITULO[franja.agrupadoPor]}</h2>
        <div className="flex items-baseline gap-3 text-xs">
          <span className="text-slate-500">
            {franja.refacciones} {franja.refacciones === 1 ? "refacción" : "refacciones"}
            {franja.valorTotal ? ` · ${formatCurrency(franja.valorTotal, moneda)}` : ""}
          </span>
        </div>
      </div>

      {/* Un almacen sin familias no se enseña como una barra sola y muda: se
          dice que falta clasificarlo, que es la accion que destraba esto. */}
      {franja.agrupadoPor === "todo" && franja.refacciones > 1 ? (
        <p className="border-b border-slate-100 bg-amber-50/60 px-4 py-2 text-[0.6875rem] text-amber-800">
          Sin familias capturadas se ve todo junto. Al ponerle familia a cada refacción, esta franja se abre por familia y se puede ver cuál está sufriendo.
        </p>
      ) : null}

      <ul>
        {franja.filas.map((f) => <FilaAlmacen key={f.id} f={f} moneda={moneda} />)}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-[0.6875rem] text-slate-500">
        <Leyenda clase={CUADRO.sana} texto={ETIQUETA_ESTADO.sana} />
        <Leyenda clase={CUADRO.bajoMinimo} texto={ETIQUETA_ESTADO.bajoMinimo} />
        <Leyenda clase={CUADRO.agotada} texto={ETIQUETA_ESTADO.agotada} />
        <Leyenda clase={CUADRO.excedida} texto={ETIQUETA_ESTADO.excedida} />
        <Leyenda clase={CUADRO.sinControl} texto={ETIQUETA_ESTADO.sinControl} />
        <span className="ml-auto text-right">
          {franja.sinControl ? (
            <Link href="/inventory/analisis" className="text-brand-700 hover:underline">
              {franja.sinControl} sin mínimo capturado
            </Link>
          ) : null}
          {franja.sinControl && franja.otras ? " · " : ""}
          {franja.otras ? `y ${franja.otras} refacciones más` : ""}
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

function FilaAlmacen({ f, moneda }: { f: FilaDeAlmacen; moneda: string }) {
  const barra = barraDeAlmacen(f);
  return (
    <li className="border-b border-slate-100 last:border-b-0">
      <Link
        href={f.enlace}
        className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 border-l-4 px-4 py-3 hover:bg-slate-50 sm:flex-nowrap", bordeDe(f))}
      >
        <div className="min-w-0 basis-full sm:basis-48">
          <p className="truncate text-sm font-medium text-slate-900">{f.nombre}</p>
          <p className="text-[0.6875rem] text-slate-500">
            {f.refacciones} {f.refacciones === 1 ? "refacción" : "refacciones"}
          </p>
        </div>

        {/* Ancho fijo por cuadro, igual que en la franja de planta: una familia
            con doce refacciones se ve mas larga que una con dos, y eso es
            informacion. Estirarlos para llenar el renglon las haria ver
            iguales. */}
        <div className="flex min-w-0 flex-1 flex-wrap gap-[3px]" role="img" aria-label={descripcion(f)}>
          {barra.map((s, i) => (
            <span key={i} className={cn("h-5 w-3.5 shrink-0 rounded-sm", CUADRO[s])} />
          ))}
        </div>

        {/* Siempre las dos lineas y siempre en el mismo sitio: como estan y
            cuanto dinero hay ahi parado. */}
        <div className="shrink-0 text-right sm:w-52">
          <p className={cn("text-xs font-medium", textoDe(f))}>{f.comoEstan}</p>
          <p className="text-[0.6875rem] text-slate-500">{f.valor ? formatCurrency(f.valor, moneda) : "Sin valor capturado"}</p>
        </div>

        <ChevronRight className="hidden h-4 w-4 shrink-0 text-slate-300 sm:block" aria-hidden />
      </Link>
    </li>
  );
}

/** Lo que oye quien usa lector de pantalla, donde la barra no existe. */
function descripcion(f: FilaDeAlmacen): string {
  const partes = [
    f.sanas ? `${f.sanas} en nivel` : null,
    f.bajoMinimo ? `${f.bajoMinimo} bajo mínimo` : null,
    f.agotadas ? `${f.agotadas} agotadas` : null,
    f.excedidas ? `${f.excedidas} por encima del máximo` : null,
    f.sinControl ? `${f.sinControl} sin mínimo capturado` : null,
  ].filter(Boolean);
  return `${f.nombre}: ${partes.join(", ")}`;
}
