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

type Columna = { nombre: string; requerido?: boolean; ayuda?: string; ejemplo: string };
type Tipo = {
  clave: string; titulo: string; descripcion: string;
  requisitos: string | null; erroresComunes: string[]; columnas: Columna[]; actualizable: boolean;
};
type Falla = { columna?: string; motivo: string };
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
  filas: Fila[];
  totales: { leidos: number; nuevos: number; actualizar: number; exactos: number; posibles: number; errores: number; advertencias: number };
  columnasDesconocidas: string[];
  puedeImportar: boolean;
};
type Lote = {
  id: string; tipo: string; archivoNombre: string | null; estado: string; leidos: number; creados: number;
  actualizados: number; omitidos: number; rechazados: number; createdAt: string; revertidoAt: string | null; detalle: string;
};
type Diagnostico = {
  aBorrar: Array<{ entidad: string; id: string; nombre: string }>;
  bloqueados: Array<{ entidad: string; id: string; nombre: string; motivos: string[] }>;
  actualizados: Array<{ entidad: string; id: string; nombre: string; antes: Record<string, unknown> }>;
};

const ESTADO_FILA: Record<Fila["estado"], { texto: string; tono: "success" | "info" | "warning" | "danger" | "muted" }> = {
  nuevo: { texto: "Nuevo", tono: "success" },
  actualizar: { texto: "Actualiza", tono: "info" },
  exacto: { texto: "Ya existe", tono: "muted" },
  posible: { texto: "Posible duplicado", tono: "warning" },
  error: { texto: "Error", tono: "danger" },
};

const ESTADO_LOTE: Record<string, { texto: string; tono: "success" | "info" | "warning" | "danger" | "muted" }> = {
  IMPORTADO: { texto: "Importado", tono: "success" },
  FALLIDO: { texto: "Falló, sin cambios", tono: "danger" },
  REVERTIDO: { texto: "Revertido", tono: "muted" },
  REVERSION_PARCIAL: { texto: "Revertido en parte", tono: "warning" },
};

