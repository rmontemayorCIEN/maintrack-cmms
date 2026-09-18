"use client";

import { useZona } from "@/components/zona-empresa";
import { Badge } from "@/components/ui";
import { TablaConfigurable, type Columna, type Vista } from "@/components/tabla-configurable";
import {
  MAINTENANCE_TYPE_COLORS, MAINTENANCE_TYPE_LABELS, PRIORITY_COLORS, PRIORITY_LABELS,
} from "@/lib/constants";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { estadoDeVencimiento } from "@/lib/vencimiento";
import { EnlacesPlan } from "./enlaces-plan";
import { EquiposDelPlan } from "./equipos-del-plan";
import { PlanDialog } from "./plan-dialog";
import { PlanRowActions } from "./plan-actions";

type Enlace = { id: string; title: string; url: string; note: string | null; createdAt: string };

export type FilaPlan = {
  id: string; name: string; description: string | null;
  activo: string | null; activoCodigo: string | null;
  maintenanceType: string; triggerType: string; priority: string;
  frecuencia: string; medidorActual: string | null;
  nextDueDate: string | null; lastCompletedAt: string | null; lastGeneratedAt: string | null;
  proyeccionSuspendida?: boolean;
  actividades: number; costoEstimado: number; horasEstimadas: number; otGeneradas: number;
  requiereParo: boolean; active: boolean;
  /** A cuantos equipos se aplica este plan. */
  equipos: number;
  intervalDays: number | null;
  toleranciaDias: number; anticipacionDias: number;
  moneda: string;
  enlaces: Enlace[];
  /** Ya con la forma que espera el dialogo de edicion. */
  paraEditar: React.ComponentProps<typeof PlanDialog>["plan"];
};

const guion = (v: string | null | undefined) => (v && v.trim() ? v : "—");

const TRIGGER: Record<string, string> = { CALENDAR: "Calendario", METER: "Medidor", CONDITION: "Condicion" };

