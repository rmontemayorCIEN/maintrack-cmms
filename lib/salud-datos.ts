import { revisarCalidad, type Hallazgo, type NivelRegla } from "./calidad-datos";

/**
 * Indice de calidad de la captura.
 *
 * Un CMMS no falla por falta de funciones, falla porque la captura queda a
 * medias: ordenes cerradas sin causa raiz, activos sin plan, refacciones sin
 * minimo. Con esos huecos los indicadores mienten y el sistema se abandona.
 *
 * Esto mide exactamente eso, sin inteligencia artificial de por medio: son
 * cuentas, y por eso son auditables. Ademas es el insumo del diagnostico
 * semanal —si la captura esta en 30%, la IA lo primero que debe decir es que
 * arreglar la captura, no interpretar indicadores que no se sostienen.
 *
 * Las reglas viven en `lib/calidad-datos.ts`, que es tambien lo que lee la IA:
 * una sola definicion de «orden sin causa raiz». Cada regla pesa distinto: que
 * una reparacion no tenga causa raiz duele mas que que un activo no tenga costo
 * de reemplazo.
 *
 * Impacto del cambio (Bloque 1): antes «activos con plan» contaba el
 * encabezado viejo del plan (un equipo agregado a un plan de varios quedaba
 * como «sin plan»), «causa raiz» se exigia a TODA orden cerrada —incluidos
 * preventivos bien hechos— y solo en el encabezado. Ahora se exige a las
 * reparaciones de falla, en la orden o en cualquiera de sus actividades, y se
 * agregaron las reglas de datos imposibles. El indice de una misma cuenta
 * puede moverse respecto al anterior sin que su captura haya cambiado.
 *
 * Proceso de ordenes (Bloque 1 nuevo): el indice salia casi perfecto (98) con
 * 15 ordenes terminadas sin horas y paros sin duracion, porque cada regla
 * aportaba su porcentaje de cumplimiento y un 85 % se promediaba con veinte
 * reglas al 100 %. Ahora las reglas `critica` —las que alimentan horas,
 * costos, MTTR, paros y backlog— se califican con penalizacion triple:
 *
 *   calificacion = max(0, 100 − 3 × % de incumplimiento)
 *
 * 15 % de ordenes sin horas califica 55, no 85. Sigue siendo aritmetica
 * auditable, sin IA.
 */

export type Revision = {
  clave: string;
  titulo: string;
  nivel: NivelRegla;
  /** Por que importa, en una frase, para mostrarlo junto al numero. */
  porque: string;
  total: number;
  cumplidos: number;
  porcentaje: number;
  peso: number;
  /** Regla del proceso de ordenes: su incumplimiento pesa el triple. */
  critica: boolean;
  /** Lo que aporta al indice: el porcentaje, o el penalizado si es critica. */
  calificacion: number;
  enlace: string;
  hallazgos: Hallazgo[];
};

/** Cuantos puntos resta cada punto porcentual de incumplimiento en una regla critica. */
export const FACTOR_CRITICA = 3;

export type SaludDatos = {
  indice: number;
  revisiones: Revision[];
  /** Las que mas restan, ya ordenadas: por ahi se empieza. */
  huecos: Revision[];
};

export async function saludDeDatos(organizationId: string, ahora = new Date()): Promise<SaludDatos> {
  const reglas = await revisarCalidad(organizationId, ahora);
  const revisiones: Revision[] = reglas.map((r) => {
    const cumplidos = Math.max(0, r.total - r.cantidad);
    // Sin redondear aqui: la calificacion penalizada se calcula sobre el valor real.
    const porcentaje = r.total === 0 ? 100 : (cumplidos / r.total) * 100;
    return {
      clave: r.clave,
      titulo: r.titulo,
      nivel: r.nivel,
      porque: r.porque,
      enlace: r.enlace,
      peso: r.peso,
      total: r.total,
      cumplidos,
      porcentaje: Math.floor(porcentaje),
      critica: !!r.critica,
      calificacion: r.critica ? Math.max(0, Math.round(100 - FACTOR_CRITICA * (100 - porcentaje))) : porcentaje,
      hallazgos: r.hallazgos,
    };
  });

  // Lo que no existe no se juzga: una planta sin medidores no esta mal por eso.
  const aplicables = revisiones.filter((r) => r.total > 0);
  const pesoTotal = aplicables.reduce((s, r) => s + r.peso, 0);
  const indice = pesoTotal === 0
    ? 0
    : Math.round(aplicables.reduce((s, r) => s + r.calificacion * r.peso, 0) / pesoTotal);

  const orden: Record<NivelRegla, number> = { ERROR: 0, ADVERTENCIA: 1, RECOMENDACION: 2 };
  return {
    indice,
    revisiones,
    huecos: aplicables
      .filter((r) => r.porcentaje < 100)
      .sort((a, b) => orden[a.nivel] - orden[b.nivel] || (b.peso * (100 - b.calificacion)) - (a.peso * (100 - a.calificacion))),
  };
}

/** Etiqueta y tono para pintar el indice. */
export function nivelSalud(indice: number) {
  if (indice >= 85) return { etiqueta: "Solida", tono: "success" as const };
  if (indice >= 65) return { etiqueta: "Aceptable", tono: "info" as const };
  if (indice >= 40) return { etiqueta: "Incompleta", tono: "warning" as const };
  return { etiqueta: "Crítica", tono: "danger" as const };
}
