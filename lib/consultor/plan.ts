import type { PasoPlan } from "@/consultor/tipos";
import { prisma } from "../db";
import { puestaEnMarcha, type Paso, type PuestaEnMarcha } from "../puesta-en-marcha";
import { puedeVerRuta } from "../pantallas";

/**
 * El plan de implementacion de Maintrack para el Consultor del Sistema.
 *
 * El arranque NO se reinventa: es la puesta en marcha (`lib/puesta-en-marcha.ts`),
 * paso por paso y con su mismo porcentaje. Un criterio, un lugar: si el
 * Consultor calculara su propio avance, el dueño veria dos numeros distintos
 * para la misma pregunta y ninguno serviria.
 *
 * Lo que la puesta en marcha no cubre es lo que viene despues de «comenzar a
 * operar»: que el sistema de verdad se use. Son tres hechos de la base, sin
 * peso en el porcentaje, que aparecen solo a quien puede abrir su pantalla.
 */

/** La puesta en marcha, en el idioma del Consultor. Puro: lo prueba scripts/prueba-consultor.ts. */
export function pasoDeArranque(p: Paso): PasoPlan {
  const conAvance = (p.progreso?.hecho ?? 0) > 0;
  const estado: PasoPlan["estado"] =
    p.estado === "COMPLETO" ? "HECHO"
      : p.estado === "OPCIONAL" || p.estado === "NO_APLICA" ? "NO_APLICA"
        : p.estado === "CORREGIR" || conAvance ? "EN_PROCESO"
          : "FALTA";
  return {
    clave: p.clave,
    titulo: p.titulo,
    que: p.que,
    porQue: p.porQue,
    estado,
    falta: estado === "HECHO" || estado === "NO_APLICA" ? "" : p.falta || p.problemas.slice(0, 2).join(" "),
    progreso: p.progreso,
    enlace: p.enlace,
    textoEnlace: p.textoEnlace,
    etapa: "ARRANQUE",
    peso: p.peso,
    // La puesta en marcha es pantalla de la administracion.
    soloAdmin: true,
  };
}

export type HechosOperacion = { ordenesCerradas: number; preventivasGeneradas: number; solicitudes: number };

/** Los pasos de despues del arranque. Cuentan desde que la empresa empezo a operar. */
export function pasosDeOperacion(h: HechosOperacion, operando: boolean): PasoPlan[] {
  const paso = (x: Omit<PasoPlan, "etapa" | "peso" | "progreso" | "despuesDe" | "estado" | "falta"> & { hecho: boolean; falta: string }): PasoPlan => ({
    clave: x.clave, titulo: x.titulo, que: x.que, porQue: x.porQue, enlace: x.enlace, textoEnlace: x.textoEnlace,
    etapa: "OPERACION", peso: 0, progreso: null, despuesDe: ["validacion"],
    estado: x.hecho ? "HECHO" : "FALTA",
    falta: x.hecho ? "" : operando ? x.falta : "Primero hay que declarar que la empresa empieza a operar",
  });
  return [
    paso({
      clave: "primera-orden", titulo: "Cierre su primera orden en el sistema",
      que: "Una orden de trabajo hecha de punta a punta: asignada, ejecutada y completada aquí.",
      porQue: "Mientras el trabajo se siga anotando en papel, los indicadores y el historial de cada equipo se quedan vacíos.",
      enlace: "/work-orders", textoEnlace: "Abrir órdenes de trabajo",
      hecho: operando && h.ordenesCerradas > 0, falta: "Todavía no hay órdenes completadas desde que empezó a operar",
    }),
    paso({
      clave: "preventivo", titulo: "Deje que el preventivo genere sus órdenes",
      que: "Los planes generan solos las órdenes cuando les toca.",
      porQue: "Es la prueba de que los planes quedaron bien armados: un plan que nunca genera una orden no protege a ningún equipo.",
      enlace: "/plans", textoEnlace: "Abrir planes preventivos",
      hecho: operando && h.preventivasGeneradas > 0, falta: "Ningún plan ha generado una orden todavía",
    }),
    paso({
      clave: "solicitudes", titulo: "Reciba la primera solicitud de mantenimiento",
      que: "Quien detecta una falla la reporta en el sistema, no por teléfono ni de pasillo.",
      porQue: "Lo que no se reporta aquí no se puede priorizar ni medir.",
      enlace: "/requests", textoEnlace: "Abrir solicitudes",
      hecho: operando && h.solicitudes > 0, falta: "Todavía no llega ninguna solicitud",
    }),
  ];
}

export type PlanConsultor = { pasos: PasoPlan[]; porcentaje: number; marcha: PuestaEnMarcha };

/** El plan de una persona: la puesta en marcha mas lo de operacion que su rol puede abrir. */
export async function planDe(organizationId: string, rol: string, opciones: { esSuperAdmin?: boolean } = {}): Promise<PlanConsultor> {
  const marcha = await puestaEnMarcha(organizationId);
  const desde = marcha.operandoDesde ?? undefined;
  const [ordenesCerradas, preventivasGeneradas, solicitudes] = desde
    ? await Promise.all([
      prisma.workOrder.count({ where: { organizationId, status: { in: ["COMPLETED", "CLOSED"] }, completedAt: { gte: desde } } }),
      prisma.workOrder.count({ where: { organizationId, planId: { not: null }, createdAt: { gte: desde } } }),
      prisma.workRequest.count({ where: { organizationId, createdAt: { gte: desde } } }),
    ])
    : [0, 0, 0];
  const operacion = pasosDeOperacion({ ordenesCerradas, preventivasGeneradas, solicitudes }, Boolean(desde))
    // Un paso nunca manda a una pantalla que la persona no puede abrir.
    .filter((p) => puedeVerRuta(rol, p.enlace, { esSuperAdmin: opciones.esSuperAdmin }));
  return { pasos: [...marcha.pasos.map(pasoDeArranque), ...operacion], porcentaje: marcha.porcentaje, marcha };
}
