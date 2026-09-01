"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Image as ImageIcon, Loader2, Trash2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import {
  ACENTOS, CLAVES_ACENTO, CLAVES_DENSIDAD, CLAVES_ESCALA, DENSIDADES, ESCALAS,
  type ClaveAcento, type ClaveDensidad, type ClaveEscala,
} from "@/lib/apariencia";

/**
 * Apariencia.
 *
 * El cambio se aplica de inmediato sobre el documento antes de guardarlo: es
 * la unica forma de elegir un tamaño de letra con criterio, viendolo. Si el
 * guardado falla, se revierte.
 */
export function PanelApariencia({
  escala,
  densidad,
  acento,
  logoUrl,
  puedeEditarMarca,
}: {
  escala: ClaveEscala;
  densidad: ClaveDensidad;
  acento: ClaveAcento;
  logoUrl: string | null;
  puedeEditarMarca: boolean;
}) {
  const router = useRouter();
  const [e, setE] = useState(escala);
  const [d, setD] = useState(densidad);
  const [a, setA] = useState(acento);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  /** Se pinta el cambio antes de pedirlo al servidor: elegir a ciegas no sirve. */
  function aplicarEnVivo(cambios: { escala?: ClaveEscala; densidad?: ClaveDensidad; acento?: ClaveAcento }) {
    const raiz = document.documentElement;
    if (cambios.escala) raiz.style.fontSize = ESCALAS[cambios.escala].raiz;
    if (cambios.densidad) {
      raiz.style.setProperty("--celda", DENSIDADES[cambios.densidad].celda);
      raiz.style.setProperty("--tarjeta", DENSIDADES[cambios.densidad].tarjeta);
    }
    if (cambios.acento) {
      for (const [tono, hex] of Object.entries(ACENTOS[cambios.acento].escala)) {
        raiz.style.setProperty(`--color-brand-${tono}`, hex);
      }
    }
  }

  async function guardar(cambios: Record<string, string>) {
    setGuardando(true);
    setError(null);
    const res = await fetch("/api/apariencia", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cambios),
    });
    const data = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok || data.error) {
      setError(data.error ?? "No fue posible guardar la preferencia");
      router.refresh();
      return;
    }
    router.refresh();
  }

  async function subirLogo(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(f.type)) {
      setError("Use PNG, JPG, WEBP o SVG."); return;
    }
    if (f.size > 300 * 1024) {
      setError(`El logotipo pesa ${Math.round(f.size / 1024)} KB y el maximo son 300 KB. Un PNG de 400 px de ancho suele pesar menos de 40.`);
      return;
    }

    setSubiendo(true); setError(null);
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const l = new FileReader();
        l.onload = () => res(String(l.result).split(",")[1] ?? "");
        l.onerror = () => rej(new Error("No se pudo leer el archivo"));
        l.readAsDataURL(f);
      });
      const r = await fetch("/api/apariencia/logo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, tipo: f.type }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "No fue posible subir el logotipo");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible subir el logotipo");
    }
    setSubiendo(false);
  }

  return (
    <div className="grid gap-4">
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

      <Card>
        <CardHeader
          title="Tamaño de letra"
          subtitle="Ajusta toda la interfaz, no solo el texto: los espacios y las tablas crecen con el. Es su preferencia personal y no afecta a nadie mas de su equipo."
        />
        <div className="grid gap-2 sm:grid-cols-3">
          {CLAVES_ESCALA.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => { setE(k); aplicarEnVivo({ escala: k }); guardar({ escalaUi: k }); }}
              className={`rounded-lg border p-3 text-left transition-colors ${
                e === k ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">{ESCALAS[k].nombre}</span>
                {e === k ? <Check className="h-4 w-4 text-brand-600" /> : null}
              </div>
              <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-slate-500">{ESCALAS[k].descripcion}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Densidad"
          subtitle="Cuanto aire hay entre renglones. Tambien es personal."
        />
        <div className="grid gap-2 sm:grid-cols-3">
          {CLAVES_DENSIDAD.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => { setD(k); aplicarEnVivo({ densidad: k }); guardar({ densidadUi: k }); }}
              className={`rounded-lg border p-3 text-left transition-colors ${
                d === k ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">{DENSIDADES[k].nombre}</span>
                {d === k ? <Check className="h-4 w-4 text-brand-600" /> : null}
              </div>
              <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-slate-500">{DENSIDADES[k].descripcion}</p>
            </button>
          ))}
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <table className="data">
            <thead>
              <tr><th>Vista previa</th><th>Estado</th><th className="text-right">Costo</th></tr>
            </thead>
            <tbody>
              <tr><td>CMP-301 Compresor de tornillo</td><td>Operando</td><td className="text-right tabular-nums">$12,480</td></tr>
              <tr><td>BOM-601 Bomba de refrigerante</td><td>Operando</td><td className="text-right tabular-nums">$3,210</td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      {puedeEditarMarca ? (
        <Card>
          <CardHeader
            title="Identidad de la empresa"
            subtitle="El logotipo y el color los ve todo su equipo. A diferencia de lo de arriba, esto si es de la organizacion."
          />

          <p className="label">Color de acento</p>
          <div className="flex flex-wrap gap-2">
            {CLAVES_ACENTO.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => { setA(k); aplicarEnVivo({ acento: k }); guardar({ colorAcento: k }); }}
                title={ACENTOS[k].nombre}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                  a === k ? "border-slate-400 bg-slate-50 font-medium text-slate-800" : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                <span className="h-4 w-4 rounded-full" style={{ background: ACENTOS[k].muestra }} />
                {ACENTOS[k].nombre}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[0.6875rem] text-slate-500">
            Son paletas preparadas y no un selector libre: de un tono elegido a mano suelen salir botones donde
            el texto blanco no se alcanza a leer.
          </p>

          <div className="mt-4 border-t border-slate-200 pt-4">
            <p className="label">Logotipo</p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid h-14 w-32 place-items-center rounded-lg border border-slate-200 bg-slate-50">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/api/apariencia/logo" alt="Logotipo" className="max-h-10 max-w-28 object-contain" />
                ) : (
                  <ImageIcon className="h-5 w-5 text-slate-300" />
                )}
              </div>
              <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                {subiendo ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
                {logoUrl ? "Cambiar logotipo" : "Subir logotipo"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={subirLogo} />
              </label>
              {logoUrl ? (
                <button
                  type="button"
                  onClick={async () => { await fetch("/api/apariencia/logo", { method: "DELETE" }); router.refresh(); }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Quitar
                </button>
              ) : null}
            </div>
            <p className="mt-1.5 text-[0.6875rem] text-slate-500">
              PNG con fondo transparente, de unos 400 px de ancho. Se muestra arriba del menu y en los reportes
              que imprima.
            </p>
          </div>
        </Card>
      ) : null}

      {guardando ? <p className="text-[0.6875rem] text-slate-400">Guardando…</p> : null}
    </div>
  );
}
