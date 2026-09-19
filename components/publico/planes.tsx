import Link from "next/link";
import { COMPLEMENTO_IA, ORDEN_PLANES, PLANES } from "@/lib/planes";
import { COBRO, TEXTO_PRUEBA, comparacion, precio, textoCelda, type Celda } from "@/lib/comercial";

/** Las fichas de planes del sitio y de la contratación: todo sale de lib/planes.ts. */
export function TarjetasPlanes({ conBoton = true }: { conBoton?: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {ORDEN_PLANES.map((clave) => {
        const p = PLANES[clave];
        return (
          <article key={clave} data-plan={clave} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-slate-900">{p.nombre}</h3>
            <p className="mt-1 text-sm text-slate-600">{p.descripcion}</p>
            <p className="mt-4"><span data-precio className="text-3xl font-semibold tabular-nums text-slate-900">{precio(p.precioMensual, p.moneda)}</span><span className="text-sm text-slate-500"> al mes</span></p>
            <ul className="mt-4 grid flex-1 gap-1.5 text-sm text-slate-700">{p.incluye.map((x) => <li key={x}>· {x}</li>)}</ul>
            {conBoton ? <Link href={`/contratar?plan=${clave}`} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">Empezar · {TEXTO_PRUEBA}</Link> : null}
          </article>
        );
      })}
      <article data-plan={COMPLEMENTO_IA.clave} className="flex flex-col rounded-2xl border border-dashed border-slate-300 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Complemento</p>
        <h3 className="text-lg font-semibold text-slate-900">{COMPLEMENTO_IA.nombre}</h3>
        <p className="mt-1 text-sm text-slate-600">{COMPLEMENTO_IA.descripcion}</p>
        <p className="mt-4"><span data-precio className="text-3xl font-semibold tabular-nums text-slate-900">{precio(COMPLEMENTO_IA.precioMensual, COMPLEMENTO_IA.moneda)}</span><span className="text-sm text-slate-500"> al mes</span></p>
        <ul className="mt-4 grid gap-1.5 text-sm text-slate-700">{COMPLEMENTO_IA.incluye.map((x) => <li key={x}>· {x}</li>)}</ul>
      </article>
      <p className="text-xs text-slate-500 md:col-span-3">{COBRO.periodicidad}, en {COBRO.moneda.toLowerCase()}. {COBRO.impuestos} {COBRO.manual}</p>
    </div>
  );
}

const estilo: Record<Celda["tipo"], string> = {
  incluido: "text-emerald-800", no: "text-slate-400", limite: "text-slate-900 tabular-nums", complemento: "text-indigo-800", configuracion: "text-amber-800",
};

/** La comparación verificable (lib/comercial.ts › comparacion). */
export function TablaPlanes() {
  const filas = comparacion();
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <caption className="sr-only">Comparación de planes</caption>
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr><th scope="col" className="px-4 py-3">Concepto</th>{ORDEN_PLANES.map((p) => <th key={p} scope="col" className="px-4 py-3">{PLANES[p].nombre}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={f.concepto} className="border-t border-slate-100">
              <th scope="row" className="px-4 py-2.5 font-normal text-slate-700">
                {i === 0 || filas[i - 1].grupo !== f.grupo ? <span className="mb-0.5 block text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-400">{f.grupo}</span> : null}
                {f.concepto}
              </th>
              {ORDEN_PLANES.map((p) => <td key={p} className={`px-4 py-2.5 ${estilo[f.celdas[p].tipo]}`}>{textoCelda(f.celdas[p])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
