"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Plus, TriangleAlert, X } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { SelectorBuscable, type OpcionBuscable } from "@/components/selector-buscable";
import {
  ESTADOS_HERRAMIENTA, MOTIVOS_BAJA, ORDEN_ESTADOS, ORDEN_MOTIVOS_BAJA,
  nombreDeEstado, seLeAtribuye,
} from "@/lib/herramientas-tipos";

const entrada = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none";
const etiqueta = "block text-xs font-medium text-slate-600";

/** Prestar una herramienta. */
export function Prestar({
  herramientas, almacenes, personas,
}: {
  herramientas: OpcionBuscable[];
  almacenes: Array<{ id: string; nombre: string; autoservicio: boolean }>;
  personas: OpcionBuscable[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [partId, setPartId] = useState("");
  const [warehouseId, setWarehouseId] = useState(almacenes[0]?.id ?? "");
  const [personaId, setPersonaId] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [estadoSalida, setEstadoSalida] = useState("BUENA");
  const [proposito, setProposito] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const almacen = almacenes.find((a) => a.id === warehouseId);

  async function guardar() {
    if (!partId || !personaId) { setError("Falta decir qué herramienta y para quién."); return; }
    setOcupado(true);
    setError(null);
    const r = await fetch("/api/herramientas/prestamos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partId, warehouseId, personaId,
        cantidad: Number(cantidad) || 1,
        estadoSalida, proposito,
        autoservicio: almacen?.autoservicio ?? false,
      }),
    });
    setOcupado(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? "No se pudo prestar.");
      return;
    }
    setPartId(""); setPersonaId(""); setCantidad("1"); setProposito("");
    setAbierto(false);
    router.refresh();
  }

  if (!abierto) {
    return <Button onClick={() => setAbierto(true)}><Plus className="mr-1 h-4 w-4" aria-hidden /> Prestar</Button>;
  }

  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">Prestar una herramienta</span>
        <button type="button" onClick={() => setAbierto(false)} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Cerrar">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={etiqueta}>Herramienta</label>
          <SelectorBuscable valor={partId} onCambio={setPartId} opciones={herramientas} vacio={null} />
        </div>
        <div>
          <label className={etiqueta}>Quién se la lleva</label>
          <SelectorBuscable valor={personaId} onCambio={setPersonaId} opciones={personas} vacio={null} />
        </div>
        <div>
          <label className={etiqueta} htmlFor="h-almacen">De qué almacén</label>
          <select id="h-almacen" className={entrada} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
          {/* Quién queda registrado como responsable cambia según el almacén. */}
          <p className="mt-1 text-[0.6875rem] text-slate-500">
            {almacen?.autoservicio
              ? "Autoservicio: queda registrado quien se la lleva, sin segunda firma."
              : "Con almacenista: queda registrado que usted la entregó."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={etiqueta} htmlFor="h-cant">Cuántas</label>
            <input id="h-cant" className={entrada} value={cantidad} inputMode="decimal"
              onChange={(e) => setCantidad(e.target.value.replace(/[^\d.]/g, ""))} />
          </div>
          <div>
            <label className={etiqueta} htmlFor="h-estado">Cómo sale</label>
            <select id="h-estado" className={entrada} value={estadoSalida} onChange={(e) => setEstadoSalida(e.target.value)}>
              {ORDEN_ESTADOS.map((e) => <option key={e} value={e}>{ESTADOS_HERRAMIENTA[e].nombre}</option>)}
            </select>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={etiqueta} htmlFor="h-prop">Para qué</label>
          <input id="h-prop" className={entrada} value={proposito} maxLength={200}
            onChange={(e) => setProposito(e.target.value)} placeholder="Calibrar la línea 1" />
        </div>
      </div>

      {/* El estado de salida no es adorno: sin él no se puede afirmar después
          que una herramienta regresó peor de como se fue. */}
      <p className="mt-2 text-[0.6875rem] text-slate-500">
        Anote cómo sale. Es lo único que después permite decir que regresó peor — sin eso, es la palabra de uno
        contra la del otro.
      </p>

      {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button onClick={guardar} disabled={ocupado}>{ocupado ? "Guardando…" : "Prestar"}</Button>
        <Button variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </Card>
  );
}

