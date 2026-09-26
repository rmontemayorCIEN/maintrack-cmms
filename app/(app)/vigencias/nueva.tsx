"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Dialogo } from "@/components/ui/dialogo";
import { ORDEN_TIPOS, TIPOS_VIGENCIA, type Anclaje, type TipoVigencia } from "@/lib/vigencias-tipos";

/**
 * Registrar un documento con vigencia desde la pantalla general.
 *
 * Aqui hay que preguntar de QUE cuelga, que es lo unico que no se pregunta
 * cuando se registra desde el expediente de un equipo. El tipo decide de que
 * puede colgar: una licencia es de una persona y una calibracion de un
 * instrumento, y ofrecer las cuatro opciones siempre invitaba a colgar la
 * poliza del seguro de un usuario.
 */

type Opcion = { id: string; etiqueta: string };

const ETIQUETA_ANCLA: Record<Anclaje, string> = {
  assetId: "Equipo", partId: "Refacción", userId: "Persona", serviceId: "Servicio externo",
};

export function NuevaVigencia() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opciones, setOpciones] = useState<Record<Anclaje, Opcion[]> | null>(null);
  const [proveedores, setProveedores] = useState<Opcion[]>([]);

  const [tipo, setTipo] = useState<TipoVigencia>("GARANTIA");
  const [ancla, setAncla] = useState<Anclaje>("assetId");
  const [anclaId, setAnclaId] = useState("");
  const [form, setForm] = useState({ titulo: "", folio: "", desde: "", hasta: "", cubre: "", supplierId: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const def = TIPOS_VIGENCIA[tipo];

  useEffect(() => {
    if (!abierto || opciones) return;
    void (async () => {
      const r = await fetch("/api/vigencias/opciones").catch(() => null);
      const d = await r?.json().catch(() => ({}));
      setOpciones(d?.opciones ?? null);
      setProveedores(d?.proveedores ?? []);
    })();
  }, [abierto, opciones]);

  // Al cambiar el tipo, el anclaje se mueve al primero que ese tipo admite: es
  // lo que evita colgar una licencia de un equipo.
  useEffect(() => {
    if (!def.anclajes.includes(ancla)) { setAncla(def.anclajes[0]); setAnclaId(""); }
  }, [tipo, def.anclajes, ancla]);

  async function guardar() {
    if (!form.titulo.trim() || !anclaId || guardando) return;
    setGuardando(true); setError(null);
    try {
      const r = await fetch("/api/vigencias", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo, [ancla]: anclaId, titulo: form.titulo.trim(),
          folio: form.folio || null, desde: form.desde || null, hasta: form.hasta || null,
          cubre: form.cubre || null, supplierId: form.supplierId || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo guardar."); return; }
      setAbierto(false);
      setForm({ titulo: "", folio: "", desde: "", hasta: "", cubre: "", supplierId: "" });
      setAnclaId("");
      router.refresh();
    } catch {
      setError("Se perdió la conexión. Lo que escribió sigue aquí.");
    } finally { setGuardando(false); }
  }

  const lista = opciones?.[ancla] ?? [];

  return (
    <>
      <button
        type="button" onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        <Plus className="h-4 w-4" aria-hidden /> Registrar documento
      </button>

      {abierto ? (
      <Dialogo onCerrar={() => setAbierto(false)} titulo="Registrar un documento con vigencia">
        <div className="grid gap-3">
          <label className="text-xs text-slate-600">
            Tipo de documento
            <select className="field" value={tipo} onChange={(e) => setTipo(e.target.value as TipoVigencia)}>
              {ORDEN_TIPOS.map((t) => <option key={t} value={t}>{TIPOS_VIGENCIA[t].nombre}</option>)}
            </select>
            <span className="mt-1 block text-[0.625rem] text-slate-500">{def.descripcion} Avisa {def.avisarDias} días antes.</span>
          </label>

          <div className="flex flex-wrap gap-2">
            {def.anclajes.length > 1 ? (
              <label className="flex-1 text-xs text-slate-600">
                Cubre a
                <select className="field" value={ancla} onChange={(e) => { setAncla(e.target.value as Anclaje); setAnclaId(""); }}>
                  {def.anclajes.map((a) => <option key={a} value={a}>{ETIQUETA_ANCLA[a]}</option>)}
                </select>
              </label>
            ) : null}
            <label className="flex-[2] text-xs text-slate-600">
              {def.anclajes.length > 1 ? "Cuál" : ETIQUETA_ANCLA[ancla]}
              <select className="field" value={anclaId} onChange={(e) => setAnclaId(e.target.value)}>
                <option value="">{opciones ? "Elija uno…" : "Cargando…"}</option>
                {lista.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
              </select>
            </label>
          </div>

          <label className="text-xs text-slate-600">
            Cómo le llaman
            <input className="field" value={form.titulo} onChange={(e) => set("titulo", e.target.value.slice(0, 160))}
              placeholder="«Garantía de fábrica», «Póliza GNP 44812»" />
          </label>

          <div className="flex flex-wrap gap-2">
            <label className="flex-1 text-xs text-slate-600">
              Folio o número
              <input className="field" value={form.folio} onChange={(e) => set("folio", e.target.value.slice(0, 60))} />
            </label>
            <label className="flex-1 text-xs text-slate-600">
              Desde
              <input type="date" className="field" value={form.desde} onChange={(e) => set("desde", e.target.value)} />
            </label>
            <label className="flex-1 text-xs text-slate-600">
              Hasta
              <input type="date" className="field" value={form.hasta} onChange={(e) => set("hasta", e.target.value)} />
            </label>
          </div>

          {def.pideProveedor ? (
            <label className="text-xs text-slate-600">
              ¿A quién se le reclama?
              <select className="field" value={form.supplierId} onChange={(e) => set("supplierId", e.target.value)}>
                <option value="">Sin proveedor</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}
              </select>
            </label>
          ) : null}

          <label className="text-xs text-slate-600">
            Qué cubre y qué no
            <textarea className="field" rows={3} value={form.cubre} onChange={(e) => set("cubre", e.target.value.slice(0, 2000))}
              placeholder="Es lo que alguien va a leer cuando llegue la falla." />
          </label>

          {error ? <p className="text-xs text-rose-700">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAbierto(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Cancelar
            </button>
            <button
              type="button" onClick={() => void guardar()} disabled={guardando || !form.titulo.trim() || !anclaId}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Guardar
            </button>
          </div>
        </div>
      </Dialogo>
      ) : null}
    </>
  );
}
