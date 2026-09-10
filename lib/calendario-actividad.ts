/**
 * El calendario de cada actividad en cada equipo.
 *
 * Hasta hoy el calendario vivia en la asignacion: una sola fecha para todo el
 * plan, y las actividades entraban por multiplos de una cadencia base. Eso se
 * cae en cuanto las frecuencias no se dividen entre si —con una actividad
 * semanal y una mensual la base se colapsa a un dia y el programador da 365
 * vueltas al ano de las que 302 no producen nada— y ademas no puede expresar
 * lo que pasa a diario en una planta: que el aceite se cambio fuera de ciclo
 * porque la maquina ya estaba abierta, y solo ESE reloj debe moverse.
 *
 * Aqui cada actividad lleva su propia fecha. Las que caen cerca se juntan en
 * una sola orden al armarla, con la ventana que ya configura la organizacion
 * —`otHorizonteDias`—, en vez de deducirlo de una aritmetica.
 */
import { prisma } from "./db";
import { jornada } from "./agenda";
import { siguienteFecha, type ReglaCalendario, type Unidad } from "./calendario";
import { startOfDay } from "./utils";

/** El reloj de una actividad, sin la base de datos de por medio. */
export type RelojActividad = {
  cadaCuanto: number | null;
  unidadFrecuencia: Unidad;
  /** Dias del plan, para actividades que todavia no traen su propia frecuencia. */
  respaldoDias?: number | null;
  arranqueEl: Date | null;
  arranqueEsUltima: boolean;
  ultimaEl: Date | null;
  proximaEl: Date | null;
};

/**
 * Los dias que valia una actividad ANTES del calendario por actividad.
 *
 * La frecuencia vivia como un MULTIPLO de la cadencia base del plan: multiplo
 * 3 en un plan de 30 dias significaba cada 90. Caer al `intervalDays` pelado
 * la volveria de 30 —tres veces mas seguido— en cualquier plan que todavia no
 * se haya traducido, y nadie lo notaria hasta ver ordenes de mas.
 *
 * Con multiplo 1 —el valor por omision y el de casi todos— da exactamente el
 * intervalo del plan, que es lo de siempre.
 */
export function respaldoEnDias(
  cadaCuantas: number | null | undefined,
  intervalDays: number | null | undefined,
): number | null {
  if (!intervalDays || intervalDays < 1) return null;
  return Math.max(cadaCuantas ?? 1, 1) * intervalDays;
}

/**
 * Cuando toca la proxima vez.
 *
 * Los tres casos, en orden:
 *
 * 1. **Nunca se ha hecho y se declaro "arranca el dia X".** Esa fecha ES la
 *    primera vez que toca. No se le suma el intervalo: sumarselo correria la
 *    actividad un ciclo completo, en silencio, que es justo el defecto que
 *    esta distincion existe para evitar.
 * 2. **Nunca se ha hecho y se declaro "la ultima vez fue el dia X".** Se cuenta
 *    un intervalo desde ahi.
 * 3. **Ya hay historial.** Se cuenta desde donde diga la organizacion:
 *    `CIERRE` desde que se hizo de verdad, `PROGRAMADO` desde la fecha en que
 *    tocaba, para que el calendario no se desplace.
 *
 * Devuelve nulo cuando la actividad no se puede programar —sin frecuencia o
 * sin punto de partida—. Quien llama tiene que DECIR que quedo sin programar,
 * no dejarla callada: una actividad que nunca genera se ve igual que una que
 * todavia no toca.
 */
