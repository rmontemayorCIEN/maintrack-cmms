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
import { formatDateTime } from "@/lib/utils";

type Notification = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  kind: string;
  read: boolean;
  createdAt: string;
};

export function Topbar({
  user,
}: {
  user: { name: string; email: string; role: string; color: string };
}) {
  const zona = useZona();
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
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
        if (!cancelled) setItems(data.notifications ?? []);
      } catch { /* sin red: se reintenta en el siguiente minuto */ }
    }
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const unread = items.filter((n) => !n.read).length;

  async function markRead() {
    try {
      await fetch("/api/notifications", { method: "PATCH" });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch { /* si no hay red, siguen marcados como no leidos */ }
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
      <div className="w-9 lg:hidden" />
      <form onSubmit={search} className="relative hidden max-w-sm flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar OT, activos, refacciones…"
          className="field con-icono"
        />
      </form>

      <div className="ml-auto flex items-center gap-2">
        {/* Solo a quien puede crear ordenes: al solicitante o al tecnico el boton
            los llevaba a un formulario que el servidor les rechaza al guardar. */}
        {can(user.role, "workorder:write") ? (
          <Link
            href="/work-orders/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
          >
            <Plus className="h-3.5 w-3.5" /> Nueva OT
          </Link>
        ) : null}

        <BotonAyuda />

        <div className="relative">
          <button
            type="button"
            onClick={() => { setOpen((v) => !v); if (!open && unread) markRead(); }}
            className="relative grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100"
            aria-label="Notificaciones"
          >
            <Bell className="h-4 w-4 text-slate-600" />
            {unread ? (
              <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                {unread}
              </span>
            ) : null}
          </button>
          {open ? (
            <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                Notificaciones
              </p>
              <div className="max-h-80 overflow-y-auto">
                {items.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-slate-400">Sin notificaciones</p>
                ) : (
                  items.map((n) => (
                    <Link
                      key={n.id}
                      href={n.link ?? "#"}
                      onClick={() => setOpen(false)}
                      className="block border-b border-slate-50 px-3 py-2.5 hover:bg-slate-50"
                    >
                      <p className="text-xs font-medium text-slate-800">{n.title}</p>
                      {n.body ? <p className="mt-0.5 text-[0.6875rem] text-slate-500">{n.body}</p> : null}
                      <p className="mt-1 text-[0.625rem] text-slate-400">{formatDateTime(n.createdAt, zona)}</p>
                    </Link>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
          <Avatar name={user.name} color={user.color} />
          <div className="hidden leading-tight sm:block">
            <p className="text-xs font-medium text-slate-800">{user.name}</p>
            <p className="text-[0.625rem] text-slate-400">{ROLE_LABELS[user.role] ?? user.role}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100"
            title="Cerrar sesión"
          >
            <LogOut className="h-4 w-4 text-slate-500" />
          </button>
        </div>
      </div>
    </header>
  );
}
