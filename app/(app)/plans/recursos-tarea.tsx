"use client";

import { useState } from "react";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { SelectorBuscable } from "@/components/selector-buscable";

export type Opcion = { id: string; etiqueta: string; costo: number; unidad?: string };
export type LineaMO = { specialtyId: string; personas: string; hours: string };
export type LineaRef = { partId: string; quantity: string };
export type LineaSrv = { serviceId: string; quantity: string; nota: string };
/**
 * Una herramienta que la actividad necesita tener en la mano.
 *
 * `fuente` dice de dónde cuelga —del almacén, de un activo serializado o de
 * una caja— porque las tres existen en el sistema y el modelo guarda
 * exactamente una. No se consume: no entra al costo del plan.
 */
export type LineaHta = { fuente: "ALMACEN" | "ACTIVO" | "CAJA"; id: string; cantidad: string; nota: string };

/**
 * Los recursos que una actividad del plan requiere.
 *
 * Tres bloques con la misma forma —mano de obra propia, refacciones de almacen
 * y servicios subcontratados— porque asi es como se presupuesta un trabajo:
 * quien lo hace, con que material y que parte se contrata afuera.
 */
export function RecursosTarea({
  labor, parts, services, tools,
  especialidades, refacciones, servicios, herramientas, herramientasActivo, cajas,
  moneda, puedeCrear,
  onLabor, onParts, onServices, onTools,
  onEspecialidades, onServicios,
}: {
  labor: LineaMO[];
  parts: LineaRef[];
  services: LineaSrv[];
  tools: LineaHta[];
  especialidades: Opcion[];
  refacciones: Opcion[];
  servicios: Opcion[];
  herramientas: Opcion[];
  herramientasActivo: Opcion[];
  cajas: Opcion[];
  moneda: string;
  puedeCrear: boolean;
  onLabor: (v: LineaMO[]) => void;
  onParts: (v: LineaRef[]) => void;
  onServices: (v: LineaSrv[]) => void;
  onTools: (v: LineaHta[]) => void;
  onEspecialidades: (v: Opcion[]) => void;
  onServicios: (v: Opcion[]) => void;
}) {
  const opcionesDe = (fuente: LineaHta["fuente"]) =>
    fuente === "ALMACEN" ? herramientas : fuente === "ACTIVO" ? herramientasActivo : cajas;
  const hayHerramientas = herramientas.length + herramientasActivo.length + cajas.length > 0;
  const primeraFuente: LineaHta["fuente"] =
    herramientas.length ? "ALMACEN" : herramientasActivo.length ? "ACTIVO" : "CAJA";
  return (
    <div className="grid gap-3 rounded-lg bg-slate-50 p-3">
      {/* ------------------------------------------------------ Mano de obra */}
      <Bloque
        titulo="Mano de obra"
        vacio="Sin mano de obra estimada."
        hayFilas={labor.length > 0}
        onAgregar={() =>
          onLabor([...labor, { specialtyId: especialidades[0]?.id ?? "", personas: "1", hours: "1" }])
        }
        deshabilitado={especialidades.length === 0 && !puedeCrear}
        aviso={especialidades.length === 0 ? "No hay especialidades dadas de alta." : null}
        alta={
          puedeCrear ? (
            <AltaRapida
              catalogo="specialties"
              titulo="Nueva especialidad"
              campos={[
                { nombre: "code", etiqueta: "Código (ej. MEC)", requerido: true },
                { nombre: "name", etiqueta: "Nombre", requerido: true },
                { nombre: "hourlyRate", etiqueta: "Tarifa por hora" },
              ]}
              onCreado={(opciones, nuevoId) => {
                onEspecialidades(opciones);
                onLabor([...labor, { specialtyId: nuevoId, personas: "1", hours: "1" }]);
              }}
            />
          ) : null
        }
      >
        {labor.map((linea, i) => {
          const esp = especialidades.find((e) => e.id === linea.specialtyId);
          const horas = Number(linea.personas || 0) * Number(linea.hours || 0);
          return (
            <div key={i} className="grid gap-1.5 md:grid-cols-[1fr_80px_80px_110px_28px]">
              <select
                className="field"
                value={linea.specialtyId}
                onChange={(e) => onLabor(labor.map((l, j) => (j === i ? { ...l, specialtyId: e.target.value } : l)))}
              >
                <option value="">Seleccione…</option>
                {especialidades.map((o) => (
                  <option key={o.id} value={o.id}>{o.etiqueta}</option>
                ))}
              </select>
              <input
                className="field" type="number" inputMode="decimal" min="1" step="1" title="Personas"
                value={linea.personas}
                onChange={(e) => onLabor(labor.map((l, j) => (j === i ? { ...l, personas: e.target.value } : l)))}
              />
              <input
                className="field" type="number" inputMode="decimal" min="0" step="0.5" title="Horas por persona"
                value={linea.hours}
                onChange={(e) => onLabor(labor.map((l, j) => (j === i ? { ...l, hours: e.target.value } : l)))}
              />
              <p className="self-center text-right text-[0.6875rem] tabular-nums text-slate-500">
                {formatNumber(horas, 1)} h · {formatCurrency(horas * (esp?.costo ?? 0), moneda)}
              </p>
              <Quitar onClick={() => onLabor(labor.filter((_, j) => j !== i))} />
            </div>
          );
        })}
        {labor.length ? (
          <p className="text-[0.6875rem] text-slate-400">Personas × horas por persona. La tarifa sale del catálogo de especialidades.</p>
        ) : null}
      </Bloque>

      {/* ------------------------------------------------------- Refacciones */}
      <Bloque
        titulo="Refacciones"
        vacio="Sin refacciones estimadas."
        hayFilas={parts.length > 0}
        onAgregar={() => onParts([...parts, { partId: refacciones[0]?.id ?? "", quantity: "1" }])}
        deshabilitado={refacciones.length === 0}
        aviso={refacciones.length === 0 ? "No hay refacciones en el almacén." : null}
      >
        {parts.map((linea, i) => {
          const ref = refacciones.find((r) => r.id === linea.partId);
          return (
            <div key={i} className="grid gap-1.5 md:grid-cols-[1fr_80px_190px_28px]">
              <SelectorBuscable
                valor={linea.partId}
                onCambio={(id) => onParts(parts.map((p, j) => (j === i ? { ...p, partId: id } : p)))}
                vacio="Seleccione…"
                marcador="Busque por clave o descripción"
                opciones={refacciones.map((o) => ({ id: o.id, etiqueta: o.etiqueta }))}
              />
              <input
                className="field" type="number" inputMode="decimal" min="0" step="0.5" title="Cantidad"
                value={linea.quantity}
                onChange={(e) => onParts(parts.map((p, j) => (j === i ? { ...p, quantity: e.target.value } : p)))}
              />
              <p className="self-center text-right text-[0.6875rem] tabular-nums text-slate-500">
                {ref?.unidad ?? ""} · {formatCurrency(Number(linea.quantity || 0) * (ref?.costo ?? 0), moneda)}
              </p>
              <Quitar onClick={() => onParts(parts.filter((_, j) => j !== i))} />
            </div>
          );
        })}
      </Bloque>

      {/* ------------------------------------------------- Servicios externos */}
      <Bloque
        titulo="Servicios externos"
        vacio="Sin servicios subcontratados."
        hayFilas={services.length > 0}
        onAgregar={() => onServices([...services, { serviceId: servicios[0]?.id ?? "", quantity: "1", nota: "" }])}
        deshabilitado={servicios.length === 0 && !puedeCrear}
        aviso={servicios.length === 0 ? "No hay servicios externos en el catálogo." : null}
        alta={
          puedeCrear ? (
            <AltaRapida
              catalogo="external-services"
              titulo="Nuevo servicio externo"
              campos={[
                { nombre: "code", etiqueta: "Código (ej. SRV-REB)", requerido: true },
                { nombre: "name", etiqueta: "Nombre", requerido: true },
                { nombre: "unit", etiqueta: "Unidad (servicio, hora…)" },
                { nombre: "unitCost", etiqueta: "Costo unitario" },
              ]}
              onCreado={(opciones, nuevoId) => {
                onServicios(opciones);
                onServices([...services, { serviceId: nuevoId, quantity: "1", nota: "" }]);
              }}
            />
          ) : null
        }
      >
        {services.map((linea, i) => {
          const srv = servicios.find((s) => s.id === linea.serviceId);
          return (
            <div key={i} className="grid gap-1.5 md:grid-cols-[1fr_80px_1fr_110px_28px]">
              <select
                className="field"
                value={linea.serviceId}
                onChange={(e) => onServices(services.map((s, j) => (j === i ? { ...s, serviceId: e.target.value } : s)))}
              >
                <option value="">Seleccione…</option>
                {servicios.map((o) => (
                  <option key={o.id} value={o.id}>{o.etiqueta}</option>
                ))}
              </select>
              <input
                className="field" type="number" inputMode="decimal" min="0" step="0.5" title="Cantidad"
                value={linea.quantity}
                onChange={(e) => onServices(services.map((s, j) => (j === i ? { ...s, quantity: e.target.value } : s)))}
              />
              <input
                className="field" placeholder="Alcance o condicion"
                value={linea.nota}
                onChange={(e) => onServices(services.map((s, j) => (j === i ? { ...s, nota: e.target.value } : s)))}
              />
              <p className="self-center text-right text-[0.6875rem] tabular-nums text-slate-500">
                {formatCurrency(Number(linea.quantity || 0) * (srv?.costo ?? 0), moneda)}
              </p>
              <Quitar onClick={() => onServices(services.filter((_, j) => j !== i))} />
            </div>
          );
        })}
      </Bloque>

      {/* ------------------------------------------------------- Herramientas */}
      <Bloque
        titulo="Herramientas"
        vacio="Sin herramientas declaradas."
        hayFilas={tools.length > 0}
        onAgregar={() =>
          onTools([...tools, { fuente: primeraFuente, id: opcionesDe(primeraFuente)[0]?.id ?? "", cantidad: "1", nota: "" }])
        }
        deshabilitado={!hayHerramientas}
        aviso={hayHerramientas ? null : "No hay herramientas ni cajas dadas de alta."}
      >
        {tools.map((linea, i) => {
          const opciones = opcionesDe(linea.fuente);
          // Un select cuyo valor no está entre sus opciones muestra la primera
          // y conserva el valor viejo: el efectivo se deriva en cada render.
          const valor = opciones.some((o) => o.id === linea.id) ? linea.id : "";
          const cambiar = (cambio: Partial<LineaHta>) =>
            onTools(tools.map((h, j) => (j === i ? { ...h, ...cambio } : h)));
          return (
            <div key={i} className="grid gap-1.5 md:grid-cols-[110px_1fr_80px_1fr_28px]">
              <select
                className="field"
                value={linea.fuente}
                title="De dónde sale la herramienta"
                onChange={(e) => {
                  const fuente = e.target.value as LineaHta["fuente"];
                  cambiar({ fuente, id: opcionesDe(fuente)[0]?.id ?? "" });
                }}
              >
                <option value="ALMACEN">Del almacén</option>
                <option value="ACTIVO">Serializada</option>
                <option value="CAJA">Caja</option>
              </select>
              <select className="field" value={valor} onChange={(e) => cambiar({ id: e.target.value })}>
                <option value="">Seleccione…</option>
                {opciones.map((o) => (
                  <option key={o.id} value={o.id}>{o.etiqueta}</option>
                ))}
              </select>
              <input
                className="field" type="number" inputMode="decimal" min="0" step="1" title="Cuántas"
                value={linea.cantidad}
                onChange={(e) => cambiar({ cantidad: e.target.value })}
              />
              <input
                className="field" placeholder="Para qué, o con qué medida"
                value={linea.nota}
                onChange={(e) => cambiar({ nota: e.target.value })}
              />
              <Quitar onClick={() => onTools(tools.filter((_, j) => j !== i))} />
            </div>
          );
        })}
      </Bloque>
    </div>
  );
}

