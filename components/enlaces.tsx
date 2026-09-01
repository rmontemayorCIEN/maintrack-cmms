"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2, Loader2, Plus, Trash2, X } from "lucide-react";

export type Enlace = {
  id: string;
  title: string;
  url: string;
  note: string | null;
  createdAt: string;
};

type Destino = { assetId: string } | { partId: string } | { planId: string };

/** El dominio dice de un vistazo si el enlace apunta donde uno espera. */
function dominio(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Enlaces de consulta: manual del fabricante en linea, ficha del proveedor,
 * video del procedimiento, norma aplicable.
 *
 * Complementan a los archivos adjuntos, no los sustituyen: lo que conviene
 * conservar se sube; lo que vive y se actualiza afuera, se enlaza.
 */
export function Enlaces({
  destino,
  enlaces,
  editable,
  titulo = "Enlaces de consulta",
  ayuda,
}: {
  destino: Destino;
  enlaces: Enlace[];
  editable: boolean;
  titulo?: string;
  ayuda?: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", url: "", note: "" });

  async function agregar(event: React.FormEvent) {
    event.preventDefault();
    setGuardando(true);
    setError(null);

    // Escribir "fabricante.com" es lo natural; se completa el esquema para no
    // rebotar al usuario por una formalidad.
    const url = /^https?:\/\//i.test(form.url.trim())
      ? form.url.trim()
      : `https://${form.url.trim()}`;

    const res = await fetch("/api/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...destino, title: form.title, url, note: form.note || null }),
    });
    const data = await res.json();
    setGuardando(false);
    if (!res.ok) {
      setError(data.error ?? "No fue posible guardar el enlace");
      return;
    }
    setForm({ title: "", url: "", note: "" });
    setAbierto(false);
    router.refresh();
  }

  async function borrar(e: Enlace) {
    if (!confirm(`¿Eliminar el enlace "${e.title}"?`)) return;
    const res = await fetch(`/api/links/${e.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "No fue posible eliminar");
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{titulo}</h3>
          <p className="text-xs text-slate-500">
            {ayuda ?? "Manual en linea, ficha del proveedor, video del procedimiento, norma aplicable."}
          </p>
        </div>
        {editable ? (
          <button
            type="button"
            onClick={() => { setAbierto((v) => !v); setError(null); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            {abierto ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {abierto ? "Cancelar" : "Agregar enlace"}
          </button>
        ) : null}
      </div>

      {abierto ? (
        <form onSubmit={agregar} className="grid gap-2 rounded-lg border border-brand-200 bg-brand-50/50 p-2.5">
          <input
            className="field" placeholder="Titulo (ej. Manual del fabricante)" required minLength={2}
            value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <input
            className="field" placeholder="https://…" required inputMode="url"
            value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
          />
          <input
            className="field" placeholder="Nota (opcional)"
            value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
          {error ? <p className="text-[0.6875rem] text-red-600">{error}</p> : null}
          <button
            type="submit" disabled={guardando || !form.title.trim() || !form.url.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            Guardar enlace
          </button>
        </form>
      ) : null}

      {error && !abierto ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}

      {enlaces.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400">
          Sin enlaces registrados
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {enlaces.map((e) => (
            <li key={e.id} className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-2.5 py-2">
              <span className="text-slate-400"><Link2 className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <a
                  href={e.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 truncate text-xs font-medium text-brand-600 hover:underline"
                >
                  {e.title}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
                <p className="truncate text-[0.625rem] text-slate-400">
                  {dominio(e.url)}
                  {e.note ? ` · ${e.note}` : ""}
                </p>
              </div>
              {editable ? (
                <button
                  type="button" onClick={() => borrar(e)} aria-label={`Eliminar ${e.title}`}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