export function proximaDe(
  reloj: RelojActividad,
  regla: ReglaCalendario,
  opciones: { desdeProgramado: boolean },
): Date | null {
  const cada = reloj.cadaCuanto ?? reloj.respaldoDias ?? null;
  const unidad: Unidad = reloj.cadaCuanto ? reloj.unidadFrecuencia : "DIAS";
  if (!cada || cada < 1) return null;

  if (!reloj.ultimaEl) {
    if (!reloj.arranqueEl) return null;
    if (!reloj.arranqueEsUltima) return startOfDay(reloj.arranqueEl);
    return siguienteFecha(reloj.arranqueEl, cada, unidad, regla, reloj.arranqueEl.getDate());
  }

  const { desdeProgramado } = opciones;
  const ancla = desdeProgramado ? (reloj.proximaEl ?? reloj.ultimaEl) : reloj.ultimaEl;

  /**
   * A que dia del mes esta anclada la actividad.
   *
   * Solo importa para intervalos en meses, y las dos opciones de recalculo le
   * dan respuestas distintas a proposito. Con CIERRE el ancla es el dia en que
   * de verdad se hizo: el calendario sigue a la realidad. Con PROGRAMADO es el
   * dia del arranque declarado, para que un cierre tardio no mueva el dia del
   * mes para siempre.
   */
  const dia = desdeProgramado
    ? (reloj.arranqueEl?.getDate() ?? ancla.getDate())
    : reloj.ultimaEl.getDate();

  let siguiente = siguienteFecha(ancla, cada, unidad, regla, dia);

  // Con PROGRAMADO y un cierre muy tardio la siguiente fecha puede nacer en el
  // pasado. Se adelanta hasta la primera que no ha ocurrido, en vez de dejar
  // un vencimiento que nace vencido y dispara una orden de inmediato.
  let guarda = 0;
  while (desdeProgramado && siguiente <= reloj.ultimaEl && guarda < 400) {
    siguiente = siguienteFecha(siguiente, cada, unidad, regla, dia);
    guarda += 1;
  }
  return siguiente;
}

/**
 * Como cuenta los dias esta organizacion, y desde donde recalcula.
 *
 * Se lee una vez por barrido y se pasa hacia abajo. La jornada se pide con
 * margen largo hacia adelante porque una actividad anual proyectada varias
 * vueltas puede salirse del ano en curso, y sin los festivos de ese tramo la
 * cuenta de dias habiles cambiaria a media proyeccion.
 */
export async function reglaDeOrganizacion(
  organizationId: string,
  desde: Date = new Date(),
): Promise<ReglaCalendario & { desdeProgramado: boolean; horizonteDias: number }> {
  const [org, j] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { otDiasHabiles: true, recalculoPlan: true, otHorizonteDias: true },
    }),
    jornada(organizationId, desde, new Date(desde.getFullYear() + 3, desde.getMonth(), 1)),
  ]);
  return {
    habiles: org?.otDiasHabiles ?? false,
    jornada: j,
    desdeProgramado: org?.recalculoPlan === "PROGRAMADO",
    horizonteDias: org?.otHorizonteDias ?? 15,
  };
}

/**
 * Crea los relojes que falten para un plan en un equipo, y calcula su fecha.
 *
 * Se llama al asignar un plan y al cambiar sus actividades. Es idempotente: no
 * pisa el arranque que alguien ya declaro ni la historia que ya se acumulo, de
 * modo que agregar una actividad a un plan de seis compresores no reinicia los
 * calendarios de las otras.
 *
 * `arranquePorOmision` es lo que se aplica a las actividades que no traen una
 * fecha propia. NUNCA se deja en nulo: un reloj sin punto de partida no se
 * programa jamas y no avisa, que es la peor clase de defecto de este proyecto.
 */
