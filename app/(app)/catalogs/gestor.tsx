"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, BotonEditar } from "@/components/ui";
import { enlaceMapa } from "@/lib/geografia";
import { cn } from "@/lib/utils";

type Campo = {
  nombre: string;
  etiqueta: string;
  tipo: "texto" | "numero" | "select" | "textarea" | "coordenadas";
  requerido?: boolean;
  ayuda?: string;
  opcionesDe?: string;
  opciones?: Array<{ valor: string; etiqueta: string }>;
};

type Definicion = { titulo: string; singular: string; descripcion: string; campos: Campo[] };
type Fila = Record<string, unknown>;

/**
 * Interpreta un par de coordenadas pegado.
 *
 * Acepta lo que Google Maps pone en el portapapeles —"25.638749, -100.380737"—
 * y tambien una URL de Maps. Devuelve "invalido" cuando hay texto pero no se
 * entiende, para poder avisar en vez de guardar un dato silenciosamente mal:
 * asi fue como una longitud quedo sin su signo y sin su punto decimal.
 */
function leerCoordenadas(texto: string): { lat: number; lon: number } | null | "invalido" {
  const limpio = texto.trim();
  if (!limpio) return null;

  const deUrl = limpio.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/) ?? limpio.match(/query=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  const par = deUrl ?? limpio.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!par) return "invalido";

  const lat = Number(par[1]);
  const lon = Number(par[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "invalido";
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return "invalido";
  return { lat, lon };
}

export function GestorCatalogos({
  definiciones,
  datos,
  activoInicial,
  editable,
}: {
  definiciones: Record<string, Definicion>;
  datos: Record<string, Fila[]>;
  activoInicial: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [activo, setActivo] = useState(activoInicial);

  // Las tablas se leen directo de lo que manda el servidor y NO se copian a
  // estado local. Copiarlas congelaba la lista en la foto del primer render:
  // el registro se creaba, el codigo quedaba tomado, y la pantalla seguia
  // mostrando el catalogo vacio al volver a entrar.
  const tablas = datos;
  const [editando, setEditando] = useState<Fila | null>(null);
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const def = definiciones[activo];
  const filas = tablas[activo] ?? [];

  const claves = Object.keys(definiciones);

  function abrirAlta() {
    setForm({});
    setEditando(null);
    setCreando(true);
    setError(null);
  }

  function abrirEdicion(fila: Fila) {
    const inicial: Record<string, string> = {};
    for (const campo of def.campos) {
      // El par de coordenadas se muestra junto aunque se guarde en dos campos.
      if (campo.tipo === "coordenadas") {
        const lat = fila.latitud, lon = fila.longitud;
        inicial[campo.nombre] = lat != null && lon != null ? `${lat}, ${lon}` : "";
        continue;
      }
      const v = fila[campo.nombre];
      inicial[campo.nombre] = v === null || v === undefined ? "" : String(v);
    }
    setForm(inicial);
    setEditando(fila);
    setCreando(false);
    setError(null);
  }

  function cerrar() {
    setCreando(false);
    setEditando(null);
    setError(null);
  }

  async function guardar(event: React.FormEvent) {
    event.preventDefault();
    setGuardando(true);
    setError(null);

    const cuerpo: Record<string, unknown> = {};
    for (const campo of def.campos) {
      // Se parte al enviar: el usuario pega un par y la base guarda dos numeros.
      if (campo.tipo === "coordenadas") {
        const par = leerCoordenadas(form[campo.nombre] ?? "");
        if (par === "invalido") {
          setGuardando(false);
          setError("Las coordenadas no se entienden. Pegue los dos numeros como los copia Google Maps, por ejemplo: 25.638749, -100.380737");
          return;
        }
        cuerpo.latitud = par?.lat ?? null;
        cuerpo.longitud = par?.lon ?? null;
        continue;
      }
      const v = form[campo.nombre];
      // En edicion no se reenvia el sitio: mover una ubicacion de sitio
      // cambiaria la jerarquia de sus activos sin avisar.
      if (editando && campo.nombre === "siteId") continue;
      if (v === "" || v === undefined) {
        if (!campo.requerido) cuerpo[campo.nombre] = null;
        continue;
      }
      cuerpo[campo.nombre] = campo.tipo === "numero" ? Number(v) : v;
    }

    const url = editando
      ? `/api/catalogs/${activo}/${editando.id}`
      : `/api/catalogs/${activo}`;

    const res = await fetch(url, {
      method: editando ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const data = await res.json();
    setGuardando(false);

    if (!res.ok) {
      setError(data.error ?? "No fue posible guardar");
      return;
    }
    router.refresh();
    setAviso(editando ? "Registro actualizado." : "Registro agregado.");
    setTimeout(() => setAviso(null), 3500);
    cerrar();
  }

  async function borrar(fila: Fila) {
    const nombre = String(fila.name ?? fila.description ?? fila.code ?? "");
    if (!confirm(`¿Eliminar "${nombre}"? Esta accion no se puede deshacer.`)) return;

    setError(null);
    const res = await fetch(`/api/catalogs/${activo}/${fila.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      // El servidor explica que lo impide (activos asignados, OT que lo usan…).
      setError(data.error ?? "No fue posible eliminar");
      return;
    }
    router.refresh();
    setAviso("Registro eliminado.");
    setTimeout(() => setAviso(null), 3500);
  }

  const columnas = useMemo(() => def.campos.filter((c) => c.nombre !== "siteId"), [def]);

  function etiquetaDeCelda(fila: Fila, campo: (typeof def.campos)[number]) {
    if (campo.tipo === "coordenadas") {
      const lat = fila.latitud, lon = fila.longitud;
      return lat != null && lon != null ? `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}` : "—";
    }
    const valor = fila[campo.nombre];
    if (valor === null || valor === undefined || valor === "") return "—";
    if (campo.tipo === "select" && campo.opcionesDe) {
      const referido = (tablas[campo.opcionesDe] ?? []).find((o) => String(o.id) === String(valor));
      if (!referido) return "—";
      return referido.code ? `${referido.code} — ${referido.name}` : String(referido.name);
    }
    if (campo.tipo === "select" && campo.opciones) {
      return campo.opciones.find((o) => o.valor === String(valor))?.etiqueta ?? String(valor);
    }
    return String(valor);
  }

  function textoUso(fila: Fila) {
    const c = fila._count as Record<string, number> | undefined;
    if (!c) return null;
    const partes = Object.entries(c)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => {
        // [singular, plural] para que no salga "1 actividades".
        const nombres: Record<string, [string, string]> = {
          assets: ["activo", "activos"],
          locations: ["ubicacion", "ubicaciones"],
          plans: ["plan", "planes"],
          workOrders: ["OT", "OT"],
          parts: ["refaccion", "refacciones"],
          members: ["miembro", "miembros"],
          planLabor: ["actividad", "actividades"],
          planServices: ["actividad", "actividades"],
        };
        const nombre = nombres[k];
        return `${n} ${nombre ? (n === 1 ? nombre[0] : nombre[1]) : k}`;
      });
    return partes.length ? partes.join(" · ") : null;
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {claves.map((clave) => (
          <button
            key={clave}
            type="button"
            onClick={() => { setActivo(clave); cerrar(); setError(null); }}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              activo === clave
                ? "border-brand-300 bg-brand-50 text-brand-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {definiciones[clave].titulo}
            <span className="ml-1.5 text-slate-400">{(tablas[clave] ?? []).length}</span>
          </button>
        ))}
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{def.titulo}</h2>
            <p className="mt-0.5 max-w-2xl text-xs text-slate-500">{def.descripcion}</p>
          </div>
          {editable ? (
            <Button size="sm" onClick={abrirAlta}>
              <Plus className="h-3.5 w-3.5" /> Agregar
            </Button>
          ) : null}
        </div>

        {aviso ? (
          <p className="border-b border-emerald-100 bg-emerald-50 px-5 py-2 text-xs text-emerald-800">{aviso}</p>
        ) : null}
        {error ? (
          <p className="border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        {creando || editando ? (
          <form onSubmit={guardar} className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {editando ? `Editar ${def.singular}` : `Nuevo ${def.singular}`}
              </p>
              <button type="button" onClick={cerrar} className="grid h-7 w-7 place-items-center rounded-lg hover:bg-slate-200">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {def.campos.map((campo) => {
                const deshabilitado = Boolean(editando) && campo.nombre === "siteId";
                return (
                  <div key={campo.nombre}>
                    <label className="label">
                      {campo.etiqueta}{campo.requerido ? " *" : ""}
                    </label>
                    {campo.tipo === "coordenadas" ? (
                      <>
                        <input
                          className="field"
                          placeholder="25.638749, -100.380737"
                          value={form[campo.nombre] ?? ""}
                          onChange={(e) => setForm((f) => ({ ...f, [campo.nombre]: e.target.value }))}
                        />
                        {(() => {
                          const par = leerCoordenadas(form[campo.nombre] ?? "");
                          if (par === "invalido") {
                            return <p className="mt-1 text-[0.6875rem] text-amber-700">Se esperan dos números separados por coma. Revise que no se haya perdido el signo menos.</p>;
                          }
                          return par ? (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${par.lat},${par.lon}`}
                              target="_blank" rel="noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-brand-600 hover:underline"
                            >
                              <MapPin className="h-3 w-3" /> Verificar en el mapa antes de guardar
                            </a>
                          ) : null;
                        })()}
                      </>
                    ) : campo.tipo === "textarea" ? (
                      <textarea
                        className="field min-h-16"
                        value={form[campo.nombre] ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, [campo.nombre]: e.target.value }))}
                        required={campo.requerido}
                      />
                    ) : campo.tipo === "select" ? (
                      <select
                        className="field"
                        value={form[campo.nombre] ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, [campo.nombre]: e.target.value }))}
                        required={campo.requerido}
                        disabled={deshabilitado}
                      >
                        <option value="">{campo.requerido ? "Seleccione…" : "Sin asignar"}</option>
                        {(campo.opciones ??
                          (campo.opcionesDe
                            ? (tablas[campo.opcionesDe] ?? []).map((o) => ({
                                valor: String(o.id),
                                etiqueta: o.code ? `${o.code} — ${o.name}` : String(o.name),
                              }))
                            : [])
                        ).map((o) => (
                          <option key={o.valor} value={o.valor}>{o.etiqueta}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="field"
                        type={campo.tipo === "numero" ? "number" : "text"}
                        value={form[campo.nombre] ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, [campo.nombre]: e.target.value }))}
                        required={campo.requerido}
                      />
                    )}
                    {campo.ayuda ? <p className="mt-1 text-[0.6875rem] text-slate-500">{campo.ayuda}</p> : null}
                    {deshabilitado ? (
                      <p className="mt-1 text-[0.6875rem] text-slate-500">
                        El sitio no se cambia al editar: movería los activos de planta.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex gap-2">
              <Button type="submit" size="sm" disabled={guardando}>
                {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {editando ? "Guardar cambios" : `Agregar ${def.singular}`}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={cerrar}>Cancelar</Button>
            </div>
          </form>
        ) : null}

        {filas.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState
              title={`Sin ${def.titulo.toLowerCase()}`}
              description={editable ? "Agregue el primero con el botón de arriba." : "Pida a un administrador que los registre."}
            />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  {columnas.map((c) => <th key={c.nombre}>{c.etiqueta}</th>)}
                  <th>En uso</th>
                  {editable ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => {
                  const uso = textoUso(fila);
                  return (
                    <tr key={String(fila.id)}>
                      {columnas.map((c) => (
                        <td key={c.nombre} className="text-slate-700">
                          {c.nombre === "code" ? (
                            <span className="font-medium">{String(fila[c.nombre] ?? "—")}</span>
                          ) : (
                            etiquetaDeCelda(fila, c)
                          )}
                        </td>
                      ))}
                      <td>
                        <div className="flex items-center gap-1.5">
                          {uso ? <Badge tone="info">{uso}</Badge> : <span className="text-xs text-slate-400">libre</span>}
                          {activo === "sites" ? (() => {
                            const url = enlaceMapa({
                              name: String(fila.name ?? ""),
                              city: fila.city as string | null,
                              address: fila.address as string | null,
                              latitud: fila.latitud as number | null,
                              longitud: fila.longitud as number | null,
                            });
                            return url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                title="Abrir en Google Maps"
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[0.625rem] text-slate-500 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600"
                              >
                                <MapPin className="h-3 w-3" /> Mapa
                              </a>
                            ) : null;
                          })() : null}
                        </div>
                      </td>
                      {editable ? (
                        <td className="text-right">
                          <div className="flex justify-end gap-1">
                            <BotonEditar que="registro" onClick={() => abrirEdicion(fila)} />
                            <button
                              type="button"
                              onClick={() => borrar(fila)}
                              title={uso ? "En uso: no se puede eliminar" : "Eliminar"}
                              className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 max-w-3xl text-xs text-slate-500">
        <strong className="text-slate-700">Criticidad, estados y prioridades no aparecen aquí.</strong>{" "}
        Son listas fijas del sistema: la criticidad A/B/C sostiene el calculo de indicadores y el
        escalamiento de las alertas predictivas, y los estados definen el flujo permitido de una
        orden de trabajo. Volverlas editables romperia esa logica.
      </p>
    </>
  );
}