function Bloque({
  titulo, vacio, aviso, deshabilitado, onAgregar, alta, hayFilas, children,
}: {
  titulo: string;
  vacio: string;
  hayFilas: boolean;
  aviso?: string | null;
  deshabilitado?: boolean;
  onAgregar: () => void;
  alta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
        <button
          type="button"
          onClick={onAgregar}
          disabled={deshabilitado}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[0.6875rem] text-slate-600 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-40"
        >
          <Plus className="h-3 w-3" /> Agregar
        </button>
        {alta}
      </div>
      <div className="grid gap-1.5">{children}</div>
      {!hayFilas ? (
        <p className="text-[0.6875rem] text-slate-400">
          {vacio}{aviso ? ` ${aviso}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function Quitar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-9 w-7 place-items-center self-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
      title="Quitar"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * Alta de un catalogo sin salir del plan. Devuelve la lista completa ya
 * actualizada y el id del registro nuevo, para dejarlo seleccionado.
 */
function AltaRapida({
  catalogo, titulo, campos, onCreado,
}: {
  catalogo: "specialties" | "external-services";
  titulo: string;
  campos: Array<{ nombre: string; etiqueta: string; requerido?: boolean }>;
  onCreado: (opciones: Opcion[], nuevoId: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    setGuardando(true);
    setError(null);
    const res = await fetch(`/api/catalogs/${catalogo}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setGuardando(false);
    if (!res.ok) {
      setError(data.error ?? "No fue posible crear el registro");
      return;
    }
    const opciones: Opcion[] = (data.items as Array<Record<string, unknown>>).map((i) => ({
      id: String(i.id),
      etiqueta: `${i.code} — ${i.name}`,
      costo: Number(i.hourlyRate ?? i.unitCost ?? 0),
      unidad: i.unit ? String(i.unit) : undefined,
    }));
    onCreado(opciones, String(data.id));
    setForm({});
    setAbierto(false);
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[0.6875rem] text-slate-500 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600"
      >
        <Plus className="h-3 w-3" /> {titulo}
      </button>
    );
  }

  return (
    <div className="grid w-full gap-1.5 rounded-lg border border-brand-200 bg-brand-50/60 p-2">
      <div className="flex items-center justify-between">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-brand-700">{titulo}</p>
        <button type="button" onClick={() => setAbierto(false)} className="text-slate-400 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {campos.map((c) => (
          <input
            key={c.nombre}
            className="field"
            placeholder={c.etiqueta + (c.requerido ? "" : " (opcional)")}
            value={form[c.nombre] ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, [c.nombre]: e.target.value }))}
          />
        ))}
      </div>
      {error ? <p className="text-[0.6875rem] text-red-600">{error}</p> : null}
      <button
        type="button"
        onClick={crear}
        disabled={guardando || campos.some((c) => c.requerido && !form[c.nombre]?.trim())}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Agregar y usar
      </button>
    </div>
  );
}
