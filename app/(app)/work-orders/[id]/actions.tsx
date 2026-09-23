"use client";

import { useState } from "react";
import { BotonDictado, unirDictado } from "@/components/boton-dictado";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Pause, Play, Sparkles } from "lucide-react";
import { Dialogo } from "@/components/ui/dialogo";
import { Button } from "@/components/ui";
import { SelectCatalogo, type OpcionCatalogo } from "@/components/select-catalogo";
import { accionesDisponibles, inicioSinResponsable, motivoValido, type AccionOt } from "@/lib/reglas-ot";
import { formatCurrency, formatNumber } from "@/lib/utils";

/**
 * La clave con la que se guarda la falla del encabezado.
 *
 * Las ordenes viejas —correctivas creadas antes de que la falla viviera en la
 * actividad— no tienen actividades donde colgar el codigo. Para esas se sigue
 * capturando arriba, con esta clave reservada.
 */
const ENCABEZADO = "__encabezado";

export function WorkOrderActions({
  workOrderId,
  status,
  failureCodes,
  causasRaiz,
  pendingRequired,
  actividadesDeFalla,
  esOrdenDeFalla,
  puedeGestionarCatalogos = false,
  iaDisponible = false,
  dictadoDisponible = false,
  rol,
  iniciada,
  conResponsable,
  requiereParo,
  evidenciaRequerida,
  cierre,
}: {
  rol: string;
  iniciada: boolean;
  conResponsable: boolean;
  requiereParo: boolean;
  evidenciaRequerida: boolean;
  /**
   * Lo que el supervisor revisa antes de cerrar, ya calculado en el servidor,
   * con los faltantes que el servidor mismo rechazaria.
   */
  cierre: {
    horas: number;
    manoDeObra: number;
    refacciones: number;
    servicios: number;
    otros: number;
    total: number;
    minutosParo: number;
    sinParoConfirmado: boolean;
    diagnostico: string;
    resolucion: string | null;
    actividadesPendientes: number;
    actividadesEnBacklog: number;
    archivos: number;
    moneda: string;
    faltantes: string[];
  };
  workOrderId: string;
  status: string;
  failureCodes: Array<{ id: string; code: string; description: string }>;
  causasRaiz: Array<{ id: string; code: string; description: string }>;
  pendingRequired: number;
  /**
   * Las actividades de esta orden que SI representan una falla —correctivo o
   * seguridad—, cada una con su reporte de origen si vino de uno.
   *
   * Se pregunta la causa una vez por cada una, no una sola vez para toda la
   * orden: una OT mezclada puede traer el preventivo del mes mas dos fugas
   * reportadas, y esos son tres eventos distintos con causas distintas.
   *
   * Vacio en una orden puramente preventiva, y entonces el cierre no pregunta
   * nada de fallas: un preventivo que se ejecuto bien no es una falla, y
   * codificarlo inventa un evento que ensucia el Pareto y el MTBF.
   */
  actividadesDeFalla: Array<{
    id: string;
    title: string;
    maintenanceType: string;
    solicitud: string | null;
  }>;
  /**
   * Si el encabezado de la orden es de un tipo que representa falla.
   *
   * Solo se usa para las ordenes viejas, sin actividades: ahi todavia hay que
   * capturar arriba. En las nuevas manda la actividad.
   */
  esOrdenDeFalla: boolean;
  puedeGestionarCatalogos?: boolean;
  /** Si el plan de la empresa incluye el asistente de cierre. */
  iaDisponible?: boolean;
  dictadoDisponible?: boolean;
}) {
  const router = useRouter();
  function clavesDeFalla() {
    return actividadesDeFalla.length
      ? actividadesDeFalla.map((a) => a.id)
      : esOrdenDeFalla
        ? [ENCABEZADO]
        : [];
  }
  const [opcionesFallas, setOpcionesFallas] = useState<OpcionCatalogo[]>(
    failureCodes.map((c) => ({ id: c.id, etiqueta: `${c.code} — ${c.description}` })),
  );
  const [opcionesCausas, setOpcionesCausas] = useState<OpcionCatalogo[]>(
    causasRaiz.map((c) => ({ id: c.id, etiqueta: `${c.code} — ${c.description}` })),
  );
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeForm, setCloseForm] = useState({ resolution: "" });

  /**
   * Que se captura para cada falla. La llave es el id de la actividad, o
   * ENCABEZADO en las ordenes viejas que no tienen actividades.
   */
  /**
   * Que se captura para cada falla. La llave es el id de la actividad, o
   * ENCABEZADO en las ordenes viejas de falla que no tienen actividades.
   *
   * Queda VACIO en una orden puramente preventiva: si aqui se colara una
   * entrada, el modal dibujaria los campos de falla debajo del aviso que dice
   * que no se piden, y se contradiria en pantalla.
   */
  const [fallas, setFallas] = useState<
    Record<string, { failureCodeId: string; rootCauseId: string; downtimeMinutes: string }>
  >(() => Object.fromEntries(
    clavesDeFalla().map((k) => [k, { failureCodeId: "", rootCauseId: "", downtimeMinutes: "0" }]),
  ));

  /** Una orden sin actividades de falla no pregunta nada de fallas. */
  const pideFallas = actividadesDeFalla.length > 0 || esOrdenDeFalla;
  /** Minutos de paro de una orden sin fallas (preventivo que paro el equipo). */
  const [paroGeneral, setParoGeneral] = useState("0");

  function setFalla(clave: string, campo: "failureCodeId" | "rootCauseId" | "downtimeMinutes", valor: string) {
    setFallas((f) => ({ ...f, [clave]: { ...f[clave], [campo]: valor } }));
  }

  type Sugerencia = {
    failureCodeId: string | null; failureCodeEtiqueta: string | null;
    rootCauseId: string | null; rootCauseEtiqueta: string | null;
    refacciones: Array<{ partId: string; codigo: string; nombre: string; unidad: string; cantidad: number; motivo: string; existencia: number }>;
    confianza: "ALTA" | "MEDIA" | "BAJA";
    nota: string;
  };
  const [sugiriendo, setSugiriendo] = useState(false);
  const [sugerencia, setSugerencia] = useState<Sugerencia | null>(null);
  const [errorIa, setErrorIa] = useState<string | null>(null);
  const [cargandoRefaccion, setCargandoRefaccion] = useState<string | null>(null);
  const [refaccionesCargadas, setRefaccionesCargadas] = useState<string[]>([]);

  /**
   * La sugerencia rellena los campos vacios pero nunca pisa lo que el tecnico
   * ya eligio: si el capturo algo, su criterio manda sobre el del modelo.
   */
  async function sugerir() {
    setSugiriendo(true);
    setErrorIa(null);
    const res = await fetch("/api/ia/cierre", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workOrderId, texto: closeForm.resolution }),
    });
    const data = await res.json();
    setSugiriendo(false);
    if (!res.ok) { setErrorIa(data.error ?? "No fue posible generar la sugerencia"); return; }

    const s: Sugerencia = data.sugerencia;
    setSugerencia(s);

    /**
     * La sugerencia solo se aplica sola cuando hay UNA falla que codificar.
     *
     * El modelo lee el texto del cierre completo, que no dice cual parrafo
     * corresponde a cual reporte. Con dos o mas fallas, repartir su respuesta
     * seria adivinar, y una causa puesta en la falla equivocada es peor que
     * una casilla vacia: ensucia el patron que el analisis busca. Con varias,
     * la sugerencia se muestra y el tecnico decide donde va.
     */
    const claves = Object.keys(fallas);
    if (claves.length !== 1) return;
    const unica = claves[0];
    setFallas((f) => ({
      ...f,
      [unica]: {
        ...f[unica],
        failureCodeId: f[unica].failureCodeId || (s.failureCodeId ?? ""),
        rootCauseId: f[unica].rootCauseId || (s.rootCauseId ?? ""),
      },
    }));
  }

  async function cargarRefaccion(partId: string, quantity: number) {
    setCargandoRefaccion(partId);
    const res = await fetch(`/api/work-orders/${workOrderId}/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partId, quantity }),
    });
    setCargandoRefaccion(null);
    if (!res.ok) {
      const data = await res.json();
      setErrorIa(data.error ?? "No fue posible cargar la refacción");
      return;
    }
    setRefaccionesCargadas((prev) => [...prev, partId]);
    router.refresh();
  }

  const faltaDiagnostico = Object.values(fallas).some((f) => !f.failureCodeId || !f.rootCauseId);
  const acciones = accionesDisponibles({ status, iniciada, conResponsable }, rol);
  /** El paso que pide motivo (o responsable) y esta esperando que la persona lo escriba. */
  const [pidiendo, setPidiendo] = useState<AccionOt | null>(null);
  const [motivo, setMotivo] = useState("");
  const [tomarla, setTomarla] = useState(true);
  const [revisandoCierre, setRevisandoCierre] = useState(false);
  const [excepciones, setExcepciones] = useState({ motivoSinHoras: "", sinParoConfirmado: false, motivoSinDiagnostico: "" });
  const sinHoras = cierre.horas <= 0;
  const reglaInicio = inicioSinResponsable(rol);
  const puedeIniciarSinResponsable = reglaInicio.puedeExcepcion;

  function elegir(accion: AccionOt) {
    setError(null);
    // Reabrir una cerrada tambien lleva a COMPLETED, pero no es completar: pide motivo, no cierre tecnico.
    if (accion.a === "COMPLETED" && status !== "CLOSED") {
      /**
       * Las fallas se arman al abrir, con las actividades de ESTE momento.
       * Si se armaran una sola vez al cargar, una actividad enviada al backlog
       * despues seguiria pidiendo su codigo en el cierre.
       */
      setFallas((previas) => Object.fromEntries(clavesDeFalla().map((k) => [
        k, previas[k] ?? { failureCodeId: "", rootCauseId: "", downtimeMinutes: "0" },
      ])));
      setClosing(true);
      return;
    }
    if (accion.a === "CLOSED") { setRevisandoCierre(true); return; }
    const iniciarSinResponsable = accion.a === "IN_PROGRESS" && !conResponsable;
    if (accion.pideMotivo || iniciarSinResponsable) {
      setMotivo("");
      setTomarla(true);
      setPidiendo(accion);
      return;
    }
    move(accion.a);
  }

  async function move(next: string, extra?: Record<string, unknown>) {
    // Un segundo clic mientras el primero viaja no manda nada.
    if (loading) return;
    setLoading(next);
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/work-orders/${workOrderId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, ...extra }),
      });
    } catch {
      setLoading(null);
      setError("No hay conexión. El cambio no se guardó; intente de nuevo cuando tenga señal.");
      return;
    }
    const data = await res.json().catch(() => ({}));
    setLoading(null);
    if (!res.ok) {
      setError(data.error ?? "No fue posible cambiar el estado");
      return;
    }
    setClosing(false);
    setPidiendo(null);
    setRevisandoCierre(false);
    router.refresh();
  }

  /** Lo que se le explica a la persona segun el caso, para pedir el motivo. */
  const sinResponsableAlIniciar = pidiendo?.a === "IN_PROGRESS" && !conResponsable;

  return (
    // «contents»: los botones se acomodan junto a Aceptar y Pedir apoyo en la misma fila de la barra.
    <div className="contents">
      {acciones.map((accion) => (
        <Button
          key={accion.a + accion.etiqueta}
          size="sm"
          variant={accion.tono === "primary" ? undefined : accion.tono}
          onClick={() => elegir(accion)}
          disabled={loading !== null}
        >
          {loading === accion.a ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : accion.a === "IN_PROGRESS" && accion.etiqueta === "Iniciar" ? <Play className="h-3.5 w-3.5" />
            : accion.a === "ON_HOLD" ? <Pause className="h-3.5 w-3.5" />
            : accion.a === "COMPLETED" && status === "IN_PROGRESS" ? <CheckCircle2 className="h-3.5 w-3.5" />
            : null}
          {/* Sin responsable, iniciar es tomarla: el boton lo dice antes del clic. */}
          {accion.a === "IN_PROGRESS" && accion.etiqueta === "Iniciar" && !conResponsable ? "Tomar e iniciar" : accion.etiqueta}
        </Button>
      ))}

      {pidiendo ? (
        <Dialogo
          titulo={sinResponsableAlIniciar ? "Iniciar una orden sin responsable" : pidiendo.etiqueta}
          descripcion={sinResponsableAlIniciar
            ? reglaInicio.texto
            : pidiendo.preguntaMotivo}
          onCerrar={() => setPidiendo(null)}
          pie={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPidiendo(null)}>Regresar</Button>
              <Button
                variant={pidiendo.tono === "danger" ? "danger" : undefined}
                disabled={loading !== null || (
                  sinResponsableAlIniciar ? !tomarla && !motivoValido(motivo) : !motivoValido(motivo)
                )}
                onClick={() => move(pidiendo.a, {
                  motivo: motivo.trim() || undefined,
                  ...(sinResponsableAlIniciar ? { tomarla } : {}),
                })}
              >
                {loading === pidiendo.a ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {pidiendo.etiqueta}
              </Button>
            </div>
          }
        >
          <div className="grid gap-3">
            {error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
            ) : null}
            {sinResponsableAlIniciar ? (
              <>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="radio" checked={tomarla} onChange={() => setTomarla(true)} />
                  Tomarla yo: quedo como responsable
                </label>
                {puedeIniciarSinResponsable ? (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="radio" checked={!tomarla} onChange={() => setTomarla(false)} />
                    Iniciarla sin responsable: excepción con motivo, queda registrada
                  </label>
                ) : null}
              </>
            ) : null}
            {!sinResponsableAlIniciar || !tomarla ? (
              <div>
                <label className="label">Motivo</label>
                <textarea
                  aria-label="Motivo"
                  className="field min-h-20"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder={pidiendo.preguntaMotivo ?? "Por qué se inicia sin responsable"}
                  autoFocus
                />
                <p className="mt-1 text-[0.6875rem] text-slate-500">
                  Queda en la bitácora de la orden con su nombre y la fecha.
                </p>
              </div>
            ) : null}
          </div>
        </Dialogo>
      ) : null}

      {revisandoCierre ? (
        <Dialogo
          titulo="Validar y cerrar"
          descripcion="Cierre administrativo: revise que lo capturado sea correcto. Cerrada, la orden ya no acepta cambios sin reabrirla con motivo."
          onCerrar={() => setRevisandoCierre(false)}
          pie={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRevisandoCierre(false)}>Regresar</Button>
              <Button variant="success" disabled={loading !== null || cierre.faltantes.length > 0} onClick={() => move("CLOSED")}>
                {loading === "CLOSED" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Cerrar orden
              </Button>
            </div>
          }
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-slate-500">Horas de mano de obra</dt>
            <dd className="text-right tabular-nums">{formatNumber(cierre.horas, 1)} h</dd>
            <dt className="text-slate-500">Mano de obra</dt>
            <dd className="text-right tabular-nums">{formatCurrency(cierre.manoDeObra, cierre.moneda)}</dd>
            <dt className="text-slate-500">Refacciones</dt>
            <dd className="text-right tabular-nums">{formatCurrency(cierre.refacciones, cierre.moneda)}</dd>
            <dt className="text-slate-500">Servicios externos</dt>
            <dd className="text-right tabular-nums">{formatCurrency(cierre.servicios, cierre.moneda)}</dd>
            {cierre.otros > 0 ? (<>
              <dt className="text-slate-500">Otros</dt>
              <dd className="text-right tabular-nums">{formatCurrency(cierre.otros, cierre.moneda)}</dd>
            </>) : null}
            <dt className="font-medium text-slate-700">Costo total</dt>
            <dd className="text-right font-medium tabular-nums">{formatCurrency(cierre.total, cierre.moneda)}</dd>
            <dt className="text-slate-500">Paro del equipo</dt>
            <dd className="text-right">
              {cierre.minutosParo > 0 ? `${cierre.minutosParo} min` : cierre.sinParoConfirmado ? "Confirmado: no hubo paro" : requiereParo ? "Sin capturar" : "No requería paro"}
            </dd>
            <dt className="text-slate-500">Diagnóstico</dt>
            <dd className="text-right">{cierre.diagnostico}</dd>
            <dt className="text-slate-500">Actividades pendientes</dt>
            <dd className="text-right">
              {cierre.actividadesPendientes === 0 ? "Ninguna" : cierre.actividadesPendientes}
              {cierre.actividadesEnBacklog ? ` · ${cierre.actividadesEnBacklog} en backlog` : ""}
            </dd>
            <dt className="text-slate-500">Evidencia</dt>
            <dd className="text-right">{cierre.archivos} archivo(s){evidenciaRequerida ? " · requerida" : ""}</dd>
          </dl>
          {cierre.resolucion ? (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <span className="font-medium">Solución: </span>{cierre.resolucion}
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          ) : null}
          {cierre.faltantes.length ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-semibold">Antes de cerrar falta:</p>
              <ul className="mt-1 list-disc pl-4">
                {cierre.faltantes.map((f) => <li key={f}>{f}</li>)}
              </ul>
              <p className="mt-1">Corrija los datos o devuelva la orden a proceso con el motivo.</p>
            </div>
          ) : null}
        </Dialogo>
      ) : null}

      {/* Con un dialogo abierto el error se muestra adentro, junto a los campos. */}
      {error && !closing && !pidiendo && !revisandoCierre ? (
        <p className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</p>
      ) : null}

      {closing ? (
        <Dialogo
          titulo="Cierre técnico"
          descripcion="Registre el resultado del trabajo para alimentar los indicadores de confiabilidad."
          onCerrar={() => setClosing(false)}
          pie={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setClosing(false)}>Cancelar</Button>
              <Button
                variant="success"
                disabled={loading !== null}
                onClick={() =>
                  move("COMPLETED", {
                    resolution: closeForm.resolution || undefined,
                    /**
                     * Una entrada por falla. Las que quedaron sin codificar se
                     * mandan igual con el paro: el tecnico pudo no saber la
                     * causa y aun asi el equipo estuvo parado, y ese dato no se
                     * puede perder.
                     */
                    fallas: Object.entries(fallas).map(([clave, v]) => ({
                      taskId: clave === ENCABEZADO ? null : clave,
                      failureCodeId: v.failureCodeId || null,
                      rootCauseId: v.rootCauseId || null,
                      downtimeMinutes: Number(v.downtimeMinutes) || 0,
                    })),
                    // Una orden sin actividades de falla no manda fallas; su paro
                    // va en el encabezado.
                    ...(pideFallas ? {} : { downtimeMinutes: Number(paroGeneral) || 0 }),
                    motivoSinHoras: sinHoras ? excepciones.motivoSinHoras.trim() || null : null,
                    sinParoConfirmado: requiereParo ? excepciones.sinParoConfirmado : false,
                    motivoSinDiagnostico: faltaDiagnostico ? excepciones.motivoSinDiagnostico.trim() || null : null,
                  })
                }
              >
                {loading === "COMPLETED" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Completar orden
              </Button>
            </div>
          }
        >
            {error ? (
              <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
            ) : null}
            {pendingRequired > 0 ? (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Quedan {pendingRequired} actividad(es) sin resolver. Marque cada una como hecha, o
                use «No se pudo hacer» para liberarla al backlog indicando por que.
              </p>
            ) : null}

            <div className="grid gap-4">
              {!pideFallas ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Esta orden no tiene actividades correctivas, asi que no se pide código de falla.
                  Una rutina preventiva que se ejecuto bien no es una falla.
                </p>
              ) : null}

              {Object.keys(fallas).map((clave) => {
                const act = actividadesDeFalla.find((a) => a.id === clave);
                const valor = fallas[clave];
                return (
                  <div
                    key={clave}
                    className={actividadesDeFalla.length > 1 ? "rounded-lg border border-slate-200 p-3" : ""}
                  >
                    {act && actividadesDeFalla.length > 1 ? (
                      <p className="mb-2 text-xs font-semibold text-slate-700">
                        {act.title}
                        {act.solicitud ? (
                          <span className="ml-1.5 font-normal text-slate-500">· reporte {act.solicitud}</span>
                        ) : null}
                      </p>
                    ) : null}

                    <div className="grid gap-4">
                      <SelectCatalogo
                        catalogo="failure-codes"
                        etiqueta="Código de falla"
                        valor={valor.failureCodeId}
                        onChange={(v) => setFalla(clave, "failureCodeId", v)}
                        opciones={opcionesFallas}
                        onOpcionesChange={setOpcionesFallas}
                        puedeCrear={puedeGestionarCatalogos}
                        vacioTexto="Sin codificar"
                        camposAlta={[
                          { nombre: "code", etiqueta: "Código (ej. MEC-05)", requerido: true },
                          { nombre: "description", etiqueta: "Descripción de la falla", requerido: true },
                        ]}
                        ayuda="Alimenta el análisis de fallas repetidas"
                      />
                      <SelectCatalogo
                        catalogo="root-causes"
                        etiqueta="Causa raiz"
                        valor={valor.rootCauseId}
                        onChange={(v) => setFalla(clave, "rootCauseId", v)}
                        opciones={opcionesCausas}
                        onOpcionesChange={setOpcionesCausas}
                        puedeCrear={puedeGestionarCatalogos}
                        vacioTexto="Sin determinar"
                        camposAlta={[
                          { nombre: "code", etiqueta: "Código (ej. FILTRO-SATURADO)", requerido: true },
                          { nombre: "description", etiqueta: "Por que fallo", requerido: true },
                        ]}
                        ayuda="Por que fallo, no que fallo. Es lo que permite atacar el patrón."
                      />
                      <div>
                        <label className="label">Tiempo de paro del equipo (minutos)</label>
                        <input
                          type="number" inputMode="decimal"
                          min="0"
                          className="field"
                          value={valor.downtimeMinutes}
                          onChange={(e) => setFalla(clave, "downtimeMinutes", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              {!pideFallas && requiereParo ? (
                <div>
                  <label className="label">Tiempo de paro del equipo (minutos)</label>
                  <input type="number" inputMode="decimal" min="0" className="field" value={paroGeneral} onChange={(e) => setParoGeneral(e.target.value)} />
                </div>
              ) : null}

              {requiereParo ? (
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={excepciones.sinParoConfirmado}
                    onChange={(e) => setExcepciones((x) => ({ ...x, sinParoConfirmado: e.target.checked }))}
                  />
                  La orden requería paro, pero finalmente no hubo paro del equipo
                </label>
              ) : null}
              {requiereParo ? (
                <p className="-mt-2 text-[0.6875rem] text-slate-500">
                  El paro es el tiempo que el equipo estuvo detenido; no son las horas de trabajo del técnico.
                </p>
              ) : null}

              {pideFallas && faltaDiagnostico ? (
                <div>
                  <label className="label">Por qué queda sin código o sin causa raíz</label>
                  <input
                    className="field"
                    value={excepciones.motivoSinDiagnostico}
                    onChange={(e) => setExcepciones((x) => ({ ...x, motivoSinDiagnostico: e.target.value }))}
                    placeholder="Ej. no se encontró la causa; se sigue observando"
                  />
                  <p className="mt-1 text-[0.6875rem] text-slate-500">
                    Una falla sin diagnóstico solo se completa como «Sin determinar» con justificación.
                  </p>
                </div>
              ) : null}

              {sinHoras ? (
                <div>
                  <label className="label">No hay horas registradas: ¿por qué?</label>
                  <input
                    className="field"
                    value={excepciones.motivoSinHoras}
                    onChange={(e) => setExcepciones((x) => ({ ...x, motivoSinHoras: e.target.value }))}
                    placeholder="Ej. lo hizo el proveedor; su costo va en servicios"
                  />
                  <p className="mt-1 text-[0.6875rem] text-slate-500">
                    Lo normal es registrar las horas en «Mano de obra» antes de completar: sin horas no hay costo ni MTTR.
                  </p>
                </div>
              ) : null}

              {evidenciaRequerida && cierre.archivos === 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Esta orden requiere evidencia: suba al menos una foto o documento en «Adjuntos» antes de completar.
                </p>
              ) : null}

              <div>
                <div className="mb-1 flex flex-col items-start gap-1.5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
                  <label className="label mb-0">Solución aplicada o resumen del trabajo *</label>
                  <div className="flex flex-wrap items-end gap-2">
                  {/* Dictar va PRIMERO porque es lo primero que se hace:
                      se cuenta lo que paso y despues se codifica. Y va
                      antes que «Codificar con IA» tambien porque ese boton
                      esta apagado hasta que haya texto, asi que el orden de
                      la pantalla es el orden del trabajo. */}
                  {dictadoDisponible ? (
                    <BotonDictado
                      onTexto={(t) =>
                        setCloseForm((f) => ({ ...f, resolution: unirDictado(f.resolution, t) }))
                      }
                    />
                  ) : null}
                  {iaDisponible ? (
                    <button
                      type="button"
                      onClick={sugerir}
                      disabled={sugiriendo || closeForm.resolution.trim().length < 10}
                      title={
                        closeForm.resolution.trim().length < 10
                          ? "Escriba primero que hizo, aunque sea en pocas palabras"
                          : "La IA propone código de falla, causa raiz y refacciones"
                      }
                      /* `min-h-9` para que empareje con «Dictar» y, sobre todo,
                         para que se pueda tocar con guante: los dos se usan en
                         el mismo momento y desde el mismo teléfono. */
                      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[0.6875rem] font-medium text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40"
                    >
                      {sugiriendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      {sugiriendo ? "Analizando…" : "Codificar con IA"}
                    </button>
                  ) : null}
                  </div>
                </div>
                <textarea
                  aria-label="Solución aplicada o resumen del trabajo"
                  className="field min-h-20"
                  placeholder="Qué encontró y qué hizo. Con dos renglones basta."
                  value={closeForm.resolution}
                  onChange={(e) => setCloseForm((f) => ({ ...f, resolution: e.target.value }))}
                />
                {errorIa ? <p className="mt-1 text-[0.6875rem] text-red-600">{errorIa}</p> : null}

                {sugerencia ? (
                  <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50/60 p-2.5">
                    <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-brand-700">
                      <Sparkles className="h-3 w-3" /> Sugerencia
                      <span className={`rounded-full px-1.5 py-0.5 text-[0.625rem] normal-case tracking-normal ${
                        sugerencia.confianza === "ALTA" ? "bg-emerald-100 text-emerald-700"
                          : sugerencia.confianza === "MEDIA" ? "bg-amber-100 text-amber-800"
                          : "bg-slate-200 text-slate-600"
                      }`}>
                        confianza {sugerencia.confianza.toLowerCase()}
                      </span>
                    </p>
                    <p className="mt-1 text-[0.6875rem] leading-relaxed text-brand-900/80">{sugerencia.nota}</p>

                    {!sugerencia.failureCodeId && !sugerencia.rootCauseId ? (
                      <p className="mt-1.5 text-[0.6875rem] text-brand-900/70">
                        No encontro elementos suficientes para codificar. Amplie un poco lo que escribio y
                        vuelva a intentar, o codifique a mano.
                      </p>
                    ) : null}

                    {sugerencia.refacciones.length ? (
                      <div className="mt-2 grid gap-1">
                        <p className="text-[0.6875rem] font-medium text-brand-900">Refacciones que sugiere cargar:</p>
                        {sugerencia.refacciones.map((r) => {
                          const cargada = refaccionesCargadas.includes(r.partId);
                          const sinExistencia = r.existencia < r.cantidad;
                          return (
                            <div key={r.partId} className="flex items-center justify-between gap-2 rounded-md bg-white/70 px-2 py-1">
                              <div className="min-w-0">
                                <p className="truncate text-[0.6875rem] font-medium text-slate-700">
                                  {r.codigo} — {r.nombre} × {r.cantidad} {r.unidad}
                                </p>
                                <p className="truncate text-[0.625rem] text-slate-500">{r.motivo}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => cargarRefaccion(r.partId, r.cantidad)}
                                disabled={cargada || sinExistencia || cargandoRefaccion === r.partId}
                                className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[0.625rem] font-medium text-slate-600 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-40"
                              >
                                {cargandoRefaccion === r.partId ? "…"
                                  : cargada ? "Cargada"
                                  : sinExistencia ? `Solo ${r.existencia} en almacen`
                                  : "Cargar"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    <p className="mt-1.5 text-[0.625rem] text-brand-900/60">
                      Revise antes de completar: de estos datos salen los indicadores de confiabilidad.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

        </Dialogo>
      ) : null}
    </div>
  );
}
