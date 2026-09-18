"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { useZona } from "@/components/zona-empresa";
import { ETIQUETA_MODULO, ETIQUETA_PRIORIDAD, PRIORIDADES, type Modulo } from "@/lib/avisos/catalogo";
import { TarjetaAviso, type AvisoVista } from "@/components/avisos/aviso";

const ESTADOS = [
  { valor: "", texto: "Todos" },
  { valor: "pendientes", texto: "Pendientes de atención" },
  { valor: "no_leidas", texto: "No leídos" },
  { valor: "atendidas", texto: "Atendidos" },
];

/** El centro de avisos: filtros, lectura, «Enterado» e historial hacia atrás. */
export function CentroDeAvisos() {
  const zona = useZona();
  const [filtros, setFiltros] = useState({ estado: "pendientes", prioridad: "", modulo: "", desde: "", hasta: "" });
  const [avisos, setAvisos] = useState<AvisoVista[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cuentas, setCuentas] = useState({ noLeidas: 0, pendientes: 0 });
  const [avisosEn, setAvisosEn] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const consulta = useCallback((desdeCursor?: string | null) => {
    const q = new URLSearchParams({ limite: "30" });
    for (const [k, v] of Object.entries(filtros)) if (v) q.set(k, k === "desde" || k === "hasta" ? new Date(`${v}T${k === "desde" ? "00:00" : "23:59"}`).toISOString() : v);
    if (desdeCursor) q.set("cursor", desdeCursor);
    return `/api/notifications?${q}`;
  }, [filtros]);

  const cargar = useCallback(async (mas = false) => {
    setCargando(true); setError(null);
    try {
      const r = await fetch(consulta(mas ? cursor : null));
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? "No se pudieron leer los avisos"); return; }
      setAvisos((prev) => (mas ? [...prev, ...d.notifications] : d.notifications));
      setCursor(d.siguienteCursor);
      setCuentas({ noLeidas: d.noLeidas, pendientes: d.pendientes });
      setAvisosEn(d.avisosEn ?? null);
    } catch {
      setError("Sin conexión. Intente de nuevo.");
    } finally {
      setCargando(false);
    }
  }, [consulta, cursor]);

  useEffect(() => { void cargar(false); }, [filtros]); // eslint-disable-line react-hooks/exhaustive-deps

  async function marcar(id: string, accion: "leer" | "no_leida" | "reconocer") {
    await fetch(`/api/notifications/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion }) }).catch(() => undefined);
    setAvisos((prev) => prev.map((a) => (a.id === id ? { ...a, read: accion !== "no_leida" } : a)));
  }
  async function todasLeidas() {
    await fetch("/api/notifications", { method: "PATCH" }).catch(() => undefined);
    setAvisos((prev) => prev.map((a) => ({ ...a, read: true })));
    setCuentas((c) => ({ ...c, noLeidas: 0 }));
  }
  const set = (k: keyof typeof filtros, v: string) => setFiltros((f) => ({ ...f, [k]: v }));

  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-[0.6875rem] text-slate-600">
            Estado
            <select className="field py-1 text-xs" value={filtros.estado} onChange={(e) => set("estado", e.target.value)}>
              {ESTADOS.map((e) => <option key={e.valor} value={e.valor}>{e.texto}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[0.6875rem] text-slate-600">
            Prioridad
            <select className="field py-1 text-xs" value={filtros.prioridad} onChange={(e) => set("prioridad", e.target.value)}>
              <option value="">Todas</option>
              {[...PRIORIDADES].reverse().map((p) => <option key={p} value={p}>{ETIQUETA_PRIORIDAD[p]}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[0.6875rem] text-slate-600">
            Módulo
            <select className="field py-1 text-xs" value={filtros.modulo} onChange={(e) => set("modulo", e.target.value)}>
              <option value="">Todos</option>
              {(Object.keys(ETIQUETA_MODULO) as Modulo[]).map((m) => <option key={m} value={m}>{ETIQUETA_MODULO[m]}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[0.6875rem] text-slate-600">
            Desde
            <input type="date" className="field py-1 text-xs" value={filtros.desde} onChange={(e) => set("desde", e.target.value)} />
          </label>
          <label className="grid gap-1 text-[0.6875rem] text-slate-600">
            Hasta
            <input type="date" className="field py-1 text-xs" value={filtros.hasta} onChange={(e) => set("hasta", e.target.value)} />
          </label>
          <div className="ml-auto flex items-center gap-2 text-[0.6875rem] text-slate-500">
            <span>{cuentas.pendientes} pendiente(s) · {cuentas.noLeidas} sin leer</span>
            <Button size="sm" variant="secondary" onClick={todasLeidas} disabled={!cuentas.noLeidas}>Marcar todas como leídas</Button>
          </div>
        </div>
      </Card>

      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      {avisosEn ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Está dentro de una empresa cliente: aquí solo aparecen avisos de esta empresa. Sus avisos de {avisosEn} los ve al volver a su empresa.
        </p>
      ) : null}

      <Card padded={false}>
        {avisos.length === 0 && !cargando ? (
          <p className="px-4 py-10 text-center text-xs text-slate-500">
            {filtros.estado === "pendientes" ? "No tiene avisos pendientes de atención." : "No hay avisos con estos filtros."}
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {avisos.map((a) => (
              <TarjetaAviso
                key={a.id} a={a} zona={zona}
                alAbrir={() => !a.read && marcar(a.id, "leer")}
                alReconocer={() => marcar(a.id, "reconocer")}
                alMarcar={(leida) => marcar(a.id, leida ? "leer" : "no_leida")}
              />
            ))}
          </div>
        )}
        {cargando ? <p className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></p> : null}
        {cursor && !cargando ? (
          <div className="border-t border-slate-100 p-3 text-center">
            <Button size="sm" variant="secondary" onClick={() => cargar(true)}>Ver más antiguos</Button>
          </div>
        ) : null}
      </Card>
      <p className="text-[0.6875rem] text-slate-500">
        Qué le llega y por dónde se decide en <Link href="/settings?s=avisos" className="text-brand-700 hover:underline">Configuración → Avisos</Link>.
      </p>
    </div>
  );
}
