"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Footprints, Loader2, MapPin, QrCode, X } from "lucide-react";
import { BotonDictado, unirDictado } from "@/components/boton-dictado";
import { FotosPorSubir, subirPendientes, type PorSubir } from "@/components/fotos-por-subir";
import { Escaner } from "../escanear/escaner";

/**
 * Caminar la planta y dejar constancia.
 *
 * ── Como esta pensada ──
 *
 * Para un telefono, de pie, a veces con guantes. Por eso todo es de un toque y
 * los botones son grandes: lo que se hace parado frente a una maquina no puede
 * pedir precision de raton.
 *
 * ── Por que el orden es dictar primero ──
 *
 * Porque eso es lo que de verdad pasa: uno ve algo y lo dice. El equipo se
 * resuelve despues —muchas veces solo, con el area o con el codigo— y cuando
 * no se puede, se pregunta. Pedir primero «de que equipo es» convierte cada
 * parada en un formulario y la gente deja de anotar.
 *
 * ── Y por que la pregunta va EN BLANCO ──
 *
 * Cuando hay varios equipos posibles no se marca ninguno. Proponer uno y pedir
 * confirmacion se vuelve tramite: si acierta cuatro de cinco veces, en tres
 * dias se confirma sin leer. Y «ninguno» esta siempre a la vista, porque un
 * hallazgo sin equipo sirve igual y uno mal atribuido ensucia el historial de
 * un equipo para siempre.
 */
type Parada = {
  id: string;
  orden: number;
  observacion: string | null;
  comoSeIdentifico: string;
  equipo: string | null;
  fotos: number;
};
type Candidato = { id: string; code: string; name: string; ubicacion: string | null };
type Area = { id: string; name: string };
type Equipo = { id: string; code: string; name: string; locationId: string | null };

