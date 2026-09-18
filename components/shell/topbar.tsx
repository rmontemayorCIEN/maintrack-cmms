"use client";

import { can } from "@/lib/rbac";
import { useZona } from "@/components/zona-empresa";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, LogOut, Plus, Search } from "lucide-react";
import { BotonAyuda } from "./ayuda";
import { Avatar } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/constants";
import { PuntoPrioridad, EstadoAviso, type AvisoVista } from "@/components/avisos/aviso";
import { formatDateTime } from "@/lib/utils";

type Notification = AvisoVista;

export function Topbar({
  user,
  empresa,
}: {
  user: { name: string; email: string; role: string; color: string };
  /** La empresa activa: en el teléfono el menú lateral no se ve y hay que decirla aquí. */
  empresa: string;
}) {
  const zona = useZona();
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [cuentas, setCuentas] = useState({ noLeidas: 0, pendientes: 0 });
  const [avisosEn, setAvisosEn] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    /**
     * La campana se consulta cada minuto y puede fallar por cosas del lado del
     * navegador —wifi que cambia, una extension que bloquea la peticion—. Sin
     * atrapar el error, cada intento dejaba un «Uncaught (in promise): Failed
     * to fetch» en la consola. No avisar en ese minuto es suficiente: al
     * siguiente se vuelve a intentar.
     */
    async function load() {
      try {
        const res = await fetch("/api/notifications");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setItems(data.notifications ?? []);
          setCuentas({ noLeidas: data.noLeidas ?? 0, pendientes: data.pendientes ?? 0 });
          setAvisosEn(data.avisosEn ?? null);
        }
      } catch { /* sin red: se reintenta en el siguiente minuto */ }
    }
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const unread = cuentas.noLeidas;

  // Abrir la campana ya no marca todo como leído: se marca lo que se abre, o
  // todo con el botón. Y leer no atiende: lo pendiente sigue pendiente.
  async function markRead() {
    try {
      await fetch("/api/notifications", { method: "PATCH" });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setCuentas((c) => ({ ...c, noLeidas: 0 }));
    } catch { /* si no hay red, siguen marcados como no leidos */ }
  }
  async function leerUna(n: Notification) {
    setOpen(false);
    if (n.read) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setCuentas((c) => ({ ...c, noLeidas: Math.max(0, c.noLeidas - 1) }));
    try {
      await fetch(`/api/notifications/${n.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "leer" }) });
    } catch { /* sin red */ }
  }

  async function logout() {
    // La sesion se cierra igual aunque la peticion falle: la cookie expira y
    // el destino es la pantalla de entrada.
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* sin red */ }
    router.push("/login");
    router.refresh();
  }

  function search(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim()) router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur no-print lg:px-6">
      <div className="w-10 shrink-0 lg:hidden" />
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 md:hidden" title={empresa}>{empresa}</p>
      <form onSubmit={search} role="search" className="relative hidden max-w-sm flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar OT, activos, refacciones…"
          aria-label="Buscar"
          type="search"
          enterKeyHint="search"
          className="field con-icono"
        />
      </form>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        {/* En el teléfono la búsqueda es su propia pantalla, con el teclado listo. */}
        <Link href="/search" aria-label="Buscar" className="grid h-10 w-10 place-items-center rounded-lg hover:bg-slate-100 md:hidden">
          <Search className="h-4 w-4 text-slate-600" />
        </Link>
        {/* Solo a quien puede crear ordenes: al solicitante o al tecnico el boton
            los llevaba a un formulario que el servidor les rechaza al guardar. */}
        {can(user.role, "workorder:write") ? (
          <Link
            href="/work-orders/new"
            className="hidden items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 sm:inline-flex"
          >
            <Plus className="h-3.5 w-3.5" /> Nueva OT
          </Link>
        ) : null}

        <BotonAyuda />

        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="relative grid h-10 w-10 place-items-center rounded-lg hover:bg-slate-100"
            aria-label={unread ? `Avisos, ${unread} sin leer` : "Avisos"}
            aria-expanded={open}
          >
            <Bell className="h-4 w-4 text-slate-600" />
            {unread ? (
              <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                {unread}
              </span>
            ) : null}
          </button>
          {open ? (
            <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <p className="text-xs font-semibold text-slate-700">
                  Avisos{cuentas.pendientes ? <span className="ml-1.5 font-normal text-amber-700">{cuentas.pendientes} pendiente(s)</span> : null}
                </p>
                {unread ? (
                  <button type="button" onClick={markRead} className="text-[0.6875rem] text-brand-700 hover:underline">Marcar todas como leídas</button>
                ) : null}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {avisosEn ? (
                  <p className="border-b border-slate-100 bg-amber-50 px-3 py-2 text-[0.6875rem] text-amber-800">
                    Está dentro de una empresa cliente. Sus avisos de {avisosEn} aparecen al volver a su empresa.
                  </p>
                ) : null}
                {items.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-slate-400">Sin notificaciones</p>
                ) : (
                  items.map((n) => (
                    <Link
                      key={n.id}
                      href={n.link ?? "/notificaciones"}
                      onClick={() => leerUna(n)}
                      className={`flex gap-2 border-b border-slate-50 px-3 py-2.5 hover:bg-slate-50 ${n.read ? "" : "bg-brand-50/40"}`}
                    >
                      <PuntoPrioridad prioridad={n.prioridad} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-1.5">
                          <p className={`text-xs ${n.read ? "font-medium text-slate-700" : "font-semibold text-slate-900"}`}>{n.title}</p>
                          <EstadoAviso a={n} />
                        </div>
                        {n.body ? <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-[0.6875rem] text-slate-500">{n.body}</p> : null}
                        <p className="mt-1 text-[0.625rem] text-slate-400">{formatDateTime(n.createdAt, zona)}</p>
                      </div>
                    </Link>
                  ))
                )}
              </div>
              <Link href="/notificaciones" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-3 py-2 text-center text-[0.6875rem] font-medium text-brand-700 hover:bg-slate-50">
                Ver todos los avisos
              </Link>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-1 border-l border-slate-200 pl-2 sm:gap-2 sm:pl-3">
          <span className="hidden sm:inline-flex"><Avatar name={user.name} color={user.color} /></span>
          <div className="hidden leading-tight sm:block">
            <p className="text-xs font-medium text-slate-800">{user.name}</p>
            <p className="text-[0.625rem] text-slate-400">{ROLE_LABELS[user.role] ?? user.role}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="grid h-10 w-10 place-items-center rounded-lg hover:bg-slate-100"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut className="h-4 w-4 text-slate-500" />
          </button>
        </div>
      </div>
    </header>
  );
}