/** El detalle de errores y advertencias como CSV, para corregir en Excel. */
function descargarDetalle(filas: Fila[], nombre: string) {
  const renglones = [["fila", "estado", "columna", "problema"]];
  for (const f of filas) {
    for (const x of f.fallas) renglones.push([String(f.fila), "error", x.columna ?? "", x.motivo]);
    for (const x of f.advertencias) renglones.push([String(f.fila), "advertencia", x.columna ?? "", x.motivo]);
    if (f.estado === "posible" && f.coincide) renglones.push([String(f.fila), "posible duplicado", "", `${f.coincide.motivo}: ${f.coincide.resumen}`]);
  }
  const csv = renglones.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `revision-${nombre.replace(/\.csv$/i, "")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
  const [contenido, setContenido] = useState<string | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [exactos, setExactos] = useState<"omitir" | "actualizar">("omitir");
  const [crearPosibles, setCrearPosibles] = useState<number[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ creados: number; actualizados: number; omitidos: number } | null>(null);
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

  async function validar(texto: string, nombre: string | null, decisiones = { exactos, crearPosibles }) {
    setOcupado("validando"); setError(null);
    try {
      const res = await fetch(`/api/import/${activo.clave}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contenido: texto, archivoNombre: nombre, decisiones }),
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
    const texto = await file.text();
    setContenido(texto);
    setNombreArchivo(file.name);
    await validar(texto, file.name, { exactos: "omitir", crearPosibles: [] });
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
        body: JSON.stringify({ contenido, archivoNombre: nombreArchivo, decisiones: { exactos, crearPosibles } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No fue posible importar"); return; }
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
      if (!res.ok) { setError(data.error ?? "No se pudo revertir"); return; }
      setRevirtiendo(null);
      void cargarLotes();
      router.refresh();
    } finally {
      setOcupado(null);
    }
  }

  const t = analisis?.totales;
  const conProblema = analisis?.filas.filter((f) => f.estado !== "nuevo" || f.advertencias.length) ?? [];

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

      <div className="grid content-start gap-4">
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
              href={`/api/import/${activo.clave}/template`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" /> Descargar plantilla
            </a>
            <input ref={archivo} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => elegirArchivo(e.target.files)} />
            <Button size="sm" onClick={() => archivo.current?.click()} disabled={ocupado !== null}>
              {ocupado === "validando" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {contenido ? "Elegir otro archivo" : "Elegir archivo CSV"}
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
                  Importación completa: {resultado.creados} creados{resultado.actualizados ? `, ${resultado.actualizados} actualizados` : ""}
                </p>
                <p className="mt-0.5 text-xs text-emerald-800">
                  {resultado.omitidos ? `${resultado.omitidos} se omitieron por duplicados. ` : ""}
                  Quedó en el historial de abajo, desde donde se puede revertir.
                </p>
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
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone="success">{t.nuevos} nuevos</Badge>
              {t.actualizar ? <Badge tone="info">{t.actualizar} actualizan</Badge> : null}
              {t.exactos ? <Badge tone="muted">{t.exactos} ya existen</Badge> : null}
              {t.posibles ? <Badge tone="warning">{t.posibles} posibles duplicados</Badge> : null}
              {t.errores ? <Badge tone="danger">{t.errores} con error</Badge> : null}
              {t.advertencias ? <Badge tone="warning">{t.advertencias} con advertencia</Badge> : null}
              <span className="text-slate-400">de {t.leidos} renglones</span>
            </div>

            {analisis.columnasDesconocidas.length ? (
              <p className="mt-2 text-xs text-amber-800">
                Columnas que no se reconocen y se ignorarán: <strong>{analisis.columnasDesconocidas.join(", ")}</strong>. Si alguna era un dato que quería importar, revise el nombre contra la plantilla.
              </p>
            ) : null}

            {(t.exactos || t.actualizar) && activo.actualizable ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
                <span className="font-medium">Los que ya existen:</span>
                <label className="flex items-center gap-1"><input type="radio" checked={exactos === "omitir"} onChange={() => cambiarDecision({ exactos: "omitir" })} /> Omitirlos</label>
                <label className="flex items-center gap-1"><input type="radio" checked={exactos === "actualizar"} onChange={() => cambiarDecision({ exactos: "actualizar" })} /> Actualizarlos con lo del archivo</label>
              </div>
            ) : null}

            {t.errores ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                Hay renglones con error, así que no se puede importar todavía. Descargue el detalle —trae fila y
                columna de cada problema—, corrija el archivo y elíjalo de nuevo para volver a validar.
              </p>
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
                          {f.fallas.map((x, i) => <p key={`f${i}`} className="text-red-700">{x.columna ? <span className="font-mono">{x.columna}: </span> : null}{x.motivo}</p>)}
                          {f.advertencias.map((x, i) => <p key={`a${i}`} className="text-amber-700">{x.columna ? <span className="font-mono">{x.columna}: </span> : null}{x.motivo}</p>)}
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

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={importar} disabled={!analisis.puedeImportar || ocupado !== null}>
                {ocupado === "importando" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Importar {t.nuevos + t.actualizar} registros
              </Button>
              {conProblema.length ? (
                <Button variant="secondary" size="sm" onClick={() => descargarDetalle(analisis.filas, nombreArchivo ?? "archivo")}>
                  <Download className="h-3.5 w-3.5" /> Descargar detalle
                </Button>
              ) : null}
              <span className="text-[0.6875rem] text-slate-500">Se guarda todo o nada: si algo falla a la mitad, no queda ningún registro a medias.</span>
            </div>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-1.5"><History className="h-4 w-4 text-slate-400" /> Importaciones anteriores</span>}
            subtitle="Cada una se puede revertir: se borra solo lo que creó y nadie usó después."
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
                        {l.estado === "FALLIDO"
                          ? (JSON.parse(l.detalle || "{}").motivo ?? "No se completó")
                          : `${l.creados} creados${l.actualizados ? `, ${l.actualizados} actualizados` : ""}${l.omitidos ? `, ${l.omitidos} omitidos` : ""}`}
                      </td>
                      <td><Badge tone={ESTADO_LOTE[l.estado]?.tono ?? "muted"}>{ESTADO_LOTE[l.estado]?.texto ?? l.estado}</Badge></td>
                      <td className="text-right">
                        {l.estado === "IMPORTADO" && l.tipo !== "DEMO" ? (
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
          descripcion="Esto es lo que va a pasar. Revíselo antes de confirmar."
          onCerrar={() => setRevirtiendo(null)}
          pie={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setRevirtiendo(null)}>Cancelar</Button>
              <Button size="sm" onClick={revertir} disabled={ocupado !== null || revirtiendo.diag.aBorrar.length === 0}>
                {ocupado === "revirtiendo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Eliminar {revirtiendo.diag.aBorrar.length} registros
              </Button>
            </div>
          }
        >
          <div className="grid gap-3 text-xs">
            <div>
              <p className="font-semibold text-slate-800">Se eliminarán ({revirtiendo.diag.aBorrar.length})</p>
              {revirtiendo.diag.aBorrar.length ? (
                <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200 p-2 text-slate-600">
                  {revirtiendo.diag.aBorrar.map((r) => <li key={r.id}>{r.nombre}</li>)}
                </ul>
              ) : <p className="mt-1 text-slate-500">Nada: todos los registros ya se usaron.</p>}
            </div>
            {revirtiendo.diag.bloqueados.length ? (
              <div>
                <p className="font-semibold text-rose-700">No se tocan porque ya se usaron ({revirtiendo.diag.bloqueados.length})</p>
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
          </div>
        </Dialogo>
      ) : null}
    </div>
  );
}
