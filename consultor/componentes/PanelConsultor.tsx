"use client";

// La pantalla del Consultor: el avance, lo siguiente que conviene hacer, el
// plan, lo que recuerda de la cuenta y la conversación.
//
// No sabe de qué app es: recibe el plan, las acciones (que corren en el
// servidor de la app) y el componente de enlace. Sin IA, el plan y el avance se
// siguen viendo (son código) y la conversación dice por qué no está.
//
// Estilos en consultor.css, solo con tokens --cs-* que cada app traduce a los suyos.

import { useMemo, useRef, useState } from "react";
import type { Contestacion, Memoria, MensajeConsultor, Nota, PasoPlan, PerfilApp, PropuestaNota, R, TipoNota } from "../tipos";
import { avanceDe, NOMBRE_ESTADO, pendientesDelAdministrador, siguientePaso } from "../reglas/avance";
import { entrevista as preguntasDeEntrevista, haceCuanto, LIMITES, TIPOS_NOTA } from "../reglas/memoria";
import { textos } from "../textos";

export type AccionesConsultor = {
  preguntar(texto: string, ruta: string | null): Promise<R<{ contestacion: Contestacion; quedan: number }>>;
  guardarNota(tipo: TipoNota, texto: string): Promise<R<{ nota: Nota }>>;
  apagarNota(id: string): Promise<R>;
  restaurarNota(id: string): Promise<R<{ nota: Nota }>>;
  arrancar(respuestas: Record<string, string>): Promise<R<{ notas: Nota[] }>>;
  saltarEntrevista(): Promise<R>;
};

export type LigaConsultor = (p: { href: string; className?: string; children: React.ReactNode }) => React.ReactElement;

type Props = {
  perfil: PerfilApp;
  pasos: PasoPlan[];
  memoria: Memoria;
  mensajes: MensajeConsultor[];
  puedeAdministrar: boolean;
  soloLectura: boolean;
  ia: { disponible: boolean; motivo: string };
  /// Del servidor, para que «hace 3 días» no dependa del reloj del navegador.
  ahora: string;
  quedanHoy: number;
  /// El porcentaje de la app, si tiene su propio criterio (ver avanceDe).
  porcentaje?: number | null;
  acciones: AccionesConsultor;
  Liga: LigaConsultor;
};

const PREGUNTAS_RAPIDAS = ["¿Qué me falta para terminar?", "¿Cómo hago el paso que sigue?", "¿Cómo voy?"];

