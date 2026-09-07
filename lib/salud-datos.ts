import { prisma } from "./db";

/**
 * Indice de salud de datos.
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
 * Cada revision pesa distinto: que una orden correctiva no tenga causa raiz
 * duele mas que que un activo no tenga costo de reemplazo.
 */

export type Revision = {
  clave: string;
  titulo: string;
  /** Por que importa, en una frase, para mostrarlo junto al numero. */
  porque: string;
  total: number;
  cumplidos: number;
  porcentaje: number;
  peso: number;
  enlace: string;
};

export type SaludDatos = {
  indice: number;
  revisiones: Revision[];
  /** Las que mas restan, ya ordenadas: por ahi se empieza. */
  huecos: Revision[];
};

function revision(
  clave: string, titulo: string, porque: string, enlace: string,
  peso: number, total: number, cumplidos: number,
): Revision {
  return {
    clave, titulo, porque, enlace, peso, total, cumplidos,
    porcentaje: total === 0 ? 100 : Math.round((cumplidos / total) * 100),
  };
}

export async function saludDeDatos(organizationId: string): Promise<SaludDatos> {
  const cerradas = { organizationId, status: { in: ["COMPLETED", "CLOSED"] } };
  const correctivasCerradas = { ...cerradas, maintenanceType: "CORRECTIVE" };

  const [
    activos, activosConPlan, activosUbicados, activosConValor,
    otCerradas, otConCausa, otConHoras,
    correctivas, correctivasConFalla,
    refacciones, refaccionesConMinimo, refaccionesConCosto,
    planes, planesConRecursos,
    medidores, medidoresAlDia,
  ] = await Promise.all([
    prisma.asset.count({ where: { organizationId, active: true } }),
    prisma.asset.count({ where: { organizationId, active: true, plans: { some: {} } } }),
    prisma.asset.count({ where: { organizationId, active: true, locationId: { not: null } } }),
    prisma.asset.count({ where: { organizationId, active: true, replacementCost: { gt: 0 } } }),

    prisma.workOrder.count({ where: cerradas }),
    prisma.workOrder.count({ where: { ...cerradas, rootCauseId: { not: null } } }),
    prisma.workOrder.count({ where: { ...cerradas, labor: { some: {} } } }),

    prisma.workOrder.count({ where: correctivasCerradas }),
    prisma.workOrder.count({ where: { ...correctivasCerradas, failureCodeId: { not: null } } }),

    prisma.part.count({ where: { organizationId, active: true } }),
    prisma.part.count({ where: { organizationId, active: true, minQuantity: { gt: 0 } } }),
    prisma.part.count({ where: { organizationId, active: true, unitCost: { gt: 0 } } }),

    prisma.maintenancePlan.count({ where: { organizationId, active: true } }),
    prisma.maintenancePlan.count({
      where: { organizationId, active: true, tasks: { some: { labor: { some: {} } } } },
    }),

    prisma.meter.count({ where: { organizationId } }),
    prisma.meter.count({
      where: { organizationId, readings: { some: { readingAt: { gte: new Date(Date.now() - 45 * 86_400_000) } } } },
    }),
  ]);

  const revisiones: Revision[] = [
    revision("activos-con-plan", "Activos con plan de mantenimiento",
      "Un activo sin plan solo genera trabajo correctivo: nunca se adelanta a la falla.",
      "/plans", 3, activos, activosConPlan),

    revision("ot-con-causa", "Órdenes cerradas con causa raiz",
      "Sin causa raiz no hay analisis de fallas: se repara lo mismo una y otra vez.",
      "/work-orders", 3, otCerradas, otConCausa),

    revision("ot-con-horas", "Órdenes cerradas con horas registradas",
      "Sin horas no hay costo de mano de obra ni productividad medible.",
      "/work-orders", 2, otCerradas, otConHoras),

    revision("correctivas-con-falla", "Correctivas con código de falla",
      "Es lo que permite ver que modo de falla domina en la planta.",
      "/work-orders", 2, correctivas, correctivasConFalla),

    revision("planes-con-recursos", "Planes con recursos capturados",
      "Sin mano de obra ni refacciones estimadas, el plan no se puede presupuestar ni preparar.",
      "/plans", 2, planes, planesConRecursos),

    revision("refacciones-con-minimo", "Refacciones con mínimo definido",
      "El mínimo es lo que dispara la alerta de reposición. En cero, nunca avisa.",
      "/inventory", 2, refacciones, refaccionesConMinimo),

    revision("refacciones-con-costo", "Refacciones con costo unitario",
      "Sin costo, el consumo de almacén no llega al costo de la orden.",
      "/inventory", 1, refacciones, refaccionesConCosto),

    revision("activos-ubicados", "Activos con ubicación precisa",
      "Es como se filtra el trabajo por área y como se encuentra el equipo en piso.",
      "/assets", 1, activos, activosUbicados),

    revision("activos-con-valor", "Activos con costo de reemplazo",
      "Permite comparar lo gastado contra reponer el equipo: la decision de reemplazo.",
      "/assets", 1, activos, activosConValor),

    revision("medidores-al-dia", "Medidores con lectura reciente",
      "Un medidor sin lecturas deja de disparar los planes que dependen de el.",
      "/meters", 1, medidores, medidoresAlDia),
  ];

  // Lo que no existe no se juzga: una planta sin medidores no esta mal por eso.
  const aplicables = revisiones.filter((r) => r.total > 0);
  const pesoTotal = aplicables.reduce((s, r) => s + r.peso, 0);
  const indice = pesoTotal === 0
    ? 0
    : Math.round(aplicables.reduce((s, r) => s + r.porcentaje * r.peso, 0) / pesoTotal);

  return {
    indice,
    revisiones,
    huecos: aplicables
      .filter((r) => r.porcentaje < 100)
      .sort((a, b) => (b.peso * (100 - b.porcentaje)) - (a.peso * (100 - a.porcentaje))),
  };
}

/** Etiqueta y tono para pintar el indice. */
export function nivelSalud(indice: number) {
  if (indice >= 85) return { etiqueta: "Solida", tono: "success" as const };
  if (indice >= 65) return { etiqueta: "Aceptable", tono: "info" as const };
  if (indice >= 40) return { etiqueta: "Incompleta", tono: "warning" as const };
  return { etiqueta: "Crítica", tono: "danger" as const };
}
