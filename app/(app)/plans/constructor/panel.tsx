"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, GitMerge, Loader2, Pencil, Scissors, TrendingUp } from "lucide-react";
import { Badge, Button, Card, CardHeader, Progress, Stat } from "@/components/ui";
import { useZona } from "@/components/zona-empresa";
import { formatDia } from "@/lib/utils";
import { Dialogo } from "@/components/ui/dialogo";
import type { EstadoPlan, PiezaPlan } from "@/lib/constructor-planes";

type PlanVista = {
  id: string; nombre: string; grupos: string[]; equipos: number; actividades: number;
  estado: EstadoPlan; avance: number; piezas: PiezaPlan[]; falta: string[]; creadoEl: string;
};
type GrupoVista = {
  clave: string; categoria: string; marca: string | null; modeloConocido: boolean;
  equipos: { id: string; code: string; name: string; criticality: string; conPlan: boolean }[];
  sinPlan: number; planes: { id: string; nombre: string; estado: EstadoPlan; avance: number }[];
  estado: EstadoPlan | "SIN_PLAN"; criticidad: string; aMano: boolean;
};
type Gemelos = {
  grupo: string; grupoEtiqueta: string; parecido: number;
  planes: { id: string; nombre: string; actividades: number; equipos: number }[];
};
type Semana = {
  semana: string; planes: number; listos: number; enForma: number; esqueleto: number;
  sugeridos: number; meta: number; equiposTotal: number; equiposCubiertos: number;
};
type Datos = {
  grupos: GrupoVista[]; planes: PlanVista[]; gemelos: Gemelos[]; historia: Semana[];
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
  const [ajustando, setAjustando] = useState<GrupoVista | null>(null);
  const [clonando, setClonando] = useState<GrupoVista | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /** Toda acción pasa por la misma ruta, y al terminar se recarga del servidor. */
  const accion = async (cuerpo: Record<string, unknown>, exito?: string) => {
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await fetch("/api/plans/constructor/acciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string })?.error ?? "No se pudo completar la acción");
      setAjustando(null);
      setClonando(null);
      if (exito) setAviso(exito);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción");
    } finally {
      setGuardando(false);
    }
  };

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
        {aviso ? <p className="mt-2 text-xs text-emerald-700">{aviso}</p> : null}

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

      <Historia historia={datos.historia} meta={datos.meta} />

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
                        {g.aMano ? " · ajustado a mano" : ""}
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
                        <span className="text-slate-500">Sin plan todavía</span>
                      ) : plan && plan.falta.length ? (
                        <span className="text-amber-800">{plan.falta.join(" · ")}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                      {editable ? (
                        <div className="mt-1 flex flex-wrap gap-2">
                          {g.estado === "SIN_PLAN" ? (
                            <>
                              <Link href="/plans" className="text-brand-700 hover:underline">Armar su plan</Link>
                              {datos.planes.length ? (
                                <button type="button" className="text-brand-700 hover:underline" onClick={() => setClonando(g)}>
                                  Copiar uno que ya tenga
                                </button>
                              ) : null}
                            </>
                          ) : g.sinPlan > 0 && peor ? (
                            <button
                              type="button"
                              className="text-brand-700 hover:underline disabled:opacity-50"
                              disabled={guardando}
                              onClick={() => accion(
                                { accion: "APLICAR_AL_GRUPO", planId: peor.id, clave: g.clave },
                                `«${peor.nombre}» se aplicó a los equipos que faltaban.`,
                              )}
                            >
                              Aplicar «{peor.nombre}» a {g.sinPlan} equipo(s)
                            </button>
                          ) : null}
                          <button type="button" className="text-slate-500 hover:underline" onClick={() => setAjustando(g)}>
                            Ajustar el grupo
                          </button>
                        </div>
                      ) : null}
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

      {datos.gemelos.length ? (
        <Card>
          <CardHeader
            title="Planes que parecen el mismo"
            subtitle="Cubren equipos del mismo grupo y comparten actividades. Puede que sean dos de verdad —uno mensual y otro anual—: solo se señalan."
          />
          <div className="space-y-3" data-gemelos={datos.gemelos.length}>
            {datos.gemelos.map((g) => (
              <div key={`${g.grupo}-${g.planes[0].id}-${g.planes[1].id}`} className="flex flex-wrap items-center gap-2 text-sm">
                <GitMerge className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <Link href={`/plans/${g.planes[0].id}`} className="font-medium text-slate-900 hover:underline">{g.planes[0].nombre}</Link>
                <span className="text-xs text-slate-500">y</span>
                <Link href={`/plans/${g.planes[1].id}`} className="font-medium text-slate-900 hover:underline">{g.planes[1].nombre}</Link>
                <span className="text-xs text-slate-500">
                  · {g.grupoEtiqueta} · comparten el {g.parecido}% de sus actividades
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

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

      {ajustando ? (
        <AjustarGrupo
          grupo={ajustando}
          grupos={datos.grupos}
          guardando={guardando}
          onCerrar={() => setAjustando(null)}
          onCorregir={(equipos, destino, exito) => accion({ accion: "CORREGIR_GRUPO", equipos, destino }, exito)}
        />
      ) : null}

      {clonando ? (
        <CopiarPlan
          grupo={clonando}
          planes={datos.planes}
          guardando={guardando}
          onCerrar={() => setClonando(null)}
          onClonar={(planId, nombre, equipos) =>
            accion({ accion: "CLONAR", planId, nombre, equipos }, "La copia quedó lista. Revísela y ajústela.")
          }
        />
      ) : null}
    </div>
  );
}

/**
 * Cómo ha ido avanzando, semana por semana.
 *
 * Es una curva dibujada a mano con SVG y no una gráfica de la librería: son
 * doce puntos y un solo trazo, y la librería pesa más que toda esta pantalla.
 * Las gráficas de verdad siguen viviendo en `components/charts`.
 */
function Historia({ historia, meta }: { historia: Semana[]; meta: number }) {
  // Con una sola foto no hay curva que dibujar: hay un punto. Se dice, porque
  // callar se vería como que la pantalla no sirve.
  if (historia.length < 2) {
    return (
      <Card>
        <CardHeader title="Cómo va avanzando" subtitle="Una foto por semana. La historia empieza el día que se enciende: hacia atrás no existe, porque el avance se calcula." />
        <p className="text-sm text-slate-500">
          {historia.length === 0
            ? "Todavía no hay fotos. La primera se toma sola esta semana."
            : "Hay una sola foto. La curva aparece con la segunda, la semana que entra."}
        </p>
      </Card>
    );
  }

  const tope = Math.max(meta, ...historia.map((h) => Math.max(h.listos, h.planes)), 1);
  const ancho = 100;
  const alto = 32;
  const punto = (valor: number, i: number) => {
    const x = (i / (historia.length - 1)) * ancho;
    const y = alto - (valor / tope) * alto;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };
  const linea = (clave: "listos" | "planes") => historia.map((h, i) => punto(h[clave], i)).join(" ");
  const primera = historia[0];
  const ultima = historia[historia.length - 1];
  const ganados = ultima.listos - primera.listos;

  return (
    <Card>
      <CardHeader
        title="Cómo va avanzando"
        subtitle="Una foto por semana: planes construidos y planes terminados."
      />
      <svg viewBox={`0 0 ${ancho} ${alto}`} className="h-24 w-full" preserveAspectRatio="none" role="img"
        aria-label={`De ${primera.listos} a ${ultima.listos} planes listos en ${historia.length} semanas`}>
        <polyline points={linea("planes")} fill="none" stroke="#cbd5e1" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <polyline points={linea("listos")} fill="none" stroke="#059669" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="mt-2 text-xs text-slate-500" data-historia={historia.length}>
        {historia.length} semanas · construidos {primera.planes} → {ultima.planes} ·{" "}
        <span className="text-emerald-700">listos {primera.listos} → {ultima.listos}</span>
        {ganados > 0 ? ` (+${ganados})` : ganados < 0 ? ` (${ganados})` : " (sin cambio)"}
      </p>
    </Card>
  );
}

/**
 * Corregir el agrupado: separar un equipo que lleva su propio plan, unir este
 * grupo con otro, o deshacer lo que ya se ajustó.
 */
function AjustarGrupo({
  grupo, grupos, guardando, onCerrar, onCorregir,
}: {
  grupo: GrupoVista;
  grupos: GrupoVista[];
  guardando: boolean;
  onCerrar: () => void;
  onCorregir: (equipos: string[], destino: string | null, exito: string) => void;
}) {
  const [separar, setSeparar] = useState<string[]>([]);
  const [destino, setDestino] = useState("");
  const otros = grupos.filter((g) => g.clave !== grupo.clave);
  const etiqueta = (g: GrupoVista) => [g.categoria, g.marca].filter(Boolean).join(" · ");

  return (
    <Dialogo
      titulo={`Ajustar «${etiqueta(grupo)}»`}
      descripcion="El agrupado se calcula solo. Aquí se corrige lo que el cálculo no puede saber, y se guarda esa corrección."
      onCerrar={onCerrar}
    >
      <div className="space-y-4">
        <div>
          <p className="label">Separar equipos de este grupo</p>
          <p className="mb-1.5 text-xs text-slate-500">Cada uno queda en su propio grupo y pedirá su propio plan.</p>
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {grupo.equipos.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={separar.includes(e.id)}
                  onChange={(ev) => setSeparar(ev.target.checked ? [...separar, e.id] : separar.filter((x) => x !== e.id))}
                />
                <span className="font-medium">{e.code}</span>
                <span className="text-slate-500">{e.name}</span>
              </label>
            ))}
          </div>
          <Button
            size="sm"
            className="mt-2"
            disabled={guardando || separar.length === 0}
            onClick={() => onCorregir(separar, `aparte:${separar[0]}`, `${separar.length} equipo(s) quedaron aparte.`)}
          >
            <Scissors className="h-3.5 w-3.5" />
            Separar {separar.length || ""}
          </Button>
        </div>

        {otros.length ? (
          <div className="border-t border-slate-200 pt-3">
            <p className="label">Unir este grupo con otro</p>
            <p className="mb-1.5 text-xs text-slate-500">
              Los {grupo.equipos.length} equipo(s) de aquí se mueven al grupo que elija, y comparten su plan.
            </p>
            <select className="field" value={destino} onChange={(e) => setDestino(e.target.value)}>
              <option value="">Seleccione el grupo destino…</option>
              {otros.map((g) => (
                <option key={g.clave} value={g.clave}>{etiqueta(g)} ({g.equipos.length})</option>
              ))}
            </select>
            <Button
              size="sm"
              className="mt-2"
              disabled={guardando || !destino}
              onClick={() => onCorregir(grupo.equipos.map((e) => e.id), destino, "Los grupos quedaron unidos.")}
            >
              <GitMerge className="h-3.5 w-3.5" />
              Unir
            </Button>
          </div>
        ) : null}

        {grupo.aMano ? (
          <div className="border-t border-slate-200 pt-3">
            <Button
              size="sm"
              variant="ghost"
              disabled={guardando}
              onClick={() => onCorregir(grupo.equipos.map((e) => e.id), null, "Vuelve a mandar el agrupado calculado.")}
            >
              Deshacer los ajustes de este grupo
            </Button>
          </div>
        ) : null}
      </div>
    </Dialogo>
  );
}

/** Copiar un plan que ya existe para los equipos de un grupo que no tiene. */
function CopiarPlan({
  grupo, planes, guardando, onCerrar, onClonar,
}: {
  grupo: GrupoVista;
  planes: PlanVista[];
  guardando: boolean;
  onCerrar: () => void;
  onClonar: (planId: string, nombre: string, equipos: string[]) => void;
}) {
  const etiqueta = [grupo.categoria, grupo.marca].filter(Boolean).join(" · ");
  const sugeridos = planes.slice().sort((a, b) => b.avance - a.avance);
  const [planId, setPlanId] = useState(sugeridos[0]?.id ?? "");
  const [nombre, setNombre] = useState(`Preventivo ${etiqueta}`.slice(0, 120));
  const [conEquipos, setConEquipos] = useState(true);

  return (
    <Dialogo
      titulo={`Copiar un plan para «${etiqueta}»`}
      descripcion="Se copian las actividades con su mano de obra, refacciones, servicios y herramientas. La copia nace aparte: cambiarla no toca al original."
      onCerrar={onCerrar}
      pie={
        <>
          <Button variant="ghost" onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button
            disabled={guardando || !planId || nombre.trim().length < 3}
            onClick={() => onClonar(planId, nombre.trim(), conEquipos ? grupo.equipos.map((e) => e.id) : [])}
          >
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
            Copiar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Plan a copiar</label>
          <select className="field" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {sugeridos.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre} · {p.actividades} actividad(es) · {p.avance}%</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Nombre de la copia</label>
          <input className="field" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} />
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
            checked={conEquipos}
            onChange={(e) => setConEquipos(e.target.checked)}
          />
          <span>
            Aplicarla a los {grupo.equipos.length} equipo(s) de este grupo
            <span className="block text-xs text-slate-500">Las fechas se reparten para no pararlos todos el mismo día.</span>
          </span>
        </label>
      </div>
    </Dialogo>
  );
}
