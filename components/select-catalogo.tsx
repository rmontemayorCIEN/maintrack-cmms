"use client";

import { useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import type { ClaveCatalogo } from "@/lib/catalogs";

export type OpcionCatalogo = { id: string; etiqueta: string };

/**
 * Campo de seleccion alimentado por un catalogo, con alta rapida.
 *
 * El "+" solo aparece si `puedeCrear` es verdadero (lo decide el permiso
 * settings:write del lado del servidor). Al crear, la opcion nueva queda
 * seleccionada sin recargar la pagina, para no perder lo capturado.
 */
export function SelectCatalogo({
  catalogo,
  etiqueta,
  valor,
  onChange,
  opciones,
  onOpcionesChange,
  puedeCrear,
  requerido,
  vacioTexto = "Sin asignar",
  camposAlta,
  contextoAlta,
  ayuda,
  claveValor = "id",
}: {
  catalogo: ClaveCatalogo;
  etiqueta: string;
  valor: string;
  onChange: (valor: string) => void;
  opciones: OpcionCatalogo[];
  onOpcionesChange: (opciones: OpcionCatalogo[]) => void;
  puedeCrear: boolean;
  requerido?: boolean;
  vacioTexto?: string;
  /** Campos que se piden en el alta rapida. */
  camposAlta: Array<{ nombre: string; etiqueta: string; requerido?: boolean }>;
  /** Valores fijos que el alta necesita pero no se preguntan (ej. siteId). */
  contextoAlta?: Record<string, string>;
  ayuda?: string;
  /**
   * Que guarda el campo del formulario. La mayoria de los catalogos se
   * referencian por `id`; los de refaccion guardan el `code`, porque
   * Part.category y Part.unit son texto.
   */
  claveValor?: "id" | "code";
}) {
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  async function crear(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    setGuardando(true);
    setError(null);

    const res = await fetch(`/api/catalogs/${catalogo}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...contextoAlta, ...form }),
    });
    const data = await res.json();
    setGuardando(false);

    if (!res.ok) {
      setError(data.error ?? "No fue posible crear el registro");
      return;
    }

    // La API devuelve la lista completa ya actualizada.
    const nuevas: OpcionCatalogo[] = (data.items as Array<Record<string, unknown>>).map((i) => ({
      id: String(claveValor === "code" ? i.code : i.id),
      etiqueta: (() => {
        const code = i.code ? String(i.code) : "";
        const nombre = String(i.name ?? i.description ?? "");
        if (!code) return nombre;
        return nombre && nombre.toLowerCase() !== code.toLowerCase() ? `${code} — ${nombre}` : code;
      })(),
    }));
    onOpcionesChange(nuevas);

    // Con claveValor "code" la API devuelve el id, no el codigo: se toma del
    // formulario, que es donde el usuario acaba de escribirlo.
    onChange(claveValor === "code" ? String(form.code ?? "") : data.id);
    setForm({});
    setAbierto(false);
  }

  return (
    <div>
      <label className="label">{etiqueta}</label>
      <div className="flex items-start gap-1.5">
        <select
          className="field"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          required={requerido}
        >
          {!requerido ? <option value="">{vacioTexto}</option> : null}
          {requerido && !valor ? <option value="">Seleccione…</option> : null}
          {opciones.map((o) => (
            <option key={o.id} value={o.id}>{o.etiqueta}</option>
          ))}
        </select>

        {puedeCrear ? (
          <button
            type="button"
            onClick={() => { setAbierto((v) => !v); setError(null); }}
            title={`Agregar ${etiqueta.toLowerCase()} sin salir de esta pantalla`}
            aria-label={`Agregar ${etiqueta.toLowerCase()}`}
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600"
          >
            {abierto ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>
        ) : null}
      </div>

      {ayuda && !abierto ? <p className="mt-1 text-[0.6875rem] text-slate-500">{ayuda}</p> : null}

      {abierto ? (
        <div className="mt-2 grid gap-2 rounded-lg border border-brand-200 bg-brand-50/50 p-2.5">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-brand-700">
            Nueva opcion
          </p>
          {camposAlta.map((campo) => (
            <input
              key={campo.nombre}
              className="field"
              placeholder={campo.etiqueta + (campo.requerido ? "" : " (opcional)")}
              value={form[campo.nombre] ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, [campo.nombre]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") crear(e); }}
            />
          ))}
          {error ? <p className="text-[0.6875rem] text-red-600">{error}</p> : null}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={crear}
              disabled={guardando || camposAlta.some((c) => c.requerido && !form[c.nombre]?.trim())}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Agregar y seleccionar
            </button>
            <button
              type="button"
              onClick={() => { setAbierto(false); setError(null); }}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
