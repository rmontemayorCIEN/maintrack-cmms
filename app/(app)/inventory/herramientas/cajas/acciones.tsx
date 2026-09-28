"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { SelectorBuscable, type OpcionBuscable } from "@/components/selector-buscable";
import { ESTADOS_HERRAMIENTA, ORDEN_ESTADOS } from "@/lib/herramientas-tipos";

const entrada = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none";
const etiqueta = "block text-xs font-medium text-slate-600";

type Pieza = { tipo: "part" | "asset"; id: string; cantidad: string };

/** Armar una caja. */
export function ArmarCaja({
  herramientas, unidades,
}: {
  herramientas: OpcionBuscable[];
  unidades: OpcionBuscable[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [notas, setNotas] = useState("");
  const [piezas, setPiezas] = useState<Pieza[]>([{ tipo: "part", id: "", cantidad: "1" }]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cambiar = (i: number, c: Partial<Pieza>) =>
    setPiezas((ps) => ps.map((p, j) => (j === i ? { ...p, ...c } : p)));

  async function guardar() {
    const listas = piezas.filter((p) => p.id);
    if (!code.trim() || !name.trim()) { setError("La caja necesita clave y nombre."); return; }
    if (!listas.length) { setError("Agregue al menos una pieza: una caja vacía no sirve de nada."); return; }

    setOcupado(true);
    setError(null);
    const r = await fetch("/api/herramientas/cajas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "armar", code, name, notas,
        piezas: listas.map((p) => ({
          ...(p.tipo === "part" ? { partId: p.id } : { assetId: p.id }),
          cantidad: Number(p.cantidad) || 1,
        })),
      }),
    });
    setOcupado(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? "No se pudo armar.");
      return;
    }
    setAbierto(false);
    setCode(""); setName(""); setNotas(""); setPiezas([{ tipo: "part", id: "", cantidad: "1" }]);
    router.refresh();
  }

  if (!abierto) {
    return <Button onClick={() => setAbierto(true)}><Plus className="mr-1 h-4 w-4" aria-hidden /> Armar una caja</Button>;
  }

  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">Armar una caja</span>
        <button type="button" onClick={() => setAbierto(false)} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Cerrar">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={etiqueta} htmlFor="caja-code">Clave</label>
          <input id="caja-code" className={entrada} value={code} maxLength={20}
            onChange={(e) => setCode(e.target.value)} placeholder="CAJA-MEC" />
        </div>
        <div className="sm:col-span-2">
          <label className={etiqueta} htmlFor="caja-name">Cómo le llaman</label>
          <input id="caja-name" className={entrada} value={name} maxLength={80}
            onChange={(e) => setName(e.target.value)} placeholder="Caja del mecánico" />
        </div>
      </div>

      <div className="mt-3">
        <span className={etiqueta}>Qué trae</span>
        <div className="mt-1 space-y-2">
          {piezas.map((p, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[auto_1fr_auto_auto]">
              <select className={entrada} value={p.tipo}
                onChange={(e) => cambiar(i, { tipo: e.target.value as Pieza["tipo"], id: "" })}>
                <option value="part">Del almacén</option>
                <option value="asset">Con número de serie</option>
              </select>
              <SelectorBuscable
                valor={p.id}
                onCambio={(v) => cambiar(i, { id: v })}
                opciones={p.tipo === "part" ? herramientas : unidades}
                vacio="Elija cuál"
              />
              <input className={`${entrada} w-20`} value={p.cantidad} inputMode="decimal"
                disabled={p.tipo === "asset"}
                onChange={(e) => cambiar(i, { cantidad: e.target.value.replace(/[^\d.]/g, "") })} />
              <button type="button" onClick={() => setPiezas((ps) => ps.filter((_, j) => j !== i))}
                className="rounded border border-slate-300 px-2 text-slate-500 hover:text-rose-600" aria-label="Quitar">
                <Trash2 className="h-3 w-3" aria-hidden />
              </button>
            </div>
          ))}
        </div>
        {/* Una unidad serializada es una: no tiene cantidad que elegir. */}
        <p className="mt-1 text-[0.6875rem] text-slate-500">
          Lo del almacén va por cantidad; lo que tiene número de serie es una pieza única.
        </p>
        <Button variant="secondary" size="sm" className="mt-2"
          onClick={() => setPiezas((ps) => [...ps, { tipo: "part", id: "", cantidad: "1" }])}>
          <Plus className="mr-1 h-3 w-3" aria-hidden /> Agregar pieza
        </Button>
      </div>

      <div className="mt-3">
        <label className={etiqueta} htmlFor="caja-notas">Notas</label>
        <input id="caja-notas" className={entrada} value={notas} maxLength={200}
          onChange={(e) => setNotas(e.target.value)} placeholder="Dónde vive, quién la usa" />
      </div>

      {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button onClick={guardar} disabled={ocupado}>{ocupado ? "Guardando…" : "Armar"}</Button>
        <Button variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </Card>
  );
}

