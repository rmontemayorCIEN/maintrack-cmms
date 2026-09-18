"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Check, Circle, CircleDot, FlaskConical, Loader2, MinusCircle,
  PlayCircle, Sparkles, Trash2, Wrench,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, Progress } from "@/components/ui";
import { Dialogo } from "@/components/ui/dialogo";
import type { EstadoPaso, Paso, Pendiente, ModuloOpcional } from "@/lib/puesta-en-marcha";

type Revision = {
  veredicto: "LISTA" | "CASI" | "FALTA_BASE";
  resumen: string;
  observaciones: Array<{ titulo: string; severidad: "ALTA" | "MEDIA" | "BAJA"; porQueImporta: string; queHacer: string }>;
  siguientePaso: string;
};

type VistaDemo = {
  aBorrar: Array<{ entidad: string; id: string; nombre: string }>;
  bloqueados: Array<{ entidad: string; id: string; nombre: string; motivos: string[] }>;
};

const TONO_SEVERIDAD = { ALTA: "danger", MEDIA: "warning", BAJA: "muted" } as const;

const ESTADO: Record<EstadoPaso, { texto: string; tono: "success" | "info" | "warning" | "danger" | "muted" }> = {
  COMPLETO: { texto: "Completo", tono: "success" },
  EN_PROCESO: { texto: "En proceso", tono: "info" },
  CORREGIR: { texto: "Requiere corrección", tono: "danger" },
  OPCIONAL: { texto: "Opcional", tono: "muted" },
  NO_APLICA: { texto: "No aplica", tono: "muted" },
};

function IconoEstado({ estado }: { estado: EstadoPaso }) {
  const base = "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold";
  if (estado === "COMPLETO") return <span className={`${base} bg-emerald-100 text-emerald-700`}><Check className="h-3.5 w-3.5" /></span>;
  if (estado === "CORREGIR") return <span className={`${base} bg-rose-100 text-rose-700`}><AlertTriangle className="h-3.5 w-3.5" /></span>;
  if (estado === "EN_PROCESO") return <span className={`${base} bg-amber-100 text-amber-700`}><CircleDot className="h-3.5 w-3.5" /></span>;
  if (estado === "NO_APLICA") return <span className={`${base} bg-slate-100 text-slate-400`}><MinusCircle className="h-3.5 w-3.5" /></span>;
  return <span className={`${base} bg-slate-100 text-slate-400`}><Circle className="h-3 w-3" /></span>;
}

/**
 * La puesta en marcha como asistente.
 *
 * Cada paso dice qué se configura, por qué importa, qué ya está bien y qué hay
 * que corregir, y lleva a la pantalla donde se resuelve. Lo capturado se guarda
 * ahí mismo, así que se puede avanzar, regresar y dejarlo a medias sin perder
 * nada: el estado se vuelve a calcular sobre la base cada vez que se abre.
 */