/** Devolver o dar de baja lo que está fuera. */
export function Devolver({
  resguardoId, estadoSalida, quien, herramienta,
}: {
  resguardoId: string;
  estadoSalida: string | null;
  quien: string;
  herramienta: string;
}) {
  const router = useRouter();
  const [modo, setModo] = useState<"cerrado" | "devolver" | "baja">("cerrado");
  const [estadoRegreso, setEstadoRegreso] = useState(estadoSalida ?? "BUENA");
  const [motivo, setMotivo] = useState("PERDIDA");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function llamar(url: string, init: RequestInit) {
    setOcupado(true);
    setError(null);
    const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    setOcupado(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? "No se pudo.");
      return;
    }
    setModo("cerrado");
    router.refresh();
  }

  if (modo === "cerrado") {
    return (
      <div className="flex gap-1">
        <button type="button" onClick={() => setModo("devolver")}
          className="rounded-lg border border-slate-300 px-2 py-1 text-[0.6875rem] text-slate-700 hover:bg-slate-50">
          Devolver
        </button>
        <button type="button" onClick={() => setModo("baja")}
          className="rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] text-slate-500 hover:text-rose-600">
          No volvió
        </button>
      </div>
    );
  }

  if (modo === "devolver") {
    return (
      <div className="rounded-lg border border-slate-200 p-2">
        <label className={etiqueta}>¿Cómo regresó?</label>
        <select className={`${entrada} mt-1`} value={estadoRegreso} onChange={(e) => setEstadoRegreso(e.target.value)}>
          {ORDEN_ESTADOS.map((e) => <option key={e} value={e}>{ESTADOS_HERRAMIENTA[e].nombre}</option>)}
        </select>
        {estadoSalida ? (
          <p className="mt-1 text-[0.6875rem] text-slate-500">Salió {nombreDeEstado(estadoSalida).toLowerCase()}.</p>
        ) : null}
        {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
        <div className="mt-2 flex gap-1">
          <Button size="sm" disabled={ocupado}
            onClick={() => llamar(`/api/herramientas/prestamos/${resguardoId}`, { method: "PATCH", body: JSON.stringify({ estadoRegreso }) })}>
            Recibir
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setModo("cerrado")}>Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-2">
      <p className="text-[0.6875rem] font-medium text-rose-900">
        {herramienta} — la traía {quien}
      </p>
      <label className={etiqueta}>¿Qué pasó?</label>
      <select className={`${entrada} mt-1`} value={motivo} onChange={(e) => setMotivo(e.target.value)}>
        {ORDEN_MOTIVOS_BAJA.map((m) => <option key={m} value={m}>{MOTIVOS_BAJA[m].nombre}</option>)}
      </select>
      {/* Se dice, antes de guardar, si esto va a contar como pérdida atribuida. */}
      <p className="mt-1 text-[0.6875rem] text-rose-800">
        {seLeAtribuye(motivo)
          ? `Se va a descontar del almacén y contará en lo que se le pierde a ${quien}.`
          : "Se va a descontar del almacén, y NO cuenta como pérdida de nadie: es desgaste."}
      </p>
      <input className={`${entrada} mt-2`} value={nota} maxLength={200}
        onChange={(e) => setNota(e.target.value)} placeholder="Qué pasó (opcional)" />
      {error ? <p className="mt-1 text-xs text-rose-700">{error}</p> : null}
      <div className="mt-2 flex gap-1">
        <Button size="sm" disabled={ocupado}
          onClick={() => llamar("/api/herramientas/bajas", { method: "POST", body: JSON.stringify({ resguardoId, motivo, nota }) })}>
          Dar de baja
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setModo("cerrado")}>Cancelar</Button>
      </div>
    </div>
  );
}

/** Lo que lleva demasiado tiempo fuera. */
export function Atrasada({ dias }: { dias: number }) {
  return (
    <Badge tone="warning">
      <TriangleAlert className="mr-1 inline h-3 w-3" aria-hidden />
      {dias} días fuera
    </Badge>
  );
}

export const IconoCambio = ArrowLeftRight;
