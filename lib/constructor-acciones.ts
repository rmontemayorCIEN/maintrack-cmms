/**
 * Lo que el constructor de planes deja HACER, no solo mirar.
 *
 * Tres acciones, y las tres existen porque el trabajo que ahorran es el que
 * hace que la gente abandone a la mitad:
 *
 *  - **Aplicar el plan del grupo** al equipo que entro despues. Hoy eso es
 *    buscar el plan, abrir sus equipos y agregarlo; ahi se pierde, y el equipo
 *    se queda meses sin preventivo sin que nadie lo note.
 *  - **Clonar un plan** para el grupo parecido. No existia duplicar: armar el
 *    de los compresores GA-75 teniendo el de los GA-30 era volver a capturar
 *    seis actividades con sus refacciones y sus horas.
 *  - **Corregir el agrupado**: unir dos grupos que son uno, o separar un equipo
 *    que lleva su propio plan. El calculo no puede saberlo; la persona si.
 *
 * Nada de esto decide por nadie: cada accion la dispara alguien, sobre lo que
 * esta viendo, y queda en la bitacora.
 */
import { prisma } from "./db";
import { logAudit } from "./audit";
import { asignarPlan } from "./asignaciones";
import { constructorDePlanes } from "./constructor-planes";

export class ErrorDeAccion extends Error {
  constructor(mensaje: string, readonly codigo = 422) {
    super(mensaje);
    this.name = "ErrorDeAccion";
  }
}

/** Los equipos de un grupo que no tienen NINGUN plan. */
async function equiposSinPlanDelGrupo(organizationId: string, clave: string) {
  const c = await constructorDePlanes(organizationId);
  const grupo = c.grupos.find((g) => g.clave === clave);
  if (!grupo) throw new ErrorDeAccion("Ese grupo de equipos ya no existe.", 404);
  return { grupo, equipos: grupo.equipos.filter((e) => !e.conPlan) };
}

/**
 * Aplica un plan que ya cubre al grupo a los equipos iguales que se quedaron
 * sin ninguno.
 *
 * Las fechas se escalonan, como en la asignacion masiva: arrancar los cuatro
 * compresores el mismo martes es pedirle a una persona el trabajo de cuatro.
 */
export async function aplicarPlanDelGrupo(p: {
  organizationId: string;
  userId: string;
  planId: string;
  clave: string;
}) {
  const plan = await prisma.maintenancePlan.findFirst({
    where: { id: p.planId, organizationId: p.organizationId },
    select: { id: true, name: true },
  });
  if (!plan) throw new ErrorDeAccion("Plan no encontrado.", 404);

  const { equipos } = await equiposSinPlanDelGrupo(p.organizationId, p.clave);
  if (!equipos.length) throw new ErrorDeAccion("Todos los equipos de ese grupo ya tienen plan.");

  const r = await asignarPlan({
    organizationId: p.organizationId,
    planId: plan.id,
    equipos: equipos.map((e) => ({ assetId: e.id })),
    escalonarAuto: true,
    userId: p.userId,
  });

  await logAudit({
    organizationId: p.organizationId,
    userId: p.userId,
    entity: "MaintenancePlan",
    entityId: plan.id,
    action: "PLAN_APPLIED_TO_GROUP",
    summary: `«${plan.name}» se aplicó a ${equipos.length} equipo(s) iguales sin plan`,
    changes: { equipos: equipos.map((e) => e.code), sinMedidor: r.sinMedidor },
  });

  return { asignados: equipos.length, equipos: equipos.map((e) => e.code), sinMedidor: r.sinMedidor };
}

/**
 * Copia un plan con todo lo que cuelga de el: actividades, mano de obra,
 * refacciones, servicios y herramientas.
 *
 * Lo que NO se copia son las asignaciones ni el calendario: la copia nace sin
 * equipos, porque pegarle los del original seria duplicar el trabajo de todos
 * ellos. A que equipos aplica lo dice quien clona, en el mismo paso.
 */