export function PanelPuestaEnMarcha({
  pasos, porcentaje, completa, pendientes, saludDatos, operandoDesde, hayDemo, impideOperar,
  empezando, tipoInstalacion, tipos, puedeConfigurar, iaDisponible,
}: {
  pasos: Paso[];
  porcentaje: number;
  completa: boolean;
  pendientes: Pendiente[];
  saludDatos: number;
  operandoDesde: string | null;
  hayDemo: boolean;
  impideOperar: string[];
  /** La empresa todavía no tiene estructura: se le ofrece cómo empezar. */
  empezando: boolean;
  tipoInstalacion: string | null;
  tipos: Array<{ clave: string; nombre: string }>;
  puedeConfigurar: boolean;
  iaDisponible: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [vistaDemo, setVistaDemo] = useState<VistaDemo | null>(null);
  const [confirmarOperar, setConfirmarOperar] = useState(false);

  async function accion(clave: string, cuerpo: Record<string, unknown>, exito?: (datos: Record<string, unknown>) => string | null) {
    setOcupado(clave); setError(null); setAviso(null);
    try {
      const res = await fetch("/api/puesta-en-marcha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const datos = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(datos.error ?? "No se pudo completar la acción. Intente de nuevo.");
        return false;
      }
      const texto = exito?.(datos);
      if (texto) setAviso(texto);
      router.refresh();
      return true;
    } catch {
      setError("No se pudo conectar. Revise su conexión e intente de nuevo.");
      return false;
    } finally {
      setOcupado(null);
    }
  }

  async function verDemo() {
    setOcupado("ver-demo"); setError(null);
    try {
      const res = await fetch("/api/puesta-en-marcha");
      const datos = await res.json();
      if (!res.ok) { setError(datos.error ?? "No se pudo revisar la demostración"); return; }
      setVistaDemo(datos.demo ?? { aBorrar: [], bloqueados: [] });
    } finally {
      setOcupado(null);
    }
  }

  async function revisar() {
    setOcupado("revision"); setError(null);
    const res = await fetch("/api/ia/revision", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setOcupado(null);
    if (!res.ok) { setError(data.error ?? "No fue posible revisar la configuración"); return; }
    setRevision(data.revision);
  }

  return (
    <div className="grid gap-4">
      {/* ── Avance ─────────────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-2xl font-semibold tabular-nums text-slate-900" data-porcentaje={porcentaje}>{porcentaje}%</p>
              {operandoDesde ? <Badge tone="success">Operando desde {operandoDesde}</Badge>
                : completa ? <Badge tone="success">Lista para operar</Badge>
                : <Badge tone="info">En puesta en marcha</Badge>}
              {hayDemo ? <Badge tone="warning">Con datos de demostración</Badge> : null}
            </div>
            <p className="mt-1 max-w-2xl text-xs text-slate-600">
              {operandoDesde
                ? `La empresa ya opera. Lo que importa ahora es la calidad de la captura, que hoy va en ${saludDatos} de 100.`
                : "El avance cuenta solo lo que ya sirve: un activo sin ubicación o un plan sin actividades no suma. Los pasos opcionales y los que no aplican no le bajan el porcentaje."}
            </p>
          </div>
          {iaDisponible ? (
            <Button variant="secondary" size="sm" onClick={revisar} disabled={ocupado === "revision"}>
              {ocupado === "revision" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {ocupado === "revision" ? "Revisando…" : "Revise cómo voy"}
            </Button>
          ) : null}
        </div>
        <div className="mt-3">
          <Progress value={porcentaje} tone={porcentaje >= 80 ? "good" : porcentaje >= 40 ? "warn" : "bad"} />
        </div>

        {/* Navegación entre pasos: se puede ir y volver cuando se quiera. */}
        <nav className="mt-3 flex flex-wrap gap-1" aria-label="Pasos de la puesta en marcha">
          {pasos.map((p) => (
            <a
              key={p.clave}
              href={`#paso-${p.numero}`}
              title={`${p.titulo}: ${ESTADO[p.estado].texto}`}
              className={`grid h-7 w-7 place-items-center rounded-full border text-[0.6875rem] font-semibold ${
                p.estado === "COMPLETO" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : p.estado === "CORREGIR" ? "border-rose-200 bg-rose-50 text-rose-700"
                  : p.estado === "EN_PROCESO" ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-slate-200 bg-white text-slate-400"
              }`}
            >
              {p.numero}
            </a>
          ))}
        </nav>

        {aviso ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{aviso}</p> : null}
        {error ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      </Card>

      {/* ── Cómo empezar ──────────────────────────────────────────── */}
      {empezando && puedeConfigurar && !operandoDesde ? (
        <Card>
          <CardHeader title="¿Cómo quiere empezar?" subtitle="Puede cambiar de idea después: nada de esto borra información." />
          <div className="grid gap-2 md:grid-cols-3">
            {[
              { modo: "VACIA", titulo: "Empezar vacía", texto: "Solo los catálogos de su tipo de instalación, que ya tiene. Usted captura o importa todo lo demás.", icono: <Circle className="h-4 w-4" /> },
              { modo: "ESTRUCTURA", titulo: "Estructura recomendada", texto: "Además, su primer sitio con el nombre que se usa en su giro y el almacén general.", icono: <Wrench className="h-4 w-4" /> },
              { modo: "DEMO", titulo: "Ver una demostración", texto: "La estructura y un juego chico de equipos, un plan y refacciones marcados [DEMO]. Se quitan con un botón antes de operar.", icono: <FlaskConical className="h-4 w-4" /> },
            ].map((o) => (
              <button
                key={o.modo}
                type="button"
                disabled={ocupado !== null}
                onClick={() => accion(`iniciar-${o.modo}`, { accion: "INICIAR", modo: o.modo }, () =>
                  o.modo === "DEMO" ? "Datos de demostración cargados. Recuerde quitarlos antes de comenzar a operar." : "Listo. Siga con los pasos de abajo.")}
                className="grid gap-1 rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-brand-300 hover:bg-brand-50/40 disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  {ocupado === `iniciar-${o.modo}` ? <Loader2 className="h-4 w-4 animate-spin" /> : o.icono} {o.titulo}
                </span>
                <span className="text-[0.6875rem] leading-relaxed text-slate-500">{o.texto}</span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {/* ── Demostración cargada ──────────────────────────────────── */}
      {hayDemo && puedeConfigurar ? (
        <Card className="border-amber-200 bg-amber-50/50">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900"><FlaskConical className="h-4 w-4" /> Hay datos de demostración cargados</p>
              <p className="mt-1 text-xs text-amber-900/80">
                Llevan «[DEMO]» en el nombre. Mientras existan, la empresa no puede declararse en operación: así
                los ejemplos nunca entran a sus indicadores. Quitarlos borra solo lo que nadie usó.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={verDemo} disabled={ocupado !== null}>
              {ocupado === "ver-demo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Quitar demostración
            </Button>
          </div>
        </Card>
      ) : null}

      {vistaDemo ? (
        <Dialogo
          titulo="Quitar los datos de demostración"
          descripcion="Esto es lo que va a pasar. Revíselo antes de confirmar."
          onCerrar={() => setVistaDemo(null)}
          pie={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setVistaDemo(null)}>Cancelar</Button>
              <Button
                size="sm"
                disabled={ocupado !== null || vistaDemo.aBorrar.length === 0}
                onClick={async () => {
                  const listo = await accion("quitar-demo", { accion: "QUITAR_DEMO" }, (d) =>
                    `Se quitaron ${d.borrados} registros de demostración${(d.bloqueados as unknown[])?.length ? `; ${(d.bloqueados as unknown[]).length} se quedaron porque ya se usaron` : ""}.`);
                  if (listo) setVistaDemo(null);
                }}
              >
                {ocupado === "quitar-demo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Quitar {vistaDemo.aBorrar.length} registros
              </Button>
            </div>
          }
        >
          <div className="grid gap-3 text-xs">
            <div>
              <p className="font-semibold text-slate-800">Se eliminarán ({vistaDemo.aBorrar.length})</p>
              <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200 p-2 text-slate-600">
                {vistaDemo.aBorrar.map((r) => <li key={r.id}>{r.nombre}</li>)}
              </ul>
            </div>
            {vistaDemo.bloqueados.length ? (
              <div>
                <p className="font-semibold text-rose-700">Se quedan porque ya se usaron ({vistaDemo.bloqueados.length})</p>
                <ul className="mt-1 grid gap-1 rounded-lg border border-rose-200 bg-rose-50/50 p-2 text-rose-900">
                  {vistaDemo.bloqueados.map((b) => <li key={b.id}><strong>{b.nombre}</strong> — {b.motivos.join(", ")}</li>)}
                </ul>
                <p className="mt-1 text-slate-500">Si ya no los necesita, bórrelos a mano cuando deje de usarlos.</p>
              </div>
            ) : null}
          </div>
        </Dialogo>
      ) : null}

      {revision ? (
        <Card>
          <CardHeader
            title="Segunda opinión"
            subtitle="Esto no es una cuenta sino una interpretación: lo que el cruce de sus datos sugiere, más allá de la lista."
            action={
              <Badge tone={revision.veredicto === "LISTA" ? "success" : revision.veredicto === "CASI" ? "warning" : "danger"}>
                {revision.veredicto === "LISTA" ? "lista" : revision.veredicto === "CASI" ? "casi" : "falta base"}
              </Badge>
            }
          />
          <p className="text-sm leading-relaxed text-slate-700">{revision.resumen}</p>
          <ul className="mt-3 grid gap-2">
            {revision.observaciones.map((o, i) => (
              <li key={i} className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={TONO_SEVERIDAD[o.severidad]}>{o.severidad.toLowerCase()}</Badge>
                  <span className="text-xs font-semibold text-slate-800">{o.titulo}</span>
                </div>
                <p className="mt-1 text-[0.6875rem] text-slate-600">{o.porQueImporta}</p>
                <p className="mt-0.5 text-[0.6875rem] text-slate-700"><span className="font-medium text-slate-500">Qué hacer · </span>{o.queHacer}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ── Pendientes, en orden de lo que más estorba ───────────── */}
      {pendientes.length ? (
        <Card>
          <CardHeader
            title={`Lo que falta resolver (${pendientes.length})`}
            subtitle="En orden: primero lo que impide crear órdenes y programar mantenimiento; al final lo que dificulta identificar equipos."
          />
          <ul className="grid gap-2">
            {pendientes.map((p, i) => (
              <li key={`${p.problema}-${i}`} className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-800">{p.problema}</p>
                  <span className="text-[0.6875rem] text-slate-500">{p.modulo}{p.cantidad > 1 ? ` · ${p.cantidad} registros` : ""}</span>
                </div>
                <p className="mt-0.5 text-[0.6875rem] text-slate-600">{p.consecuencia}</p>
                {p.registros.length ? (
                  <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[0.6875rem]">
                    {p.registros.map((r) => r.enlace
                      ? <Link key={r.id} href={r.enlace} className="text-brand-700 hover:underline">{r.nombre}</Link>
                      : <span key={r.id} className="text-slate-700">{r.nombre}</span>)}
                    {p.cantidad > p.registros.length ? <span className="text-slate-400">y {p.cantidad - p.registros.length} más</span> : null}
                  </p>
                ) : null}
                <Link href={p.accion.enlace} className="mt-1.5 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-brand-700 hover:underline">
                  {p.accion.texto} <ArrowRight className="h-3 w-3" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ── Los 12 pasos ─────────────────────────────────────────── */}
      <div className="grid gap-2.5">
        {pasos.map((p) => (
          <Card key={p.clave} className={p.estado === "COMPLETO" || p.estado === "NO_APLICA" ? "opacity-80" : ""}>
            {p.clave === "validacion" ? <div id="validacion" className="scroll-mt-20" /> : null}
            <div id={`paso-${p.numero}`} className="flex scroll-mt-20 items-start gap-3">
              <IconoEstado estado={p.estado} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">
                    <span className="text-slate-400">{p.numero}.</span> {p.titulo}
                  </p>
                  <div className="flex items-center gap-2">
                    {p.progreso ? <span className="text-[0.6875rem] tabular-nums text-slate-500">{p.progreso.hecho} de {p.progreso.meta} correctos</span> : null}
                    <Badge tone={ESTADO[p.estado].tono}>{ESTADO[p.estado].texto}</Badge>
                  </div>
                </div>
                <p className="mt-0.5 text-[0.6875rem] text-slate-700">{p.que}</p>
                <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-slate-500">{p.porQue}</p>

                {p.progreso && p.estado !== "COMPLETO" ? (
                  <div className="mt-1.5 max-w-xs">
                    <Progress value={(p.progreso.hecho / Math.max(p.progreso.meta, 1)) * 100} tone={p.estado === "CORREGIR" ? "bad" : "warn"} />
                  </div>
                ) : null}
                {p.falta ? <p className="mt-1.5 text-xs text-slate-700">{p.falta}</p> : null}
                {p.problemas.length ? (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {p.problemas.map((x) => <Badge key={x} tone="warning">{x}</Badge>)}
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {p.clave !== "validacion" && p.estado !== "COMPLETO" && p.estado !== "NO_APLICA" ? (
                    <Link href={p.enlace} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-[0.6875rem] font-medium text-white hover:bg-brand-700">
                      {p.textoEnlace} <ArrowRight className="h-3 w-3" />
                    </Link>
                  ) : p.clave !== "validacion" ? (
                    <Link href={p.enlace} className="text-[0.6875rem] text-slate-500 hover:text-brand-700 hover:underline">{p.textoEnlace}</Link>
                  ) : null}

                  {p.clave === "instalacion" && puedeConfigurar ? (
                    <select
                      value={tipoInstalacion ?? ""}
                      disabled={ocupado !== null}
                      onChange={(e) => e.target.value && accion("tipo", { accion: "TIPO", tipo: e.target.value }, () =>
                        "Tipo de instalación guardado. Sus catálogos no cambian solos: cárguelos de nuevo desde Catálogos si quiere los del tipo nuevo.")}
                      className="field max-w-56 px-2 py-1 text-[0.6875rem]"
                      aria-label="Tipo de instalación"
                    >
                      <option value="">Elija el tipo…</option>
                      {tipos.map((t) => <option key={t.clave} value={t.clave}>{t.nombre}</option>)}
                    </select>
                  ) : null}

                  {p.modulo && puedeConfigurar ? (
                    p.estado === "NO_APLICA" ? (
                      <button type="button" disabled={ocupado !== null}
                        onClick={() => accion(`mod-${p.modulo}`, { accion: "MODULO", modulo: p.modulo as ModuloOpcional, usa: null })}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] text-slate-600 hover:bg-slate-50">
                        Sí lo usaremos
                      </button>
                    ) : (
                      <button type="button" disabled={ocupado !== null}
                        onClick={() => accion(`mod-${p.modulo}`, { accion: "MODULO", modulo: p.modulo as ModuloOpcional, usa: false })}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] text-slate-600 hover:bg-slate-50">
                        No usaremos esto
                      </button>
                    )
                  ) : null}
                </div>

                {/* Validación final */}
                {p.clave === "validacion" && !operandoDesde ? (
                  <div className="mt-2">
                    {impideOperar.length ? (
                      <ul className="grid gap-0.5 text-[0.6875rem] text-slate-600">
                        {impideOperar.map((x) => <li key={x}>• {x}</li>)}
                      </ul>
                    ) : null}
                    {puedeConfigurar ? (
                      <Button size="sm" className="mt-2" disabled={impideOperar.length > 0 || ocupado !== null} onClick={() => setConfirmarOperar(true)}>
                        <PlayCircle className="h-3.5 w-3.5" /> Comenzar a operar
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {confirmarOperar ? (
        <Dialogo
          titulo="Comenzar a operar"
          descripcion="A partir de ahora los indicadores cuentan de verdad y ya no se podrán cargar datos de demostración."
          onCerrar={() => setConfirmarOperar(false)}
          pie={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmarOperar(false)}>Todavía no</Button>
              <Button size="sm" disabled={ocupado !== null} onClick={async () => {
                const listo = await accion("operar", { accion: "OPERAR" }, () => "La empresa ya está en operación.");
                if (listo) setConfirmarOperar(false);
              }}>
                {ocupado === "operar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Sí, comenzar
              </Button>
            </div>
          }
        >
          <p className="text-xs text-slate-600">Queda registrado en la bitácora quién lo declaró y cuándo.</p>
        </Dialogo>
      ) : null}
    </div>
  );
}
