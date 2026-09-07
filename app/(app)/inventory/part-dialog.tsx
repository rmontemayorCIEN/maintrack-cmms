"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui";
import { SelectCatalogo, type OpcionCatalogo } from "@/components/select-catalogo";

/** Al migrar valores de texto libre el nombre queda igual al codigo; repetirlo
 *  ("pza — pza") no aporta nada. */
function etiquetaCatalogo(code: string, name: string) {
  return name && name.toLowerCase() !== code.toLowerCase() ? `${code} — ${name}` : code;
}

export type RefaccionEditable = {
  id: string; code: string; name: string; description: string | null;
  category: string | null; unit: string; unitCost: number;
  minQuantity: number; maxQuantity: number; bin: string | null;
  supplierId: string | null;
};

export function PartDialog({
  suppliers,
  familias,
  unidades,
  refaccion,
  puedeGestionarCatalogos = false,
}: {
  suppliers: Array<{ id: string; name: string }>;
  familias: Array<{ code: string; name: string }>;
  unidades: Array<{ code: string; name: string }>;
  /** Si viene, el dialogo edita esa refaccion en vez de crear una nueva. */
  refaccion?: RefaccionEditable;
  puedeGestionarCatalogos?: boolean;
}) {
  const router = useRouter();
  const editando = Boolean(refaccion);
  const [opcionesProveedores, setOpcionesProveedores] = useState<OpcionCatalogo[]>(
    suppliers.map((s) => ({ id: s.id, etiqueta: s.name })),
  );
  const [opcionesFamilias, setOpcionesFamilias] = useState<OpcionCatalogo[]>(
    familias.map((f) => ({ id: f.code, etiqueta: etiquetaCatalogo(f.code, f.name) })),
  );
  const [opcionesUnidades, setOpcionesUnidades] = useState<OpcionCatalogo[]>(
    unidades.map((u) => ({ id: u.code, etiqueta: etiquetaCatalogo(u.code, u.name) })),
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: refaccion?.code ?? "",
    name: refaccion?.name ?? "",
    description: refaccion?.description ?? "",
    category: refaccion?.category ?? "",
    unit: refaccion?.unit ?? unidades.find((u) => u.code === "pza")?.code ?? unidades[0]?.code ?? "",
    unitCost: String(refaccion?.unitCost ?? 0),
    quantityOnHand: "0",
    minQuantity: String(refaccion?.minQuantity ?? 0),
    maxQuantity: String(refaccion?.maxQuantity ?? 0),
    bin: refaccion?.bin ?? "",
    supplierId: refaccion?.supplierId ?? "",
  });

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch(editando ? `/api/parts/${refaccion!.id}` : "/api/parts", {
      method: editando ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        unitCost: Number(form.unitCost),
        quantityOnHand: Number(form.quantityOnHand),
        minQuantity: Number(form.minQuantity),
        maxQuantity: Number(form.maxQuantity),
        supplierId: form.supplierId || null,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? `No fue posible ${editando ? "guardar los cambios" : "registrar la refacción"}`);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return editando ? (
      <button
        type="button" onClick={() => setOpen(true)} title="Editar refaccion"
        className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    ) : (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Nueva refacción
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/40 p-4">
      <form onSubmit={submit} className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {editando ? `Editar ${refaccion!.code}` : "Nueva refacción"}
            </h3>
            {editando ? (
              <p className="mt-0.5 text-xs text-slate-500">
                La existencia no se edita aquí: se mueve con entradas, salidas y ajustes.
              </p>
            ) : null}
          </div>
          <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Código</label>
            <input className="field" value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} required disabled={editando} />
          </div>
          <div>
            <label className="label">Nombre</label>
            <input className="field" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Descripción</label>
            <input className="field" value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <SelectCatalogo
            catalogo="part-categories"
            etiqueta="Familia"
            valor={form.category}
            onChange={(v) => set("category", v)}
            opciones={opcionesFamilias}
            onOpcionesChange={setOpcionesFamilias}
            puedeCrear={puedeGestionarCatalogos}
            vacioTexto="Sin familia"
            claveValor="code"
            camposAlta={[
              { nombre: "code", etiqueta: "Código (ej. RETENES)", requerido: true },
              { nombre: "name", etiqueta: "Nombre de la familia", requerido: true },
            ]}
          />

          <SelectCatalogo
            catalogo="part-units"
            etiqueta="Unidad de medida"
            valor={form.unit}
            onChange={(v) => set("unit", v)}
            opciones={opcionesUnidades}
            onOpcionesChange={setOpcionesUnidades}
            puedeCrear={puedeGestionarCatalogos}
            requerido
            claveValor="code"
            camposAlta={[
              { nombre: "code", etiqueta: "Código corto (ej. galon)", requerido: true },
              { nombre: "name", etiqueta: "Nombre completo", requerido: true },
            ]}
          />
          <div>
            <label className="label">Costo unitario</label>
            <input type="number" min="0" step="0.01" className="field" value={form.unitCost} onChange={(e) => set("unitCost", e.target.value)} />
          </div>
          {!editando ? (
            <div>
              <label className="label">Existencia inicial</label>
              <input type="number" min="0" step="0.5" className="field" value={form.quantityOnHand} onChange={(e) => set("quantityOnHand", e.target.value)} />
            </div>
          ) : null}
          <div>
            <label className="label">Mínimo (punto de reorden)</label>
            <input type="number" min="0" step="0.5" className="field" value={form.minQuantity} onChange={(e) => set("minQuantity", e.target.value)} />
          </div>
          <div>
            <label className="label">Máximo</label>
            <input type="number" min="0" step="0.5" className="field" value={form.maxQuantity} onChange={(e) => set("maxQuantity", e.target.value)} />
          </div>
          <div>
            <label className="label">Ubicación en almacén</label>
            <input className="field" value={form.bin} onChange={(e) => set("bin", e.target.value)} placeholder="Ej. A-03-2" />
          </div>
          <SelectCatalogo
            catalogo="suppliers"
            etiqueta="Proveedor"
            valor={form.supplierId}
            onChange={(v) => set("supplierId", v)}
            opciones={opcionesProveedores}
            onOpcionesChange={setOpcionesProveedores}
            puedeCrear={puedeGestionarCatalogos}
            vacioTexto="Sin proveedor"
            camposAlta={[
              { nombre: "name", etiqueta: "Nombre del proveedor", requerido: true },
              { nombre: "contactName", etiqueta: "Contacto" },
              { nombre: "phone", etiqueta: "Telefono" },
            ]}
          />
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {editando ? "Guardar cambios" : "Registrar"}
          </Button>
        </div>
      </form>
    </div>
  );
}
