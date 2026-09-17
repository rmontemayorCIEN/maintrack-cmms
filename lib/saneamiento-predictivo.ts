/**
 * Saneamiento de fechas predictivas historicas incoherentes.
 *
 * Antes de la logica actual se guardaba en la alerta una sola fecha
 * (`projectedFailureAt`) calculada al detectar, y podia quedar ANTERIOR a la
 * propia deteccion: CNC-201 se detecto el 29-ago con fecha 22-jul. La pantalla
 * ya la ignora (muestra «Umbral critico superado» desde la evaluacion viva),
 * pero el valor invalido seguia guardado y la calidad de datos lo reportaba.
 *
 * Reglas:
 *  - Solo toca fechas ANTERIORES a la deteccion de su alerta. Una fecha
 *    posterior a la deteccion es un dato valido de su momento y no se modifica
 *    (si ya paso, las pantallas la leen como «Proyeccion vencida»).
 *  - Si el punto esta hoy sobre el umbral de esa fecha, o la alerta ya esta
 *    cerrada, la fecha se limpia: una fecha futura ya no tiene sentido.
 *  - Si esta abierta y el punto no ha cruzado, se recalcula con la evaluacion
 *    actual; si no hay proyeccion valida, se limpia.
 *  - Nunca borra alertas ni lecturas. Cada cambio deja bitacora con valor
 *    anterior, valor corregido, motivo, fecha y proceso responsable.
 *  - Idempotente: despues de aplicarlo no queda ninguna fecha anterior a la
 *    deteccion, asi que una segunda corrida no encuentra nada.
 */
import { prisma } from "./db";
import { logAudit } from "./audit";
import { evaluarPuntos } from "./predictive";

export const PROCESO_SANEAMIENTO = "scripts/sanear-fechas-predictivas.ts";

type Campo = "projectedFailureAt" | "fechaCruceCritico" | "fechaCruceAdvertencia";
const CAMPOS: Campo[] = ["projectedFailureAt", "fechaCruceCritico", "fechaCruceAdvertencia"];

export type CambioPredictivo = {
  alertaId: string;
  titulo: string;
  estado: string;
  detectadaEl: Date;
  campo: Campo;
  antes: Date;
  despues: Date | null;
  motivo: string;
};

export async function planearSaneamiento(organizationId: string, ahora = new Date()): Promise<CambioPredictivo[]> {
  const alertas = await prisma.predictiveAlert.findMany({
    where: {
      organizationId,
      OR: CAMPOS.map((c) => ({ [c]: { not: null } })),
    },
    select: {
      id: true, title: true, status: true, createdAt: true, sensorId: true,
      projectedFailureAt: true, fechaCruceCritico: true, fechaCruceAdvertencia: true,
    },
  });
  const invalidas = alertas.filter((a) => CAMPOS.some((c) => a[c] && (a[c] as Date) < a.createdAt));
  if (!invalidas.length) return [];

  const abiertas = invalidas.filter((a) => ["OPEN", "ACKNOWLEDGED"].includes(a.status) && a.sensorId);
  const vivas = await evaluarPuntos(organizationId, abiertas.map((a) => a.sensorId as string), ahora);

  const cambios: CambioPredictivo[] = [];
  for (const a of invalidas) {
    const abierta = ["OPEN", "ACKNOWLEDGED"].includes(a.status);
    const e = a.sensorId ? vivas.get(a.sensorId) : undefined;
    for (const campo of CAMPOS) {
      const valor = a[campo];
      if (!valor || valor >= a.createdAt) continue;
      const cruce = campo === "fechaCruceAdvertencia" ? e?.cruceAdvertencia : e?.cruceCritico;
      let despues: Date | null = null;
      let motivo: string;
      if (!abierta) {
        motivo = "Fecha proyectada anterior a la detección en una alerta cerrada: se limpia, no hay proyección vigente que recalcular.";
      } else if (!e) {
        motivo = "Fecha proyectada anterior a la detección y sin lecturas para recalcular: se limpia.";
      } else if (cruce?.razon === "UMBRAL_SUPERADO") {
        motivo = `Fecha proyectada anterior a la detección y el umbral ya está superado (${e.etiquetaEstado}): una fecha futura no tiene sentido; se limpia.`;
      } else if (cruce?.fecha) {
        despues = cruce.fecha;
        motivo = `Fecha proyectada anterior a la detección: recalculada con la tendencia actual (${e.etiquetaTendencia.toLowerCase()}, ${e.etiquetaConfianza.toLowerCase()}).`;
      } else {
        motivo = `Fecha proyectada anterior a la detección y sin proyección válida hoy (${cruce?.texto ?? "sin datos"}): se limpia.`;
      }
      cambios.push({ alertaId: a.id, titulo: a.title, estado: a.status, detectadaEl: a.createdAt, campo, antes: valor, despues, motivo });
    }
  }
  return cambios;
}

/** Aplica los cambios planeados, uno por uno, con bitacora. Revalida cada campo antes de escribir. */
export async function aplicarSaneamiento(organizationId: string, cambios: CambioPredictivo[], ahora = new Date()) {
  let aplicados = 0;
  for (const c of cambios) {
    const actual = await prisma.predictiveAlert.findFirst({
      where: { id: c.alertaId, organizationId },
      select: { createdAt: true, projectedFailureAt: true, fechaCruceCritico: true, fechaCruceAdvertencia: true },
    });
    const valor: Date | null = actual ? actual[c.campo] : null;
    // Si entre el ensayo y la aplicacion alguien ya lo corrigio, no se toca.
    if (!actual || !valor || valor.getTime() !== c.antes.getTime() || valor.getTime() >= actual.createdAt.getTime()) continue;
    await prisma.predictiveAlert.update({ where: { id: c.alertaId }, data: { [c.campo]: c.despues } });
    await logAudit({
      organizationId,
      userId: null,
      entity: "PredictiveAlert",
      entityId: c.alertaId,
      action: "FECHA_PREDICTIVA_SANEADA",
      summary: `${c.titulo}: ${c.campo} ${c.antes.toISOString()} → ${c.despues ? c.despues.toISOString() : "vacía"}. ${c.motivo}`,
      changes: {
        campo: c.campo,
        valorAnterior: c.antes.toISOString(),
        valorCorregido: c.despues ? c.despues.toISOString() : null,
        motivo: c.motivo,
        corregidoEl: ahora.toISOString(),
        proceso: PROCESO_SANEAMIENTO,
      },
    });
    aplicados += 1;
  }
  return aplicados;
}
