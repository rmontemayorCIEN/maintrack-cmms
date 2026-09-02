"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { SelectorBuscable } from "@/components/selector-buscable";

export function NuevoPunto({
  sitios, ubicaciones, activos,
}: {
  sitios: { id: string; name: string }[];
  ubicaciones: { id: string; name: string; siteId: string }[];
  activos: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [siteId, setSiteId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ubicacionesDelSitio = useMemo(
    () => (siteId ? ubicaciones.filter((u) => u.siteId === siteId) : ubicaciones),
    [ubicaciones, siteId],
  );

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true); setError(null);
    const res = await fetch("/api/puntos-reporte", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, siteId: siteId || null, locationId: locationId || null, assetId: assetId || null }),
    });
    const data = await res.json().catch(() => ({}));
    setOcupado(false);
    if (!res.ok) { setError(data.error ?? "No fue posible crear el punto"); return; }
    setAbierto(false); setNombre(""); setSiteId(""); setLocationId(""); setAssetId("");
    router.refresh();
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setAbierto(true)}>
        <Plus className="h-3.5 w-3.5" /> Nuevo punto
      </Button>

      {abierto ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 text-left">
          <form onSubmit={crear} className="mt-16 w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-800">Nuevo punto de reporte</h2>
            <p className="mt-0.5 text-[0.6875rem] text-slate-500">
              Para lugares sin equipo registrado: un salón, un baño, un pasillo. Los equipos ya
              generan su código solo, desde su propia ficha.
            </p>

            <div className="mt-3 grid gap-3">
              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Nombre del punto *</label>
                <input
                  value={nombre} onChange={(e) => setNombre(e.target.value)} required minLength={3} maxLength={80}
                  placeholder="Salón 3, Cuarto de máquinas, Bomba del hidroneumático"
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Sitio</label>
                <select value={siteId} onChange={(e) => { setSiteId(e.target.value); setLocationId(""); }}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                  <option value="">Sin especificar</option>
                  {sitios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Área o ubicación</label>
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                  <option value="">Sin especificar</option>
                  {ubicacionesDelSitio.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Equipo</label>
                <SelectorBuscable
                  className="mt-0.5"
                  valor={assetId}
                  onCambio={setAssetId}
                  vacio="Sin especificar"
                  marcador="Busque por clave o nombre del equipo"
                  opciones={activos.map((a) => ({ id: a.id, etiqueta: `${a.code} — ${a.name}` }))}
                />
                <p className="mt-0.5 text-[0.625rem] text-slate-400">
                  Solo si quiere un segundo código para ese equipo. El suyo propio ya existe en
                  su ficha.
                </p>
              </div>
            </div>

            {error ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button type="submit" disabled={ocupado}>
                {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Crear y generar QR
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
