/**
 * Los procesos programados de avisos.
 *
 *  - `ejecutarProgramador`: corre el generador de preventivos de UNA empresa
 *    y avisa si falla (PLAN_FALLO_GENERAR) o si un plan no tiene con qué
 *    programarse (PLAN_SIN_PROGRAMACION). Antes, una excepción tiraba la
 *    corrida de todas las empresas y nadie se enteraba.
 *  - `correrAvisos`: detectores, escalamientos, resúmenes y la cola de
 *    entregas. Cada empresa por separado: si una falla, las demás siguen.
 */
import { createHash } from "node:crypto";
import { prisma } from "../db";
import { generateScheduledWorkOrders } from "../scheduler";
import { configDe } from "./config";
import { detectar } from "./detectores";
import { procesarEscalamientos } from "./escalamiento";
import { enviarResumenes } from "./resumenes";
import { procesarEntregas } from "./entrega";
import { atenderAvisos, emitirAviso } from "./emitir";
import { limpiarLimites } from "../integraciones/limites";

const SIN_PROGRAMACION = /sin regla|no tiene medidor|no tiene intervalo/i;
const idDePlan = (organizationId: string, plan: string) => `plan:${createHash("sha1").update(`${organizationId}|${plan}`).digest("hex").slice(0, 16)}`;

export async function ejecutarProgramador(
  organizationId: string,
  opciones: { generar?: typeof generateScheduledWorkOrders } = {},
) {
  const generar = opciones.generar ?? generateScheduledWorkOrders;
  try {
    const r = await generar(organizationId, { horizonDays: 0 });
    await atenderAvisos({ organizationId, entidadId: `${organizationId}:programador`, tipos: ["PLAN_FALLO_GENERAR"], motivo: "el programador volvió a correr bien" });

    // Planes que no pueden programarse, con el motivo que da el propio programador.
    const sinRegla = r.details.filter((d) => d.reason && SIN_PROGRAMACION.test(d.reason));
    const vigentes = new Set<string>();
    for (const d of sinRegla) {
      const id = idDePlan(organizationId, `${d.plan}|${d.reason}`);
      vigentes.add(id);
      await emitirAviso({
        organizationId, tipo: "PLAN_SIN_PROGRAMACION", entidad: "MaintenancePlan", entidadId: id,
        titulo: `Plan sin programación válida: ${d.plan}`, cuerpo: d.reason,
        porQue: "Se ve en la lista de planes pero nunca va a generar una orden.",
        accion: "Corrija su frecuencia o asígnele el medidor.", enlace: "/plans",
      });
    }
    const abiertos = await prisma.notification.findMany({
      where: { organizationId, tipo: "PLAN_SIN_PROGRAMACION", atendidaEl: null }, select: { entidadId: true },
    });
    for (const n of abiertos) {
      if (n.entidadId && !vigentes.has(n.entidadId)) {
        await atenderAvisos({ organizationId, entidadId: n.entidadId, tipos: ["PLAN_SIN_PROGRAMACION"], motivo: "el plan ya se puede programar" });
      }
    }
    return { ok: true as const, generadas: r.generated, omitidas: r.skipped, sinProgramacion: sinRegla.length };
  } catch (e) {
    const detalle = e instanceof Error ? e.message.slice(0, 160) : "error desconocido";
    await emitirAviso({
      organizationId, tipo: "PLAN_FALLO_GENERAR", entidad: "Organization", entidadId: `${organizationId}:programador`,
      version: new Date().toISOString().slice(0, 10),
      titulo: "No se pudieron generar las órdenes preventivas",
      cuerpo: `El programador falló: ${detalle}`,
      porQue: "Los preventivos que tocaban no tienen orden: si nadie lo nota, se incumplen.",
      accion: "Revise los planes y, si persiste, avise a soporte. Mientras tanto, arme las órdenes desde el armador.",
      enlace: "/work-orders/armar",
    });
    return { ok: false as const, error: detalle };
  }
}

export async function correrAvisos(opciones: { ahora?: Date; organizationId?: string } = {}) {
  const ahora = opciones.ahora ?? new Date();
  const orgs = await prisma.organization.findMany({
    where: { status: { in: ["ACTIVE", "TRIAL"] }, ...(opciones.organizationId ? { id: opciones.organizationId } : {}) },
    select: { id: true, name: true },
  });
  const resumen: Array<Record<string, unknown>> = [];
  for (const org of orgs) {
    try {
      const cfg = await configDe(org.id, ahora);
      const d = await detectar(org.id, cfg, ahora);
      const e = await procesarEscalamientos(org.id, cfg, ahora);
      const r = await enviarResumenes(org.id, cfg, ahora);
      const movio = Object.keys(d).length || e.recordatorios || e.escalados || r.diarios || r.semanales;
      if (movio) resumen.push({ organizacion: org.name, detectados: d, escalamiento: e, resumenes: r });
    } catch (err) {
      // Una empresa con problemas no detiene a las demás; queda en los logs.
      console.error(`[avisos] ${org.name}:`, err instanceof Error ? err.message : err);
      resumen.push({ organizacion: org.name, error: err instanceof Error ? err.message.slice(0, 160) : "error" });
    }
  }
  const entregas = await procesarEntregas({ ahora, organizationId: opciones.organizationId });
  await limpiarLimites(ahora);
  // Las claves de idempotencia sirven para repeticiones cercanas: una semana basta.
  await prisma.claveIdempotencia.deleteMany({ where: { createdAt: { lt: new Date(ahora.getTime() - 7 * 86_400_000) } } });
  return { empresas: orgs.length, resumen, entregas };
}
