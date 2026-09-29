"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Info, Link2, Plus, Trash2, X } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { Adjuntos, type Adjunto } from "@/components/adjuntos";

const entrada = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none";

export type LigaDeNorma = {
  id: string;
  title: string;
  url: string;
  note: string | null;
  origenIa: boolean;
};

/**
 * El letrero que acompaña a todo lo que trajo la IA.
 *
 * Es literal y sin matices a proposito. El modelo puede dar por vigente una
 * version derogada de una norma con la misma seguridad con que da la vigente,
 * y aqui eso no es un error cosmetico: el cliente arma con esto el expediente
 * que le enseña a un inspector. Quien decide si el documento sirve es la
 * persona, no el sistema.
 */
function AvisoDeIa() {
  return (
    <p className="mt-1 flex gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[0.6875rem] leading-relaxed text-amber-900">
      <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <strong>Este documento lo localizó la asistencia con IA.</strong> Verifique que
        corresponda a la versión vigente de la norma antes de usarlo como evidencia: la
        publicación oficial en el Diario Oficial de la Federación es la única que manda.
      </span>
    </p>
  );
}

/**
 * Los documentos de una norma: su publicacion, su guia, el manual del que
 * depende.
 *
 * Archivos y ligas viven en los mismos modelos que el resto del sistema
 * —`Attachment` y `ReferenceLink`— y no en uno propio: un PDF colgado de una
 * norma es un PDF, y duplicar el mecanismo habria significado duplicar tambien
 * el cupo, la firma de descarga y el borrado.
 */
export function DocumentosDeNorma({
  normaId, adjuntos, ligas, editable,
}: {
  normaId: string;
  adjuntos: Adjunto[];
  ligas: LigaDeNorma[];
  editable: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function agregarLiga() {
    if (!titulo.trim() || !url.trim()) { setError("Hace falta el nombre y la dirección."); return; }
    setOcupado(true);
    setError(null);
    const r = await fetch("/api/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ normaId, title: titulo, url }),
    });
    setOcupado(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? "No se pudo guardar el enlace.");
      return;
    }
    setTitulo(""); setUrl(""); setAbierto(false);
    router.refresh();
  }

  async function quitarLiga(id: string) {
    await fetch(`/api/links/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <Card className="mb-4">
      <h2 className="text-sm font-semibold text-slate-900">Documentos de la norma</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        La publicación oficial, la guía, el manual del que depende. Es lo que contesta
        «¿de dónde salió esto?» cuando alguien lo pregunta.
      </p>

      <div className="mt-3">
        <Adjuntos
          destino={{ normaId }}
          adjuntos={adjuntos}
          editable={editable}
          titulo="Archivos"
          ayuda="El PDF del Diario Oficial, la guía de la autoridad, el manual del equipo al que aplica."
        />
      </div>

      {/* Las ligas van aparte de los archivos: una norma se consulta mas veces
          en el sitio del DOF que en un PDF descargado, y esa liga no ocupa
          cupo ni envejece con una copia. */}
      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">Enlaces</span>
          {editable && !abierto ? (
            <Button variant="secondary" size="sm" onClick={() => setAbierto(true)}>
              <Plus className="mr-1 h-3 w-3" aria-hidden /> Agregar enlace
            </Button>
          ) : null}
        </div>

        {abierto ? (
          <div className="mt-2 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">Agregar enlace</span>
              <button type="button" onClick={() => setAbierto(false)} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Cerrar">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input className={entrada} value={titulo} maxLength={150} placeholder="Publicación en el DOF"
                onChange={(e) => setTitulo(e.target.value)} />
              <input className={entrada} value={url} maxLength={2000} placeholder="https://..."
                onChange={(e) => setUrl(e.target.value)} />
            </div>
            {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={agregarLiga} disabled={ocupado}>{ocupado ? "Guardando…" : "Guardar"}</Button>
              <Button size="sm" variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button>
            </div>
          </div>
        ) : null}

        {ligas.length ? (
          <ul className="mt-2 space-y-2">
            {ligas.map((l) => (
              <li key={l.id} className="min-w-0">
                <div className="flex items-start gap-2">
                  <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <a href={l.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline">
                      <span className="truncate">{l.title}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                    </a>
                    <p className="truncate text-[0.6875rem] text-slate-400">{l.url}</p>
                    {l.origenIa ? <AvisoDeIa /> : null}
                  </div>
                  {editable ? (
                    <button type="button" onClick={() => quitarLiga(l.id)}
                      className="shrink-0 rounded p-1 text-slate-400 hover:text-rose-600" aria-label={`Quitar ${l.title}`}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-400">Todavía no hay enlaces.</p>
        )}
      </div>
    </Card>
  );
}