export async function sembrarCalendario(p: {
  organizationId: string;
  planId: string;
  assetId: string;
  arranquePorOmision: { fecha: Date; esUltima: boolean };
  /** Fechas distintas para actividades puntuales, por id de actividad. */
  arranques?: Map<string, { fecha: Date; esUltima: boolean }>;
}): Promise<{ creados: number; sinFrecuencia: string[] }> {
  const plan = await prisma.maintenancePlan.findFirst({
    where: { id: p.planId, organizationId: p.organizationId },
    select: {
      intervalDays: true,
      tasks: {
        orderBy: { position: "asc" },
        select: {
          id: true, title: true, cadaCuanto: true, unidadFrecuencia: true, cadaCuantas: true,
        },
      },
    },
  });
  if (!plan) return { creados: 0, sinFrecuencia: [] };

  const regla = await reglaDeOrganizacion(p.organizationId);
  const existentes = await prisma.planTaskAsset.findMany({
    where: { assetId: p.assetId, planTaskId: { in: plan.tasks.map((t) => t.id) } },
    select: { planTaskId: true },
  });
  const yaHay = new Set(existentes.map((e) => e.planTaskId));

  let creados = 0;
  const sinFrecuencia: string[] = [];

  for (const tarea of plan.tasks) {
    if (yaHay.has(tarea.id)) continue;
    const arranque = p.arranques?.get(tarea.id) ?? p.arranquePorOmision;
    const proxima = proximaDe(
      {
        cadaCuanto: tarea.cadaCuanto,
        unidadFrecuencia: (tarea.unidadFrecuencia as Unidad) ?? "DIAS",
        respaldoDias: respaldoEnDias(tarea.cadaCuantas, plan.intervalDays),
        arranqueEl: arranque.fecha,
        arranqueEsUltima: arranque.esUltima,
        ultimaEl: null,
        proximaEl: null,
      },
      regla,
      { desdeProgramado: regla.desdeProgramado },
    );
    if (!proxima) sinFrecuencia.push(tarea.title);

    await prisma.planTaskAsset.create({
      data: {
        organizationId: p.organizationId,
        planTaskId: tarea.id,
        assetId: p.assetId,
        arranqueEl: startOfDay(arranque.fecha),
        arranqueEsUltima: arranque.esUltima,
        proximaEl: proxima ? startOfDay(proxima) : null,
      },
    });
    creados += 1;
  }

  return { creados, sinFrecuencia };
}

/**
 * Avanza el reloj de UNA actividad porque se acaba de hacer.
 *
 * Solo el de ella. Es la razon de ser de todo este cambio: si el aceite se
 * cambio fuera de ciclo, las bujias siguen debiendose para cuando les tocaba.
 */
export async function avanzarActividad(p: {
  organizationId: string;
  planTaskId: string;
  assetId: string;
  completadaEl: Date;
  regla?: ReglaCalendario & { desdeProgramado: boolean };
}): Promise<Date | null> {
  const reloj = await prisma.planTaskAsset.findUnique({
    where: { planTaskId_assetId: { planTaskId: p.planTaskId, assetId: p.assetId } },
    select: {
      id: true,
      arranqueEl: true,
      arranqueEsUltima: true,
      proximaEl: true,
      planTask: {
        select: {
          cadaCuanto: true, unidadFrecuencia: true, cadaCuantas: true,
          plan: { select: { intervalDays: true } },
        },
      },
    },
  });
  if (!reloj) return null;

  const regla = p.regla ?? (await reglaDeOrganizacion(p.organizationId));
  const proxima = proximaDe(
    {
      cadaCuanto: reloj.planTask.cadaCuanto,
      unidadFrecuencia: (reloj.planTask.unidadFrecuencia as Unidad) ?? "DIAS",
      respaldoDias: respaldoEnDias(reloj.planTask.cadaCuantas, reloj.planTask.plan.intervalDays),
      arranqueEl: reloj.arranqueEl,
      arranqueEsUltima: reloj.arranqueEsUltima,
      ultimaEl: p.completadaEl,
      proximaEl: reloj.proximaEl,
    },
    regla,
    { desdeProgramado: regla.desdeProgramado },
  );

  await prisma.planTaskAsset.update({
    where: { id: reloj.id },
    data: { ultimaEl: p.completadaEl, proximaEl: proxima ? startOfDay(proxima) : null },
  });
  return proxima;
}

export type ActividadPendiente = {
  planTaskId: string;
  planId: string;
  planNombre: string;
  maintenanceType: string;
  priority: string;
  assetId: string;
  assetCode: string;
  assetNombre: string;
  titulo: string;
  descripcion: string | null;
  taskType: string;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  required: boolean;
  position: number;
  /** Dias de anticipacion con que este plan quiere que se genere la orden. */
  leadTimeDays: number;
  proximaEl: Date;
  /** Dias que faltan. Negativo si ya vencio. */
  faltan: number;
  horas: number;
};

