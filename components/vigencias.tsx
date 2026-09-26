"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, ShieldCheck, X } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  ETIQUETA_ESTADO, ORDEN_TIPOS, TIPOS_VIGENCIA, diasParaVencer, estadoDeVigencia,
  nombreDeTipo, type Anclaje, type EstadoVigencia, type TipoVigencia,
} from "@/lib/vigencias-tipos";

/**
 * Los documentos con vigencia de un registro: garantia, poliza, contrato,
 * calibracion, permiso, licencia, certificado.
 *
 * Importa de `@/lib/vigencias-tipos` y NUNCA de `@/lib/vigencias`: ese otro
 * trae prisma y el emisor de avisos, y en un componente de cliente eso
 * termina en un «no encuentro fs» que no dice nada de la causa.
 */

type Vigencia = {
  id: string;
  tipo: string;
  titulo: string;
  folio: string | null;
  desde: string | null;
  hasta: string | null;
  avisarDias: number | null;
  cubre: string | null;
  nota: string | null;
  activa: boolean;
  supplier: { id: string; name: string } | null;
  asset: { id: string; code: string; name: string } | null;
  part: { id: string; code: string; name: string } | null;
  user: { id: string; name: string } | null;
  service: { id: string; code: string; name: string } | null;
};

type Proveedor = { id: string; name: string };

const TONO: Record<EstadoVigencia, "success" | "warning" | "danger" | "muted" | "info"> = {
  VIGENTE: "success", POR_VENCER: "warning", VENCIDA: "danger",
  CANCELADA: "muted", SIN_VENCIMIENTO: "info",
};

const dia = (iso: string | null, zona: string) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: zona }) : "—";

/** «vence en 12 días» / «venció hace 3 días». Es lo que se lee primero. */
function cuanto(v: Vigencia): string {
  const d = diasParaVencer(v.hasta);
  if (d === null) return "no caduca";
  if (d === 0) return "vence hoy";
  return d > 0 ? `vence en ${d} día${d === 1 ? "" : "s"}` : `venció hace ${Math.abs(d)} día${Math.abs(d) === 1 ? "" : "s"}`;
}

