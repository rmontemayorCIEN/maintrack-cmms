"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { Dialogo } from "@/components/ui/dialogo";
import { SelectorBuscable } from "@/components/selector-buscable";
import { CampoTitulo } from "@/components/campo-titulo";
import { FotosPorSubir, subirPendientes, BotonSubir, type PorSubir } from "@/components/fotos-por-subir";
import { SIN_RED, useBorrador } from "@/lib/cliente/borrador";

/**
 * Reportar un problema, en palabras de quien lo ve, no de mantenimiento: qué
 * pasa, dónde, qué tan urgente parece, si impide trabajar, si hay riesgo, una
 * foto y cómo contactarle. Lo técnico (tipo de trabajo, prioridad formal) lo
 * decide quien revisa.
 *
 * Lo escrito se conserva si se cierra sin enviar, se cae la señal o se va a
 * otra pantalla (useBorrador); las fotos se eligen antes y se suben al enviar.
 */
const URGENCIA = [
  { valor: "LOW", texto: "Puede esperar" },
  { valor: "MEDIUM", texto: "Esta semana" },
  { valor: "HIGH", texto: "Hoy" },
  { valor: "CRITICAL", texto: "Ya, es urgente" },
];

const VACIO = { title: "", description: "", assetId: "", donde: "", priority: "MEDIUM", impide: "", riesgo: "", riesgoMotivo: "", contacto: "" };

