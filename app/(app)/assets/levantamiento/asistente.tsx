"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ClipboardList, Loader2, Sparkles } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { PasoFotos, type Foto } from "./fotos";

type Pregunta = { clave: string; pregunta: string; porQue: string; ejemplo: string };
type Propuesta = {
  id: string; sistema: string; nombre: string; categoria: string | null;
  criticidad: string; ubicacion: string | null; cantidad: number; porQue: string | null;
};

type Paso = "DESCRIBIR" | "ENTREVISTA" | "FOTOS" | "GENERANDO" | "REVISAR" | "LISTO";

const CRITICIDAD: Record<string, { texto: string; tono: "danger" | "warning" | "muted" }> = {
  A: { texto: "A · crítico", tono: "danger" },
  B: { texto: "B · importante", tono: "warning" },
  C: { texto: "C · secundario", tono: "muted" },
};

/**
 * Levantamiento asistido del inventario, paso a paso.
 *
 * Cada paso dice que hacer, por que, y que va a pasar despues. Quien ejecuta
 * esto normalmente lo hace una sola vez en la vida de una cuenta —el dia de la
 * implementacion— asi que no puede depender de que ya sepa como funciona.
 */
export function AsistenteLevantamiento({
  sitios,
  ubicaciones,
  operacionesRestantes,
  instalacion,
}: {
  sitios: Array<{ id: string; code: string; name: string }>;
  ubicaciones: Array<{ id: string; name: string; siteId: string }>;
  operacionesRestantes: number;
  /** Tipo de instalacion del cliente: adapta el ejemplo y el vocabulario. */
  instalacion: { nombre: string; sustantivo: string; ejemplo: string };
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>("DESCRIBIR");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [descripcion, setDescripcion] = useState("");
  const [tipo, setTipo] = useState<string | null>(null);
  const [entendido, setEntendido] = useState("");
  const [preguntas, setPreguntas] = useState<Pregunta[]>([]);
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [fotos, setFotos] = useState<Foto[]>([]);

  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);
  const [nota, setNota] = useState("");
  const [aceptados, setAceptados] = useState<Set<string>>(new Set());

  const [siteId, setSiteId] = useState(sitios[0]?.id ?? "");
  const [locationId, setLocationId] = useState("");
  const [prefijo, setPrefijo] = useState("ACT");
  const [resultado, setResultado] = useState<{ creados: number } | null>(null);

  const ubicacionesDelSitio = ubicaciones.filter((u) => u.siteId === siteId);
  const totalEquipos = propuestas
    .filter((p) => aceptados.has(p.id))
    .reduce((s, p) => s + p.cantidad, 0);

  async function pedirEntrevista() {
    setCargando(true); setError(null);
    const res = await fetch("/api/ia/levantamiento", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paso: "ENTREVISTA", descripcion }),
    });
    const data = await res.json();
    setCargando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible preparar la entrevista"); return; }
    setTipo(data.entrevista.tipo);
    setEntendido(data.entrevista.entendido);
    setPreguntas(data.entrevista.preguntas);
    setPaso("ENTREVISTA");
  }

  async function generarInventario() {
    setCargando(true); setError(null); setPaso("GENERANDO");
    const res = await fetch("/api/ia/levantamiento", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paso: "INVENTARIO", descripcion, tipo,
        respuestas: preguntas.map((p) => ({ pregunta: p.pregunta, respuesta: respuestas[p.clave] ?? "no se" })),
        equiposVistos: fotos
          .filter((f) => f.util && f.equipos.length)
          .map((f) => ({
            zona: f.zona,
            equipos: f.equipos.map((e) => `${e.nombre}${e.cantidad > 1 ? ` x${e.cantidad}` : ""} (${e.confianza.toLowerCase()})`),
          })),
        // Van todas, tambien las que no sirvieron: que una foto se haya
        // descartado y por que tambien es parte del expediente.
        fotoIds: fotos.map((f) => f.fotoId).filter(Boolean),
      }),
    });
    const data = await res.json();
    setCargando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible generar el inventario"); setPaso("FOTOS"); return; }

    const detalle = await fetch(`/api/ia/levantamiento/${data.intakeId}/propuestas`).then((r) => r.json()).catch(() => null);
    setIntakeId(data.intakeId);
    setNota(data.nota ?? "");
    const lista: Propuesta[] = detalle?.propuestas ?? [];
    setPropuestas(lista);
    setAceptados(new Set(lista.map((p) => p.id)));
    setPaso("REVISAR");
  }

  async function aplicar() {
    if (!intakeId) return;
    setCargando(true); setError(null);
    const res = await fetch(`/api/ia/levantamiento/${intakeId}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, locationId: locationId || null, prefijo, aceptados: [...aceptados] }),
    });
    const data = await res.json();
    setCargando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible dar de alta los activos"); return; }
    setResultado({ creados: data.creados });
    setPaso("LISTO");
    router.refresh();
  }

  const pasos = ["Describir", "Entrevista", "Fotos", "Revisar", "Dar de alta"];
  const indice =
    paso === "DESCRIBIR" ? 0
      : paso === "ENTREVISTA" ? 1
      : paso === "FOTOS" ? 2
      : paso === "LISTO" ? 4
      : 3;

  return (
    <div className="grid gap-4">
      {/* ─────────────────────────────────────────── Barra de pasos */}
      <div className="flex flex-wrap items-center gap-1.5">
        {pasos.map((p, i) => (
          <div key={p} className="flex items-center gap-1.5">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium ${
              i < indice ? "bg-emerald-100 text-emerald-700"
                : i === indice ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-400"
            }`}>
              {i < indice ? <Check className="h-3 w-3" /> : <span className="tabular-nums">{i + 1}</span>}
              {p}
            </span>
            {i < pasos.length - 1 ? <span className="text-slate-300">·</span> : null}
          </div>
        ))}
        <span className="ml-auto text-[0.6875rem] text-slate-400">
          {operacionesRestantes} operaciones de IA disponibles
        </span>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}

      {/* ──────────────────────────────────── Paso 1: describir */}
      {paso === "DESCRIBIR" ? (
        <Card>
          <p className="text-sm font-semibold text-slate-800">Paso 1 · Describa {instalacion.sustantivo}</p>
          <p className="mt-1 text-xs text-slate-600">
            Escriba en dos o tres renglones que es el lugar y de que tamaño. No necesita listar equipos —de eso
            se encarga el sistema—; describa el <strong>lugar</strong>, no lo que hay adentro.
          </p>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">
              Ejemplo para {instalacion.nombre.toLowerCase()}
            </p>
            <p className="mt-1 text-xs italic text-slate-600">&ldquo;{instalacion.ejemplo}&rdquo;</p>
          </div>
          <textarea
            className="field mt-3 min-h-28"
            placeholder="Describa el lugar: giro, tamaño, niveles, areas principales y horario de operacion."
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            maxLength={1200}
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[0.6875rem] text-slate-400">
              Entre mas concreto, mejor sale el inventario. {descripcion.length}/1200
            </span>
            <Button onClick={pedirEntrevista} disabled={cargando || descripcion.trim().length < 15}>
              {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Continuar
            </Button>
          </div>
        </Card>
      ) : null}

      {/* ──────────────────────────────────── Paso 2: entrevista */}
      {paso === "ENTREVISTA" ? (
        <Card>
          <p className="text-sm font-semibold text-slate-800">Paso 2 · Conteste unas preguntas</p>
          <p className="mt-1 text-xs text-slate-600">
            Estas son las preguntas cuya respuesta cambia de verdad la lista de equipos. Conteste con lo que
            sepa; si algo no lo sabe, escriba <strong>"no se"</strong> y siga —es mejor que adivinar, porque
            entonces se marca para verificar en piso.
          </p>

          <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-brand-700">Lo que entendi</p>
            <p className="mt-0.5 text-xs text-brand-900">{entendido}</p>
            {tipo ? <p className="mt-1 text-[0.6875rem] text-brand-800/70">Tipo de instalacion: {tipo}</p> : null}
          </div>

          <div className="mt-4 grid gap-4">
            {preguntas.map((p, i) => (
              <div key={p.clave}>
                <label className="label">
                  {i + 1}. {p.pregunta}
                </label>
                <p className="mb-1 text-[0.6875rem] text-slate-500">{p.porQue}</p>
                <input
                  className="field"
                  placeholder={p.ejemplo}
                  value={respuestas[p.clave] ?? ""}
                  onChange={(e) => setRespuestas((r) => ({ ...r, [p.clave]: e.target.value }))}
                  maxLength={400}
                />
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setPaso("DESCRIBIR")}>Regresar</Button>
            <Button onClick={() => setPaso("FOTOS")} disabled={cargando}>
              <ArrowRight className="h-4 w-4" /> Continuar
            </Button>
          </div>
        </Card>
      ) : null}

      {/* ──────────────────────────────── Paso 3: fotos (opcional) */}
      {paso === "FOTOS" ? (
        <Card>
          <p className="text-sm font-semibold text-slate-800">Paso 3 · Fotografie las áreas (opcional)</p>
          <p className="mt-1 text-xs text-slate-600">
            Si esta parado en la instalación, tome una foto de cada cuarto técnico. Lo que la entrevista no
            alcanzo a describir, la cámara lo muestra: cada equipo reconocido entra al inventario aunque no
            se haya mencionado. <strong>Si no tiene fotos a la mano, puede saltarse este paso.</strong>
          </p>
          <div className="mt-3">
            <PasoFotos fotos={fotos} onCambio={setFotos} />
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setPaso("ENTREVISTA")}>Regresar</Button>
            <Button onClick={generarInventario} disabled={cargando}>
              <Sparkles className="h-4 w-4" /> Proponer el inventario
            </Button>
          </div>
        </Card>
      ) : null}

      {paso === "GENERANDO" ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
            <p className="text-sm font-semibold text-slate-800">Armando el inventario…</p>
            <p className="max-w-md text-xs text-slate-500">
              Tarda entre uno y dos minutos. No cierre la ventana; al terminar va a poder revisar equipo por
              equipo antes de que se cree ninguno.
            </p>
          </div>
        </Card>
      ) : null}

      {/* ──────────────────────────────────── Paso 3: revisar */}
      {paso === "REVISAR" ? (
        <>
          <Card>
            <p className="text-sm font-semibold text-slate-800">Paso 4 · Revise lo propuesto</p>
            <p className="mt-1 text-xs text-slate-600">
              Nada se ha creado todavía. Desmarque lo que no exista en la instalación y corrija las cantidades.
              Es mas facil agregar después lo que falte que borrar lo que sobre.
            </p>
            {nota ? (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <strong>Nota de la IA:</strong> {nota}
              </p>
            ) : null}
            <p className="mt-2 text-xs font-medium text-slate-700">
              {aceptados.size} de {propuestas.length} conceptos seleccionados · {totalEquipos} activos se van a crear
            </p>
          </Card>

          {[...new Set(propuestas.map((p) => p.sistema))].map((sistema) => (
            <Card key={sistema} padded={false}>
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{sistema}</p>
                <button
                  type="button"
                  className="text-[0.6875rem] text-slate-500 hover:text-brand-600"
                  onClick={() =>
                    setAceptados((prev) => {
                      const s = new Set(prev);
                      const delSistema = propuestas.filter((p) => p.sistema === sistema);
                      const todos = delSistema.every((p) => s.has(p.id));
                      delSistema.forEach((p) => (todos ? s.delete(p.id) : s.add(p.id)));
                      return s;
                    })
                  }
                >
                  Marcar o desmarcar todo
                </button>
              </div>
              <ul className="divide-y divide-slate-100">
                {propuestas.filter((p) => p.sistema === sistema).map((p) => {
                  const c = CRITICIDAD[p.criticidad] ?? CRITICIDAD.C;
                  return (
                    <li key={p.id} className="px-4 py-2.5">
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
                          checked={aceptados.has(p.id)}
                          onChange={(e) =>
                            setAceptados((prev) => {
                              const s = new Set(prev);
                              if (e.target.checked) s.add(p.id); else s.delete(p.id);
                              return s;
                            })
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-medium text-slate-800">{p.nombre}</span>
                            <Badge tone={c.tono}>{c.texto}</Badge>
                            {p.cantidad > 1 ? <Badge tone="info">{p.cantidad} equipos</Badge> : null}
                          </div>
                          {p.porQue ? <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-slate-500">{p.porQue}</p> : null}
                          <p className="mt-0.5 text-[0.6875rem] text-slate-400">
                            {p.categoria ?? "sin categoría"}{p.ubicacion ? ` · ${p.ubicacion}` : ""}
                          </p>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}

          <Card>
            <p className="text-sm font-semibold text-slate-800">Paso 5 · Donde se dan de alta</p>
            <p className="mt-1 text-xs text-slate-600">
              Los activos se crean en el sitio que elija, con código consecutivo y <strong>sin datos de placa</strong>:
              marca, modelo y serie se capturan en piso con la foto de la placa. Cada uno queda con una nota que
              dice que falta verificarlo.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Sitio</label>
                <select className="field" value={siteId} onChange={(e) => { setSiteId(e.target.value); setLocationId(""); }}>
                  {sitios.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Ubicación (opcional)</label>
                <select className="field" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Sin ubicación</option>
                  {ubicacionesDelSitio.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Prefijo del código</label>
                <input className="field" value={prefijo} maxLength={6} onChange={(e) => setPrefijo(e.target.value.toUpperCase())} />
                <p className="mt-1 text-[0.6875rem] text-slate-500">Quedaran como {prefijo || "ACT"}-001, {prefijo || "ACT"}-002…</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500">Se van a crear {totalEquipos} activos</span>
              <Button onClick={aplicar} disabled={cargando || aceptados.size === 0 || !siteId}>
                {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Dar de alta
              </Button>
            </div>
          </Card>
        </>
      ) : null}

      {/* ──────────────────────────────────── Cierre */}
      {paso === "LISTO" && resultado ? (
        <Card>
          <div className="py-6 text-center">
            <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700">
              <Check className="h-5 w-5" />
            </span>
            <p className="mt-2 text-sm font-semibold text-slate-800">
              {resultado.creados} activos dados de alta
            </p>
            <div className="mx-auto mt-3 max-w-lg rounded-lg border border-slate-200 bg-slate-50 p-3 text-left">
              <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-600">
                <ClipboardList className="h-3.5 w-3.5" /> Lo que sigue
              </p>
              <ol className="mt-1.5 grid gap-1 text-xs text-slate-600">
                <li><strong>1.</strong> Recorra la instalación y confirme cada activo: los que no existan, dese de baja.</li>
                <li><strong>2.</strong> Fotografie la placa de cada equipo para llenar marca, modelo y serie.</li>
                <li><strong>3.</strong> Genere los planes de mantenimiento con IA desde la pantalla de Planes.</li>
                <li><strong>4.</strong> Revise que refacciones conviene tener, en Almacén → Análisis.</li>
              </ol>
            </div>
            <Button className="mt-4" onClick={() => router.push("/assets")}>
              Ver los activos <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