export function PanelConsultor(p: Props) {
  const { Liga } = p;
  const [notas, setNotas] = useState<Nota[]>(p.memoria.notas);
  const [apagadas, setApagadas] = useState<Nota[]>([]);
  const [mensajes, setMensajes] = useState<MensajeConsultor[]>(p.mensajes);
  const [propuestas, setPropuestas] = useState<PropuestaNota[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [quedan, setQuedan] = useState(p.quedanHoy);
  const [entrevista, setEntrevista] = useState(!p.memoria.ultimaVez && !p.memoria.notas.length && !p.soloLectura);
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [verPlan, setVerPlan] = useState(true);
  const [nueva, setNueva] = useState<{ tipo: TipoNota; texto: string } | null>(null);
  const fin = useRef<HTMLDivElement>(null);

  const ahora = useMemo(() => new Date(p.ahora), [p.ahora]);
  const T = textos(p.perfil.trato);
  const av = avanceDe(p.pasos, p.porcentaje);
  const sig = siguientePaso(p.pasos, { pasoActual: p.memoria.pasoActual, puedeAdministrar: p.puedeAdministrar, trato: p.perfil.trato });
  const delAdmin = p.puedeAdministrar ? [] : pendientesDelAdministrador(p.pasos);
  const puedeEscribir = p.ia.disponible && !p.soloLectura && quedan > 0;

  // Un doble toque no duplica: mientras hay una acción en curso, las demás esperan.
  async function correr<T>(f: () => Promise<R<T>>, bien: (r: T) => void) {
    if (enviando) return;
    setEnviando(true);
    setError("");
    try {
      const r = await f();
      if (r.ok) bien(r);
      else setError(r.error);
    } catch {
      setError(T.errorRed);
    } finally {
      setEnviando(false);
    }
  }

  function preguntar(t: string) {
    const limpio = t.trim();
    if (!limpio) return;
    const id = `local-${Date.now()}`;
    void correr(() => p.acciones.preguntar(limpio, null), (r) => {
      setMensajes((ms) => [...ms,
        { id, de: "USUARIO", texto: limpio, fecha: new Date().toISOString() },
        { id: `${id}-r`, de: "CONSULTOR", texto: r.contestacion.respuesta, fecha: new Date().toISOString(), enlace: r.contestacion.enlace }]);
      setPropuestas(r.contestacion.notasPropuestas);
      setQuedan(r.quedan);
      setTexto("");
      setTimeout(() => fin.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
    });
  }

  return (
    <div className="cs">
      <section className="cs-tarjeta cs-avance" aria-label="Avance de la implementación">
        <div className="cs-avance-cifra">
          <b className="cs-num">{av.porcentaje} %</b>
          <span>{av.etapa === "OPERACION" ? T.etapaOperacion : "de la implementación"}</span>
        </div>
        <div className="cs-barra" role="progressbar" aria-valuenow={av.porcentaje} aria-valuemin={0} aria-valuemax={100} aria-label="Avance">
          <i style={{ width: `${av.porcentaje}%` }} />
        </div>
        <small className="cs-tenue">
          {T.pasosHechos(av.hechos, av.total)}
          {p.memoria.ultimaVez ? ` Última vez con el Consultor: ${haceCuanto(p.memoria.ultimaVez, ahora)}.` : ""}
        </small>
      </section>

      {sig ? (
        <section className="cs-tarjeta cs-siguiente" aria-label="Lo siguiente que conviene hacer">
          <small className="cs-etiqueta">Lo siguiente que conviene hacer</small>
          <h3>{sig.paso.titulo}</h3>
          <p>{sig.paso.que}</p>
          {/* Si la app ya escribe «Falta …», no se repite. */}
          {sig.paso.falta && <p className="cs-tenue">{/^falta\b/i.test(sig.paso.falta) ? sig.paso.falta : `Falta: ${sig.paso.falta}`}</p>}
          <p className="cs-tenue"><b>Por qué va primero:</b> {sig.porque}</p>
          <div className="cs-fila">
            <Liga href={sig.paso.enlace} className="cs-boton cs-principal">{sig.paso.textoEnlace}</Liga>
            {p.ia.disponible && !p.soloLectura && (
              <button type="button" className="cs-boton" disabled={!puedeEscribir || enviando} onClick={() => preguntar(T.pideExplicar(sig.paso.titulo))}>
                {T.explicamelo}
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="cs-tarjeta cs-siguiente">
          <small className="cs-etiqueta">Lo siguiente</small>
          <h3>{av.porcentaje === 100 ? "Todo el plan está hecho" : T.noDependeDeTi}</h3>
          <p className="cs-tenue">{av.porcentaje === 100 ? T.sigueTodoHecho : "Los pasos pendientes los hace quien administra la cuenta."}</p>
        </section>
      )}

      {delAdmin.length > 0 && (
        <div className="cs-nota-admin" role="note">
          {T.delAdmin(delAdmin.map((x) => `«${x.titulo}»`).join(", "), delAdmin.length)}
        </div>
      )}

      <div className="cs-columnas">
        <div className="cs-col">
          <section className="cs-tarjeta" aria-label="Conversación con el Consultor">
            <h3 className="cs-titulo">{T.pregunta}</h3>
            {entrevista ? (
              <form className="cs-entrevista" onSubmit={(e) => { e.preventDefault(); void correr(() => p.acciones.arrancar(respuestas), (r) => { setNotas((ns) => [...ns, ...r.notas]); setEntrevista(false); }); }}>
                <p>{T.entrevista}</p>
                {preguntasDeEntrevista(p.perfil.trato).map((q) => (
                  <label key={q.clave} className="cs-campo">
                    <span>{q.pregunta}</span>
                    <input value={respuestas[q.clave] ?? ""} maxLength={LIMITES.nota} placeholder={`Por ejemplo: ${q.ejemplo}`}
                      onChange={(e) => setRespuestas((r) => ({ ...r, [q.clave]: e.target.value }))} />
                  </label>
                ))}
                <div className="cs-fila">
                  <button type="submit" className="cs-boton cs-principal" disabled={enviando}>Guardar y empezar</button>
                  <button type="button" className="cs-boton" disabled={enviando} onClick={() => void correr(() => p.acciones.saltarEntrevista(), () => setEntrevista(false))}>Saltar</button>
                </div>
              </form>
            ) : (
              <>
                <div className="cs-mensajes" aria-live="polite">
                  {mensajes.length === 0 && (
                    <p className="cs-tenue">{T.vacio(p.perfil.nombre)}</p>
                  )}
                  {mensajes.map((m) => (
                    <div key={m.id} className={`cs-msg ${m.de === "USUARIO" ? "cs-yo" : "cs-el"}`}>
                      <div className="cs-burbuja">{m.texto}</div>
                      {m.enlace && <Liga href={m.enlace.href} className="cs-boton cs-chico">{m.enlace.texto}</Liga>}
                    </div>
                  ))}
                  <div ref={fin} />
                </div>

                {propuestas.length > 0 && (
                  <div className="cs-propuestas">
                    <small className="cs-etiqueta">¿Lo recuerdo para la próxima?</small>
                    {propuestas.map((n, i) => (
                      <div key={`${n.tipo}-${i}`} className="cs-propuesta">
                        <span><b>{TIPOS_NOTA[n.tipo]}:</b> {n.texto}</span>
                        <span className="cs-fila">
                          <button type="button" className="cs-boton cs-chico" disabled={enviando}
                            onClick={() => void correr(() => p.acciones.guardarNota(n.tipo, n.texto), (r) => { setNotas((ns) => [...ns, r.nota]); setPropuestas((ps) => ps.filter((_, j) => j !== i)); })}>Guardar</button>
                          <button type="button" className="cs-boton cs-chico" onClick={() => setPropuestas((ps) => ps.filter((_, j) => j !== i))}>No</button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {!p.ia.disponible ? (
                  <p className="cs-aviso" role="status">{p.ia.motivo}</p>
                ) : p.soloLectura ? (
                  <p className="cs-aviso" role="status">{T.soloLectura}</p>
                ) : quedan <= 0 ? (
                  <p className="cs-aviso" role="status">{T.tope(LIMITES.preguntasPorDia)}</p>
                ) : (
                  <form className="cs-preguntar" onSubmit={(e) => { e.preventDefault(); preguntar(texto); }}>
                    <div className="cs-rapidas">
                      {PREGUNTAS_RAPIDAS.map((q) => <button key={q} type="button" className="cs-chip" disabled={enviando} onClick={() => preguntar(q)}>{q}</button>)}
                    </div>
                    <label className="cs-campo">
                      <span className="cs-oculto">Tu pregunta</span>
                      <textarea rows={3} value={texto} maxLength={LIMITES.pregunta} placeholder={T.escribe}
                        onChange={(e) => setTexto(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); preguntar(texto); } }} />
                    </label>
                    <div className="cs-fila cs-entre">
                      <small className="cs-tenue">{T.quedan(quedan)}</small>
                      <button type="submit" className="cs-boton cs-principal" disabled={enviando || !texto.trim()}>{enviando ? "Pensando…" : "Preguntar"}</button>
                    </div>
                  </form>
                )}
              </>
            )}
            {error && <p className="cs-error" role="alert">{error}</p>}
          </section>
        </div>

        <div className="cs-col">
          <section className="cs-tarjeta" aria-label="Plan de implementación">
            <div className="cs-fila cs-entre">
              <h3 className="cs-titulo">Plan de implementación</h3>
              <button type="button" className="cs-boton cs-chico" aria-expanded={verPlan} onClick={() => setVerPlan((v) => !v)}>{verPlan ? "Contraer" : "Ver los pasos"}</button>
            </div>
            {verPlan && (
              <ol className="cs-plan">
                {p.pasos.map((x) => (
                  <li key={x.clave} className={`cs-paso cs-${x.estado.toLowerCase()}`}>
                    <div className="cs-fila cs-entre">
                      <b>{x.titulo}</b>
                      <span className={`cs-estado cs-estado-${x.estado.toLowerCase()}`}>{NOMBRE_ESTADO[x.estado]}{x.progreso ? ` · ${x.progreso.hecho} de ${x.progreso.meta}` : ""}</span>
                    </div>
                    <small className="cs-tenue">{x.estado === "HECHO" || x.estado === "NO_APLICA" ? x.que : x.falta || x.que}</small>
                    {(x.estado === "FALTA" || x.estado === "EN_PROCESO") && (
                      x.soloAdmin && !p.puedeAdministrar
                        ? <small className="cs-tenue">Lo hace quien administra la cuenta.</small>
                        : <Liga href={x.enlace} className="cs-enlace">{x.textoEnlace}</Liga>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="cs-tarjeta" aria-label="Lo que el Consultor recuerda">
            <div className="cs-fila cs-entre">
              <h3 className="cs-titulo">{T.recuerdo}</h3>
              {!p.soloLectura && !nueva && <button type="button" className="cs-boton cs-chico" onClick={() => setNueva({ tipo: "NECESIDAD", texto: "" })}>Agregar</button>}
            </div>
            {nueva && (
              <form className="cs-nueva" onSubmit={(e) => { e.preventDefault(); void correr(() => p.acciones.guardarNota(nueva.tipo, nueva.texto), (r) => { setNotas((ns) => [...ns, r.nota]); setNueva(null); }); }}>
                <label className="cs-campo"><span>Tipo</span>
                  <select value={nueva.tipo} onChange={(e) => setNueva({ ...nueva, tipo: e.target.value as TipoNota })}>
                    {Object.entries(TIPOS_NOTA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="cs-campo"><span>Nota</span>
                  <input value={nueva.texto} maxLength={LIMITES.nota} onChange={(e) => setNueva({ ...nueva, texto: e.target.value })} />
                </label>
                <div className="cs-fila">
                  <button type="submit" className="cs-boton cs-principal" disabled={enviando || !nueva.texto.trim()}>Guardar</button>
                  <button type="button" className="cs-boton" onClick={() => setNueva(null)}>Cancelar</button>
                </div>
              </form>
            )}
            {notas.length === 0 && !nueva && <p className="cs-tenue">{T.notasVacio}</p>}
            <ul className="cs-notas">
              {notas.map((n) => (
                <li key={n.id}>
                  <span><b>{TIPOS_NOTA[n.tipo]}:</b> {n.texto} <small className="cs-tenue">· {n.autor}</small></span>
                  {!p.soloLectura && (
                    <button type="button" className="cs-boton cs-chico" disabled={enviando} aria-label={`Apagar la nota ${n.texto}`}
                      onClick={() => void correr(() => p.acciones.apagarNota(n.id), () => { setNotas((ns) => ns.filter((x) => x.id !== n.id)); setApagadas((xs) => [n, ...xs]); })}>Apagar</button>
                  )}
                </li>
              ))}
              {apagadas.map((n) => (
                <li key={`ap-${n.id}`} className="cs-apagada">
                  <span>{T.apagaste(n.texto)}</span>
                  <button type="button" className="cs-boton cs-chico" disabled={enviando}
                    onClick={() => void correr(() => p.acciones.restaurarNota(n.id), (r) => { setApagadas((xs) => xs.filter((x) => x.id !== n.id)); setNotas((ns) => [...ns, r.nota]); })}>Deshacer</button>
                </li>
              ))}
            </ul>
            {p.memoria.resumen && <p className="cs-tenue"><b>Donde nos quedamos:</b> {p.memoria.resumen}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
