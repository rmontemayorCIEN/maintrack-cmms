"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { PREGUNTAS, ejemploDe, type ClavePregunta } from "@/lib/contexto-negocio";

/**
 * Lo que la empresa cuenta de si misma, para que la IA piense mejor.
 *
 * Cada pregunta muestra POR QUE se pregunta. Un formulario que no explica para
 * que sirve lo que pide se contesta con una linea o se salta, y un contexto a
 * medias no mejora ninguna respuesta.
 *
 * El ejemplo cambia segun el tipo de instalacion: a un hospital no le sirve el
 * ejemplo de una planta metalmecanica, y un ejemplo que no le queda es peor
 * que ninguno porque lo manda a contestar lo que no es.
 */
export function ContextoDelNegocio({
  valores,
  tipoInstalacion,
  actualizadoEl,
  envejecido,
  editable,
}: {
  valores: Record<ClavePregunta, string | null>;
  tipoInstalacion: string | null;
  actualizadoEl: string | null;
  envejecido: boolean;
  editable: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Record<ClavePregunta, string>>(
    () =>
      Object.fromEntries(
        PREGUNTAS.map((p) => [p.clave, valores[p.clave] ?? ""]),
      ) as Record<ClavePregunta, string>,
  );
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contestadas = PREGUNTAS.filter((p) => form[p.clave].trim()).length;

  async function guardar() {
    setGuardando(true);
    setError(null);
    setMensaje(null);
    const res = await fetch("/api/organizacion/contexto", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setGuardando(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "No fue posible guardar");
      return;
    }
    setMensaje("Guardado. La inteligencia artificial ya lo toma en cuenta.");
    router.refresh();
  }

  return (
    <Card>
      <div className="grid gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold text-slate-900">Su negocio, en sus palabras</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              El giro dice la categoría —«manufactura metalmecánica»—. Esto dice lo suyo: que
              trabaja tres turnos, que sin la grúa no se mueve material, que este año quiere
              certificarse. Es la diferencia entre que la IA le reporte hallazgos y que le
              aconseje.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[0.6875rem] font-medium tabular-nums text-slate-600">
            {contestadas} de {PREGUNTAS.length}
          </span>
        </div>

        {envejecido ? (
          <div className="flex gap-2 rounded-lg bg-amber-50 p-2.5 text-amber-900">
            <TriangleAlert className="mt-px h-4 w-4 shrink-0" />
            <p className="text-[0.6875rem] leading-relaxed">
              Esto no se actualiza desde hace más de un año. La IA lo está tomando por cierto:
              si su operación cambió, conviene corregirlo.
            </p>
          </div>
        ) : null}

        <div className="grid gap-5">
          {PREGUNTAS.map((p) => (
            <div key={p.clave}>
              <label className="label" htmlFor={`ctx-${p.clave}`}>
                {p.etiqueta}
              </label>
              <p className="mb-1.5 text-[0.6875rem] leading-relaxed text-slate-500">
                {p.porque}
              </p>
              <textarea
                id={`ctx-${p.clave}`}
                className="field"
                rows={p.renglones}
                disabled={!editable}
                value={form[p.clave]}
                placeholder={ejemploDe(p, tipoInstalacion)}
                onChange={(e) => setForm((f) => ({ ...f, [p.clave]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        {/*
          Se dice de frente que esto NO manda sobre los datos. Quien escriba
          "somos muy buenos en preventivo" debe saber que si los números dicen
          otra cosa, la IA se lo va a señalar.
        */}
        <div className="flex gap-2 rounded-lg bg-slate-50 p-2.5">
          <Sparkles className="mt-px h-4 w-4 shrink-0 text-slate-400" />
          <p className="text-[0.6875rem] leading-relaxed text-slate-600">
            Esto es contexto, no verdad. Si lo que escriba aquí no coincide con lo que dicen
            sus órdenes de trabajo, mandan los datos — y la IA le va a señalar la diferencia.
            Lo aprovechan las funciones de diagnóstico, planes, refacciones sugeridas y
            levantamiento.
          </p>
        </div>

        {editable ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={guardar} disabled={guardando}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
            {actualizadoEl ? (
              <span className="text-[0.6875rem] text-slate-500">
                Actualizado el {actualizadoEl}
              </span>
            ) : null}
            {mensaje ? <span className="text-xs text-emerald-700">{mensaje}</span> : null}
            {error ? <span className="text-xs text-red-600">{error}</span> : null}
          </div>
        ) : (
          <p className="text-[0.6875rem] text-slate-500">
            Solo un administrador puede editar esto.
          </p>
        )}
      </div>
    </Card>
  );
}
