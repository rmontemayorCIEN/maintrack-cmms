"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui";
import { SelectCatalogo, type OpcionCatalogo } from "@/components/select-catalogo";
import { ASSET_STATUS_LABELS, CRITICALITY_LABELS } from "@/lib/constants";

export type ActivoEditable = {
  id: string; code: string; name: string; description: string | null;
  siteId: string; locationId: string | null; categoryId: string | null; centroDeCostoId: string | null;
  manufacturer: string | null; model: string | null; serialNumber: string | null;
  criticality: string; status: string;
  detieneLinea: boolean | null;
  purchaseDate: string | null; warrantyExpiry: string | null;
  purchaseCost: number; replacementCost: number;
};

export function AssetDialog({
  sites,
  locations,
  categories,
  centrosDeCosto,
  activo,
  puedeGestionarCatalogos = false,
  abrirAlInicio = false,
}: {
  sites: Array<{ id: string; name: string; code?: string }>;
  locations: Array<{ id: string; name: string; siteId: string; code?: string }>;
  categories: Array<{ id: string; name: string; code?: string }>;
  centrosDeCosto: Array<{ id: string; name: string; code?: string }>;
  /** Si viene, el dialogo edita ese activo en vez de crear uno nuevo. */
  activo?: ActivoEditable;
  puedeGestionarCatalogos?: boolean;
  /** La acción rápida «Crear activo» llega con el formulario abierto. */
  abrirAlInicio?: boolean;
}) {
  const router = useRouter();
  const editando = Boolean(activo);
  const [open, setOpen] = useState(abrirAlInicio);

  // Las listas viven en estado para que el alta rapida desde el "+" las refresque.
  const [opcionesSitios, setOpcionesSitios] = useState<OpcionCatalogo[]>(
    sites.map((x) => ({ id: x.id, etiqueta: x.code ? `${x.code} — ${x.name}` : x.name })),
  );
  const [opcionesUbicaciones, setOpcionesUbicaciones] = useState(
    locations.map((x) => ({ id: x.id, etiqueta: x.code ? `${x.code} — ${x.name}` : x.name, siteId: x.siteId })),
  );
  const [opcionesCategorias, setOpcionesCategorias] = useState<OpcionCatalogo[]>(
    categories.map((x) => ({ id: x.id, etiqueta: x.code ? `${x.code} — ${x.name}` : x.name })),
  );
  const [opcionesCentros, setOpcionesCentros] = useState<OpcionCatalogo[]>(
    centrosDeCosto.map((x) => ({ id: x.id, etiqueta: x.code ? `${x.code} — ${x.name}` : x.name })),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: activo?.code ?? "",
    name: activo?.name ?? "",
    description: activo?.description ?? "",
    siteId: activo?.siteId ?? sites[0]?.id ?? "",
    locationId: activo?.locationId ?? "",
    categoryId: activo?.categoryId ?? "",
    centroDeCostoId: activo?.centroDeCostoId ?? "",
    manufacturer: activo?.manufacturer ?? "",
    model: activo?.model ?? "",
    serialNumber: activo?.serialNumber ?? "",
    criticality: activo?.criticality ?? "B",
    // Vacio = nadie lo ha dicho. No se adivina: un "no" por omision daria
    // un costo de paro bajo que parece exacto.
    detieneLinea: activo?.detieneLinea === true ? "SI" : activo?.detieneLinea === false ? "NO" : "",
    status: activo?.status ?? "OPERATIONAL",
    purchaseDate: activo?.purchaseDate?.slice(0, 10) ?? "",
    purchaseCost: String(activo?.purchaseCost ?? 0),
    replacementCost: String(activo?.replacementCost ?? 0),
    warrantyExpiry: activo?.warrantyExpiry?.slice(0, 10) ?? "",
  });

  const siteLocations = useMemo(
    () => opcionesUbicaciones.filter((l) => l.siteId === form.siteId),
    [opcionesUbicaciones, form.siteId],
  );

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch(editando ? `/api/assets/${activo!.id}` : "/api/assets", {
      method: editando ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        purchaseCost: Number(form.purchaseCost),
        replacementCost: Number(form.replacementCost),
        purchaseDate: form.purchaseDate || null,
        warrantyExpiry: form.warrantyExpiry || null,
        locationId: form.locationId || null,
        categoryId: form.categoryId || null,
        centroDeCostoId: form.centroDeCostoId || null,
        // El select maneja tres estados y el campo es booleano nulable: vacio
        // viaja como null, que es "nadie lo ha dicho".
        detieneLinea: form.detieneLinea === "SI" ? true : form.detieneLinea === "NO" ? false : null,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? `No fue posible ${editando ? "guardar los cambios" : "registrar el activo"}`);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return editando ? (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" /> Editar activo
      </Button>
    ) : (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Nuevo activo
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 p-4">
      <form onSubmit={submit} className="mx-auto my-6 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {editando ? `Editar ${activo!.code}` : "Nuevo activo"}
            </h3>
            {puedeGestionarCatalogos ? (
              <p className="mt-0.5 text-xs text-slate-500">
                Use el <strong>+</strong> junto a Sitio, Ubicación o Categoria para agregar opciones sin salir de aquí.
              </p>
            ) : null}
          </div>
          <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Código (TAG)</label>
            <input className="field" value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="Ej. BOM-101" required disabled={editando} />
            {editando ? <p className="mt-1 text-[0.6875rem] text-slate-500">El código identifica al activo en el historial y no se cambia.</p> : null}
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
            catalogo="sites"
            etiqueta="Sitio"
            valor={form.siteId}
            onChange={(v) => { set("siteId", v); set("locationId", ""); }}
            opciones={opcionesSitios}
            onOpcionesChange={setOpcionesSitios}
            puedeCrear={puedeGestionarCatalogos}
            requerido
            camposAlta={[
              { nombre: "code", etiqueta: "Código (ej. P02)", requerido: true },
              { nombre: "name", etiqueta: "Nombre de la planta", requerido: true },
              { nombre: "city", etiqueta: "Ciudad" },
            ]}
          />

          <SelectCatalogo
            catalogo="locations"
            etiqueta="Ubicacion"
            valor={form.locationId}
            onChange={(v) => set("locationId", v)}
            opciones={siteLocations.map(({ id, etiqueta }) => ({ id, etiqueta }))}
            onOpcionesChange={(nuevas) =>
              // La API devuelve todas las ubicaciones; se conserva su sitio para
              // poder seguir filtrando por el sitio elegido.
              setOpcionesUbicaciones(
                (nuevas as Array<OpcionCatalogo & { siteId?: string }>).map((n) => ({
                  ...n,
                  siteId: n.siteId ?? form.siteId,
                })),
              )
            }
            puedeCrear={puedeGestionarCatalogos && Boolean(form.siteId)}
            vacioTexto="Sin ubicación"
            contextoAlta={{ siteId: form.siteId }}
            camposAlta={[
              { nombre: "code", etiqueta: "Código (ej. LIN-A)", requerido: true },
              { nombre: "name", etiqueta: "Nombre del área", requerido: true },
            ]}
            ayuda="Se agrega dentro del sitio seleccionado"
          />

          <SelectCatalogo
            catalogo="categories"
            etiqueta="Categoria"
            valor={form.categoryId}
            onChange={(v) => set("categoryId", v)}
            opciones={opcionesCategorias}
            onOpcionesChange={setOpcionesCategorias}
            puedeCrear={puedeGestionarCatalogos}
            vacioTexto="Sin categoría"
            camposAlta={[
              { nombre: "code", etiqueta: "Código (ej. BOMB)", requerido: true },
              { nombre: "name", etiqueta: "Nombre de la familia", requerido: true },
            ]}
          />
          {/* El eje contable, junto a los de sitio y categoría que son los
              físicos: es lo que permite entregar el costo de mantenimiento
              agrupado como lo pide contabilidad. */}
          <SelectCatalogo
            catalogo="cost-centers"
            etiqueta="Centro de costo"
            valor={form.centroDeCostoId}
            onChange={(v) => set("centroDeCostoId", v)}
            opciones={opcionesCentros}
            onOpcionesChange={setOpcionesCentros}
            puedeCrear={puedeGestionarCatalogos}
            vacioTexto="Sin centro de costo"
            camposAlta={[
              { nombre: "code", etiqueta: "Clave de contabilidad (ej. 5010-PROD)", requerido: true },
              { nombre: "name", etiqueta: "Nombre del centro", requerido: true },
            ]}
            ayuda="Sus órdenes de trabajo lo heredan, y ahí se puede cambiar cuando el trabajo lo paga otra área"
          />

          <div>
            <label className="label">Criticidad</label>
            <select className="field" value={form.criticality} onChange={(e) => set("criticality", e.target.value)}>
              {Object.entries(CRITICALITY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Si para, ¿detiene la producción?</label>
            <select
              className="field"
              value={form.detieneLinea}
              onChange={(e) => set("detieneLinea", e.target.value)}
            >
              <option value="">Sin definir</option>
              <option value="SI">Sí, se detiene el área</option>
              <option value="NO">No, se sigue produciendo</option>
            </select>
            {/*
              Es distinto de la criticidad: la criticidad habla de consecuencia
              en general —seguridad, costo, normativa— y esto solo de si se
              detiene la produccion. Un extractor de humos puede ser critico por
              seguridad y no parar la linea.
            */}
            <p className="mt-1 text-[0.6875rem] leading-relaxed text-slate-500">
              De aquí sale cuánto cuesta que este equipo falle. No es lo mismo que la
              criticidad: el extractor de humos puede ser crítico por seguridad y aun así
              no detener la producción. Sin definir, sus paros no se cuentan como pérdida.
            </p>
          </div>
          <div>
            <label className="label">Fabricante</label>
            <input className="field" value={form.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} />
          </div>
          <div>
            <label className="label">Modelo</label>
            <input className="field" value={form.model} onChange={(e) => set("model", e.target.value)} />
          </div>
          <div>
            <label className="label">Número de serie</label>
            <input className="field" value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} />
          </div>
          <div>
            <label className="label">Estado</label>
            <select className="field" value={form.status} onChange={(e) => set("status", e.target.value)}>
              {Object.entries(ASSET_STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Fecha de compra</label>
            <input type="date" className="field" value={form.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} />
          </div>
          <div>
            <label className="label">Fin de garantía</label>
            <input type="date" className="field" value={form.warrantyExpiry} onChange={(e) => set("warrantyExpiry", e.target.value)} />
          </div>
          <div>
            <label className="label">Costo de adquisición</label>
            <input type="number" inputMode="decimal" min="0" className="field" value={form.purchaseCost} onChange={(e) => set("purchaseCost", e.target.value)} />
          </div>
          <div>
            <label className="label">Costo de reposición</label>
            <input type="number" inputMode="decimal" min="0" className="field" value={form.replacementCost} onChange={(e) => set("replacementCost", e.target.value)} />
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {editando ? "Guardar cambios" : "Registrar activo"}
          </Button>
        </div>
      </form>
    </div>
  );
}
