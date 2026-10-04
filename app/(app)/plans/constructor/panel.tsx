"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Pencil, TrendingUp } from "lucide-react";
import { Badge, Button, Card, CardHeader, Progress, Stat } from "@/components/ui";
import { useZona } from "@/components/zona-empresa";
import { formatDia } from "@/lib/utils";
import type { EstadoPlan, PiezaPlan } from "@/lib/constructor-planes";

type PlanVista = {
  id: string; nombre: string; grupos: string[]; equipos: number; actividades: number;
  estado: EstadoPlan; avance: number; piezas: PiezaPlan[]; falta: string[]; creadoEl: string;
};
type GrupoVista = {
  clave: string; categoria: string; marca: string | null; modeloConocido: boolean;
  equipos: { id: string; code: string; name: string; criticality: string; conPlan: boolean }[];
  sinPlan: number; planes: { id: string; nombre: string; estado: EstadoPlan; avance: number }[];
  estado: EstadoPlan | "SIN_PLAN"; criticidad: string;
};
type Datos = {
  grupos: GrupoVista[]; planes: PlanVista[];
  sugeridos: number; meta: number; metaFijada: number | null;
  metaFijadaPor: string | null; metaFijadaEl: string | null; sugeridoSuperaMeta: boolean;
  construidos: number; listos: number;
  porEstado: { listos: number; enForma: number; esqueleto: number; sinPlan: number };
  equiposTotal: number; equiposCubiertos: number;
  ritmoSemanal: number | null; fechaTermino: string | null;
  diasSinPlanNuevo: number | null; detenido: boolean;
};

const ESTADO: Record<EstadoPlan | "SIN_PLAN", { texto: string; tono: "success" | "warning" | "danger" | "muted" }> = {
  LISTO: { texto: "Listo", tono: "success" },
  EN_FORMA: { texto: "En forma", tono: "warning" },
  ESQUELETO: { texto: "Esqueleto", tono: "warning" },
  SIN_PLAN: { texto: "Sin plan", tono: "danger" },
};

/**
 * El tablero de construccion.
 *
 * No crea planes: mide y pone la meta. Cada numero de aqui sale de
 * `lib/constructor-planes.ts`, que es tambien el que usa la prueba.
 */
