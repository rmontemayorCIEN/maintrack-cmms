"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet, History, Loader2, RotateCcw, Upload, X,
} from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { Dialogo } from "@/components/ui/dialogo";
import { cn, formatDateTime } from "@/lib/utils";
import { useZona } from "@/components/zona-empresa";
import { ESTADOS_CON_REGISTROS, ESTADO_LOTE, type EstadoLote } from "@/lib/estados-lote";

type Columna = { nombre: string; requerido?: boolean; ayuda?: string; ejemplo: string };
type Tipo = {
  clave: string; titulo: string; descripcion: string;
  requisitos: string | null; erroresComunes: string[]; columnas: Columna[]; actualizable: boolean;
};
type Falla = { columna?: string; motivo: string; valor?: string; solucion?: string };
type Fila = {
  fila: number;
  estado: "nuevo" | "actualizar" | "exacto" | "posible" | "error";
  resumen: string;
  clave?: string;
  fallas: Falla[];
  advertencias: Falla[];
  coincide?: { id: string | null; resumen: string; motivo: string };
};
type Analisis = {
  formato: "csv" | "xlsx";
  filas: Fila[];
  totales: {
    leidos: number; validos: number; conAdvertencias: number; rechazados: number;
    nuevos: number; actualizar: number; exactos: number; posibles: number;
  };
  columnasDesconocidas: string[];
  columnasFaltantes: string[];
  avisosArchivo: string[];
  puedeImportar: boolean;
  politica: string;
  despues?: string;
};
type Resultado = { estado: EstadoLote; creados: number; actualizados: number; omitidos: number; despues?: string };
type Lote = {
  id: string; tipo: string; archivoNombre: string | null; estado: string; leidos: number; creados: number;
  actualizados: number; omitidos: number; rechazados: number; createdAt: string; revertidoAt: string | null; detalle: string;
};
type Diagnostico = {
  aBorrar: Array<{ entidad: string; id: string; nombre: string; accion: "ELIMINAR" | "ANULAR" | "COMPENSAR" }>;
  bloqueados: Array<{ entidad: string; id: string; nombre: string; motivos: string[] }>;
  actualizados: Array<{ entidad: string; id: string; nombre: string; antes: Record<string, unknown> }>;
  estadoEsperado: EstadoLote;
  resultado: string;
};

const ACCION_REVERSION = { ELIMINAR: "Se elimina", ANULAR: "Se anula (queda en el historial)", COMPENSAR: "Salida que regresa la existencia" };

const ESTADO_FILA: Record<Fila["estado"], { texto: string; tono: "success" | "info" | "warning" | "danger" | "muted" }> = {
  nuevo: { texto: "Nuevo", tono: "success" },
  actualizar: { texto: "Actualiza", tono: "info" },
  exacto: { texto: "Ya existe", tono: "muted" },
  posible: { texto: "Posible duplicado", tono: "warning" },
  error: { texto: "Error", tono: "danger" },
};

const tonoLote = (e: string) => {
  const t = ESTADO_LOTE[e as EstadoLote]?.tono ?? "neutral";
  return t === "neutral" ? "muted" : t;
};

