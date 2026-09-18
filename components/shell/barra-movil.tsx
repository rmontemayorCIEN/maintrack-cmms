"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu } from "lucide-react";
import { barraDe } from "@/lib/pantallas";
import { cn } from "@/lib/utils";
import { IconoMenu } from "./iconos";
import { EVENTO_ABRIR_MENU } from "./sidebar";

/**
 * La barra inferior del teléfono: los cuatro destinos del día de cada rol, al
 * alcance del pulgar, y «Menú» para todo lo demás. No tapa contenido: el
 * layout le deja su espacio abajo. En tableta y computadora no aparece; ahí
 * está el menú lateral.
 */
export function BarraMovil({ rol }: { rol: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const items = barraDe(rol);
  const actual = (href: string) => {
    const [ruta, query = ""] = href.split("?");
    const mismaRuta = pathname === ruta || (ruta !== "/dashboard" && pathname.startsWith(`${ruta}/`));
    if (!mismaRuta) return false;
    // «Mis órdenes» y «Órdenes» comparten ruta: se distinguen por el filtro.
    const hermanos = items.filter((i) => i.href.split("?")[0] === ruta);
    if (hermanos.length < 2) return true;
    const exacto = hermanos.find((i) => (i.href.split("?")[1] ?? "") === params.toString());
    return exacto ? exacto.href === href : !query;
  };
  return (
    <nav
      aria-label="Accesos principales"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur no-print lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-5">
        {items.map((i) => {
          const activo = actual(i.href);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[0.6875rem] font-medium",
                  activo ? "text-brand-700" : "text-slate-500",
                )}
              >
                <IconoMenu nombre={i.icono} className="h-5 w-5" />
                <span className="max-w-full truncate">{i.etiqueta}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(EVENTO_ABRIR_MENU))}
            className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-[0.6875rem] font-medium text-slate-500"
          >
            <Menu className="h-5 w-5" />
            <span>Menú</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