/** Prestar una caja completa. */
export function PrestarCaja({
  cajaId, cajaNombre, personas, almacenes,
}: {
  cajaId: string;
  cajaNombre: string;
  personas: OpcionBuscable[];
  almacenes: Array<{ id: string; nombre: string }>;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [personaId, setPersonaId] = useState("");
  const [warehouseId, setWarehouseId] = useState(almacenes[0]?.id ?? "");
  const [estadoSalida, setEstadoSalida] = useState("BUENA");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function prestar() {
    if (!personaId) { setError("Diga para quién."); return; }
    setOcupado(true);
    setError(null);
    const r = await fetch("/api/herramientas/cajas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "prestar", kitId: cajaId, personaId, warehouseId, estadoSalida }),
    });
    const d = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) { setError(d.error ?? "No se pudo prestar."); return; }

    /*
     * Si la caja salió incompleta se dice AQUÍ y no se cierra el panel: quien
     * la entrega tiene que enterarse antes de que el técnico baje a piso.
     */
    if (d.faltaron?.length) {
      setAviso(`Salió con ${d.prestadas} piezas. No se pudo llevar: ${d.faltaron.map((f: { que: string; motivo: string }) => `${f.que} (${f.motivo})`).join(" · ")}`);
      router.refresh();
      return;
    }
    setAbierto(false);
    setPersonaId("");
    router.refresh();
  }

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)}
        className="rounded-lg border border-slate-300 px-2 py-1 text-[0.6875rem] text-slate-700 hover:bg-slate-50">
        Prestar
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-slate-200 p-3">
      <p className="mb-2 text-xs font-medium text-slate-700">Prestar {cajaNombre}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <SelectorBuscable valor={personaId} onCambio={setPersonaId} opciones={personas} vacio="Para quién" />
        <select className={entrada} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        <select className={entrada} value={estadoSalida} onChange={(e) => setEstadoSalida(e.target.value)}>
          {ORDEN_ESTADOS.map((e) => <option key={e} value={e}>{ESTADOS_HERRAMIENTA[e].nombre}</option>)}
        </select>
      </div>
      {aviso ? <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[0.6875rem] text-amber-800">{aviso}</p> : null}
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={prestar} disabled={ocupado}>{ocupado ? "Sacando…" : "Sacar la caja"}</Button>
        <Button size="sm" variant="secondary" onClick={() => { setAbierto(false); setAviso(null); }}>Cerrar</Button>
      </div>
    </div>
  );
}

/** Recibir una caja que vuelve, marcando qué regresó. */
export function RecibirCaja({
  grupo, piezas,
}: {
  grupo: string;
  piezas: Array<{ id: string; que: string }>;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [regresaron, setRegresaron] = useState<string[]>(piezas.map((p) => p.id));
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function recibir() {
    setOcupado(true);
    setError(null);
    const r = await fetch(`/api/herramientas/cajas/${grupo}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "devolver", grupo, devueltos: regresaron, estadoRegreso: "USADA" }),
    });
    setOcupado(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? "No se pudo recibir.");
      return;
    }
    setAbierto(false);
    router.refresh();
  }

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)}
        className="rounded-lg border border-slate-300 px-2 py-1 text-[0.6875rem] text-slate-700 hover:bg-slate-50">
        Recibir
      </button>
    );
  }

  const faltan = piezas.length - regresaron.length;

  return (
    <div className="mt-2 rounded-lg border border-slate-200 p-3">
      {/* Se marca pieza por pieza: es la única razón de ser de una caja. */}
      <p className="mb-2 text-xs font-medium text-slate-700">Marque lo que sí regresó</p>
      <ul className="space-y-1">
        {piezas.map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={regresaron.includes(p.id)}
                onChange={(e) =>
                  setRegresaron((rs) => (e.target.checked ? [...rs, p.id] : rs.filter((x) => x !== p.id)))
                }
              />
              {p.que}
            </label>
          </li>
        ))}
      </ul>
      {faltan > 0 ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[0.6875rem] text-amber-800">
          {faltan === 1 ? "Una pieza no regresa" : `${faltan} piezas no regresan`}: van a seguir a nombre de quien
          las trae, para buscarlas o darlas de baja.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={recibir} disabled={ocupado}>{ocupado ? "Recibiendo…" : "Recibir"}</Button>
        <Button size="sm" variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </div>
  );
}
