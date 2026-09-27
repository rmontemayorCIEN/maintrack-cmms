"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, Menu, PanelLeftClose, PanelLeftOpen, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { etiquetaDeItem, menuDe, type ItemMenu } from "@/lib/pantallas";
import { IconoMenu } from "./iconos";

/**
 * El menú, ordenado por el día de quien lo usa y filtrado por su rol: sale de
 * `menuDe()` en lib/pantallas.ts, la misma tabla con que el servidor decide
 * qué pantallas responde. Nunca ofrece una liga que termina en «Sin permiso».
 */
const LLAVE_ABIERTOS = "mt_menu_abiertos";
/**
 * Si el menu quedo plegado en escritorio.
 *
 * Preferencia de cada persona y de cada navegador, como los grupos abiertos:
 * quien trabaja el dia entero en el tablero o en el calendario gana el ancho,
 * y a quien le sirve verlo completo no le cambia nada.
 */
const LLAVE_PLEGADO = "mt_menu_plegado";

/** El botón «Menú» de la barra inferior del teléfono abre este mismo cajón. */
export const EVENTO_ABRIR_MENU = "mt:abrir-menu";

export function Sidebar({
  orgName,
  plan,
  rol,
  esSuperAdmin = false,
  esDemo = false,
  registrosPropios = false,
  tieneLogo = false,
  terminoConjuntoPlural,
  favoritos,
}: {
  orgName: string;
  plan: string;
  /** El rol efectivo (el del operador dentro de un cliente es OWNER). */
  rol: string;
  esSuperAdmin?: boolean;
  esDemo?: boolean;
  /** Si la empresa contrato «Registros propios». Es contrato, no permiso. */
  registrosPropios?: boolean;
  /** Si la empresa subio su logotipo, sustituye al icono generico. */
  tieneLogo?: boolean;
  /** Como le llama esta cuenta a un conjunto de equipos: Lineas, Sistemas, Servicios, Rutas. */
  terminoConjuntoPlural?: string;
  /** Las pantallas que esta persona ancló, ya filtradas por su rol. */
  favoritos: ItemMenu[];
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
  /**
   * Los accesos rápidos van ARRIBA y como un grupo más, no como una barra
   * aparte: así se recorre el menú de una sola manera y la pantalla anclada se
   * ve igual que en su grupo de siempre —mismo ícono, mismo nombre—. Quien no
   * ancle nada ve el menú de siempre, sin un hueco donde antes no había nada.
   */
  const menu = [
    ...(favoritos.length
      ? [{ seccion: "Lo que más uso", clave: "favoritos", items: favoritos }]
      : []),
    ...menuDe(rol, { esSuperAdmin, esDemo, registrosPropios }),
  ];
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(menu.map((g) => [g.clave, true])),
  );
  /*
   * Arranca DESPLEGADO siempre, tambien para quien lo dejo plegado: el
   * servidor no tiene localStorage y dibujar una cosa distinta a la del
   * navegador parpadea. Se lee despues del primer dibujado, como los grupos.
   */
  const [plegado, setPlegado] = useState(false);

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
      if (localStorage.getItem(LLAVE_PLEGADO) === "1") setPlegado(true);
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

  function alternarPlegado() {
    setPlegado((p) => {
      const siguiente = !p;
      try { localStorage.setItem(LLAVE_PLEGADO, siguiente ? "1" : "0"); } catch { /* sin almacenamiento: vale para esta sesión */ }
      return siguiente;
    });
  }

  /*
   * El contenido se dibuja dos veces con el mismo código: completo en el cajón
   * del teléfono, y completo o plegado en escritorio. `compacto` solo es true
   * en el escritorio plegado; el cajón del teléfono nunca se pliega, porque
   * ahí ya se cierra entero.
   */
  const contenido = (compacto: boolean) => (
    <div className="flex h-full flex-col">
      <div className={cn("flex items-center gap-2 border-b border-slate-200 py-4", compacto ? "justify-center px-2" : "px-4")}>
        {tieneLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/api/apariencia/logo" alt={orgName} className="h-8 w-8 shrink-0 rounded-lg object-contain" />
        ) : (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">
            <Wrench className="h-4 w-4" />
          </span>
        )}
        {compacto ? null : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{orgName}</p>
            <p className="text-[0.625rem] uppercase tracking-wide text-slate-400">Plan {plan}</p>
          </div>
        )}
        {/* Plegar es solo de escritorio: en el teléfono el menú ya se cierra entero. */}
        <button
          type="button"
          onClick={alternarPlegado}
          className="hidden shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:block"
          title={compacto ? "Desplegar el menú" : "Plegar el menú"}
          aria-label={compacto ? "Desplegar el menú" : "Plegar el menú"}
        >
          {compacto ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className={cn("flex-1 overflow-y-auto py-4", compacto ? "px-2" : "px-3")}>
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
                  {/* Plegado no hay títulos de grupo: solo una raya que separa. */}
                  {compacto ? (
                    <div className="mb-1 border-t border-slate-100" aria-hidden />
                  ) : (
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
                  )}
                  <ul className={cn("grid gap-0.5", !compacto && !abierto && "hidden")}>
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const nombre = etiquetaDeItem(item, terminoConjuntoPlural);
                /*
                 * Una pantalla que vive DENTRO de otra del mismo grupo se
                 * sangra debajo de ella: «Qué falta para cerrar» pertenece a
                 * Órdenes, «Qué hay que comprar» a Compras. El menú se lee
                 * como veinte destinos con sus vistas y no como treinta y seis
                 * renglones planos, sin sacar nada —lo que sale del menú deja
                 * de poder anclarse en «Lo que más uso» y de ser destino por
                 * voz—.
                 */
                const dentroDeOtra = !compacto && group.items.some(
                  (o) => o.href !== item.href && item.href.startsWith(`${o.href}/`),
                );
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      /* Plegado, el nombre vive en el title: un menú de puros
                         cuadritos obliga a desplegarlo para todo. */
                      title={compacto ? nombre : undefined}
                      className={cn(
                        "flex min-h-10 items-center rounded-lg py-2 text-sm transition-colors lg:min-h-0",
                        compacto ? "justify-center px-2" : "gap-2.5 px-2.5",
                        dentroDeOtra && "ml-3 border-l border-slate-200 pl-3",
                        active
                          ? "bg-brand-50 font-medium text-brand-700"
                          : "text-slate-600 hover:bg-slate-100",
                      )}
                    >
                      <span className={active ? "text-brand-600" : "text-slate-400"}><IconoMenu nombre={item.icono} /></span>
                      {compacto ? <span className="sr-only">{nombre}</span> : nombre}
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
        MainTrack
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

      <aside
        className={cn(
          "hidden shrink-0 border-r border-slate-200 bg-white transition-[width] lg:block no-print",
          plegado ? "w-16" : "w-60",
        )}
      >
        {contenido(plegado)}
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
            {contenido(false)}
          </div>
        </div>
      ) : null}
    </>
  );
}
