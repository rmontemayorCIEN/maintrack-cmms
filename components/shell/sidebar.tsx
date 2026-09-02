"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  ClipboardList,
  Cpu,
  Factory,
  Gauge,
  Inbox,
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

const NAV: Array<{ section: string; items: Array<{ href: string; label: string; icon: React.ReactNode }> }> = [
  {
    section: "Operacion",
    items: [
      { href: "/dashboard", label: "Panel de control", icon: <Gauge className="h-4 w-4" /> },
      { href: "/puesta-en-marcha", label: "Puesta en marcha", icon: <ListChecks className="h-4 w-4" /> },
      { href: "/work-orders", label: "Ordenes de trabajo", icon: <ClipboardList className="h-4 w-4" /> },
      { href: "/backlog", label: "Trabajo pendiente", icon: <PackageX className="h-4 w-4" /> },
      { href: "/board", label: "Tablero", icon: <KanbanSquare className="h-4 w-4" /> },
      { href: "/calendar", label: "Calendario", icon: <CalendarDays className="h-4 w-4" /> },
      { href: "/requests", label: "Solicitudes", icon: <Inbox className="h-4 w-4" /> },
      { href: "/requests/puntos", label: "Puntos de reporte QR", icon: <QrCode className="h-4 w-4" /> },
    ],
  },
  {
    section: "Mantenimiento",
    items: [
      { href: "/plans", label: "Planes preventivos", icon: <Wrench className="h-4 w-4" /> },
      { href: "/predictive", label: "Predictivo", icon: <Activity className="h-4 w-4" /> },
      { href: "/alerts", label: "Alertas", icon: <AlertTriangle className="h-4 w-4" /> },
    ],
  },
  {
    section: "Activos y recursos",
    items: [
      { href: "/assets", label: "Activos", icon: <Factory className="h-4 w-4" /> },
      { href: "/meters", label: "Medidores", icon: <Cpu className="h-4 w-4" /> },
      { href: "/inventory", label: "Almacen", icon: <Boxes className="h-4 w-4" /> },
      { href: "/requisiciones", label: "Requisiciones", icon: <ClipboardList className="h-4 w-4" /> },
      { href: "/compras", label: "Compras", icon: <ShoppingCart className="h-4 w-4" /> },
      { href: "/suppliers", label: "Proveedores", icon: <Truck className="h-4 w-4" /> },
    ],
  },
  {
    section: "Analisis",
    items: [
      { href: "/consulta", label: "Pregunte a sus datos", icon: <MessageCircleQuestion className="h-4 w-4" /> },
      { href: "/diagnostico", label: "Diagnostico IA", icon: <Sparkles className="h-4 w-4" /> },
      { href: "/reports", label: "Reportes", icon: <BarChart3 className="h-4 w-4" /> },
      { href: "/catalogs", label: "Catalogos", icon: <Library className="h-4 w-4" /> },
      { href: "/import", label: "Importar datos", icon: <Upload className="h-4 w-4" /> },
      { href: "/glossary", label: "Glosario", icon: <BookOpen className="h-4 w-4" /> },
      { href: "/settings", label: "Configuracion", icon: <Settings className="h-4 w-4" /> },
    ],
  },
];

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
                items: [
                  { href: "/clients", label: "Empresas cliente", icon: <Building2 className="h-4 w-4" /> },
                ],
              },
            ]
          : NAV
        ).map((group) => (
          <div key={group.section} className="mb-5">
            <p className="mb-1.5 px-2 text-[0.625rem] font-semibold uppercase tracking-wider text-slate-400">
              {group.section}
            </p>
            <ul className="grid gap-0.5">
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
        aria-label="Abrir menu"
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
              aria-label="Cerrar menu"
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