export async function clonarPlan(p: {
  organizationId: string;
  userId: string;
  planId: string;
  nombre?: string | null;
  /** A quienes aplicarlo de una vez. Vacío: la copia nace sin equipos. */
  equipos?: string[];
}) {
  const original = await prisma.maintenancePlan.findFirst({
    where: { id: p.planId, organizationId: p.organizationId },
    include: {
      tasks: {
        orderBy: { position: "asc" },
        include: {
          labor: { select: { specialtyId: true, personas: true, hours: true } },
          parts: { select: { partId: true, quantity: true } },
          services: { select: { serviceId: true, quantity: true, nota: true } },
          tools: { select: { partId: true, assetId: true, kitId: true, cantidad: true, nota: true } },
        },
      },
    },
  });
  if (!original) throw new ErrorDeAccion("Plan no encontrado.", 404);

  const nombre = (p.nombre || `${original.name} (copia)`).trim().slice(0, 120);
  if (nombre.length < 3) throw new ErrorDeAccion("El nombre de la copia es muy corto.");

  const copia = await prisma.maintenancePlan.create({
    data: {
      organizationId: p.organizationId,
      name: nombre,
      description: original.description,
      categoryId: original.categoryId,
      assignedToId: original.assignedToId,
      teamId: original.teamId,
      maintenanceType: original.maintenanceType,
      triggerType: original.triggerType,
      intervalDays: original.intervalDays,
      intervalMeter: original.intervalMeter,
      leadTimeDays: original.leadTimeDays,
      toleranceDays: original.toleranceDays,
      priority: original.priority,
      estimatedHours: original.estimatedHours,
      requiresShutdown: original.requiresShutdown,
      procedure: original.procedure,
      safetyNotes: original.safetyNotes,
      active: true,
      tasks: {
        create: original.tasks.map((t) => ({
          position: t.position,
          title: t.title,
          description: t.description,
          taskType: t.taskType,
          cadaCuantas: t.cadaCuantas,
          cadaCuanto: t.cadaCuanto,
          unidadFrecuencia: t.unidadFrecuencia,
          // La confirmación de una actividad diaria NO se copia: es la firma de
          // una persona diciendo «sí, esto va todos los días», y la copia
          // todavía no tiene quien la firme.
          unit: t.unit,
          minValue: t.minValue,
          maxValue: t.maxValue,
          required: t.required,
          labor: { create: t.labor },
          parts: { create: t.parts },
          services: { create: t.services },
          tools: { create: t.tools },
        })),
      },
    },
    select: { id: true, name: true },
  });

  let asignados = 0;
  const sinMedidor: string[] = [];
  if (p.equipos?.length) {
    const r = await asignarPlan({
      organizationId: p.organizationId,
      planId: copia.id,
      equipos: p.equipos.map((assetId) => ({ assetId })),
      escalonarAuto: true,
      userId: p.userId,
    });
    asignados = p.equipos.length;
    sinMedidor.push(...r.sinMedidor);
  }

  await logAudit({
    organizationId: p.organizationId,
    userId: p.userId,
    entity: "MaintenancePlan",
    entityId: copia.id,
    action: "PLAN_CLONED",
    summary: `«${copia.name}» se copió de «${original.name}»`,
    changes: { origen: original.id, actividades: original.tasks.length, equipos: asignados },
  });

  return { plan: copia, actividades: original.tasks.length, asignados, sinMedidor };
}

/**
 * Mueve equipos de un grupo a otro, o los deja aparte.
 *
 * `destino` es la clave del grupo al que van. `null` deshace la corrección y
 * devuelve esos equipos a lo que diga el cálculo.
 */
export async function corregirGrupo(p: {
  organizationId: string;
  userId: string;
  equipos: string[];
  destino: string | null;
}) {
  if (!p.equipos.length) throw new ErrorDeAccion("Elija al menos un equipo.");
  const propios = await prisma.asset.findMany({
    where: { id: { in: p.equipos }, organizationId: p.organizationId },
    select: { id: true, code: true },
  });
  if (propios.length !== new Set(p.equipos).size) {
    throw new ErrorDeAccion("Alguno de los equipos no existe en su catálogo.", 404);
  }

  if (p.destino === null) {
    await prisma.grupoDeEquipo.deleteMany({ where: { organizationId: p.organizationId, assetId: { in: propios.map((a) => a.id) } } });
  } else {
    const clave = p.destino.trim().slice(0, 200);
    if (!clave) throw new ErrorDeAccion("El grupo de destino no es válido.");
    for (const a of propios) {
      await prisma.grupoDeEquipo.upsert({
        where: { assetId: a.id },
        create: { organizationId: p.organizationId, assetId: a.id, clave, movidoPorId: p.userId },
        update: { clave, movidoPorId: p.userId, movidoEl: new Date() },
      });
    }
  }

  await logAudit({
    organizationId: p.organizationId,
    userId: p.userId,
    entity: "Asset",
    entityId: propios[0].id,
    action: "ASSET_GROUP_CHANGED",
    summary: p.destino === null
      ? `${propios.length} equipo(s) vuelven al agrupado calculado`
      : `${propios.length} equipo(s) se movieron de grupo a mano`,
    changes: { equipos: propios.map((a) => a.code), destino: p.destino },
  });

  return constructorDePlanes(p.organizationId);
}

/** La clave que hace que un equipo quede en su propio grupo. */
export function claveAparte(assetId: string): string {
  return `aparte:${assetId}`;
}