/** El detalle de errores y advertencias como CSV, para corregir en Excel. */
function descargarDetalle(filas: Fila[], nombre: string) {
  const renglones = [["fila", "estado", "columna", "valor recibido", "problema", "cómo corregirlo"]];
  for (const f of filas) {
    for (const x of f.fallas) renglones.push([String(f.fila), "error", x.columna ?? "", x.valor ?? "", x.motivo, x.solucion ?? ""]);
    for (const x of f.advertencias) renglones.push([String(f.fila), "advertencia", x.columna ?? "", x.valor ?? "", x.motivo, x.solucion ?? ""]);
    if (f.estado === "posible" && f.coincide) renglones.push([String(f.fila), "posible duplicado", "", "", `${f.coincide.motivo}: ${f.coincide.resumen}`, "Omítalo, o márquelo como distinto para crearlo"]);
  }
  const csv = renglones.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `revision-${nombre.replace(/\.(csv|xlsx)$/i, "")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Qué pasó con un lote, en una línea. */
function resumenLote(l: Lote) {
  const d = (() => { try { return JSON.parse(l.detalle || "{}"); } catch { return {}; } })();
  if (l.estado === "FALLIDA") return d.motivo ?? "No se completó: no se guardó nada";
  if (l.estado === "VALIDADA" || l.estado === "CONFIRMADA") {
    return `Solo validada: ${l.leidos} renglones${l.rechazados ? `, ${l.rechazados} rechazados` : ""}. No se guardó nada.`;
  }
  const base = `${l.creados} creados${l.actualizados ? `, ${l.actualizados} actualizados` : ""}${l.omitidos ? `, ${l.omitidos} duplicados omitidos` : ""}`;
  return d.resultado ? `${base}. ${d.resultado}` : base;
}

/**
 * Importación en dos tiempos: validar y ver, luego confirmar.
 *
 * La validación no escribe nada. Con errores no se importa: se corrige el
 * archivo y se vuelve a validar. Los duplicados se deciden aquí —omitir,
 * actualizar o crear de todos modos— y nunca se combinan solos. Cada
 * importación queda en el historial, y desde ahí se puede revertir.
 */
export function AsistenteImportacion({ tipos }: { tipos: Tipo[] }) {
  const router = useRouter();
  // La hora de la empresa, no la del navegador: quien revisa desde otra zona
  // tiene que ver la misma hora que quien importó.
  const zona = useZona();
  const archivo = useRef<HTMLInputElement>(null);

  const [activo, setActivo] = useState(tipos[0]);
  // El archivo tal como se manda: texto si es CSV, base64 si es Excel.
  const [contenido, setContenido] = useState<{ texto: string; formato: "csv" | "xlsx" } | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [exactos, setExactos] = useState<"omitir" | "actualizar">("omitir");
  const [crearPosibles, setCrearPosibles] = useState<number[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const [revirtiendo, setRevirtiendo] = useState<{ lote: Lote; diag: Diagnostico } | null>(null);

  const cargarLotes = useCallback(async () => {
    const r = await fetch("/api/import/lotes").catch(() => null);
    if (r?.ok) setLotes((await r.json()).lotes);
  }, []);
  useEffect(() => { void cargarLotes(); }, [cargarLotes]);

  function reiniciar() {
    setContenido(null); setNombreArchivo(null); setAnalisis(null); setError(null);
    setResultado(null); setCrearPosibles([]); setExactos("omitir");
    if (archivo.current) archivo.current.value = "";
  }

  async function validar(archivoLeido: { texto: string; formato: "csv" | "xlsx" }, nombre: string | null, decisiones = { exactos, crearPosibles }) {
    setOcupado("validando"); setError(null);
    try {
      const res = await fetch(`/api/import/${activo.clave}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contenido: archivoLeido.texto, formato: archivoLeido.formato, archivoNombre: nombre, decisiones }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No fue posible leer el archivo"); setAnalisis(null); return; }
      setAnalisis(data);
    } catch {
      setError("No se pudo conectar. Revise su conexión e intente de nuevo.");
    } finally {
      setOcupado(null);
    }
  }

  async function elegirArchivo(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setResultado(null); setCrearPosibles([]); setExactos("omitir");
    // Excel viaja en base64 y se lee en el servidor con las mismas reglas que
    // un CSV. Un .xls viejo no es un .xlsx: se pide guardarlo de nuevo.
    if (/\.xls$/i.test(file.name)) {
      setError("Ese es el formato de Excel anterior (.xls). Ábralo y guárdelo como «Libro de Excel (.xlsx)», o expórtelo a CSV.");
      return;
    }
    const esExcel = /\.xlsx$/i.test(file.name);
    let leido: { texto: string; formato: "csv" | "xlsx" };
    if (esExcel) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binario = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      leido = { texto: btoa(binario), formato: "xlsx" };
    } else {
      leido = { texto: await file.text(), formato: "csv" };
    }
    setContenido(leido);
    setNombreArchivo(file.name);
    await validar(leido, file.name, { exactos: "omitir", crearPosibles: [] });
  }

  function cambiarDecision(nuevas: { exactos?: "omitir" | "actualizar"; crearPosibles?: number[] }) {
    const d = { exactos: nuevas.exactos ?? exactos, crearPosibles: nuevas.crearPosibles ?? crearPosibles };
    setExactos(d.exactos); setCrearPosibles(d.crearPosibles);
    if (contenido) void validar(contenido, nombreArchivo, d);
  }

  async function importar() {
    if (!contenido) return;
    setOcupado("importando"); setError(null);
    try {
      const res = await fetch(`/api/import/${activo.clave}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contenido: contenido.texto, formato: contenido.formato, archivoNombre: nombreArchivo, decisiones: { exactos, crearPosibles } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No fue posible importar");
        void cargarLotes();
        return;
      }
      setResultado(data);
      setAnalisis(null); setContenido(null);
      if (archivo.current) archivo.current.value = "";
      void cargarLotes();
      router.refresh();
    } catch {
      setError("No se pudo conectar. La importación no se hizo; intente de nuevo.");
    } finally {
      setOcupado(null);
    }
  }

  async function prepararReversion(lote: Lote) {
    setOcupado(`rev-${lote.id}`); setError(null);
    try {
      const res = await fetch(`/api/import/lotes/${lote.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo revisar la importación"); return; }
      setRevirtiendo({ lote, diag: data });
    } finally {
      setOcupado(null);
    }
  }

  async function revertir() {
    if (!revirtiendo) return;
    setOcupado("revirtiendo"); setError(null);
    try {
      const res = await fetch(`/api/import/lotes/${revirtiendo.lote.id}/revertir`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setRevirtiendo(null);
      if (!res.ok) { setError(data.error ?? "No se pudo revertir"); void cargarLotes(); return; }
      void cargarLotes();
      router.refresh();
    } finally {
      setOcupado(null);
    }
  }

  const t = analisis?.totales;
  const conError = analisis?.filas.filter((f) => f.estado === "error") ?? [];
  const conProblema = analisis?.filas.filter((f) => f.estado !== "error" && (f.estado !== "nuevo" || f.advertencias.length || f.coincide)) ?? [];
  const errores = conError.flatMap((f) => f.fallas.map((x) => ({ fila: f.fila, ...x })));

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav className="grid content-start gap-0.5">
        <p className="mb-1 px-1 text-[0.625rem] font-semibold uppercase tracking-wider text-slate-400">Orden sugerido</p>
        {tipos.map((x, i) => (
          <button
            key={x.clave}
            type="button"
            onClick={() => { setActivo(x); reiniciar(); }}
            className={cn(
              "flex items-baseline gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
              activo.clave === x.clave ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            <span className="w-4 shrink-0 text-[0.6875rem] tabular-nums text-slate-400">{i + 1}</span>
            {x.titulo}
          </button>
        ))}
      </nav>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
        <Card>
          <h2 className="text-sm font-semibold text-slate-900">{activo.titulo}</h2>
          <p className="mt-1 text-sm text-slate-600">{activo.descripcion}</p>
          {activo.requisitos ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>Antes de importar:</strong> {activo.requisitos}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={`/api/import/${activo.clave}/template?formato=xlsx`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" /> Plantilla Excel
            </a>
            <a
              href={`/api/import/${activo.clave}/template`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" /> Plantilla CSV
            </a>
            <input
              ref={archivo} type="file" className="hidden" onChange={(e) => elegirArchivo(e.target.files)}
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            />
            <Button size="sm" onClick={() => archivo.current?.click()} disabled={ocupado !== null}>
              {ocupado === "validando" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {contenido ? "Elegir otro archivo" : "Elegir archivo (Excel o CSV)"}
            </Button>
            {nombreArchivo ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <FileSpreadsheet className="h-3.5 w-3.5" /> {nombreArchivo}
                <button type="button" onClick={reiniciar} className="text-slate-400 hover:text-slate-700" aria-label="Quitar archivo">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : null}
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-brand-600">
              Qué columnas lleva y qué errores son comunes
            </summary>
            <div className="table-wrap mt-2 rounded-lg border border-slate-200">
              <table className="data">
                <thead><tr><th>Columna</th><th>Obligatoria</th><th>Ejemplo</th><th>Nota</th></tr></thead>
                <tbody>
                  {activo.columnas.map((c) => (
                    <tr key={c.nombre}>
                      <td className="font-mono text-xs">{c.nombre}</td>
                      <td>{c.requerido ? <Badge tone="warning">Sí</Badge> : <span className="text-xs text-slate-400">Opcional</span>}</td>
                      <td className="text-xs text-slate-600">{c.ejemplo}</td>
                      <td className="text-xs text-slate-500">{c.ayuda ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-2 grid gap-0.5 text-[0.6875rem] text-slate-600">
              <li>• Excel (.xlsx) o CSV, con las mismas reglas. De un Excel se lee la primera hoja; el renglón 1 son los nombres de columna.</li>
              <li>• Fechas en <strong>dd/mm/aaaa</strong> (15/09/2026). Una fecha que no existe se rechaza, no se ajusta.</li>
              <li>• Números con punto decimal (1.5). La coma solo como separador de miles (1,250.50).</li>
              <li>• Si omite un dato opcional, el registro se crea sin él; si el dato está mal escrito, se avisa y se deja vacío.</li>
              {activo.erroresComunes.map((e) => <li key={e}>• {e}</li>)}
            </ul>
          </details>
        </Card>

        {error ? (
          <Card className="border-red-200 bg-red-50">
            <p className="flex items-start gap-2 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>
          </Card>
        ) : null}

        {resultado ? (
          <Card className="border-emerald-200 bg-emerald-50">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold text-emerald-900">
                  {ESTADO_LOTE[resultado.estado]?.texto ?? "Completada"}: {resultado.creados} creados{resultado.actualizados ? `, ${resultado.actualizados} actualizados` : ""}
                </p>
                <p className="mt-0.5 text-xs text-emerald-800">
                  {resultado.omitidos ? `${resultado.omitidos} duplicado(s) omitidos. ` : ""}
                  Quedó en el historial de abajo, desde donde se puede revertir.
                </p>
                {resultado.despues ? <p className="mt-1 text-xs font-medium text-emerald-900">{resultado.despues}</p> : null}
              </div>
            </div>
          </Card>
        ) : null}

        {analisis && t ? (
          <Card>
            <CardHeader
              title="Vista previa: esto es lo que pasaría"
              subtitle="Todavía no se guardó nada. Revise, decida los duplicados y confirme."
            />
            <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 xl:grid-cols-5" data-totales>
              {([
                ["Total de filas", t.leidos, "text-slate-800"],
                ["Válidas", t.validos, "text-emerald-700"],
                ["Con advertencia", t.conAdvertencias, t.conAdvertencias ? "text-amber-700" : "text-slate-400"],
                ["Rechazadas", t.rechazados, t.rechazados ? "text-red-700" : "text-slate-400"],
                ["Nuevas", t.nuevos, "text-emerald-700"],
                ["Actualizarán", t.actualizar, t.actualizar ? "text-sky-700" : "text-slate-400"],
                ["Ya existen (exactos)", t.exactos, t.exactos ? "text-slate-700" : "text-slate-400"],
                ["Posibles duplicados", t.posibles, t.posibles ? "text-amber-700" : "text-slate-400"],
                ["Columnas no reconocidas", analisis.columnasDesconocidas.length, analisis.columnasDesconocidas.length ? "text-amber-700" : "text-slate-400"],
                ["Obligatorias faltantes", analisis.columnasFaltantes.length, analisis.columnasFaltantes.length ? "text-red-700" : "text-slate-400"],
              ] as const).map(([k, v, c]) => (
                <div key={k} className="rounded-lg border border-slate-200 px-2.5 py-1.5">
                  <dt className="text-[0.625rem] uppercase tracking-wide text-slate-500">{k}</dt>
                  <dd className={cn("text-base font-semibold tabular-nums", c)}>{v}</dd>
                </div>
              ))}
            </dl>

            {analisis.columnasFaltantes.length ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                Al archivo le faltan columnas obligatorias: <strong>{analisis.columnasFaltantes.join(", ")}</strong>. Agréguelas
                con ese nombre exacto en el primer renglón —la plantilla ya las trae— y vuelva a elegir el archivo.
              </p>
            ) : null}

            {analisis.columnasDesconocidas.length ? (
              <p className="mt-2 text-xs text-amber-800">
                Columnas que no se reconocen y se ignorarán: <strong>{analisis.columnasDesconocidas.join(", ")}</strong>. Si alguna era un dato que quería importar, revise el nombre contra la plantilla.
              </p>
            ) : null}
            {analisis.avisosArchivo.map((x) => <p key={x} className="mt-1 text-xs text-amber-800">{x}</p>)}

            {(t.exactos || t.actualizar) && activo.actualizable ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
                <span className="font-medium">Los que ya existen:</span>
                <label className="flex items-center gap-1"><input type="radio" checked={exactos === "omitir"} onChange={() => cambiarDecision({ exactos: "omitir" })} /> Omitirlos</label>
                <label className="flex items-center gap-1"><input type="radio" checked={exactos === "actualizar"} onChange={() => cambiarDecision({ exactos: "actualizar" })} /> Actualizarlos con lo del archivo</label>
              </div>
            ) : null}

            {errores.length ? (
              <>
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {t.rechazados} renglón(es) rechazados, así que no se puede importar todavía. Corrija el archivo
                  —abajo, o en el detalle descargable, está cada problema con su fila, columna y cómo arreglarlo— y
                  elíjalo de nuevo para volver a validar.
                </p>
                <div className="table-wrap mt-2 max-h-80 overflow-auto rounded-lg border border-red-200">
                  <table className="data">
                    <thead><tr><th>Fila</th><th>Columna</th><th>Valor recibido</th><th>Problema</th><th>Cómo corregirlo</th></tr></thead>
                    <tbody>
                      {errores.slice(0, 300).map((x, i) => (
                        <tr key={`${x.fila}-${i}`}>
                          <td className="text-xs tabular-nums text-slate-500">{x.fila}</td>
                          <td className="font-mono text-xs">{x.columna ?? "—"}</td>
                          <td className="max-w-40 truncate text-xs text-slate-600" title={x.valor}>{x.valor ? `«${x.valor}»` : <span className="text-slate-400">vacío</span>}</td>
                          <td className="text-xs text-red-700">{x.motivo}</td>
                          <td className="text-xs text-slate-600">{x.solucion ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            {conProblema.length ? (
              <div className="table-wrap mt-3 max-h-96 overflow-auto rounded-lg border border-slate-200">
                <table className="data">
                  <thead><tr><th>Fila</th><th>Registro</th><th>Estado</th><th>Detalle</th></tr></thead>
                  <tbody>
                    {conProblema.slice(0, 300).map((f) => (
                      <tr key={f.fila}>
                        <td className="text-xs tabular-nums text-slate-500">{f.fila}</td>
                        <td className="text-xs">{f.resumen || "—"}</td>
                        <td><Badge tone={ESTADO_FILA[f.estado].tono}>{ESTADO_FILA[f.estado].texto}</Badge></td>
                        <td className="text-xs text-slate-600">
                          {f.advertencias.map((x, i) => (
                            <p key={`a${i}`} className="text-amber-700">
                              {x.columna ? <span className="font-mono">{x.columna}: </span> : null}{x.motivo}
                              {x.solucion ? <span className="text-slate-500"> — {x.solucion}</span> : null}
                            </p>
                          ))}
                          {f.coincide && f.estado !== "error" ? (
                            <p>{f.coincide.motivo} que <strong>{f.coincide.resumen}</strong></p>
                          ) : null}
                          {f.estado === "posible" || (f.estado === "nuevo" && f.coincide && crearPosibles.includes(f.fila)) ? (
                            <label className="mt-0.5 flex items-center gap-1 text-slate-700">
                              <input
                                type="checkbox"
                                checked={crearPosibles.includes(f.fila)}
                                onChange={(e) => cambiarDecision({
                                  crearPosibles: e.target.checked ? [...crearPosibles, f.fila] : crearPosibles.filter((n) => n !== f.fila),
                                })}
                              />
                              Es distinto: crearlo de todos modos
                            </label>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <strong>Antes de confirmar:</strong> {analisis.politica} Se guarda todo o nada: si algo falla a la mitad, no queda
              ningún registro a medias y la importación queda como fallida en el historial.
            </p>
            {analisis.despues ? <p className="mt-2 text-xs text-slate-600">{analisis.despues}</p> : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={importar} disabled={!analisis.puedeImportar || ocupado !== null}>
                {ocupado === "importando" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Importar {t.nuevos + t.actualizar} registros
              </Button>
              {conProblema.length || errores.length ? (
                <Button variant="secondary" size="sm" onClick={() => descargarDetalle(analisis.filas, nombreArchivo ?? "archivo")}>
                  <Download className="h-3.5 w-3.5" /> Descargar detalle
                </Button>
              ) : null}
            </div>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-1.5"><History className="h-4 w-4 text-slate-400" /> Importaciones anteriores</span>}
            subtitle="Validadas, confirmadas, completadas o fallidas. Las completadas se pueden revertir: se deshace solo lo que creó y nadie usó después."
          />
          {!lotes ? (
            <p className="text-xs text-slate-400">Cargando…</p>
          ) : lotes.length === 0 ? (
            <p className="text-xs text-slate-500">Todavía no hay importaciones.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Archivo</th><th>Resultado</th><th>Estado</th><th /></tr></thead>
                <tbody>
                  {lotes.map((l) => (
                    <tr key={l.id}>
                      <td className="text-xs text-slate-500">{formatDateTime(l.createdAt, zona)}</td>
                      <td className="text-xs">{tipos.find((x) => x.clave === l.tipo)?.titulo ?? (l.tipo === "DEMO" ? "Datos de demostración" : l.tipo)}</td>
                      <td className="text-xs text-slate-600">{l.archivoNombre ?? "—"}</td>
                      <td className="text-xs text-slate-600">
                        {resumenLote(l)}
                      </td>
                      <td><Badge tone={tonoLote(l.estado)}>{ESTADO_LOTE[l.estado as EstadoLote]?.texto ?? l.estado}</Badge></td>
                      <td className="text-right">
                        {(ESTADOS_CON_REGISTROS as string[]).includes(l.estado) && l.tipo !== "DEMO" ? (
                          <button
                            type="button"
                            disabled={ocupado !== null}
                            onClick={() => prepararReversion(l)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] text-slate-600 hover:bg-slate-50"
                          >
                            {ocupado === `rev-${l.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                            Revertir
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {revirtiendo ? (
        <Dialogo
          titulo="Revertir la importación"
          descripcion={revirtiendo.diag.resultado}
          onCerrar={() => setRevirtiendo(null)}
          pie={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setRevirtiendo(null)}>Cancelar</Button>
              <Button size="sm" onClick={revertir} disabled={ocupado !== null || revirtiendo.diag.aBorrar.length === 0}>
                {ocupado === "revirtiendo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Revertir {revirtiendo.diag.aBorrar.length} registro(s)
              </Button>
            </div>
          }
        >
          <div className="grid gap-3 text-xs">
            <div>
              <p className="font-semibold text-slate-800">Se pueden revertir ({revirtiendo.diag.aBorrar.length})</p>
              {revirtiendo.diag.aBorrar.length ? (
                <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200 p-2 text-slate-600">
                  {revirtiendo.diag.aBorrar.map((r) => (
                    <li key={r.id}>{r.nombre} <span className="text-slate-400">· {ACCION_REVERSION[r.accion]}</span></li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-slate-500">Nada: todos los registros ya se usaron.</p>}
            </div>
            {revirtiendo.diag.bloqueados.length ? (
              <div>
                <p className="font-semibold text-rose-700">No se pueden revertir: ya se usaron ({revirtiendo.diag.bloqueados.length})</p>
                <ul className="mt-1 grid max-h-40 gap-1 overflow-auto rounded-lg border border-rose-200 bg-rose-50/50 p-2 text-rose-900">
                  {revirtiendo.diag.bloqueados.map((b) => <li key={b.id}><strong>{b.nombre}</strong> — {b.motivos.join(", ")}</li>)}
                </ul>
              </div>
            ) : null}
            {revirtiendo.diag.actualizados.length ? (
              <p className="text-slate-600">
                {revirtiendo.diag.actualizados.length} registro(s) que esta importación actualizó <strong>no se regresan</strong> a como
                estaban: pudieron cambiar después. Si hace falta, corríjalos a mano.
              </p>
            ) : null}
            <p className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-slate-700">
              Resultado esperado: <strong>{ESTADO_LOTE[revirtiendo.diag.estadoEsperado]?.texto}</strong>. Queda en la bitácora con su nombre.
            </p>
          </div>
        </Dialogo>
      ) : null}
    </div>
  );
}
