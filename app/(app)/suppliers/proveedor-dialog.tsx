"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui";

export type ProveedorEditable = {
  id: string; name: string;
  contactName: string | null; email: string | null; phone: string | null;
  address: string | null; leadTimeDays: number; notes: string | null;
};

const CAMPOS = [
  { nombre: "name", etiqueta: "Nombre", requerido: true, ancho: "sm:col-span-2" },
  { nombre: "contactName", etiqueta: "Contacto" },
  { nombre: "phone", etiqueta: "Telefono" },
  { nombre: "email", etiqueta: "Correo", tipo: "email" },
  { nombre: "leadTimeDays", etiqueta: "Días de entrega", tipo: "number", ayuda: "Lo que tarda en surtir" },
  { nombre: "address", etiqueta: "Direccion", ancho: "sm:col-span-2" },
] as const;

export function ProveedorDialog({ proveedor }: { proveedor?: ProveedorEditable }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editando = Boolean(proveedor);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setGuardando(true); setError(null);
    const datos = Object.fromEntries(new FormData(e.currentTarget).entries());
    const r = await fetch(editando ? `/api/suppliers/${proveedor!.id}` : "/api/suppliers", {
      method: editando ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    const respuesta = await r.json().catch(() => ({}));
    setGuardando(false);
    if (!r.ok) { setError(respuesta.error ?? "No fue posible guardar"); return; }
    setAbierto(false);
    router.refresh();
  }

  return (
    <>
      {editando ? (
        <button
          type="button" onClick={() => setAbierto(true)} title="Editar proveedor"
          className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Button type="button" size="sm" onClick={() => setAbierto(true)}>
          <Plus className="h-3.5 w-3.5" /> Nuevo proveedor
        </Button>
      )}

      {abierto ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 text-left">
          <form onSubmit={enviar} className="mt-12 w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-800">
              {editando ? `Editar ${proveedor!.name}` : "Nuevo proveedor"}
            </h2>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {CAMPOS.map((c) => (
                <div key={c.nombre} className={"ancho" in c ? c.ancho : undefined}>
                  <label className="text-[0.6875rem] font-medium text-slate-600">
                    {c.etiqueta}{"requerido" in c && c.requerido ? " *" : ""}
                  </label>
                  <input
                    name={c.nombre}
                    type={"tipo" in c ? c.tipo : "text"}
                    required={"requerido" in c && c.requerido}
                    defaultValue={
                      proveedor
                        ? String(proveedor[c.nombre as keyof ProveedorEditable] ?? "")
                        : c.nombre === "leadTimeDays" ? "7" : ""
                    }
                    className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                  />
                  {"ayuda" in c && c.ayuda ? <p className="mt-0.5 text-[0.625rem] text-slate-400">{c.ayuda}</p> : null}
                </div>
              ))}

              <div className="sm:col-span-2">
                <label className="text-[0.6875rem] font-medium text-slate-600">Notas</label>
                <textarea
                  name="notes" rows={2}
                  defaultValue={proveedor?.notes ?? ""}
                  placeholder="Condiciones de pago, horarios de entrega, con quien hablar cuando urge…"
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                />
              </div>
            </div>

            {error ? (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