/**
 * Las actividades que vencen de aqui a `hasta`, listas para armar ordenes.
 *
 * Reemplaza a preguntar "que plan vence": ahora vence la ACTIVIDAD, y las que
 * caen cerca se juntan por equipo. La ventana adelanta y nunca retrasa —si las
 * bujias tocan el 22 y el aceite el 25, la orden sale el 22 con las dos—,
 * porque empujar las bujias al 25 seria diferir un mantenimiento y eso no lo
 * decide el sistema.
 */
export async function actividadesPendientes(
  organizationId: string,
  opciones: {
    assetId?: string;
    hasta: Date;
    /**
     * Limita a los planes de un tipo de disparo. El programador pide CALENDAR
     * para no pisarse con el camino de medidores, que sigue programando por
     * asignacion: sin esto las actividades de un plan por medidor se generarian
     * DOS veces, una por cada camino, y las dos ordenes se verian legitimas.
     */
    triggerType?: string;
  } = { hasta: new Date() },
): Promise<ActividadPendiente[]> {
  const relojes = await prisma.planTaskAsset.findMany({
    where: {
      organizationId,
      active: true,
      ...(opciones.assetId ? { assetId: opciones.assetId } : {}),
      proximaEl: { not: null, lte: opciones.hasta },
      // Un equipo dado de baja no genera nada, por las dos formas de estar
      // fuera: la baja logica de la pantalla y el estatus RETIRED de la ficha.
      asset: { active: true, status: { not: "RETIRED" } },
      planTask: {
        plan: {
          active: true,
          ...(opciones.triggerType ? { triggerType: opciones.triggerType } : {}),
        },
      },
    },
    select: {
      planTaskId: true,
      assetId: true,
      proximaEl: true,
      asset: { select: { code: true, name: true } },
      planTask: {
        select: {
          title: true, description: true, taskType: true, unit: true,
          minValue: true, maxValue: true, required: true, position: true,
          labor: { select: { personas: true, hours: true } },
          plan: {
            select: {
              id: true, name: true, maintenanceType: true, priority: true,
              leadTimeDays: true, assignedToId: true, teamId: true,
              requiresShutdown: true, procedure: true, safetyNotes: true, description: true,
            },
          },
        },
      },
    },
    orderBy: { proximaEl: "asc" },
  });

  const hoy = startOfDay(new Date()).getTime();
  return relojes
    .filter((r) => r.proximaEl !== null)
    .map((r) => ({
      planTaskId: r.planTaskId,
      planId: r.planTask.plan.id,
      planNombre: r.planTask.plan.name,
      maintenanceType: r.planTask.plan.maintenanceType,
      priority: r.planTask.plan.priority,
      assetId: r.assetId,
      assetCode: r.asset.code,
      assetNombre: r.asset.name,
      titulo: r.planTask.title,
      descripcion: r.planTask.description,
      taskType: r.planTask.taskType,
      unit: r.planTask.unit,
      minValue: r.planTask.minValue,
      maxValue: r.planTask.maxValue,
      required: r.planTask.required,
      position: r.planTask.position,
      leadTimeDays: r.planTask.plan.leadTimeDays,
      proximaEl: r.proximaEl as Date,
      faltan: Math.round(
        (startOfDay(r.proximaEl as Date).getTime() - hoy) / (1000 * 60 * 60 * 24),
      ),
      // Las horas de la actividad salen de su mano de obra declarada: personas
      // por horas. Sin declarar es cero, y quien suma decide que hacer con eso
      // —inventar un estimado aqui inflaria la carga del personal, y esa cifra
      // decide si contratar—.
      horas: r.planTask.labor.reduce((t, l) => t + l.personas * l.hours, 0),
    }));
}

/**
 * Los relojes que quedaron sin fecha, para que no se queden callados.
 *
 * Una actividad sin punto de partida o sin frecuencia nunca genera una orden y
 * se ve exactamente igual que una que todavia no toca. Este es el reporte que
 * hace visible la diferencia.
 */
