import Link from "next/link";
import { cn } from "@/lib/utils";

export type Pestana = { clave: string; titulo: string; icono: React.ReactNode };

/**
 * Navegacion por pestañas basada en la URL, no en estado del cliente.
 *
 * Asi cada seccion es enlazable y compartible (`/settings?s=usuarios`), y sobre
 * todo permite que el servidor consulte unicamente los datos de la pestaña
 * abierta en vez de los de todas.
 */
export function Pestanas({ activa, pestanas }: { activa: string; pestanas: Pestana[] }) {
  return (
    <div className="mb-5 -mx-1 overflow-x-auto">
      <nav className="flex min-w-max gap-1 border-b border-slate-200 px-1" aria-label="Secciones de configuración">
        {pestanas.map((p) => {
          const seleccionada = p.clave === activa;
          return (
            <Link
              key={p.clave}
              href={`/settings?s=${p.clave}`}
              aria-current={seleccionada ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
                seleccionada
                  ? "border-brand-600 font-medium text-brand-700"
                  : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900",
              )}
            >
              <span className={seleccionada ? "text-brand-600" : "text-slate-400"}>{p.icono}</span>
              {p.titulo}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
