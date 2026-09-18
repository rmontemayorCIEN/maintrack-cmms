"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, Menu, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { menuDe } from "@/lib/pantallas";
import { IconoMenu } from "./iconos";

/**
 * El menú, ordenado por el día de quien lo usa y filtrado por su rol: sale de
 * `menuDe()` en lib/pantallas.ts, la misma tabla con que el servidor decide
 * qué pantallas responde. Nunca ofrece una liga que termina en «Sin permiso».
 */
const LLAVE_ABIERTOS = "mt_menu_abiertos";

/** El botón «Menú» de la barra inferior del teléfono abre este mismo cajón. */
export const EVENTO_ABRIR_MENU = "mt:abrir-menu";

export function Sidebar({
  orgName,
  plan,
  rol,
  esSuperAdmin = false,
  tieneLogo = false,
  terminoConjuntoPlural,
}: {
  orgName: string;
  plan: string;
  /** El rol efectivo (el del operador dentro de un cliente es OWNER). */
  rol: string;
  esSuperAdmin?: boolean;
  /** Si la empresa subio su logotipo, sustituye al icono generico. */
  tieneLogo?: boolean;
  /** Como le llama esta cuenta a un conjunto de equipos: Lineas, Sistemas, Servicios, Rutas. */
  terminoConjuntoPlural?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  /**
   * Que grupos estan abiertos.
   *
   * Arranca con todos abiertos: un menu que se abre cerrado esconde lo que el
   * usuario todavia no sabe que existe. Quien ya lo conoce cierra lo que no
   * usa y el navegador se lo recuerda.
   */
  const menu = menuDe(rol, { esSuperAdmin });
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(menu.map((g) => [g.clave, true])),
  );

  // Cerrar el cajón al cambiar de pantalla, y abrirlo desde la barra inferior.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const abrir = () => setOpen(true);
    window.addEventListener(EVENTO_ABRIR_MENU, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_MENU, abrir);
  }, []);
  // Con el cajón abierto, Escape lo cierra y la página de atrás no se desplaza.
  useEffect(() => {
    if (!open) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", tecla);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", tecla); document.body.style.overflow = antes; };
  }, [open]);

  // Se lee despues del primer dibujado: en el servidor no hay localStorage, y
  // leerlo durante el render daria una pantalla distinta a la del cliente.
  useEffect(() => {
    try {
      const guardado = localStorage.getItem(LLAVE_ABIERTOS);
      if (guardado) setAbiertos((a) => ({ ...a, ...JSON.parse(guardado) }));
    } catch {
      // Navegador sin almacenamiento o en privado: se queda con todo abierto.
    }
  }, []);

  function alternarGrupo(clave: string) {
    setAbiertos((a) => {
      const siguiente = { ...a, [clave]: !a[clave] };
      try {
        localStorage.setItem(LLAVE_ABIERTOS, JSON.stringify(siguiente));
      } catch {
        // Si no se puede guardar, al menos funciona en esta sesion.
      }
      return siguiente;
    });
  }

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-4">
        {tieneLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/api/apariencia/logo" alt={orgName} className="h-8 w-8 rounded-lg object-contain" />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
            <Wrench className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{orgName}</p>
          <p className="text-[0.625rem] uppercase tracking-wide text-slate-400">Plan {plan}</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {menu.map((group) => (
          <div key={group.clave} className="mb-3">
            {/* El grupo que contiene la pagina actual se muestra abierto
                aunque este cerrado: esconder donde esta parado el usuario
                seria desorientarlo. */}
            {(() => {
              const tieneLaActual = group.items.some(
                (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
              );
              const abierto = abiertos[group.clave] !== false || tieneLaActual;
              return (
                <>
                  <button
                    type="button"
                    onClick={() => alternarGrupo(group.clave)}
                    className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[0.8125rem] font-bold uppercase tracking-wide text-slate-800 hover:bg-slate-100"
                    aria-expanded={abierto}
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform",
                        abierto && "rotate-90",
                      )}
                    />
                    {group.seccion}
                  </button>
                  <ul className={cn("grid gap-0.5", !abierto && "hidden")}>
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors lg:min-h-0",
                        active
                          ? "bg-brand-50 font-medium text-brand-700"
                          : "text-slate-600 hover:bg-slate-100",
                      )}
                    >
                      <span className={active ? "text-brand-600" : "text-slate-400"}><IconoMenu nombre={item.icono} /></span>
                      {item.porInstalacion ? terminoConjuntoPlural ?? item.etiqueta : item.etiqueta}
                    </Link>
                  </li>
                );
              })}
                  </ul>
                </>
              );
            })()}
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 px-4 py-3 text-[0.625rem] text-slate-400">
        MainTrack CMMS v1.0
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed left-2 top-2.5 z-30 grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-white lg:hidden no-print"
        aria-label="Abrir menú"
        aria-expanded={open}
      >
        <Menu className="h-4 w-4" />
      </button>

      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block no-print">
        {content}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[min(18rem,85vw)] bg-white shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-2 top-3 grid h-10 w-10 place-items-center rounded-lg hover:bg-slate-100"
              aria-label="Cerrar menú"
            >
              <X className="h-4 w-4" />
            </button>
            {content}
          </div>
        </div>
      ) : null}
    </>
  );
}