export async function actividadesSinProgramar(organizationId: string) {
  const relojes = await prisma.planTaskAsset.findMany({
    where: {
      organizationId,
      active: true,
      proximaEl: null,
      asset: { active: true, status: { not: "RETIRED" } },
      planTask: { plan: { active: true } },
    },
    select: {
      planTaskId: true,
      assetId: true,
      arranqueEl: true,
      asset: { select: { code: true, name: true } },
      planTask: {
        select: {
          title: true,
          cadaCuanto: true,
          plan: { select: { id: true, name: true, intervalDays: true } },
        },
      },
    },
  });
  return relojes.map((r) => ({
    assetCode: r.asset.code,
    plan: r.planTask.plan.name,
    actividad: r.planTask.title,
    causa: !r.arranqueEl
      ? "sin fecha de arranque"
      : !r.planTask.cadaCuanto && !r.planTask.plan.intervalDays
        ? "sin frecuencia"
        : "sin regla válida",
  }));
}

/**
 * Avanza los relojes de las actividades que trajo una orden al cerrarse.
 *
 * Se recorren las actividades de la orden, no las del plan: una orden puede
 * traer tres de las diez del plan y las otras siete siguen debiendose para
 * cuando les toque, que es justo el punto.
 *
 * Las LIBERADAS no avanzan. Una actividad que se solto por falta de refaccion
 * no se hizo, y correrle el calendario seria dar por cumplido trabajo que
 * nunca ocurrio —la clase de mentira que despues ensucia el historial y no se
 * puede deshacer—.
 */
export async function avanzarActividadesDeOrden(p: {
  organizationId: string;
  workOrderId: string;
  assetId: string | null;
  completadaEl: Date;
}): Promise<number> {
  if (!p.assetId) return 0;

  const actividades = await prisma.workOrderTask.findMany({
    where: { workOrderId: p.workOrderId, liberadaAt: null, planTaskId: { not: null } },
    select: { planTaskId: true },
    distinct: ["planTaskId"],
  });
  if (!actividades.length) return 0;

  // Una sola lectura de la regla para todas: pedirla por actividad seria una
  // consulta de organizacion y otra de festivos por cada renglon de la orden.
  const regla = await reglaDeOrganizacion(p.organizationId);

  let avanzadas = 0;
  for (const a of actividades) {
    const r = await avanzarActividad({
      organizationId: p.organizationId,
      planTaskId: a.planTaskId as string,
      assetId: p.assetId,
      completadaEl: p.completadaEl,
      regla,
    });
    if (r) avanzadas += 1;
  }

  await sincronizarAsignaciones(p.organizationId, p.assetId);
  return avanzadas;
}

/**
 * Deja `PlanAsset.nextDueDate` igual a la mas proxima de sus actividades.
 *
 * La fecha de la asignacion deja de ser la verdad y pasa a ser un derivado,
 * pero NO se abandona: cinco pantallas la leen —la lista de planes, el
 * tablero, la proyeccion, la cobertura y el detalle del equipo— y apagarlas
 * todas de golpe era la forma segura de romper algo sin notarlo. Se mantiene
 * al dia hasta que cada una se migre a leer las actividades.
 */
export async function sincronizarAsignaciones(organizationId: string, assetId: string) {
  const asignaciones = await prisma.planAsset.findMany({
    where: { organizationId, assetId, active: true },
    select: { id: true, planId: true },
  });

  for (const a of asignaciones) {
    const proxima = await prisma.planTaskAsset.findFirst({
      where: {
        organizationId,
        assetId,
        active: true,
        proximaEl: { not: null },
        planTask: { planId: a.planId },
      },
      orderBy: { proximaEl: "asc" },
      select: { proximaEl: true },
    });
    // Sin actividades con fecha no se toca: dejar la asignacion en nulo
    // apagaria el plan viejo que todavia no se migra.
    if (proxima?.proximaEl) {
      await prisma.planAsset.update({
        where: { id: a.id },
        data: { nextDueDate: proxima.proximaEl },
      });
    }
  }
}

