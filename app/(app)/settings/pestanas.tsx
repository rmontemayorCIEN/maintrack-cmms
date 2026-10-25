import Link from "next/link";
import { cn } from "@/lib/utils";

export type Pestana = { clave: string; titulo: string; icono: React.ReactNode; grupo: string };

/**
 * Índice de Ajustes, agrupado.
 *
 * Eran trece pestañas en una sola fila, en el orden en que se fueron agregando:
 * lo personal mezclado con lo de la empresa y con lo del cobro. Ahora van en
 * grupos con título, y el título dice de quién es lo que hay debajo: «Mi
 * cuenta» es suyo y no cambia el de nadie; «Mi empresa» lo ve todo el equipo.
 *
 * En escritorio es una columna a la izquierda y en el teléfono una tira que se
 * desliza, con el título del grupo antes de sus pestañas.
 *
 * Sigue basada en la URL, no en estado del cliente: cada sección es enlazable
 * (`/settings?s=usuarios`) y el servidor consulta únicamente los datos de la
 * abierta en vez de los de todas.
 */
export function Pestanas({ activa, pestanas }: { activa: string; pestanas: Pestana[] }) {
  const grupos: { titulo: string; items: Pestana[] }[] = [];
  for (const p of pestanas) {
    const g = grupos.find((x) => x.titulo === p.grupo);
    if (g) g.items.push(p);
    else grupos.push({ titulo: p.grupo, items: [p] });
  }

  return (
    <nav
      className="-mx-1 mb-5 overflow-x-auto border-b border-slate-200 px-1 pb-1 lg:sticky lg:top-4 lg:mx-0 lg:mb-0 lg:overflow-visible lg:border-b-0 lg:px-0 lg:pb-0"
      aria-label="Secciones de configuración"
    >
      <div className="flex min-w-max gap-5 lg:min-w-0 lg:flex-col lg:gap-5">
        {grupos.map((g) => (
          <div key={g.titulo}>
            <p className="mb-1 px-2 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-slate-500">{g.titulo}</p>
            <ul className="flex gap-1 lg:flex-col lg:gap-0.5">
              {g.items.map((p) => {
                const seleccionada = p.clave === activa;
                return (
                  <li key={p.clave}>
                    <Link
                      href={`/settings?s=${p.clave}`}
                      aria-current={seleccionada ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition-colors",
                        seleccionada
                          ? "bg-brand-50 font-medium text-brand-700"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                      )}
                    >
                      <span className={seleccionada ? "text-brand-600" : "text-slate-400"}>{p.icono}</span>
                      {p.titulo}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
