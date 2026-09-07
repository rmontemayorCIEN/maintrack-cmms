"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Cpu,
  Factory,
  Gauge,
  Rocket,
  Inbox,
  UsersRound,
  PackageX,
  KanbanSquare,
  Library,
  ListChecks,
  Menu,
  MessageCircleQuestion,
  QrCode,
  Settings,
  ShoppingCart,
  Sparkles,
  Truck,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El menu, ordenado por el dia de quien lo usa, no por como esta hecho el
 * sistema.
 *
 * El orden responde a las preguntas en el orden en que aparecen: como voy, que
 * me llego, que tengo que hacer, sobre que equipos, con que material, como me
 * fue. La configuracion va al final a proposito: se toca las primeras semanas
 * y casi nunca despues, asi que arriba solo estorbaria todos los dias.
 */
const NAV: Array<{
  section: string;
  /** Para recordar si el grupo quedo abierto o cerrado. */
  clave: string;
  items: Array<{ href: string; label: string; icon: React.ReactNode }>;
}> = [
  {
    section: "Como voy",
    clave: "inicio",
    items: [
      { href: "/dashboard", label: "Panel de control", icon: <Gauge className="h-4 w-4" /> },
      { href: "/board", label: "Tablero", icon: <KanbanSquare className="h-4 w-4" /> },
      { href: "/calendar", label: "Calendario", icon: <CalendarDays className="h-4 w-4" /> },
    ],
  },
  {
    section: "Lo que llega",
    clave: "entradas",
    items: [
      { href: "/requests", label: "Solicitudes", icon: <Inbox className="h-4 w-4" /> },
      { href: "/requests/puntos", label: "Puntos de reporte QR", icon: <QrCode className="h-4 w-4" /> },
      { href: "/alerts", label: "Alertas", icon: <AlertTriangle className="h-4 w-4" /> },
    ],
  },
  {
    section: "El trabajo",
    clave: "trabajo",
    items: [
      { href: "/work-orders", label: "Órdenes de trabajo", icon: <ClipboardList className="h-4 w-4" /> },
      { href: "/work-orders/armar", label: "Armar una orden", icon: <Wrench className="h-4 w-4" /> },
      { href: "/backlog", label: "Trabajo pendiente", icon: <PackageX className="h-4 w-4" /> },
      // "Personal" y no "Equipo": en el mismo menu, "equipos" son las maquinas.
      // Tampoco "Mano de obra", que es la linea de costo y no las personas —si
      // manana hay una pantalla de costo de mano de obra, se llamaria asi.
      { href: "/equipo", label: "Personal", icon: <UsersRound className="h-4 w-4" /> },
    ],
  },
  {
    section: "Equipos y planes",
    clave: "activos",
    items: [
      // "Activo" es jerga de CMMS; en piso se dice equipo. El glosario mismo
      // define activo usando la palabra equipo, asi que se ponen las dos.
      { href: "/assets", label: "Activos / Equipos", icon: <Factory className="h-4 w-4" /> },
      { href: "/meters", label: "Medidores", icon: <Cpu className="h-4 w-4" /> },
      { href: "/plans", label: "Planes preventivos", icon: <ListChecks className="h-4 w-4" /> },
      { href: "/predictive", label: "Predictivo", icon: <Activity className="h-4 w-4" /> },
    ],
  },
  {
    section: "Almacén y compras",
    clave: "almacen",
    items: [
      { href: "/inventory", label: "Almacen", icon: <Boxes className="h-4 w-4" /> },
      { href: "/requisiciones", label: "Requisiciones", icon: <ClipboardList className="h-4 w-4" /> },
      { href: "/compras", label: "Compras", icon: <ShoppingCart className="h-4 w-4" /> },
      { href: "/suppliers", label: "Proveedores", icon: <Truck className="h-4 w-4" /> },
    ],
  },
  {
    section: "Como me fue",
    clave: "analisis",
    items: [
      { href: "/reports", label: "Reportes", icon: <BarChart3 className="h-4 w-4" /> },
      { href: "/consulta", label: "Pregunte a sus datos", icon: <MessageCircleQuestion className="h-4 w-4" /> },
      { href: "/diagnostico", label: "Diagnóstico IA", icon: <Sparkles className="h-4 w-4" /> },
    ],
  },
  {
    section: "Configuracion",
    clave: "config",
    items: [
      { href: "/puesta-en-marcha", label: "Puesta en marcha", icon: <Rocket className="h-4 w-4" /> },
      { href: "/catalogs", label: "Catalogos", icon: <Library className="h-4 w-4" /> },
      { href: "/import", label: "Importar datos", icon: <Upload className="h-4 w-4" /> },
      { href: "/glossary", label: "Glosario", icon: <BookOpen className="h-4 w-4" /> },
      { href: "/settings", label: "Ajustes", icon: <Settings className="h-4 w-4" /> },
    ],
  },
];

const LLAVE_ABIERTOS = "mt_menu_abiertos";

export function Sidebar({
  orgName,
  plan,
  esSuperAdmin = false,
  tieneLogo = false,
}: {
  orgName: string;
  plan: string;
  esSuperAdmin?: boolean;
  /** Si la empresa subio su logotipo, sustituye al icono generico. */
  tieneLogo?: boolean;
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
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NAV.map((g) => [g.clave, true])),
  );

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
        {(esSuperAdmin
          ? [
              ...NAV,
              {
                section: "Plataforma",
                clave: "plataforma",
                items: [
                  { href: "/clients", label: "Empresas cliente", icon: <Building2 className="h-4 w-4" /> },
                ],
              },
            ]
          : NAV
        ).map((group) => (
          <div key={group.section} className="mb-3">
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
                    className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[0.9375rem] font-semibold text-slate-800 hover:bg-slate-100"
                    aria-expanded={abierto}
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform",
                        abierto && "rotate-90",
                      )}
                    />
                    {group.section}
                  </button>
                  <ul className={cn("grid gap-0.5", !abierto && "hidden")}>
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                        active
                          ? "bg-brand-50 font-medium text-brand-700"
                          : "text-slate-600 hover:bg-slate-100",
                      )}
                    >
                      <span className={active ? "text-brand-600" : "text-slate-400"}>{item.icon}</span>
                      {item.label}
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
        className="fixed left-3 top-3 z-30 grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white lg:hidden no-print"
        aria-label="Abrir menú"
      >
        <Menu className="h-4 w-4" />
      </button>

      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block no-print">
        {content}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64 bg-white shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-2 top-3 grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100"
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