export function Recorrido({
  rondinInicial,
  areas,
  equipos,
}: {
  rondinInicial: { id: string; numero: string; paradas: number; area: string | null; areaId: string | null } | null;
  areas: Area[];
  /**
   * Los equipos, para poder decir de cual era cuando el sistema no lo dedujo.
   *
   * Sin esto la parada quedaba «equipo por confirmar» PARA SIEMPRE: solo se
   * podia elegir entre los candidatos que el sistema propusiera, y cuando no
   * proponia ninguno no habia forma de confirmarla. Se vio usandolo, no
   * leyendolo.
   */
  equipos: Equipo[];
}) {
  const router = useRouter();
  const [rondin, setRondin] = useState(rondinInicial);
  const [areaElegida, setAreaElegida] = useState("");
  const [texto, setTexto] = useState("");
  const [paradas, setParadas] = useState<Parada[]>([]);
  const [pendiente, setPendiente] = useState<{ paradaId: string; candidatos: Candidato[]; explicacion: string } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  /**
   * Las fotos se eligen ANTES de anotar, porque es como pasa: se ve algo, se
   * fotografia y despues se cuenta. La parada todavia no existe, asi que
   * esperan en memoria y se suben en cuanto hay a que colgarlas.
   */
  const [fotos, setFotos] = useState<PorSubir[]>([]);
  /**
   * A que parada iban las fotos que no subieron.
   *
   * Sin esto, una foto que fallo por señal se quedaba sin destino: la parada
   * ya se creo y el boton de reintentar no sabria a donde mandarla. En una
   * planta la señal se cae a media nave; que la foto se pierda por eso seria
   * volver a caminar hasta alla.
   */
  const [paradaDeLasFotos, setParadaDeLasFotos] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [tokenQr, setTokenQr] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function empezar() {
    setTrabajando(true); setError(null);
    try {
      const r = await fetch("/api/rondines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: areaElegida || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo empezar el recorrido."); return; }
      setRondin({
        id: d.rondin.id, numero: d.rondin.numero, paradas: d.rondin._count?.paradas ?? 0,
        area: areas.find((a) => a.id === areaElegida)?.name ?? null,
        areaId: areaElegida || null,
      });
    } finally { setTrabajando(false); }
  }

  async function anotar() {
    if (!rondin || (!texto.trim() && !tokenQr)) return;
    setTrabajando(true); setError(null);
    try {
      const r = await fetch(`/api/rondines/${rondin.id}/paradas`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dicho: texto.trim() || null, tokenQr }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo anotar la parada."); return; }

      const paradaId = d.parada.id as string;
      const cuantas = fotos.filter((f) => f.estado !== "subida").length;
      setParadas((p) => [...p, {
        id: paradaId, orden: d.parada.orden, observacion: d.parada.observacion,
        comoSeIdentifico: d.parada.comoSeIdentifico, equipo: null, fotos: cuantas,
      }]);
      setTexto(""); setTokenQr(null);

      // Las fotos se suben DESPUES de que la parada existe, que es cuando ya
      // hay a que colgarlas. La parada queda anotada aunque la subida falle:
      // perder el texto por una foto seria el peor de los dos males.
      if (cuantas) {
        setParadaDeLasFotos(paradaId);
        setSubiendo(true);
        const fallidas = await subirPendientes({ rondinParadaId: paradaId }, fotos, setFotos);
        setSubiendo(false);
        if (!fallidas) { setFotos([]); setParadaDeLasFotos(null); }
        else setError(`${fallidas} foto(s) no subieron. Toque «Reintentar» cuando tenga señal.`);
      }

      // Solo se detiene a preguntar cuando de verdad hace falta. Si el código
      // o el área lo resolvieron, se sigue caminando.
      if (d.hayQuePreguntar) {
        setPendiente({
          paradaId: d.parada.id,
          candidatos: d.candidatos ?? [],
          // Sin candidatos, la explicación del servidor no viene al caso: lo
          // que hay que decir es que se puede elegir o dejarlo sin equipo.
          explicacion: d.candidatos?.length ? d.explicacion : "¿De qué equipo es esto?",
        });
        setBuscando(!d.candidatos?.length);
      }
    } finally { setTrabajando(false); }
  }

  async function conciliar(assetId: string | null) {
    if (!pendiente) return;
    setTrabajando(true);
    try {
      await fetch(`/api/rondines/paradas/${pendiente.paradaId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      const enCandidatos = pendiente.candidatos.find((c) => c.id === assetId);
      const enLista = equipos.find((e) => e.id === assetId);
      const nombre = enCandidatos ?? enLista;
      setParadas((p) => p.map((x) => x.id === pendiente.paradaId
        ? { ...x, equipo: nombre ? `${nombre.code} — ${nombre.name}` : null, comoSeIdentifico: assetId ? "ELEGIDO" : "NINGUNO" }
        : x));
      setPendiente(null);
      setBuscando(false);
    } finally { setTrabajando(false); }
  }

  async function reintentarFotos() {
    if (!paradaDeLasFotos) return;
    setSubiendo(true); setError(null);
    const fallidas = await subirPendientes({ rondinParadaId: paradaDeLasFotos }, fotos, setFotos);
    setSubiendo(false);
    if (!fallidas) { setFotos([]); setParadaDeLasFotos(null); }
    else setError(`${fallidas} foto(s) siguen sin subir.`);
  }

  async function terminar() {
    if (!rondin) return;
    setTrabajando(true);
    try {
      const r = await fetch(`/api/rondines/${rondin.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "No se pudo cerrar el recorrido.");
        return;
      }
      /**
       * Se suelta el recorrido AQUI, no solo con `router.refresh()`.
       *
       * El refresco vuelve a pedir los datos del servidor, pero el estado de
       * esta pantalla es del navegador y se queda como estaba: el recorrido
       * aparecia cerrado en la lista de abajo y al mismo tiempo abierto
       * arriba, con su boton de «Terminar» y su campo de parada. Se vio
       * usandolo; leyendo el codigo parecia correcto.
       */
      setRondin(null);
      setParadas([]);
      setPendiente(null);
      setTexto("");
      setTokenQr(null);
      setFotos([]);
      setParadaDeLasFotos(null);
      router.refresh();
    } finally { setTrabajando(false); }
  }

  // ─────────────────────────────────────────────────── Antes de empezar ────
  if (!rondin) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Footprints className="h-4 w-4 text-brand-600" aria-hidden /> Empezar un recorrido
          </p>
          <div className="mt-4">
            <label className="label" htmlFor="area">¿Qué área va a recorrer?</label>
            <select id="area" className="field" value={areaElegida} onChange={(e) => setAreaElegida(e.target.value)}>
              <option value="">Toda la planta</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            {/* Esto no es un trámite: es lo que después permite saber de qué
                equipo habla cuando no haya código pegado. */}
            <p className="mt-1 text-[0.6875rem] text-slate-500">
              Decirlo ayuda a identificar los equipos de los que hable, aunque no tengan código QR.
            </p>
          </div>
          <button
            type="button"
            onClick={empezar}
            disabled={trabajando}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Footprints className="h-4 w-4" aria-hidden />}
            Empezar recorrido
          </button>
          {error ? <p className="mt-2 text-xs text-red-600" role="alert">{error}</p> : null}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────── Caminando ──────
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-brand-900">{rondin.numero}</p>
          <p className="truncate text-[0.6875rem] text-brand-900/70">
            {rondin.area ?? "Toda la planta"} · {paradas.length + rondin.paradas} parada(s)
          </p>
        </div>
        <button
          type="button"
          onClick={terminar}
          disabled={trabajando}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-brand-300 bg-white px-3 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" aria-hidden /> Terminar
        </button>
      </div>

      {escaneando ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-slate-700">Apunte al código del punto</p>
            <button type="button" onClick={() => setEscaneando(false)} aria-label="Cerrar el escáner"
              className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <Escaner onLeido={(codigo) => { setTokenQr(codigo); setEscaneando(false); }} />
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between">
          <label className="label mb-0" htmlFor="obs">¿Qué ve en esta parada?</label>
          <div className="flex flex-wrap items-end gap-2">
            <BotonDictado onTexto={(t) => setTexto((v) => unirDictado(v, t))} etiqueta="Dictar" />
            <button
              type="button"
              onClick={() => setEscaneando((v) => !v)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[0.6875rem] font-medium text-slate-600 hover:border-brand-300 hover:bg-brand-50"
            >
              <QrCode className="h-3.5 w-3.5" aria-hidden /> {tokenQr ? "Código leído" : "Escanear punto"}
            </button>
          </div>
        </div>
        <textarea
          id="obs"
          className="field min-h-20"
          placeholder="Lo que encontró. Puede dictarlo."
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        {tokenQr ? (
          <p className="mt-1 flex items-center gap-1 text-[0.6875rem] text-emerald-700">
            <MapPin className="h-3 w-3" aria-hidden /> Punto identificado por su código
          </p>
        ) : null}

        {/* Las fotos van aquí, con la observación, porque son la misma cosa
            vista de dos formas: lo que se dice y lo que se ve. */}
        <div className="mt-3 border-t border-slate-100 pt-3">
          <FotosPorSubir
            archivos={fotos}
            onCambio={setFotos}
            maximo={6}
            deshabilitado={trabajando || subiendo}
          />
          {paradaDeLasFotos && fotos.some((f) => f.estado === "error") ? (
            <button
              type="button"
              onClick={reintentarFotos}
              disabled={subiendo}
              className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              Reintentar las fotos
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={anotar}
          disabled={trabajando || subiendo || (!texto.trim() && !tokenQr && !fotos.length)}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-40"
        >
          {trabajando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Anotar parada
        </button>
        {error ? <p className="mt-2 text-xs text-red-600" role="alert">{error}</p> : null}
      </div>

      {pendiente ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-xs font-semibold text-amber-900">{pendiente.explicacion}</p>
          {/* Sin ninguno marcado, a propósito: hay que elegir, no confirmar. */}
          <div className="mt-2 grid gap-1.5">
            {pendiente.candidatos.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => conciliar(c.id)}
                disabled={trabajando}
                className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 text-left text-xs hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{c.code} — {c.name}</span>
                  {c.ubicacion ? <span className="block truncate text-[0.625rem] text-slate-500">{c.ubicacion}</span> : null}
                </span>
              </button>
            ))}
            {/* Siempre se puede elegir otro, aunque el sistema no propusiera
                ninguno: si no, una parada se quedaba «por confirmar» sin forma
                de confirmarla. */}
            {buscando ? (
              <select
                className="field"
                defaultValue=""
                onChange={(e) => e.target.value && conciliar(e.target.value)}
                aria-label="Elegir el equipo"
              >
                <option value="" disabled>Elija el equipo…</option>
                {equipos
                  .filter((e) => !rondin?.areaId || e.locationId === rondin.areaId)
                  .map((e) => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
                {/* Los de fuera del área van después: casi nunca son, pero a
                    veces uno se sale del área sin volver a empezar. */}
                {rondin?.areaId ? equipos
                  .filter((e) => e.locationId !== rondin.areaId)
                  .map((e) => <option key={e.id} value={e.id}>{e.code} — {e.name} (otra área)</option>) : null}
              </select>
            ) : (
              <button
                type="button"
                onClick={() => setBuscando(true)}
                className="min-h-11 rounded-lg border border-amber-200 bg-white px-3 text-left text-xs text-slate-600 hover:bg-slate-50"
              >
                Es otro equipo: buscarlo
              </button>
            )}
            <button
              type="button"
              onClick={() => conciliar(null)}
              disabled={trabajando}
              className="min-h-11 rounded-lg border border-amber-200 bg-white px-3 text-left text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Ninguno: no es de un equipo en particular
            </button>
          </div>
        </div>
      ) : null}

      {paradas.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">En este recorrido</p>
          <ul className="mt-2 grid gap-2">
            {paradas.map((p) => (
              <li key={p.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-700">{p.orden}. {p.observacion ?? "(sin nota)"}</p>
                <p className="text-[0.625rem] text-slate-500">
                  {p.equipo ?? (p.comoSeIdentifico === "NINGUNO" ? "Sin equipo" : "Equipo por confirmar")}
                  {p.fotos ? ` · ${p.fotos} foto(s)` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
