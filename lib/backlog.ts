/**
 * El backlog: trabajo que se libero de una OT y sigue pendiente.
 *
 * NO es una tabla. Es una consulta sobre las actividades marcadas como
 * liberadas que nadie ha retomado todavia. La actividad se queda en la OT
 * donde se libero —con su motivo y su fecha— para que esa orden siga contando
 * lo que de verdad ocurrio ese dia. Copiarla a un almacen aparte duplicaria el
 * dato y le quitaria a la OT su historia.
 *
 * Retomar una actividad crea una nueva que apunta a la liberada. Esa cadena es
 * el historial completo, y de ahi sale cuantas veces se ha trabado un trabajo
 * sin llevar contadores que se desincronizan.
 */
import { prisma } from "./db";
import { equivalentesDe } from "./equivalencias";
import { estadoDeVencimiento } from "./vencimiento";

export const MOTIVOS_LIBERACION = {
  SIN_REFACCION: "No había la refacción",
  SIN_MANO_DE_OBRA: "No hubo quien lo hiciera",
  SERVICIO_EXTERNO: "Requiere servicio externo",
  SIN_ACCESO: "No se pudo parar o entrar al equipo",
  OTRO: "Otro motivo",
} as const;

export type MotivoLiberacion = keyof typeof MOTIVOS_LIBERACION;

export const esMotivoValido = (m: string): m is MotivoLiberacion => m in MOTIVOS_LIBERACION;

/** Cuantas veces se ha liberado este trabajo, recorriendo la cadena hacia atras. */
export async function vecesLiberada(taskId: string): Promise<number> {
  let n = 0;
  let actual: string | null = taskId;
  // La cadena es corta por naturaleza; el tope evita un ciclo por dato corrupto.
  for (let i = 0; actual && i < 50; i++) {
    // El tipo va explicito: sin el, TypeScript no puede inferirlo porque `t`
    // alimenta a `actual`, que es lo que consulta a `t`.
    const t: { retomaDeTaskId: string | null; liberadaAt: Date | null } | null =
      await prisma.workOrderTask.findUnique({
        where: { id: actual },
        select: { retomaDeTaskId: true, liberadaAt: true },
      });
    if (!t) break;
    if (t.liberadaAt) n++;
    actual = t.retomaDeTaskId;
  }
  return n;
}

/**
 * El backlog de una organizacion, opcionalmente de un activo.
 *
 * Devuelve cada actividad liberada con lo que hace falta para decidir: de
 * donde venia, por que se trabo, cuanto lleva esperando y —si fue por
 * refaccion— si hoy ya hay existencia para hacerla.
 */
