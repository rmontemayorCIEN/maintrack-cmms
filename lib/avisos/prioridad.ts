/**
 * Qué tan urgente es un aviso. Reglas fijas, con la razón escrita.
 *
 * Se parte de la prioridad del evento en el catálogo y se ajusta con lo que se
 * sabe del registro. Dos topes a propósito:
 *
 *  - Estar vencido no vuelve crítico a nada por sí solo: sube un nivel, y
 *    solo llega a crítico si además la orden es crítica o el equipo es A.
 *  - Monto, reincidencia y tiempo sin atención suben hasta «alta», nunca a
 *    «crítica»: crítico se reserva para seguridad y para lo que detiene un
 *    equipo crítico.
 *
 * Sin dependencias: se prueba con números y la usa cualquier detector.
 */
import { ETIQUETA_PRIORIDAD, PESO_PRIORIDAD, PRIORIDADES, type Prioridad } from "./catalogo";

export type Factores = {
  prioridadRegistro?: string | null;   // LOW | MEDIUM | HIGH | CRITICAL
  criticidadActivo?: string | null;    // A | B | C
  horasRestantes?: number | null;      // negativo = vencido
  seguridad?: boolean;                 // trabajo de seguridad o reporte de riesgo
  detieneEquipo?: boolean;             // falta material con equipo parado
  montoAlto?: boolean;                 // arriba del umbral de autorización
  reincidencia?: number;               // veces que ya pasó lo mismo
  horasSinAtencion?: number;
};

const DE_REGISTRO: Record<string, Prioridad> = { LOW: "BAJA", MEDIUM: "MEDIA", HIGH: "ALTA", CRITICAL: "CRITICA" };

const nivel = (n: number): Prioridad => PRIORIDADES[Math.max(0, Math.min(4, n))];

export function calcularPrioridad(base: Prioridad, f: Factores = {}): { prioridad: Prioridad; razones: string[] } {
  let n = PESO_PRIORIDAD[base];
  const razones: string[] = [];

  const registro = f.prioridadRegistro ? DE_REGISTRO[f.prioridadRegistro] : undefined;
  if (registro && PESO_PRIORIDAD[registro] > n) {
    n = PESO_PRIORIDAD[registro];
    razones.push(`la orden es de prioridad ${ETIQUETA_PRIORIDAD[registro].toLowerCase()}`);
  }
  const ordenCritica = f.prioridadRegistro === "CRITICAL";
  const equipoA = f.criticidadActivo === "A";

  if (f.seguridad) { n = 4; razones.push("es un tema de seguridad"); }
  if (f.detieneEquipo) {
    const antes = n;
    n = Math.max(n, equipoA ? 4 : 3);
    if (n > antes) razones.push(equipoA ? "detiene un equipo crítico" : "detiene un equipo");
  }
  if (equipoA && n < 4) {
    n = Math.min(n + 1, ordenCritica ? 4 : 3);
    razones.push("el equipo es de criticidad A");
  }
  if (f.horasRestantes !== undefined && f.horasRestantes !== null && f.horasRestantes < 0) {
    const max = ordenCritica || equipoA ? 4 : 3;
    if (n < max) { n = Math.min(n + 1, max); razones.push(`lleva ${Math.round(-f.horasRestantes)} h vencida`); }
  }
  const hastaAlta = (condicion: boolean | undefined, razon: string) => {
    if (condicion && n < 3) { n += 1; razones.push(razon); }
  };
  hastaAlta(f.montoAlto, "el monto requiere firma");
  hastaAlta((f.reincidencia ?? 0) >= 3, `ya pasó ${f.reincidencia} veces`);
  hastaAlta((f.horasSinAtencion ?? 0) >= 48, `lleva ${Math.round(f.horasSinAtencion ?? 0)} h sin atención`);
  return { prioridad: nivel(n), razones };
}

/** «hace 3 h», «hace 2 días»: cuánto lleva pendiente, para el texto del aviso. */
export function tiempoPendiente(desde: Date, ahora = new Date()): string {
  const min = Math.max(0, Math.round((ahora.getTime() - desde.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} días`;
}