/**
 * Siembra los relojes que falten de un plan en TODOS sus equipos asignados.
 *
 * Se llama al editar un plan: una actividad recien agregada no tiene reloj en
 * ninguno de los seis compresores, y sin esto no generaria nunca sin decir por
 * que. Las que ya tienen reloj no se tocan —`sembrarCalendario` es
 * idempotente—, asi que agregar una actividad no reinicia el calendario de las
 * demas.
 *
 * El arranque por omision de una actividad nueva es HOY como ultima vez, no
 * como vencimiento: dar de alta una actividad no deberia disparar una orden el
 * mismo dia en los seis equipos. Quien quiera que toque de inmediato lo ajusta
 * en la asignacion.
 */
export async function sembrarCalendarioDelPlan(organizationId: string, planId: string) {
  const asignaciones = await prisma.planAsset.findMany({
    where: { organizationId, planId, active: true },
    select: { assetId: true },
  });

  const hoy = startOfDay(new Date());
  let creados = 0;
  const sinFrecuencia = new Set<string>();
  for (const a of asignaciones) {
    const r = await sembrarCalendario({
      organizationId,
      planId,
      assetId: a.assetId,
      arranquePorOmision: { fecha: hoy, esUltima: true },
    });
    creados += r.creados;
    for (const t of r.sinFrecuencia) sinFrecuencia.add(t);
  }
  return { creados, sinFrecuencia: [...sinFrecuencia] };
}

/**
 * Siembra los relojes de las asignaciones que todavia no los tienen.
 *
 * Existe porque una asignacion puede nacer por muchas puertas —la pantalla, la
 * importacion, un script, o simplemente ser anterior a este cambio— y una sin
 * relojes no genera NADA por el camino nuevo. Sin esto, publicar el cambio
 * habria apagado en silencio los preventivos de las cuentas que ya estaban
 * corriendo: la peor clase de defecto de este proyecto, porque la pantalla se
 * sigue viendo perfecta.
 *
 * El arranque es la fecha que la asignacion ya tenia, tomada como "arranca ese
 * dia". Asi el calendario que el cliente ya conocia NO se mueve el dia que se
 * publica: todas las actividades del plan vencen cuando vencia el plan, y de
 * ahi en adelante cada una sigue su propio ritmo.
 *
 * Corre al inicio de cada barrido y es barato cuando no hay nada que hacer:
 * dos consultas y ningun escritura.
 */
export async function sembrarLoQueFalte(
  organizationId: string,
  assetId?: string,
): Promise<number> {
  const asignaciones = await prisma.planAsset.findMany({
    where: {
      organizationId,
      active: true,
      ...(assetId ? { assetId } : {}),
      plan: { active: true, triggerType: "CALENDAR", tasks: { some: {} } },
      asset: { active: true, status: { not: "RETIRED" } },
    },
    select: {
      assetId: true,
      planId: true,
      nextDueDate: true,
      lastCompletedAt: true,
      plan: { select: { tasks: { select: { id: true } } } },
    },
  });
  if (!asignaciones.length) return 0;

  const yaHay = await prisma.planTaskAsset.findMany({
    where: { organizationId, ...(assetId ? { assetId } : {}) },
    select: { planTaskId: true, assetId: true },
  });
  const conReloj = new Set(yaHay.map((r) => `${r.planTaskId}:${r.assetId}`));

  const hoy = startOfDay(new Date());
  let sembradas = 0;
  for (const a of asignaciones) {
    const faltan = a.plan.tasks.some((t) => !conReloj.has(`${t.id}:${a.assetId}`));
    if (!faltan) continue;
    await sembrarCalendario({
      organizationId,
      planId: a.planId,
      assetId: a.assetId,
      // "Arranca ese dia", no "la ultima vez fue ese dia": `nextDueDate` es un
      // VENCIMIENTO. Tratarlo como ultima ejecucion correria cada actividad un
      // intervalo completo hacia adelante y el cliente veria su programa
      // desaparecer un mes, sin un solo mensaje.
      arranquePorOmision: { fecha: a.nextDueDate ?? hoy, esUltima: false },
    });
    sembradas += 1;
  }
  return sembradas;
}

