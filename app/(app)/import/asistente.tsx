"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet,
  Loader2, Upload, X,
} from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";

type Columna = { nombre: string; requerido?: boolean; ayuda?: string; ejemplo: string };
type Tipo = {
  clave: string; titulo: string; descripcion: string;
  requisitos: string | null; columnas: Columna[];
};
type Analisis = {
  fila: number; clave?: string;
  estado: "nuevo" | "duplicado" | "error";
  motivo?: string; resumen: string;
};
type Totales = { leidos: number; nuevos: number; duplicados: number; errores: number };

export function AsistenteImportacion({ tipos }: { tipos: Tipo[] }) {
  const router = useRouter();
  const archivo = useRef<HTMLInputElement>(null);

  const [activo, setActivo] = useState(tipos[0]);
  const [contenido, setContenido] = useState<string | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<Analisis[] | null>(null);
  const [totales, setTotales] = useState<Totales | null>(null);
  const [ocupado, setOcupado] = useState<"leyendo" | "importando" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ insertados: number; omitidos: number; errores: number } | null>(null);

  function reiniciar() {
    setContenido(null); setNombreArchivo(null); setAnalisis(null);
    setTotales(null); setError(null); setResultado(null);
    if (archivo.current) archivo.current.value = "";
  }

  function cambiarTipo(t: Tipo) {
    setActivo(t);
    reiniciar();
  }

  async function elegirArchivo(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setOcupado("leyendo"); setError(null); setResultado(null);

    const texto = await file.text();
    setContenido(texto);
    setNombreArchivo(file.name);

    const res = await fetch(`/api/import/${activo.clave}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contenido: texto }),
    });
    const data = await res.json();
    setOcupado(null);

    if (!res.ok) {
      setError(data.error ?? "No fue posible leer el archivo");
      setAnalisis(null); setTotales(null);
      return;
    }
    setAnalisis(data.analisis);
    setTotales(data.totales);
  }

  async function importar() {
    if (!contenido) return;
    setOcupado("importando"); setError(null);

    const res = await fetch(`/api/import/${activo.clave}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contenido }),
    });
    const data = await res.json();
    setOcupado(null);

    if (!res.ok) { setError(data.error ?? "No fue posible importar"); return; }
    setResultado({ insertados: data.insertados, omitidos: data.omitidos, errores: data.errores });
    setAnalisis(null); setTotales(null); setContenido(null);
    if (archivo.current) archivo.current.value = "";
    router.refresh();
  }

  const conError = analisis?.filter((a) => a.estado === "error") ?? [];
  const duplicados = analisis?.filter((a) => a.estado === "duplicado") ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav className="grid content-start gap-0.5">
        <p className="mb-1 px-1 text-[0.625rem] font-semibold uppercase tracking-wider text-slate-400">
          Orden sugerido
        </p>
        {tipos.map((t, i) => (
          <button
            key={t.clave}
            type="button"
            onClick={() => cambiarTipo(t)}
            className={cn(
              "flex items-baseline gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
              activo.clave === t.clave
                ? "bg-brand-50 font-medium text-brand-700"
                : "text-slate-600 hover:bg-slate-100",
            )}
          >
            <span className="w-4 shrink-0 text-[0.6875rem] tabular-nums text-slate-400">{i + 1}</span>
            {t.titulo}
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
            <input
              ref={archivo} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => elegirArchivo(e.target.files)}
            />
            <Button size="sm" onClick={() => archivo.current?.click()} disabled={ocupado !== null}>
              {ocupado === "leyendo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Elegir archivo CSV
            </Button>
            {nombreArchivo ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <FileSpreadsheet className="h-3.5 w-3.5" /> {nombreArchivo}
                <button type="button" onClick={reiniciar} className="text-slate-400 hover:text-slate-700">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : null}
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-brand-600">
              Ver las {activo.columnas.length} columnas de la plantilla
            </summary>
            <div className="table-wrap mt-2 rounded-lg border border-slate-200">
              <table className="data">
                <thead>
                  <tr><th>Columna</th><th>Obligatoria</th><th>Ejemplo</th><th>Nota</th></tr>
                </thead>
                <tbody>
                  {activo.columnas.map((c) => (
                    <tr key={c.nombre}>
                      <td className="font-mono text-xs">{c.nombre}</td>
                      <td>{c.requerido ? <Badge tone="warning">Si</Badge> : <span className="text-xs text-slate-400">Opcional</span>}</td>
                      <td className="text-xs text-slate-600">{c.ejemplo}</td>
                      <td className="text-xs text-slate-500">{c.ayuda ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>

        {error ? (
          <Card className="border-red-200 bg-red-50">
            <p className="text-sm text-red-800">{error}</p>
          </Card>
        ) : null}

        {resultado ? (
          <Card className="border-emerald-200 bg-emerald-50">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold text-emerald-900">
                  Se importaron {resultado.insertados} registros
                </p>
                <p className="mt-0.5 text-xs text-emerald-800">
                  {resultado.omitidos > 0 ? `${resultado.omitidos} se omitieron por estar repetidos. ` : ""}
                  {resultado.errores > 0 ? `${resultado.errores} no se pudieron importar.` : "Sin errores."}
                </p>
              </div>
            </div>
          </Card>
        ) : null}

        {totales && analisis ? (
          <Card padded={false}>
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-900">Vista previa</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Todavía no se ha guardado nada. Esto es lo que pasaria al confirmar.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone="success">{totales.nuevos} se importarian</Badge>
                {totales.duplicados > 0 ? <Badge tone="muted">{totales.duplicados} repetidos, se omiten</Badge> : null}
                {totales.errores > 0 ? <Badge tone="danger">{totales.errores} con error</Badge> : null}
                <Badge tone="info">{totales.leidos} renglones leidos</Badge>
              </div>
            </div>

            {conError.length ? (
              <div className="border-b border-slate-200 bg-red-50/50 px-5 py-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-red-800">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Renglones que no se pueden importar
                </p>
                <ul className="grid gap-1">
                  {conError.slice(0, 12).map((a) => (
                    <li key={a.fila} className="text-xs text-red-700">
                      <span className="font-medium">Renglon {a.fila}</span>
                      {a.resumen ? ` (${a.resumen})` : ""}: {a.motivo}
                    </li>
                  ))}
                  {conError.length > 12 ? (
                    <li className="text-xs italic text-red-600">…y {conError.length - 12} mas</li>
                  ) : null}
                </ul>
                <p className="mt-2 text-[0.6875rem] text-red-700">
                  Puede corregirlos en el archivo y volver a cargarlo, o continuar: estos renglones se saltan.
                </p>
              </div>
            ) : null}

            {duplicados.length ? (
              <div className="border-b border-slate-200 px-5 py-3">
                <p className="mb-1 text-xs font-semibold text-slate-600">Ya existentes, se omiten</p>
                <p className="text-xs text-slate-500">
                  {duplicados.slice(0, 8).map((d) => d.resumen || d.clave).join(", ")}
                  {duplicados.length > 8 ? ` y ${duplicados.length - 8} mas` : ""}
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 px-5 py-4">
              <Button onClick={importar} disabled={ocupado !== null || totales.nuevos === 0}>
                {ocupado === "importando" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Importar {totales.nuevos} registros
              </Button>
              <Button variant="secondary" onClick={reiniciar}>Cancelar</Button>
              {totales.nuevos === 0 ? (
                <span className="text-xs text-slate-500">No hay nada nuevo que importar.</span>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
