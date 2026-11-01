// Una pregunta al Consultor, de punta a punta, sin saber de qué app es.
//
//   1. CLASIFICAR  la puerta de IA de la app escoge una clase (salida cerrada).
//   2. FILTRAR     fuera de tema o consejo de experto: texto fijo, y aquí acaba.
//   3. REDACTAR    con el contexto armado por código (plan, notas, ayuda).
//   4. REVISAR     cifras ajenas, enlaces y notas, antes de enseñar nada.
//
// La app pone la puerta de IA (que registra el consumo) y guarda el resultado.
// Las pruebas ponen una puerta simulada: nunca llaman al modelo.

import type { ClasePregunta, Contestacion, FichaConsultor, R } from "./tipos";
import { contextoDe, fichasRelevantes, instruccionesRedactar, type EntradaContexto } from "./reglas/contexto";
import { esClase, instruccionesClasificar, respuestaFija, revisarPregunta } from "./reglas/tema";
import { revisarRespuesta, rutasPermitidas, type RespuestaCruda } from "./reglas/guardas";
import { textos } from "./textos";

export type PuertaIA = {
  clasificar(o: { sistema: string; pregunta: string }): Promise<unknown>;
  redactar(o: { sistema: string; contexto: string; pregunta: string }): Promise<RespuestaCruda | null>;
};

export type EntradaConsulta = Omit<EntradaContexto, "fichas"> & {
  pregunta: string;
  /// La pantalla desde donde se pregunta, si se sabe.
  ruta?: string | null;
  /// Las fichas de las pantallas que esta persona puede abrir: aquí se escogen las que vienen al caso.
  fichas: FichaConsultor[];
};

export type ResultadoConsulta = R<{ contestacion: Contestacion; pasoClave: string | null; resumen: string; redactada: boolean }>;

export async function consultar(e: EntradaConsulta, ia: PuertaIA, explicarError: (x: unknown) => string): Promise<ResultadoConsulta> {
  const T = textos(e.perfil.trato);
  const p = revisarPregunta(e.pregunta, e.perfil.trato);
  if (!p.ok) return p;

  let clase: ClasePregunta;
  try {
    const c = await ia.clasificar({ sistema: instruccionesClasificar(e.perfil), pregunta: p.texto });
    // Si la clase no sirve no se adivina: se pide de otra forma.
    if (!esClase(c)) return { ok: false, error: T.noEntendi };
    clase = c;
  } catch (x) {
    return { ok: false, error: explicarError(x) };
  }

  const fija = respuestaFija(clase, e.perfil);
  if (fija) return { ok: true, redactada: false, pasoClave: null, resumen: e.memoria.resumen, contestacion: { respuesta: fija, clase, enlace: null, notasPropuestas: [] } };

  const fichas = fichasRelevantes(p.texto, e.fichas, { ruta: e.ruta });
  const contexto = contextoDe({ ...e, fichas });
  let cruda: RespuestaCruda | null;
  try {
    cruda = await ia.redactar({ sistema: instruccionesRedactar(e.perfil), contexto, pregunta: p.texto });
  } catch (x) {
    return { ok: false, error: explicarError(x) };
  }
  const rev = revisarRespuesta(cruda, { pasos: e.pasos, rutas: rutasPermitidas(e.pasos, e.fichas, e.puedeAdministrar), fuentes: [contexto, p.texto], notas: e.memoria.notas });
  if (!rev.ok) {
    return { ok: false, error: rev.motivo.startsWith("cifras") ? T.cifrasAjenas : T.sinRespuesta };
  }
  const r = rev.r;
  return {
    ok: true, redactada: true, pasoClave: r.pasoClave, resumen: r.resumen || e.memoria.resumen,
    contestacion: { respuesta: r.respuesta, clase, enlace: r.enlace, notasPropuestas: r.notasPropuestas },
  };
}