export type VisitaProyectada = {
  planId: string;
  planNombre: string;
  assetId: string;
  assetCode: string;
  assetNombre: string;
  categoryId: string | null;
  priority: string;
  maintenanceType: string;
  fecha: Date;
  /** Los titulos de lo que llevaria esa visita. */
  actividades: string[];
};

/**
 * Que visitas van a ocurrir de aqui a `dias`, y que lleva cada una.
 *
 * La proyeccion agrupa con LA MISMA ventana que usa el generador. Si dibujara
 * una linea por actividad, el calendario prometeria cuatro visitas donde va a
 * haber una, y la carga de personal que sale de ahi —la cifra con la que se
 * decide contratar— quedaria inflada cuatro veces.
 *
 * Solo planes por calendario: los de medidor se proyectan con el consumo del
 * equipo, que es otro eje y vive en el programador.
 */
export async function proyectarActividades(
  organizationId: string,
  dias = 60,
): Promise<VisitaProyectada[]> {
  const regla = await reglaDeOrganizacion(organizationId);
  const hasta = new Date();
  hasta.setDate(hasta.getDate() + dias);

  const relojes = await prisma.planTaskAsset.findMany({
    where: {
      organizationId,
      active: true,
      proximaEl: { not: null },
      asset: { active: true, status: { not: "RETIRED" } },
      planTask: { plan: { active: true, triggerType: "CALENDAR" } },
    },
    select: {
      proximaEl: true,
      assetId: true,
      arranqueEl: true,
      asset: { select: { code: true, name: true, categoryId: true } },
      planTask: {
        select: {
          title: true, cadaCuanto: true, unidadFrecuencia: true, cadaCuantas: true,
          plan: {
            select: {
              id: true, name: true, priority: true, maintenanceType: true, intervalDays: true,
            },
          },
        },
      },
    },
  });

  /** Una ocurrencia suelta antes de agruparse en visitas. */
  type Toque = { fecha: Date; titulo: string };
  const porGrupo = new Map<string, { base: (typeof relojes)[number]; toques: Toque[] }>();

  for (const r of relojes) {
    const cada = r.planTask.cadaCuanto ?? respaldoEnDias(r.planTask.cadaCuantas, r.planTask.plan.intervalDays);
    if (!cada || cada < 1) continue;
    const unidad: Unidad = r.planTask.cadaCuanto
      ? ((r.planTask.unidadFrecuencia as Unidad) ?? "DIAS")
      : "DIAS";

    const clave = `${r.assetId}:${r.planTask.plan.id}`;
    const grupo = porGrupo.get(clave) ?? { base: r, toques: [] };
    porGrupo.set(clave, grupo);

    // Se avanza actividad por actividad hasta el horizonte. El tope evita que
    // una frecuencia diaria proyectada a un ano llene la memoria.
    let f = r.proximaEl as Date;
    let guarda = 0;
    while (f <= hasta && guarda < 400) {
      grupo.toques.push({ fecha: f, titulo: r.planTask.title });
      f = siguienteFecha(f, cada, unidad, regla, r.arranqueEl?.getDate());
      guarda += 1;
    }
  }

  const visitas: VisitaProyectada[] = [];
  for (const { base, toques } of porGrupo.values()) {
    toques.sort((a, b) => +a.fecha - +b.fecha);
    let i = 0;
    while (i < toques.length) {
      const inicio = toques[i].fecha;
      const corte = new Date(inicio);
      corte.setDate(corte.getDate() + regla.horizonteDias);
      const juntas: string[] = [];
      while (i < toques.length && toques[i].fecha <= corte) {
        juntas.push(toques[i].titulo);
        i += 1;
      }
      visitas.push({
        planId: base.planTask.plan.id,
        planNombre: base.planTask.plan.name,
        assetId: base.assetId,
        assetCode: base.asset.code,
        assetNombre: base.asset.name,
        categoryId: base.asset.categoryId,
        priority: base.planTask.plan.priority,
        maintenanceType: base.planTask.plan.maintenanceType,
        fecha: inicio,
        actividades: [...new Set(juntas)],
      });
    }
  }

  return visitas.sort((a, b) => +a.fecha - +b.fecha);
}