export function RequestDialog({
  assets, abrirAlInicio = false, textoBoton = "Reportar falla", activoInicial,
}: {
  assets: Array<{ id: string; code: string; name: string }>;
  /** Llega desde el QR del equipo: el reporte ya sabe dónde es. */
  activoInicial?: string;
  /** Abre el formulario al llegar (la acción rápida «Reportar un problema»). */
  abrirAlInicio?: boolean;
  textoBoton?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { valor: form, setValor: setForm, limpiar, recuperado } = useBorrador("solicitud-nueva", VACIO);
  const [fotos, setFotos] = useState<PorSubir[]>([]);
  const [creada, setCreada] = useState<{ id: string; numero: string } | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  useEffect(() => { if (abrirAlInicio) setOpen(true); }, [abrirAlInicio]);
  useEffect(() => {
    if (activoInicial && assets.some((a) => a.id === activoInicial)) setForm((f) => (f.assetId ? f : { ...f, assetId: activoInicial }));
  }, [activoInicial, assets, setForm]);

  const campo = <K extends keyof typeof VACIO>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function subirFotos(id: string) {
    setSubiendo(true);
    const fallidas = await subirPendientes({ workRequestId: id }, fotos, setFotos);
    setSubiendo(false);
    if (fallidas) setError(`La solicitud quedó registrada, pero ${fallidas === 1 ? "una foto no se subió" : `${fallidas} fotos no se subieron`}. Puede reintentar.`);
    else setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (enviando) return; // un doble toque no manda dos solicitudes
    setEnviando(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title, description: form.description || null, assetId: form.assetId || null,
          priority: form.priority, donde: form.donde || null,
          impideTrabajar: form.impide === "" ? undefined : form.impide === "si",
          riesgo: form.riesgo === "si" ? "ALTO" : "NINGUNO", riesgoMotivo: form.riesgoMotivo || null,
          contacto: form.contacto || null,
        }),
      });
    } catch {
      setEnviando(false);
      setError(SIN_RED);
      return;
    }
    const data = await res.json().catch(() => ({}));
    setEnviando(false);
    if (!res.ok) {
      // Lo escrito se queda: solo se corrige lo que se señala.
      setError(data.error ?? "No fue posible enviar el reporte. Revise los datos e intente de nuevo.");
      return;
    }
    limpiar();
    // Sin router.refresh() aquí: remontaría este diálogo y se perdería el estado de las fotos.
    setCreada({ id: data.request.id, numero: data.request.number });
    if (fotos.length) await subirFotos(data.request.id);
  }

  function cerrar() {
    setOpen(false);
    if (creada) {
      setCreada(null);
      setFotos([]);
      router.refresh();
    }
    setError(null);
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="min-h-11">
        <Plus className="h-4 w-4" /> {textoBoton}
      </Button>
    );
  }

  if (creada) {
    const faltan = fotos.some((f) => f.estado !== "subida");
    return (
      <Dialogo
        titulo={<span className="inline-flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" /> Reporte {creada.numero} enviado</span>}
        descripcion="Ya se avisó a quien lo revisa. Aquí mismo verá cuando se atienda."
        onCerrar={cerrar}
        pie={<div className="flex flex-wrap justify-end gap-2">
          {faltan ? <BotonSubir archivos={fotos} subiendo={subiendo} onSubir={() => subirFotos(creada.id)} texto="Subir" /> : null}
          <Button onClick={cerrar} className="min-h-11">Listo</Button>
        </div>}
      >
        <p className="mb-2 text-sm text-slate-700">{fotos.length ? "Fotos del reporte:" : "¿Tiene una foto? Ayuda a entender el problema sin ir a verlo."}</p>
        <FotosPorSubir archivos={fotos} onCambio={setFotos} deshabilitado={subiendo} soloImagenes />
        {error ? <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      </Dialogo>
    );
  }

  const opcion = (activo: boolean) => `min-h-11 rounded-lg border px-3 text-sm ${activo ? "border-brand-500 bg-brand-50 font-medium text-brand-800" : "border-slate-200 bg-white text-slate-700"}`;

  return (
    <Dialogo
      titulo="Reportar un problema"
      descripcion={recuperado ? "Recuperamos lo que había escrito y no envió." : "Quien revisa decide cómo atenderlo. Solo cuéntenos lo que ve."}
      onCerrar={cerrar}
      onSubmit={submit}
      pie={<div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={cerrar} className="min-h-11">Cerrar</Button>
        <Button type="submit" disabled={enviando} className="min-h-11">
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {enviando ? "Enviando…" : "Enviar reporte"}
        </Button>
      </div>}
    >
      <div className="grid gap-4">
        <div>
          <label className="label" htmlFor="sol-que">¿Qué sucede?</label>
          <CampoTitulo id="sol-que" value={form.title} onChange={(v) => campo("title", v)} placeholder="Ej. Gotea aceite debajo de la bomba" required minLength={3} autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="sol-donde">¿Dónde sucede?</label>
          <SelectorBuscable
            valor={form.assetId}
            onCambio={(id) => campo("assetId", id)}
            vacio="No sé qué equipo es"
            marcador="Si sabe el equipo, búsquelo por nombre o clave"
            opciones={assets.map((a) => ({ id: a.id, etiqueta: `${a.code} — ${a.name}` }))}
          />
          <input id="sol-donde" className="field mt-2" value={form.donde} onChange={(e) => campo("donde", e.target.value)} placeholder="Lugar: área, pasillo, piso…" autoComplete="off" />
        </div>
        <fieldset>
          <legend className="label">¿Qué tan urgente parece?</legend>
          <div className="grid grid-cols-2 gap-2">
            {URGENCIA.map((u) => (
              <button key={u.valor} type="button" aria-pressed={form.priority === u.valor} onClick={() => campo("priority", u.valor)} className={opcion(form.priority === u.valor)}>{u.texto}</button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">¿Impide trabajar?</legend>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={form.impide === "si"} onClick={() => campo("impide", "si")} className={opcion(form.impide === "si")}>Sí, no se puede trabajar</button>
            <button type="button" aria-pressed={form.impide === "no"} onClick={() => campo("impide", "no")} className={opcion(form.impide === "no")}>No, se puede seguir</button>
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">¿Hay algún riesgo para las personas?</legend>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={form.riesgo === "si"} onClick={() => campo("riesgo", "si")} className={opcion(form.riesgo === "si")}>Sí, hay riesgo</button>
            <button type="button" aria-pressed={form.riesgo === "no"} onClick={() => campo("riesgo", "no")} className={opcion(form.riesgo === "no")}>No</button>
          </div>
          {form.riesgo === "si" ? (
            <input className="field mt-2" value={form.riesgoMotivo} onChange={(e) => campo("riesgoMotivo", e.target.value)} placeholder="¿Cuál? Ej. cable expuesto, piso resbaloso" />
          ) : null}
        </fieldset>
        <div>
          <label className="label" htmlFor="sol-detalle">Algo más que ayude (opcional)</label>
          <textarea id="sol-detalle" className="field min-h-20" value={form.description} onChange={(e) => campo("description", e.target.value)} placeholder="Desde cuándo pasa, ruidos, olores…" />
        </div>
        <div>
          <p className="label">Fotos (opcional)</p>
          <FotosPorSubir archivos={fotos} onCambio={setFotos} soloImagenes deshabilitado={enviando} />
        </div>
        <div>
          <label className="label" htmlFor="sol-contacto">Teléfono para contactarle (opcional)</label>
          <input id="sol-contacto" className="field" type="tel" inputMode="tel" autoComplete="tel" value={form.contacto} onChange={(e) => campo("contacto", e.target.value)} placeholder="Si quien lo atienda necesita preguntarle algo" />
        </div>
        {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      </div>
    </Dialogo>
  );
}