export async function backlog(organizationId: string, opciones?: { assetId?: string }) {
  const tareas = await prisma.workOrderTask.findMany({
    where: {
      liberadaAt: { not: null },
      // Nadie la ha retomado: eso es lo que la mantiene en el backlog.
      retomadaPor: null,
      workOrder: {
        organizationId,
        ...(opciones?.assetId ? { assetId: opciones.assetId } : {}),
      },
    },
    orderBy: { liberadaAt: "asc" },
    select: {
      id: true, title: true, description: true, taskType: true,
      unit: true, minValue: true, maxValue: true, required: true,
      origen: true, origenPlanId: true, origenRequestId: true, maintenanceType: true,
      origenRequest: { select: { number: true } },
      // De que actividad del plan salio. Sin esto, al retomarla la orden nueva
      // no sabria que reloj avanzar al cerrarse, y la actividad se quedaria
      // marcada como atrasada para siempre aunque ya se hubiera hecho.
      planTaskId: true,
      liberadaAt: true, motivoLiberacion: true, motivoDetalle: true,
      bloqueadaPorPartId: true,
      // El id va ademas del nombre: sin el no se le puede avisar a esa persona
      // cuando la refaccion que la trabo por fin llega.
      avisoDisponibleAt: true,
      liberadaPorId: true,
      liberadaPor: { select: { name: true } },
      bloqueadaPor: { select: { id: true, code: true, name: true, quantityOnHand: true, unit: true } },
      workOrder: {
        select: {
          id: true, number: true, closedAt: true, completedAt: true, priority: true,
          plan: { select: { name: true } },
          asset: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });

  // Las equivalentes de las refacciones que trabaron trabajo. Se consultan de
  // una vez y no una por tarea: dos actividades trabadas por el mismo balero
  // no tienen por que preguntar dos veces.
  const bloqueantes = [...new Set(tareas.map((t) => t.bloqueadaPorPartId).filter(Boolean))] as string[];
  const alternativas = new Map<string, Awaited<ReturnType<typeof equivalentesDe>>>();
  for (const partId of bloqueantes) {
    alternativas.set(partId, (await equivalentesDe(organizationId, partId)).filter((e) => e.hay > 0));
  }

  const ahora = Date.now();
  return tareas.map((t) => {
    const equivalentes = t.bloqueadaPorPartId ? alternativas.get(t.bloqueadaPorPartId) ?? [] : [];
    const hayPropia = (t.bloqueadaPor?.quantityOnHand ?? 0) > 0;
    return {
      ...t,
      diasEsperando: t.liberadaAt
        ? Math.floor((ahora - t.liberadaAt.getTime()) / 86_400_000)
        : 0,
      // Con equivalentes: una actividad trabada por un balero que no llego se
      // puede hacer hoy si el equivalente de otra marca si esta en el almacen.
      // Deterministico, contra la existencia de hoy.
      yaSePuede:
        t.motivoLiberacion === "SIN_REFACCION"
          ? hayPropia || equivalentes.length > 0
          : null,
      /** Con que se puede resolver si la original sigue sin llegar. */
      conEquivalente: hayPropia ? null : (equivalentes[0] ?? null),
    };
  });
}

export type ItemBacklog = Awaited<ReturnType<typeof backlog>>[number];

// ─────────────────────────────────────────── El trabajo pendiente completo ───

/**
 * El backlog que se revisa en la junta: TODO el trabajo pendiente, separado
 * por lo que le pasa.
 *
 * Antes la pantalla solo mostraba actividades liberadas, asi que una orden
 * vencida hace un mes, una en espera de refaccion o una que nadie tenia
 * asignada no aparecian en «Trabajo pendiente» aunque lo fueran. Ahora cada
 * cosa cae en UNA categoria —la mas urgente de resolver— y lleva las demas
 * como avisos, para no contar dos veces la misma orden:
 *
 *   EN_ESPERA > VENCIDA > SIN_RESPONSABLE > SIN_PROGRAMAR > PROGRAMADA
 *
 * Una actividad liberada no es una orden: va en su propia categoria.
 */
export const CATEGORIAS_PENDIENTE = {
  EN_ESPERA: { titulo: "En espera o bloqueadas", descripcion: "Órdenes pausadas: algo impide avanzar." },
  VENCIDA: { titulo: "Vencidas", descripcion: "Órdenes abiertas con la fecha compromiso ya pasada." },
  ACTIVIDAD_LIBERADA: { titulo: "Actividades no realizadas", descripcion: "Se liberaron de una orden con motivo y esperan que otra las retome." },
  SIN_RESPONSABLE: { titulo: "Sin responsable", descripcion: "Nadie las tiene en su carga de trabajo." },
  SIN_PROGRAMAR: { titulo: "Sin programar", descripcion: "Sin fecha compromiso." },
  PROGRAMADA: { titulo: "Programadas a tiempo", descripcion: "Con responsable y fecha por venir o de hoy." },
} as const;

export type CategoriaPendiente = keyof typeof CATEGORIAS_PENDIENTE;

export type Pendiente = {
  id: string;
  categoria: CategoriaPendiente;
  tipo: "ORDEN" | "ACTIVIDAD";
  titulo: string;
  orden: { id: string; number: string };
  origen: string;
  activo: string | null;
  prioridad: string;
  /** Nulo cuando no hay estimado: se muestra como tal, no se inventa. */
  horas: number | null;
  motivo: string;
  responsable: string | null;
  antiguedadDias: number;
  proximaAccion: string;
  /** Otras situaciones que tambien aplican (p. ej. vencida Y sin responsable). */
  avisos: string[];
  /** Solo actividades: ya hay refaccion para hacerla. */
  yaSePuede?: boolean | null;
  /** Solo actividades: con que equivalente se puede resolver hoy. */
  nota?: string | null;
};

const ACCION_POR_MOTIVO: Record<string, string> = {
  SIN_REFACCION: "Conseguir la refacción y armar la orden que la retome",
  SIN_MANO_DE_OBRA: "Asignar a alguien y armar la orden que la retome",
  SERVICIO_EXTERNO: "Contratar el servicio externo",
  SIN_ACCESO: "Coordinar el paro o el acceso al equipo",
  OTRO: "Resolver el motivo y armar la orden que la retome",
};

export async function trabajoPendiente(organizationId: string, opciones: { zona: string; ahora?: Date }) {
  const ahora = opciones.ahora ?? new Date();
  const dias = (d: Date) => Math.max(0, Math.floor((ahora.getTime() - d.getTime()) / 86_400_000));

  const [ordenes, actividades] = await Promise.all([
    prisma.workOrder.findMany({
      where: { organizationId, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] } },
      select: {
        id: true, number: true, title: true, status: true, priority: true, estimatedHours: true,
        dueDate: true, completedAt: true, createdAt: true, motivoEspera: true, startedAt: true,
        asset: { select: { code: true, name: true } },
        assignedTo: { select: { name: true } },
        plan: { select: { name: true } },
        requests: { select: { number: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    backlog(organizationId),
  ]);

  const horasDePlan = new Map<string, number>();
  const planTaskIds = [...new Set(actividades.map((a) => a.planTaskId).filter(Boolean))] as string[];
  if (planTaskIds.length) {
    const mano = await prisma.planTaskLabor.findMany({
      where: { planTaskId: { in: planTaskIds } },
      select: { planTaskId: true, personas: true, hours: true },
    });
    for (const m of mano) horasDePlan.set(m.planTaskId, (horasDePlan.get(m.planTaskId) ?? 0) + m.personas * m.hours);
  }

  const items: Pendiente[] = [];

  for (const o of ordenes) {
    const venc = estadoDeVencimiento(o, { zona: opciones.zona, ahora });
    const vencida = venc.clave === "VENCIDA";
    const sinResponsable = !o.assignedTo;
    const sinFecha = !o.dueDate;
    const categoria: CategoriaPendiente =
      o.status === "ON_HOLD" ? "EN_ESPERA"
        : vencida ? "VENCIDA"
        : sinResponsable ? "SIN_RESPONSABLE"
        : sinFecha ? "SIN_PROGRAMAR"
        : "PROGRAMADA";

    const avisos: string[] = [];
    if (categoria !== "VENCIDA" && vencida) avisos.push(venc.texto);
    if (categoria !== "SIN_RESPONSABLE" && sinResponsable) avisos.push("Sin responsable");
    if (categoria !== "SIN_PROGRAMAR" && sinFecha) avisos.push("Sin fecha compromiso");

    const motivo =
      categoria === "EN_ESPERA" ? (o.motivoEspera ?? "En espera sin motivo registrado (anterior a que se pidiera)")
        : categoria === "VENCIDA" ? venc.texto
        : categoria === "SIN_RESPONSABLE" ? "Nadie la tiene asignada"
        : categoria === "SIN_PROGRAMAR" ? "Sin fecha compromiso"
        : venc.texto;

    const proximaAccion =
      categoria === "EN_ESPERA" ? "Resolver lo que se espera y reanudar"
        : categoria === "VENCIDA"
          ? sinResponsable ? "Asignar responsable y reprogramar con motivo"
            : o.status === "IN_PROGRESS" ? "Completar, o reprogramar con motivo"
            : "Iniciar, o reprogramar con motivo"
        : categoria === "SIN_RESPONSABLE" ? "Asignar responsable"
        : categoria === "SIN_PROGRAMAR" ? "Fijar fecha compromiso"
        : o.status === "IN_PROGRESS" ? "Terminar y completar" : "Ejecutar en la fecha";

    items.push({
      id: o.id,
      categoria,
      tipo: "ORDEN",
      titulo: o.title,
      orden: { id: o.id, number: o.number },
      origen: o.plan ? `Plan: ${o.plan.name}`
        : o.requests.length ? `Solicitud ${o.requests.map((r) => r.number).join(", ")}`
        : "Captura manual",
      activo: o.asset ? `${o.asset.code} · ${o.asset.name}` : null,
      prioridad: o.priority,
      horas: o.estimatedHours > 0 ? o.estimatedHours : null,
      motivo,
      responsable: o.assignedTo?.name ?? null,
      antiguedadDias: dias(o.createdAt),
      proximaAccion,
      avisos,
    });
  }

  for (const a of actividades) {
    items.push({
      id: a.id,
      categoria: "ACTIVIDAD_LIBERADA",
      tipo: "ACTIVIDAD",
      titulo: a.title,
      orden: { id: a.workOrder.id, number: a.workOrder.number },
      origen: a.origen === "PLAN" ? `Plan${a.workOrder.plan ? `: ${a.workOrder.plan.name}` : ""}`
        : a.origen === "SOLICITUD" ? `Solicitud ${a.origenRequest?.number ?? ""}`.trim()
        : "Captura manual",
      activo: a.workOrder.asset ? `${a.workOrder.asset.code} · ${a.workOrder.asset.name}` : null,
      prioridad: a.workOrder.priority,
      horas: a.planTaskId ? horasDePlan.get(a.planTaskId) ?? null : null,
      motivo: `${MOTIVOS_LIBERACION[a.motivoLiberacion as MotivoLiberacion] ?? a.motivoLiberacion ?? "Sin motivo"}` +
        `${a.motivoDetalle ? ` — ${a.motivoDetalle}` : ""}` +
        `${a.bloqueadaPor ? ` · ${a.bloqueadaPor.code} ${a.bloqueadaPor.name}` : ""}`,
      responsable: null,
      antiguedadDias: a.diasEsperando,
      proximaAccion: a.yaSePuede ? "Ya se puede hacer: armar la orden que la retome"
        : ACCION_POR_MOTIVO[a.motivoLiberacion ?? ""] ?? "Armar la orden que la retome",
      avisos: a.liberadaPor?.name ? [`Liberada por ${a.liberadaPor.name} en ${a.workOrder.number}`] : [`Liberada en ${a.workOrder.number}`],
      yaSePuede: a.yaSePuede,
      nota: a.conEquivalente
        ? `Se puede resolver con ${a.conEquivalente.refaccion.code} ${a.conEquivalente.refaccion.name} ` +
          `(${a.conEquivalente.tipo === "EQUIVALENTE" ? "misma pieza, otra marca" : "sustituto"}, hay ${a.conEquivalente.hay} ${a.conEquivalente.refaccion.unit})` +
          `${a.conEquivalente.nota ? `. ⚠ ${a.conEquivalente.nota}` : ""}`
        : null,
    });
  }

  const orden = Object.keys(CATEGORIAS_PENDIENTE) as CategoriaPendiente[];
  const PRIORIDAD: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  items.sort((x, y) =>
    orden.indexOf(x.categoria) - orden.indexOf(y.categoria) ||
    (PRIORIDAD[x.prioridad] ?? 9) - (PRIORIDAD[y.prioridad] ?? 9) ||
    y.antiguedadDias - x.antiguedadDias,
  );
  return items;
}