export function PanelConstructor({ datos, editable }: { datos: Datos; editable: boolean }) {
  const zona = useZona();
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(String(datos.meta));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  const guardar = async (meta: number | null) => {
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch("/api/plans/constructor", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? "No se pudo guardar la meta");
      setEditando(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la meta");
    } finally {
      setGuardando(false);
    }
  };

  const avance = datos.meta ? Math.round((datos.listos / datos.meta) * 100) : 0;
  const ancho = (n: number) => (datos.meta ? `${(n / datos.meta) * 100}%` : "0%");
  const gruposVisibles = verTodos ? datos.grupos : datos.grupos.slice(0, 12);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-2xl font-semibold tabular-nums text-slate-900" data-avance={avance}>
              {datos.listos} de {datos.meta} planes listos
            </p>
            <p className="mt-0.5 text-xs text-slate-500" data-sugeridos={datos.sugeridos}>
              Mínimo sugerido por sus equipos: {datos.sugeridos} ·{" "}
              {datos.metaFijada === null
                ? "meta en el mínimo sugerido"
                : `meta fijada en ${datos.metaFijada}${datos.metaFijadaPor ? ` por ${datos.metaFijadaPor}` : ""}${
                    datos.metaFijadaEl ? ` el ${formatDia(datos.metaFijadaEl, { zona })}` : ""
                  }`}
            </p>
          </div>
          {editable ? (
            editando ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  className="h-9 w-24 rounded-md border border-slate-300 px-2 text-sm tabular-nums"
                  aria-label="Meta de planes"
                />
                <Button size="sm" onClick={() => guardar(Number(valor))} disabled={guardando}>
                  {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Guardar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => guardar(null)} disabled={guardando}>
                  Usar el sugerido
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditando(false); setError(null); }}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => { setValor(String(datos.meta)); setEditando(true); }}>
                <Pencil className="h-3.5 w-3.5" />
                Cambiar la meta
              </Button>
            )
          ) : null}
        </div>

        {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}

        <div className="mt-3">
          <Progress value={avance} tone={avance >= 80 ? "good" : avance >= 40 ? "warn" : "bad"} />
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <span className="bg-emerald-500" style={{ width: ancho(datos.porEstado.listos) }} />
            <span className="bg-amber-500" style={{ width: ancho(datos.porEstado.enForma) }} />
            <span className="bg-amber-300" style={{ width: ancho(datos.porEstado.esqueleto) }} />
          </div>
          <p className="mt-1.5 text-xs text-slate-500" data-estados>
            {datos.porEstado.listos} listos · {datos.porEstado.enForma} en forma · {datos.porEstado.esqueleto} esqueleto ·{" "}
            {datos.porEstado.sinPlan} por crear
          </p>
        </div>

        {datos.sugeridoSuperaMeta ? (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Su meta dice {datos.metaFijada}, y con los equipos que hay el mínimo sugerido ya es {datos.sugeridos}. No se
            la cambiamos solos: revísela cuando quiera.
          </p>
        ) : null}
        {datos.detenido ? (
          <p className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Llevan {datos.diasSinPlanNuevo} días sin un plan nuevo y faltan {datos.meta - datos.construidos}.
          </p>
        ) : null}
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Planes construidos" value={`${datos.construidos}`} hint={`${datos.listos} terminados`} />
        <Stat
          label="Equipos con plan"
          value={`${datos.equiposCubiertos} de ${datos.equiposTotal}`}
          hint={datos.equiposTotal - datos.equiposCubiertos > 0 ? `${datos.equiposTotal - datos.equiposCubiertos} sin ninguno` : "todos cubiertos"}
          href="/plans/cobertura"
        />
        <Stat
          label="Ritmo"
          value={datos.ritmoSemanal === null ? "—" : `${datos.ritmoSemanal} / semana`}
          hint="planes nuevos, últimas 8 semanas"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <Stat
          label="A este ritmo, termina"
          value={datos.fechaTermino ? formatDia(datos.fechaTermino, { zona }) : datos.meta <= datos.construidos ? "ya está" : "—"}
          hint={datos.fechaTermino ? `faltan ${datos.meta - datos.construidos}` : "sin ritmo que proyectar"}
        />
      </div>

      <Card>
        <CardHeader
          title="Grupos de equipos iguales"
          subtitle="Misma familia y mismo modelo caben en un plan. Son candidatos: usted decide si se parten o se juntan."
        />
        <div className="table-wrap">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Grupo</th>
                <th className="py-2 pr-3">Equipos</th>
                <th className="py-2 pr-3">Su plan</th>
                <th className="py-2">Le falta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100" data-grupos={datos.grupos.length}>
              {gruposVisibles.map((g) => {
                const peor = g.planes.slice().sort((a, b) => a.avance - b.avance)[0];
                const plan = peor ? datos.planes.find((p) => p.id === peor.id) : undefined;
                return (
                  <tr key={g.clave} className="align-top">
                    <td className="py-2 pr-3">
                      <p className="font-medium text-slate-900">{g.categoria}</p>
                      <p className="text-xs text-slate-500">
                        {g.marca ?? "sin fabricante ni modelo capturados"}
                        {!g.modeloConocido ? " · sin modelo: puede que sean varios tipos" : ""}
                      </p>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {g.equipos.length}
                      {g.sinPlan > 0 ? <span className="text-amber-700"> · {g.sinPlan} sin plan</span> : null}
                      <p className="text-xs text-slate-500">
                        {g.equipos.slice(0, 4).map((e) => e.code).join(", ")}
                        {g.equipos.length > 4 ? ` y ${g.equipos.length - 4} más` : ""}
                      </p>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={ESTADO[g.estado].tono}>{ESTADO[g.estado].texto}</Badge>
                      {g.planes.length > 1 ? (
                        <p className="mt-1 text-xs text-slate-500">{g.planes.length} planes lo cubren</p>
                      ) : null}
                    </td>
                    <td className="py-2 text-xs">
                      {g.estado === "SIN_PLAN" ? (
                        <Link href="/plans" className="text-brand-700 hover:underline">
                          Armar su plan
                        </Link>
                      ) : plan && plan.falta.length ? (
                        <span className="text-amber-800">{plan.falta.join(" · ")}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {datos.grupos.length > gruposVisibles.length ? (
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setVerTodos(true)}>
            Ver los {datos.grupos.length} grupos
          </Button>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Qué le falta a cada plan"
          subtitle="Un plan terminado se puede presupuestar y preparar: mano de obra en cada actividad, refacciones donde se reemplaza, rango donde se mide, herramientas y procedimiento."
        />
        <div className="space-y-3" data-planes={datos.planes.length}>
          {datos.planes
            .slice()
            .sort((a, b) => a.avance - b.avance)
            .map((p) => (
              <div key={p.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/plans/${p.id}`} className="font-medium text-slate-900 hover:underline">
                    {p.nombre}
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-slate-500">{p.avance}%</span>
                    <Badge tone={ESTADO[p.estado].tono}>{ESTADO[p.estado].texto}</Badge>
                  </div>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {p.actividades} actividad(es) · {p.equipos} equipo(s)
                </p>
                {p.estado !== "LISTO" ? (
                  <div className="mt-1.5 max-w-xs">
                    <Progress value={p.avance} tone={p.avance < 50 ? "bad" : "warn"} />
                  </div>
                ) : null}
                {p.falta.length ? (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800">
                    {p.falta.map((f) => (
                      <li key={f}>· {f}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          {datos.planes.length === 0 ? (
            <p className="text-sm text-slate-500">
              Todavía no hay planes. Empiece por el grupo de arriba: es el de los equipos más críticos sin cubrir.
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