export function TablaPlanes({
  planes, vistaInicial, editable, assets, meters, technicians,
  especialidades, refacciones, servicios, moneda, puedeCrearCatalogos, busquedaInicial, conCostos = true,
}: {
  /** Sin costos (técnico): el costo estimado del plan no se ofrece. */
  conCostos?: boolean;
  planes: FilaPlan[];
  vistaInicial: Vista;
  busquedaInicial?: string;
  editable: boolean;
  assets: React.ComponentProps<typeof PlanDialog>["assets"];
  meters: React.ComponentProps<typeof PlanDialog>["meters"];
  technicians: React.ComponentProps<typeof PlanDialog>["technicians"];
  especialidades: React.ComponentProps<typeof PlanDialog>["especialidades"];
  refacciones: React.ComponentProps<typeof PlanDialog>["refacciones"];
  servicios: React.ComponentProps<typeof PlanDialog>["servicios"];
  moneda: string;
  puedeCrearCatalogos: boolean;
}) {
  const zona = useZona();
  const FIJAS: Columna<FilaPlan>[] = [
    {
      id: "plan", etiqueta: "Plan",
      texto: (p) => `${p.name} ${p.description ?? ""}`,
      pinta: (p) => (
        <div className={`max-w-64 ${p.active ? "" : "opacity-50"}`}>
          {/* El nombre abre la ficha: un control menos en el renglon. */}
          {editable ? (
            <PlanDialog
              plan={p.paraEditar}
              assets={assets} meters={meters} technicians={technicians}
              especialidades={especialidades} refacciones={refacciones}
              servicios={servicios} moneda={moneda}
              puedeCrearCatalogos={puedeCrearCatalogos}
              disparador={(abrir) => (
                <button
                  type="button"
                  onClick={abrir}
                  title={`Ver y editar ${p.name}`}
                  className="block max-w-full truncate text-left font-medium text-brand-600 underline decoration-brand-300 underline-offset-2 hover:text-brand-800 hover:decoration-brand-600"
                >
                  {p.name}
                </button>
              )}
            />
          ) : (
            <p className="truncate font-medium text-slate-800">{p.name}</p>
          )}
          {p.description ? <p className="truncate text-xs text-slate-500">{p.description}</p> : null}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <EnlacesPlan planId={p.id} nombre={p.name} editable={editable} enlaces={p.enlaces} />
            <EquiposDelPlan
              planId={p.id} nombre={p.name} intervaloDias={p.intervalDays ?? null}
              porMedidor={p.triggerType === "METER"}
              editable={editable}
              activos={assets.map((a) => ({ id: a.id, code: a.code, name: a.name }))}
            />
          </div>
        </div>
      ),
    },
    {
      // Un plan puede aplicarse a varios equipos. Cuando es uno solo se muestra
      // cual, que es el caso comun; cuando son varios lo que importa es cuantos.
      id: "activo", etiqueta: "Equipos",
      texto: (p) => (p.equipos > 1 ? `${p.equipos} equipos` : p.activoCodigo ? `${p.activoCodigo} ${p.activo}` : "—"),
      pinta: (p) =>
        p.equipos > 1 ? (
          <Badge tone="info">{p.equipos} equipos</Badge>
        ) : (
          <span className="text-xs text-slate-600">
            {p.activoCodigo ? `${p.activoCodigo} · ${p.activo}` : "—"}
          </span>
        ),
    },
  ];

  const COLUMNAS: Columna<FilaPlan>[] = [
    {
      id: "tipo", etiqueta: "Tipo", agrupable: true,
      texto: (p) => MAINTENANCE_TYPE_LABELS[p.maintenanceType] ?? p.maintenanceType,
      pinta: (p) => <Badge className={MAINTENANCE_TYPE_COLORS[p.maintenanceType]}>{MAINTENANCE_TYPE_LABELS[p.maintenanceType]}</Badge>,
    },
    { id: "disparo", etiqueta: "Disparo", agrupable: true, texto: (p) => TRIGGER[p.triggerType] ?? p.triggerType },
    {
      id: "frecuencia", etiqueta: "Frecuencia", agrupable: true,
      texto: (p) => p.frecuencia,
      pinta: (p) => (
        <div className="text-xs text-slate-600">
          {p.frecuencia}
          {p.medidorActual ? <p className="text-[0.6875rem] text-slate-400">{p.medidorActual}</p> : null}
        </div>
      ),
    },
    {
      id: "prioridad", etiqueta: "Prioridad", agrupable: true,
      texto: (p) => PRIORITY_LABELS[p.priority] ?? p.priority,
      pinta: (p) => <Badge className={PRIORITY_COLORS[p.priority]}>{PRIORITY_LABELS[p.priority]}</Badge>,
    },
    {
      id: "proximo", etiqueta: "Próximo",
      // Con la zona de la empresa y el mismo texto que las ordenes: igual en
      // el servidor que en el navegador.
      texto: (p) => (p.proyeccionSuspendida ? "Proyección suspendida" : p.nextDueDate ? estadoDeVencimiento({ status: "OPEN", dueDate: p.nextDueDate }, { zona }).texto : "—"),
      pinta: (p) => {
        if (p.proyeccionSuspendida) {
          return (
            <a href="/meters" className="inline-block" title="El medidor contiene una lectura inválida: corríjala o anúlela en Medidores">
              <Badge tone="warning">Proyección suspendida</Badge>
            </a>
          );
        }
        if (!p.nextDueDate) return "—";
        const d = estadoDeVencimiento({ status: "OPEN", dueDate: p.nextDueDate }, { zona });
        return <Badge tone={d.tono}>{d.texto}</Badge>;
      },
    },
    { id: "actividades", etiqueta: "Actividades", alineaDerecha: true, texto: (p) => String(p.actividades) },
    {
      id: "costo", etiqueta: "Costo est.", alineaDerecha: true,
      texto: (p) => (p.costoEstimado > 0 || p.horasEstimadas > 0 ? formatCurrency(p.costoEstimado, p.moneda) : "—"),
      pinta: (p) =>
        p.costoEstimado > 0 || p.horasEstimadas > 0 ? (
          <>
            {formatCurrency(p.costoEstimado, p.moneda)}
            <p className="text-[0.6875rem] text-slate-400">{formatNumber(p.horasEstimadas, 1)} h estimadas</p>
          </>
        ) : <span className="text-slate-300">—</span>,
    },
    { id: "otGeneradas", etiqueta: "OT generadas", alineaDerecha: true, texto: (p) => String(p.otGeneradas) },
    {
      id: "estado", etiqueta: "Situacion", agrupable: true,
      texto: (p) => (p.active ? "Activo" : "Pausado"),
      pinta: (p) => (p.active ? <Badge tone="success">Activo</Badge> : <Badge tone="muted">Pausado</Badge>),
    },
    {
      id: "paro", etiqueta: "Requiere paro", agrupable: true,
      texto: (p) => (p.requiereParo ? "Si" : "No"),
    },
    { id: "ultimoCierre", etiqueta: "Último cierre", texto: (p) => (p.lastCompletedAt ? formatDate(p.lastCompletedAt, zona) : "—") },
    { id: "ultimaGeneracion", etiqueta: "Última generación", texto: (p) => (p.lastGeneratedAt ? formatDate(p.lastGeneratedAt, zona) : "—") },
    { id: "tolerancia", etiqueta: "Tolerancia (días)", alineaDerecha: true, texto: (p) => String(p.toleranciaDias) },
    { id: "anticipacion", etiqueta: "Anticipacion (días)", alineaDerecha: true, texto: (p) => String(p.anticipacionDias) },
    { id: "enlaces", etiqueta: "Referencias", alineaDerecha: true, texto: (p) => String(p.enlaces.length) },
  ];

  /** La vista de fabrica: lo que se necesita para saber que toca y cuanto cuesta. */
  const DE_FABRICA = ["tipo", "disparo", "frecuencia", "prioridad", "proximo", "actividades", "costo", "otGeneradas"];

  return (
    <TablaConfigurable
      filas={planes}
      fijas={FIJAS}
      columnas={conCostos ? COLUMNAS : COLUMNAS.filter((c) => c.id !== "costo")}
      deFabrica={DE_FABRICA}
      vistaInicial={vistaInicial}
      busquedaInicial={busquedaInicial}
      clave="planes"
      sustantivo="planes"
      ejemploFiltro='Filtrar: "bomba", "mensual", "pausado"…'
      acciones={editable ? (p) => (
        <div className="flex justify-end gap-1">
          {/* La ficha se abre desde el nombre del plan. */}
          <PlanRowActions planId={p.id} active={p.active} />
        </div>
      ) : undefined}
    />
  );
}