export function Vigencias({
  ancla, anclaId, zona, puedeEscribir, titulo = "Garantías y vigencias", tiposSugeridos,
}: {
  /** De qué cuelgan: assetId, partId, userId o serviceId. */
  ancla: Anclaje;
  anclaId: string;
  /** La zona de la empresa: un vencimiento no puede correrse un día. */
  zona: string;
  puedeEscribir: boolean;
  titulo?: string;
  /** Los tipos que tienen sentido aquí. Si no se da, todos. */
  tiposSugeridos?: TipoVigencia[];
}) {
  const [lista, setLista] = useState<Vigencia[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tipos = tiposSugeridos?.length ? tiposSugeridos : ORDEN_TIPOS;
  const [form, setForm] = useState({
    tipo: tipos[0] as string, titulo: "", folio: "", desde: "", hasta: "", cubre: "", supplierId: "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function traer() {
    try {
      const r = await fetch(`/api/vigencias?${ancla}=${encodeURIComponent(anclaId)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudieron leer las vigencias."); return; }
      setLista(d.vigencias ?? []); setProveedores(d.proveedores ?? []); setError(null);
    } catch {
      setError("Se perdió la conexión.");
    } finally { setCargando(false); }
  }

  useEffect(() => { void traer(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ancla, anclaId]);

  async function guardar() {
    if (!form.titulo.trim() || guardando) return;
    setGuardando(true); setError(null);
    try {
      const r = await fetch("/api/vigencias", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [ancla]: anclaId,
          tipo: form.tipo, titulo: form.titulo.trim(),
          folio: form.folio || null, desde: form.desde || null, hasta: form.hasta || null,
          cubre: form.cubre || null, supplierId: form.supplierId || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo guardar."); return; }
      setForm({ tipo: tipos[0] as string, titulo: "", folio: "", desde: "", hasta: "", cubre: "", supplierId: "" });
      setAbierto(false);
      await traer();
    } catch {
      setError("Se perdió la conexión. Lo que escribió sigue aquí.");
    } finally { setGuardando(false); }
  }

  async function cancelar(id: string, activa: boolean) {
    const r = await fetch(`/api/vigencias/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activa }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? "No se pudo cambiar."); return; }
    await traer();
  }

  const def = TIPOS_VIGENCIA[form.tipo as TipoVigencia];

  return (
    <Card>
      <CardHeader
        title={titulo}
        subtitle="Lo que se vence y hay que renovar a tiempo: garantías, pólizas, contratos, calibraciones y permisos."
        action={puedeEscribir ? (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Registrar
          </button>
        ) : undefined}
      />

      {abierto ? (
        <div className="mb-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex flex-wrap gap-2">
            <select className="field flex-1" value={form.tipo} onChange={(e) => set("tipo", e.target.value)} aria-label="Tipo de documento">
              {tipos.map((t) => <option key={t} value={t}>{TIPOS_VIGENCIA[t].nombre}</option>)}
            </select>
            <input className="field flex-1" value={form.titulo} onChange={(e) => set("titulo", e.target.value.slice(0, 160))}
              placeholder="Cómo le llaman: «Garantía de fábrica»" aria-label="Nombre" />
          </div>
          {def ? <p className="text-[0.625rem] text-slate-500">{def.descripcion} Avisa {def.avisarDias} días antes.</p> : null}
          <div className="flex flex-wrap gap-2">
            <input className="field flex-1" value={form.folio} onChange={(e) => set("folio", e.target.value.slice(0, 60))}
              placeholder="Folio o número (opcional)" aria-label="Folio" />
            <label className="flex-1 text-[0.625rem] text-slate-500">
              Desde
              <input type="date" className="field" value={form.desde} onChange={(e) => set("desde", e.target.value)} aria-label="Desde" />
            </label>
            <label className="flex-1 text-[0.625rem] text-slate-500">
              Hasta
              <input type="date" className="field" value={form.hasta} onChange={(e) => set("hasta", e.target.value)} aria-label="Hasta" />
            </label>
          </div>
          {def?.pideProveedor ? (
            <select className="field" value={form.supplierId} onChange={(e) => set("supplierId", e.target.value)} aria-label="A quién se le reclama">
              <option value="">¿A quién se le reclama? (opcional)</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : null}
          <textarea className="field" rows={2} value={form.cubre} onChange={(e) => set("cubre", e.target.value.slice(0, 2000))}
            placeholder="Qué cubre y qué no. Es lo que alguien va a leer cuando llegue la falla." aria-label="Qué cubre" />
          <button
            type="button" onClick={() => void guardar()} disabled={guardando || !form.titulo.trim()}
            className="justify-self-start rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40"
          >
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : "Guardar"}
          </button>
        </div>
      ) : null}

      {error ? <p className="mb-2 text-xs text-rose-700">{error}</p> : null}

      {cargando ? (
        <p className="py-3 text-center text-xs text-slate-400">
          <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Cargando…
        </p>
      ) : lista.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-400">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden /> Sin documentos registrados.
        </p>
      ) : (
        <ul className="grid gap-2">
          {lista.map((v) => {
            const estado = estadoDeVigencia(v);
            return (
              <li key={v.id} className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2",
                estado === "CANCELADA" ? "border-slate-100 bg-slate-50/50" : "border-slate-200",
              )}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm leading-snug">
                    <span className={cn("font-medium", estado === "CANCELADA" ? "text-slate-400 line-through" : "text-slate-800")}>
                      {v.titulo}
                    </span>
                    <Badge tone={TONO[estado]}>{ETIQUETA_ESTADO[estado]}</Badge>
                  </p>
                  <p className="mt-0.5 text-[0.625rem] text-slate-500">
                    {nombreDeTipo(v.tipo)}
                    {v.folio ? ` · ${v.folio}` : ""}
                    {v.hasta ? ` · hasta ${dia(v.hasta, zona)} (${cuanto(v)})` : " · sin vencimiento"}
                    {v.supplier ? ` · ${v.supplier.name}` : ""}
                  </p>
                  {v.cubre ? <p className="mt-1 text-[0.6875rem] text-slate-600">{v.cubre}</p> : null}
                </div>
                {puedeEscribir ? (
                  <button
                    type="button" onClick={() => void cancelar(v.id, !v.activa)}
                    className="shrink-0 rounded px-1.5 py-1 text-[0.625rem] text-slate-500 hover:bg-slate-100"
                    title={v.activa ? "Cancelar sin borrarla: se conserva como historia" : "Volver a activarla"}
                  >
                    {v.activa ? <X className="h-3.5 w-3.5" aria-hidden /> : "Reactivar"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
