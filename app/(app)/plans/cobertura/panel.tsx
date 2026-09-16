"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarDays, Check, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { SelectorBuscable } from "@/components/selector-buscable";
import { ArranqueConIa } from "./arranque";
import { cn, diaDeCalendario } from "@/lib/utils";

type PlanDeEquipo = {
  asignacionId: string; planId: string; nombre: string;
  porMedidor: boolean; proxima: string | null;
};
type Activo = {
  id: string; code: string; name: string; criticality: string;
  categoriaId: string | null; categoria: string;
  sitioId: string | null; sitio: string | null;
  planes: PlanDeEquipo[];
};
type Plan = {
  id: string; nombre: string; tipo: string;
  porMedidor: boolean; cada: number | null; equipos: number;
};

/**
 * Los equipos y sus planes, mirado desde el equipo.
 *
 * El caso que resuelve: una planta con compresores tipo A, B y C —todos en la
 * categoria «Compresores»— donde cada tipo lleva su plan. Que equipo va a que
 * plan lo decide la persona; lo que el sistema aporta es que se vea de un
 * vistazo cual quedo sin ninguno.
 */
export function PanelCobertura({
  resumen, activos, planes, categorias, sitios, editable,
}: {
  resumen: { total: number; conPlan: number; sinPlan: number };
  activos: Activo[];
  planes: Plan[];
  categorias: { id: string; name: string }[];
  sitios: { id: string; name: string }[];
  editable: boolean;
}) {
  const router = useRouter();
  const [categoria, setCategoria] = useState("");
  const [sitio, setSitio] = useState("");
  const [soloSinPlan, setSoloSinPlan] = useState(resumen.sinPlan > 0);
  const [busqueda, setBusqueda] = useState("");
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [planElegido, setPlanElegido] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const sinAcentos = (t: string) =>
    t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const visibles = useMemo(() => {
    const q = sinAcentos(busqueda.trim());
    return activos.filter(
      (a) =>
        (!categoria || a.categoriaId === categoria) &&
        (!sitio || a.sitioId === sitio) &&
        (!soloSinPlan || a.planes.length === 0) &&
        (!q || sinAcentos(`${a.code} ${a.name}`).includes(q)),
    );
  }, [activos, categoria, sitio, soloSinPlan, busqueda]);

  const seleccionables = visibles.map((a) => a.id);
  const todosElegidos = seleccionables.length > 0 && seleccionables.every((id) => seleccion.includes(id));

  async function aplicar() {
    if (!planElegido || !seleccion.length) return;
    setTrabajando(true); setAviso(null);
    const res = await fetch("/api/plans/asignaciones", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: planElegido, assetIds: seleccion, escalonar: true }),
    });
    const c = await res.json().catch(() => null);
    setTrabajando(false);
    if (!res.ok) { setAviso(c?.error ?? "No se pudo aplicar"); return; }
    const partes = [`Aplicado a ${c.creadas?.length ?? 0} equipo(s)`];
    if (c.yaEstaban?.length) partes.push(`${c.yaEstaban.length} ya lo tenían`);
    if (c.sinMedidor?.length) partes.push(`sin medidor: ${c.sinMedidor.join(", ")} — no van a generar`);
    setAviso(partes.join(" · "));
    setSeleccion([]);
    router.refresh();
  }

  async function quitar(asignacionId: string) {
    await fetch("/api/plans/asignaciones", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: asignacionId }),
    });
    router.refresh();
  }

  const fmt = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(diaDeCalendario(iso)) : null;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { n: resumen.total, t: "equipos activos", tono: "" },
          { n: resumen.conPlan, t: "con plan", tono: "text-emerald-700" },
          { n: resumen.sinPlan, t: "sin ningún plan", tono: resumen.sinPlan > 0 ? "text-amber-700" : "" },
        ].map((x) => (
          <Card key={x.t}>
            <p className={cn("text-2xl font-semibold tabular-nums", x.tono || "text-slate-800")}>{x.n}</p>
            <p className="text-xs text-slate-500">{x.t}</p>
          </Card>
        ))}
      </div>

      {editable ? <ArranqueConIa sinPlan={resumen.sinPlan} /> : null}

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
          <input
            className="field h-8 w-48 py-0 text-xs"
            placeholder="Buscar equipo…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <select className="field h-8 py-0 text-xs" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {sitios.length > 1 ? (
            <select className="field h-8 py-0 text-xs" value={sitio} onChange={(e) => setSitio(e.target.value)}>
              <option value="">Todos los sitios</option>
              {sitios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : null}
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600">
            <input type="checkbox" className="h-3.5 w-3.5" checked={soloSinPlan} onChange={(e) => setSoloSinPlan(e.target.checked)} />
            Solo los que no tienen plan
          </label>
          <span className="ml-auto text-xs text-slate-400">{visibles.length} equipo(s)</span>
        </div>

        {editable ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-4 py-2.5">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={todosElegidos}
                onChange={(e) => setSeleccion(e.target.checked ? seleccionables : [])}
              />
              {seleccion.length ? `${seleccion.length} elegido(s)` : "Elegir todos los visibles"}
            </label>
            <span className="text-slate-300">→</span>
            <div className="w-64">
              <SelectorBuscable
                className="[&_button]:h-8 [&_button]:py-0 [&_button]:text-xs"
                valor={planElegido}
                onCambio={setPlanElegido}
                vacio="Elija el plan a aplicar"
                marcador="Busque el plan"
                opciones={planes.map((p) => ({
                  id: p.id,
                  etiqueta: p.nombre,
                  detalle: `${p.equipos} equipo(s) · ${p.cada ? (p.porMedidor ? `cada ${p.cada}` : `cada ${p.cada} días`) : "sin intervalo"}`,
                }))}
              />
            </div>
            <button
              type="button"
              onClick={aplicar}
              disabled={!planElegido || !seleccion.length || trabajando}
              className="btn-primary h-8 py-0 text-xs"
            >
              {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Aplicar
            </button>
            {aviso ? <span className="text-xs text-slate-600">{aviso}</span> : null}
          </div>
        ) : null}

        <ul className="divide-y divide-slate-100">
          {visibles.length === 0 ? (
            <li className="px-4 py-10 text-center text-xs text-slate-400">
              Ningún equipo coincide con el filtro.
            </li>
          ) : (
            visibles.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-3 px-4 py-2.5">
                {editable ? (
                  <input
                    type="checkbox"
                    className="mt-1 h-3.5 w-3.5 shrink-0"
                    checked={seleccion.includes(a.id)}
                    onChange={(e) =>
                      setSeleccion((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))
                    }
                    aria-label={`Elegir ${a.code}`}
                  />
                ) : null}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/assets/${a.id}`} className="text-sm font-medium text-slate-800 hover:text-brand-600">
                      {a.code}
                    </Link>
                    <span className="min-w-0 truncate text-sm text-slate-600">{a.name}</span>
                    {a.criticality === "A" ? <Badge tone="danger">Crítico</Badge> : null}
                    <span className="text-xs text-slate-400">{a.categoria}</span>
                    {a.sitio && sitios.length > 1 ? <span className="text-xs text-slate-400">· {a.sitio}</span> : null}
                  </div>

                  {a.planes.length === 0 ? (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-700">
                      <AlertTriangle className="h-3 w-3" />
                      Sin ningún plan de mantenimiento
                    </p>
                  ) : (
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {a.planes.map((p) => (
                        <li
                          key={p.asignacionId}
                          className="inline-flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50/60 px-1.5 py-0.5 text-xs"
                        >
                          <Check className="h-3 w-3 shrink-0 text-emerald-600" />
                          <span className="text-slate-700">{p.nombre}</span>
                          <span className="inline-flex items-center gap-0.5 text-slate-400">
                            <CalendarDays className="h-3 w-3" />
                            {p.porMedidor ? "por medidor" : fmt(p.proxima) ?? "sin fecha"}
                          </span>
                          {editable ? (
                            <button
                              type="button"
                              onClick={() => quitar(p.asignacionId)}
                              className="text-slate-400 hover:text-rose-600"
                              aria-label={`Quitar ${p.nombre} de ${a.code}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
      </Card>

      <p className="text-xs text-slate-400">
        Qué equipo va a qué plan lo decide usted: una planta puede tener compresores tipo A, B y C en la
        misma categoría, cada tipo con su propio plan, y eso no se puede adivinar. Lo que el sistema
        garantiza es que se vea cuál quedó sin ninguno.
      </p>
    </div>
  );
}
