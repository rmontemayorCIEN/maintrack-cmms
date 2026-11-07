// El avance de la implementación y lo siguiente que conviene hacer.
//
// Todo sale del plan que entrega la app, calculado con sus datos. Nada de esto
// se guarda: un porcentaje guardado se vuelve mentira el día que alguien borra
// lo que lo hacía cierto.

import type { EstadoPaso, PasoPlan } from "../tipos";
import { textos, type Trato } from "../textos";

export const NOMBRE_ESTADO: Record<EstadoPaso, string> = {
  HECHO: "Hecho",
  EN_PROCESO: "En proceso",
  FALTA: "Falta",
  NO_APLICA: "No aplica",
};

const pendiente = (p: PasoPlan) => p.estado === "FALTA" || p.estado === "EN_PROCESO";
const resuelto = (p: PasoPlan | undefined) => !p || p.estado === "HECHO" || p.estado === "NO_APLICA";

/// Cuánto vale un paso: hecho, 1; en proceso, su progreso (o la mitad); falta, 0.
function valor(p: PasoPlan): number {
  if (p.estado === "HECHO") return 1;
  if (p.estado === "FALTA") return 0;
  if (p.progreso && p.progreso.meta > 0) return Math.min(0.9, p.progreso.hecho / p.progreso.meta);
  return 0.5;
}

export type Avance = {
  /// 0 a 100. Solo llega a 100 si todo lo que aplica está hecho.
  porcentaje: number;
  hechos: number;
  /// Los pasos que aplican.
  total: number;
  /// IMPLEMENTACION mientras falte un paso de arranque; luego, OPERACION.
  etapa: "IMPLEMENTACION" | "OPERACION";
};

/// `porcentaje`: el de la app, cuando ya tiene su propio criterio (la puesta en
/// marcha de Maintrack). Un criterio, un lugar: el Consultor no inventa otro
/// número para la misma pregunta.
export function avanceDe(pasos: PasoPlan[], porcentajeDeLaApp?: number | null): Avance {
  const aplican = pasos.filter((p) => p.estado !== "NO_APLICA");
  const pesoTotal = aplican.reduce((s, p) => s + p.peso, 0);
  const logrado = aplican.reduce((s, p) => s + p.peso * valor(p), 0);
  const hechos = aplican.filter((p) => p.estado === "HECHO").length;
  // Hacia abajo: un 99.6 % no es 100 % mientras falte algo.
  let porcentaje = pesoTotal ? Math.floor((logrado / pesoTotal) * 100) : 100;
  if (hechos < aplican.length) porcentaje = Math.min(porcentaje, 99);
  if (typeof porcentajeDeLaApp === "number" && Number.isFinite(porcentajeDeLaApp)) porcentaje = Math.max(0, Math.min(100, Math.round(porcentajeDeLaApp)));
  const etapa = pasos.filter((p) => p.etapa === "ARRANQUE").every(resuelto) ? "OPERACION" : "IMPLEMENTACION";
  return { porcentaje, hechos, total: aplican.length, etapa };
}

export type Siguiente = { paso: PasoPlan; porque: string };

/// Lo siguiente que conviene hacer, con su porqué (ordenar no es priorizar).
///
///   1. Donde se quedó, si sigue pendiente y ya puede hacerlo.
///   2. Lo que ya empezó.
///   3. El primero del plan cuyos pasos previos están resueltos.
///
/// Quien no administra no recibe un paso que solo el administrador puede hacer:
/// se le dice a quién pedírselo en el plan, no se le manda a una pantalla cerrada.
export function siguientePaso(pasos: PasoPlan[], o: { pasoActual: string | null; puedeAdministrar: boolean; trato?: Trato }): Siguiente | null {
  const T = textos(o.trato);
  const porClave = new Map(pasos.map((p) => [p.clave, p]));
  const listo = (p: PasoPlan) => (p.despuesDe ?? []).every((c) => resuelto(porClave.get(c)));
  const candidatos = pasos.filter((p) => pendiente(p) && listo(p) && (o.puedeAdministrar || !p.soloAdmin));
  if (!candidatos.length) return null;

  const actual = candidatos.find((p) => p.clave === o.pasoActual);
  if (actual) return { paso: actual, porque: T.dondeTeQuedaste };

  // El arranque va antes que la operación, aunque el plan los traiga mezclados.
  const enOrden = [...candidatos.filter((p) => p.etapa === "ARRANQUE"), ...candidatos.filter((p) => p.etapa === "OPERACION")];
  const empezado = enOrden.find((p) => p.estado === "EN_PROCESO");
  if (empezado) return { paso: empezado, porque: T.yaEmpezaste };

  const p = enOrden[0]!;
  const previos = (p.despuesDe ?? []).map((c) => porClave.get(c)?.titulo).filter(Boolean);
  return {
    paso: p,
    porque: previos.length
      ? `Ya quedó «${previos.join("» y «")}», y esto es lo que sigue.`
      : p.etapa === "ARRANQUE" ? "Es el primer paso pendiente del arranque." : "El arranque ya quedó: ahora toca usarlo en el día a día.",
  };
}

/// Pasos pendientes que solo puede hacer quien administra: para decirle a los
/// demás que no dependen de ellos.
export function pendientesDelAdministrador(pasos: PasoPlan[]): PasoPlan[] {
  return pasos.filter((p) => pendiente(p) && p.soloAdmin);
}
