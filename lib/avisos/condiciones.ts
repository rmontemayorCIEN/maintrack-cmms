/**
 * Cuándo un aviso queda atendido. Una regla por tipo, en un solo lugar.
 *
 * Un aviso que pide acción se atiende cuando la CONDICIÓN que lo originó deja
 * de existir. No cuando se lee, no cuando alguien dice «Enterado», no cuando
 * se abre o se edita el registro. Reprogramar una OT vencida a otra fecha que
 * también ya pasó no la atiende: sigue vencida.
 *
 * Cada regla dice cuándo nace el aviso, cuándo permanece, cuándo se actualiza,
 * cuándo escala y cuándo queda atendido, y trae la función que lo decide
 * leyendo el estado real del registro. Esa misma función la usan:
 *
 *  - los flujos (terminar una OT, autorizar una compra), en el momento;
 *  - la reconciliación del proceso programado, cada cinco minutos, que corrige
 *    lo que haya quedado inconsistente;
 *  - el escalamiento, para decir por qué se detuvo.
 *
 * Los recordatorios de escalamiento son otra condición, no la misma: «OT
 * vencida sin movimiento» se resuelve con movimiento, aunque la orden siga
 * vencida. Se distinguen por su clave (`...:esc-<REGLA>-<nivel>`).
 */
import { prisma } from "../db";
import { consumoDe } from "../planes";
import { EVENTOS, type TipoEvento } from "./catalogo";
import { configDe, type ConfigEmpresa } from "./config";
import { resolverDestinatarios } from "./destinatarios";
import { ultimosMovimientos } from "./movimiento";
import { REGLAS_RECOMENDADAS, type ClaveRegla } from "./reglas";
import { compraTerminada, criticosSinPlan, medidoresSinLectura, refaccionesBajoMinimo, refaccionesCriticasAgotadas } from "./situaciones";

export type AvisoAbierto = {
  id: string; tipo: string; entidadId: string | null; userId: string; claveDedup: string | null;
  createdAt: Date; actualizadaEl: Date | null; organizationId: string;
};

/** Lo que dice la regla de un aviso: sigue, o ya se resolvió y por qué. */
export type Veredicto =
  | { sigue: true; condicion: string }
  | { sigue: false; condicion: string; motivo: string; evento: string; actorId?: string | null };

type Ctx = { organizationId: string; ahora: Date; cfg: ConfigEmpresa };
type Evaluador = (c: Ctx, avisos: AvisoAbierto[]) => Promise<Map<string, Veredicto>>;

export type ReglaDeAviso = {
  /** Lo que se avisó, en palabras: queda como «condición anterior» en el historial. */
  condicion: string;
  nace: string;
  permanece: string;
  actualiza: string;
  escala: string;
  atiende: string;
  /**
   * Decide con el estado real. `null` solo cuando la condición no vive en la
   * base y la conoce un proceso (el programador sabe si falló): ese proceso
   * la resuelve con `atenderAvisos` y deja el mismo historial.
   */
  evaluar: Evaluador | null;
};

const HORA = 3_600_000;
const sigue = (condicion: string): Veredicto => ({ sigue: true, condicion });
const resuelto = (condicion: string, motivo: string, evento: string, actorId?: string | null): Veredicto =>
  ({ sigue: false, condicion, motivo, evento, actorId: actorId ?? null });
const fecha = (d: Date, zona: string) => d.toLocaleDateString("es-MX", { timeZone: zona, day: "numeric", month: "short", year: "numeric" });

/** La condición de un aviso: su tipo, o la regla de escalamiento si es un recordatorio. */
export function condicionDe(n: { tipo: string; claveDedup: string | null }): string {
  const m = n.claveDedup ? /:esc-([A-Z_]+)-(\d+)$/.exec(n.claveDedup) : null;
  if (m && m[1] in REGLAS_RECOMENDADAS) return `esc:${m[1]}`;
  return n.tipo;
}
const nivelDe = (n: { claveDedup: string | null }) => Number(/:esc-[A-Z_]+-(\d+)$/.exec(n.claveDedup ?? "")?.[1] ?? 0);
const desdeAviso = (n: AvisoAbierto) => n.actualizadaEl ?? n.createdAt;

// ─────────────────────────────────────────── Órdenes de trabajo

type Orden = NonNullable<Awaited<ReturnType<typeof leerOrdenes>>[number]>;

async function leerOrdenes(organizationId: string, ids: string[]) {
  return prisma.workOrder.findMany({
    where: { organizationId, id: { in: ids } },
    select: {
      id: true, number: true, status: true, priority: true, dueDate: true, startedAt: true, assignedToId: true,
      siteId: true, maintenanceType: true, planId: true, plan: { select: { toleranceDays: true } },
      assignedTo: { select: { name: true } },
    },
  });
}

/** Quién hizo el último cambio de cada tipo en cada orden (para el historial). */
async function actores(organizationId: string, ids: string[]) {
  const filas = await prisma.auditLog.findMany({
    where: { organizationId, entity: "WorkOrder", entityId: { in: ids }, action: { in: ["STATUS_CHANGED", "RESCHEDULED", "UPDATED"] } },
    select: { entityId: true, action: true, userId: true },
    orderBy: { createdAt: "asc" },
  });
  const m = new Map<string, string | null>();
  for (const f of filas) m.set(`${f.entityId}:${f.action}`, f.userId);
  return (id: string, accion: "STATUS_CHANGED" | "RESCHEDULED" | "UPDATED") => m.get(`${id}:${accion}`) ?? null;
}

const ETIQUETA_OT: Record<string, string> = {
  OPEN: "abierta", ASSIGNED: "asignada", IN_PROGRESS: "en proceso", ON_HOLD: "en espera",
  COMPLETED: "terminada", CLOSED: "cerrada", CANCELLED: "cancelada",
};
const PRIORIDAD_OT: Record<string, string> = { LOW: "baja", MEDIUM: "media", HIGH: "alta", CRITICAL: "crítica" };

/** Terminada, cerrada, cancelada o borrada: la condición de trabajo pendiente se acabó. */
function finDeOrden(o: Orden | undefined, actor: (id: string, a: "STATUS_CHANGED") => string | null): Veredicto | null {
  if (!o) return resuelto("La OT ya no existe", "La OT se eliminó", "Eliminación de la OT");
  const ev = (a: string) => `Cambio de estado a ${ETIQUETA_OT[a]}`;
  if (o.status === "COMPLETED") return resuelto("Terminada", "La OT fue terminada", ev("COMPLETED"), actor(o.id, "STATUS_CHANGED"));
  if (o.status === "CLOSED") return resuelto("Cerrada", "La OT fue cerrada", ev("CLOSED"), actor(o.id, "STATUS_CHANGED"));
  if (o.status === "CANCELLED") return resuelto("Cancelada", "La OT fue cancelada", ev("CANCELLED"), actor(o.id, "STATUS_CHANGED"));
  return null;
}

/**
 * ¿Le sigue tocando a esta persona? Para los avisos del responsable: si la
 * orden cambió de manos, el suyo se cierra por reasignación; el de los
 * supervisores (y el del responsable nuevo) sigue.
 */
function destinatariosVigentes(c: Ctx) {
  const memo = new Map<string, Promise<Set<string>>>();
  return (tipo: TipoEvento, o: Orden) => {
    const clave = `${tipo}|${o.assignedToId ?? "-"}|${o.siteId ?? "-"}`;
    if (!memo.has(clave)) {
      memo.set(clave, resolverDestinatarios(c.organizationId, EVENTOS[tipo].destinatarios.map((g) => [...g]), { responsableId: o.assignedToId, siteId: o.siteId })
        .then((r) => new Set(r.destinatarios.map((d) => d.userId))));
    }
    return memo.get(clave)!;
  };
}
function porReasignacion(o: Orden, actor: (id: string, a: "UPDATED") => string | null): Veredicto {
  return o.assignedToId
    ? resuelto(`A cargo de ${o.assignedTo?.name ?? "otra persona"}`, `La OT se reasignó a ${o.assignedTo?.name ?? "otra persona"}`, "Reasignación", actor(o.id, "UPDATED"))
    : resuelto("Sin responsable", "Se quitó el responsable de la OT; la siguen los supervisores", "Reasignación", actor(o.id, "UPDATED"));
}

/** Evaluador de avisos de órdenes: lee las órdenes una vez y aplica `decidir` a cada aviso. */
function deOrdenes(decidir: (o: Orden | undefined, n: AvisoAbierto, x: {
  c: Ctx; actor: Awaited<ReturnType<typeof actores>>; vigentes: ReturnType<typeof destinatariosVigentes>;
  movimientos: Awaited<ReturnType<typeof ultimosMovimientos>>;
}) => Promise<Veredicto> | Veredicto, conMovimiento = false): Evaluador {
  return async (c, avisos) => {
    const ids = [...new Set(avisos.map((a) => a.entidadId).filter((x): x is string => Boolean(x)))];
    const [ordenes, actor, movimientos] = await Promise.all([
      leerOrdenes(c.organizationId, ids), actores(c.organizationId, ids),
      conMovimiento ? ultimosMovimientos(c.organizationId, ids) : Promise.resolve(new Map()),
    ]);
    const porId = new Map(ordenes.map((o) => [o.id, o]));
    const vigentes = destinatariosVigentes(c);
    const salida = new Map<string, Veredicto>();
    for (const n of avisos) salida.set(n.id, await decidir(n.entidadId ? porId.get(n.entidadId) : undefined, n, { c, actor, vigentes, movimientos }));
    return salida;
  };
}

/** Vencida: fecha compromiso ya pasada (o sin fecha válida, que no la resuelve). */
function vencimiento(o: Orden, c: Ctx, actor: (id: string, a: "RESCHEDULED") => string | null): Veredicto {
  if (!o.dueDate) return sigue("Sin fecha compromiso válida: sigue pendiente");
  if (o.dueDate.getTime() <= c.ahora.getTime()) return sigue(`Vencida desde ${fecha(o.dueDate, c.cfg.zona)}`);
  return resuelto(`Vence el ${fecha(o.dueDate, c.cfg.zona)}`, `La fecha compromiso se cambió a una fecha futura (${fecha(o.dueDate, c.cfg.zona)})`,
    "Reprogramación", actor(o.id, "RESCHEDULED"));
}

// ─────────────────────────────────────────── Evaluadores por registro

async function porId<T extends { id: string }>(filas: Promise<T[]>) {
  return new Map((await filas).map((f) => [f.id, f]));
}
const ids = (avisos: AvisoAbierto[]) => [...new Set(avisos.map((a) => a.entidadId).filter((x): x is string => Boolean(x)))];

function cadaUno<T>(cargar: (c: Ctx, ids: string[]) => Promise<Map<string, T>>, decidir: (r: T | undefined, n: AvisoAbierto, c: Ctx) => Veredicto): Evaluador {
  return async (c, avisos) => {
    const registros = await cargar(c, ids(avisos));
    return new Map(avisos.map((n) => [n.id, decidir(n.entidadId ? registros.get(n.entidadId) : undefined, n, c)]));
  };
}
/** Situaciones agrupadas (una por empresa): todos los avisos corren la misma suerte. */
function agrupada(decidir: (c: Ctx) => Promise<Veredicto>): Evaluador {
  return async (c, avisos) => {
    const v = await decidir(c);
    return new Map(avisos.map((n) => [n.id, v]));
  };
}

const solicitud: Evaluador = cadaUno(
  (c, x) => porId(prisma.workRequest.findMany({
    where: { organizationId: c.organizationId, id: { in: x } },
    select: { id: true, status: true, reviewedById: true, workOrder: { select: { number: true } } },
  })),
  (s) => {
    if (!s) return resuelto("La solicitud ya no existe", "La solicitud se eliminó", "Eliminación");
    if (s.status === "PENDING") return sigue("Pendiente de revisión");
    if (s.status === "CONVERTED") return resuelto("Convertida en orden", `La solicitud se convirtió en la OT ${s.workOrder?.number ?? ""}`.trim(), "Conversión en OT", s.reviewedById);
    if (s.status === "APPROVED") return resuelto("Aprobada", "La solicitud se aprobó", "Aprobación", s.reviewedById);
    if (s.status === "REJECTED") return resuelto("Rechazada", "La solicitud se rechazó", "Rechazo", s.reviewedById);
    return resuelto(`Estado ${s.status}`, "La solicitud ya se revisó", "Revisión", s.reviewedById);
  },
);

const alertaPredictiva = (condicionEsReconocer: boolean): Evaluador => cadaUno(
  (c, x) => porId(prisma.predictiveAlert.findMany({ where: { organizationId: c.organizationId, id: { in: x } }, select: { id: true, status: true } })),
  (a) => {
    if (!a) return resuelto("La alerta ya no existe", "La alerta predictiva se eliminó", "Eliminación");
    if (a.status === "RESOLVED") return resuelto("Resuelta", "La alerta predictiva fue resuelta", "Resolución de la alerta");
    if (a.status === "DISMISSED") return resuelto("Descartada", "La alerta predictiva se descartó", "Descarte de la alerta");
    if (a.status === "ACKNOWLEDGED") {
      return condicionEsReconocer
        ? resuelto("Reconocida, sin resolver", "La alerta se reconoció en predictivo; su aviso sigue abierto hasta resolverla", "Reconocimiento de la alerta")
        : sigue("Reconocida, pero sin resolver");
    }
    return sigue("Abierta");
  },
);

const refaccionAgotada: Evaluador = async (c, avisos) => {
  const [partes, criticas] = await Promise.all([
    porId(prisma.part.findMany({ where: { organizationId: c.organizationId, id: { in: ids(avisos) } }, select: { id: true, active: true, quantityOnHand: true, unit: true } })),
    refaccionesCriticasAgotadas(c.organizationId),
  ]);
  const siguen = new Set(criticas.map((p) => p.id));
  return new Map(avisos.map((n) => {
    const p = n.entidadId ? partes.get(n.entidadId) : undefined;
    let v: Veredicto;
    if (!p || !p.active) v = resuelto("Dada de baja", "La refacción se dio de baja", "Baja de la refacción");
    else if (p.quantityOnHand > 0) v = resuelto(`Existencia ${p.quantityOnHand} ${p.unit}`, `La existencia se repuso: ${p.quantityOnHand} ${p.unit}`, "Entrada de almacén");
    else if (!siguen.has(p.id)) v = resuelto("Agotada, ya no crítica", "Dejó de ser crítica: ya no la necesita un plan de equipo crítico ni una orden abierta", "Cambio de planes u órdenes");
    else v = sigue("Agotada");
    return [n.id, v];
  }));
};

const requisicion: Evaluador = cadaUno(
  (c, x) => porId(prisma.purchaseRequest.findMany({ where: { organizationId: c.organizationId, id: { in: x } }, select: { id: true, estado: true, autorizadaPorId: true } })),
  (r) => {
    if (!r) return resuelto("Ya no existe", "La requisición se eliminó", "Eliminación");
    if (r.estado === "SOLICITADA") return sigue("Esperando autorización");
    if (r.estado === "RECHAZADA") return resuelto("Rechazada", "La requisición fue rechazada", "Rechazo", r.autorizadaPorId);
    if (r.estado === "CANCELADA") return resuelto("Cancelada", "La requisición se canceló", "Cancelación");
    return resuelto("Autorizada", "La requisición fue autorizada", "Autorización", r.autorizadaPorId);
  },
);

const ordenCompraVencida: Evaluador = cadaUno(
  (c, x) => porId(prisma.purchaseOrder.findMany({
    where: { organizationId: c.organizationId, id: { in: x } },
    select: { id: true, estado: true, fechaPrometida: true, purchaseRequest: { select: { estado: true } } },
  })),
  (o, _n, c) => {
    if (!o) return resuelto("Ya no existe", "La orden de compra se eliminó", "Eliminación");
    // La recepción actualiza la requisición: si ya se recibió completa, la orden no espera nada.
    if (o.estado === "RECIBIDA" || ["RECIBIDA", "CERRADA"].includes(o.purchaseRequest.estado)) return resuelto("Recibida completa", "La compra fue recibida completamente", "Recepción");
    if (o.estado === "CANCELADA" || compraTerminada(o.purchaseRequest.estado)) return resuelto("Cancelada", "La orden de compra se canceló", "Cancelación");
    if (o.fechaPrometida && o.fechaPrometida.getTime() > c.ahora.getTime()) {
      return resuelto(`Prometida para el ${fecha(o.fechaPrometida, c.cfg.zona)}`, `El proveedor comprometió una nueva fecha: ${fecha(o.fechaPrometida, c.cfg.zona)}`, "Cambio de fecha prometida");
    }
    return sigue(o.estado === "RECIBIDA_PARCIAL" ? "Recibida en parte y vencida" : "Vencida sin recibir");
  },
);

/**
 * El compromiso: se cierra solo cuando se marca hecho o cancelado.
 *
 * Es lo que lo distingue de una mencion —que no tiene condicion que se pueda
 * calcular— y lo que hace que la promesa deje de estar en el aire: el aviso no
 * se va hasta que alguien lo resuelve, y cuando lo resuelve se va solo.
 */
const compromiso: Evaluador = cadaUno(
  (c, x) => porId(prisma.compromiso.findMany({
    where: { organizationId: c.organizationId, id: { in: x } },
    select: { id: true, estado: true },
  })),
  (r) => {
    if (!r) return resuelto("Ya no existe", "El compromiso se eliminó", "Eliminación");
    if (r.estado === "HECHO") return resuelto("Hecho", "El compromiso se marcó como hecho", "Compromiso hecho");
    if (r.estado === "CANCELADO") return resuelto("Cancelado", "El compromiso se canceló", "Cancelación");
    return sigue("Abierto");
  },
);

// ─────────────────────────────────────────── El registro de reglas

type Clave = TipoEvento | `esc:${ClaveRegla}`;

export const REGLAS_DE_AVISO: Partial<Record<Clave, ReglaDeAviso>> = {
  COMPROMISO_ASIGNADO: {
    condicion: "Compromiso abierto a su nombre",
    nace: "Cuando alguien le anota algo a su nombre en un registro.",
    permanece: "Mientras siga abierto.",
    actualiza: "No cambia: si cambia lo que hay que hacer, se anota otro.",
    escala: "No escala: es un acuerdo entre dos personas, no una orden de trabajo.",
    atiende: "Al marcarse hecho o cancelado, o si el compromiso se elimina.",
    evaluar: compromiso,
  },
  OT_ASIGNADA: {
    condicion: "OT asignada sin iniciar",
    nace: "Al asignarse la orden a una persona.", permanece: "Mientras esa persona siga a cargo y no la inicie.",
    actualiza: "Si cambia la prioridad o el texto.", escala: "Si es alta o crítica, por «OT sin aceptar».",
    atiende: "Al iniciarse, al reasignarse (el de la persona anterior), o al terminarse, cerrarse o cancelarse.",
    evaluar: deOrdenes(async (o, n, { actor, vigentes }) => {
      const fin = finDeOrden(o, actor);
      if (fin) return fin;
      if (o!.startedAt) return resuelto("Iniciada", "La OT se inició", "Inicio de la OT", actor(o!.id, "STATUS_CHANGED"));
      if (!(await vigentes("OT_ASIGNADA", o!)).has(n.userId)) return porReasignacion(o!, actor);
      return sigue(`Asignada, sin iniciar (${ETIQUETA_OT[o!.status]})`);
    }),
  },
  OT_CRITICA_CREADA: {
    condicion: "OT crítica sin iniciar",
    nace: "Al crearse o subir a prioridad crítica.", permanece: "Mientras sea crítica y nadie la haya iniciado.",
    actualiza: "Si cambia su texto.", escala: "Por «OT crítica sin aceptar» si tiene responsable.",
    atiende: "Al iniciarse, al bajar de prioridad crítica, o al terminarse, cerrarse o cancelarse.",
    evaluar: deOrdenes((o, _n, { actor }) => {
      const fin = finDeOrden(o, actor);
      if (fin) return fin;
      if (o!.startedAt) return resuelto("Iniciada", "La OT se inició", "Inicio de la OT", actor(o!.id, "STATUS_CHANGED"));
      if (o!.priority !== "CRITICAL") return resuelto(`Prioridad ${PRIORIDAD_OT[o!.priority]}`, `La prioridad bajó de crítica a ${PRIORIDAD_OT[o!.priority]}`, "Cambio de prioridad", actor(o!.id, "UPDATED"));
      return sigue("Crítica, sin iniciar");
    }),
  },
  OT_POR_VENCER: {
    condicion: "OT próxima a vencer",
    nace: "Cuando falta menos que la anticipación de la empresa para la fecha compromiso.",
    permanece: "Mientras la fecha siga dentro de ese periodo y la orden abierta.", actualiza: "Si cambia la fecha dentro del periodo.",
    escala: "No escala: si vence, nace «OT vencida».",
    atiende: "Al vencer (pasa a vencidas), al moverse la fecha fuera del periodo, al reasignarse (el de la persona anterior), o al terminarse, cerrarse o cancelarse.",
    evaluar: deOrdenes(async (o, n, { c, actor, vigentes }) => {
      const fin = finDeOrden(o, actor);
      if (fin) return fin;
      if (!o!.dueDate) return sigue("Sin fecha compromiso válida: sigue pendiente");
      if (o!.dueDate.getTime() <= c.ahora.getTime()) return resuelto(`Vencida desde ${fecha(o!.dueDate, c.cfg.zona)}`, "La OT ya venció: el aviso sigue como «OT vencida»", "Vencimiento");
      if (o!.dueDate.getTime() - c.ahora.getTime() > c.cfg.anticipacionHoras * HORA) {
        return resuelto(`Vence el ${fecha(o!.dueDate, c.cfg.zona)}`, `La fecha compromiso se cambió al ${fecha(o!.dueDate, c.cfg.zona)}, fuera del periodo de aviso`, "Reprogramación", actor(o!.id, "RESCHEDULED"));
      }
      if (!(await vigentes("OT_POR_VENCER", o!)).has(n.userId)) return porReasignacion(o!, actor);
      return sigue(`Vence el ${fecha(o!.dueDate, c.cfg.zona)}`);
    }),
  },
  OT_VENCIDA: {
    condicion: "OT vencida: fecha compromiso en el pasado",
    nace: "Cuando pasa la fecha compromiso de una orden abierta.",
    permanece: "Mientras la fecha compromiso siga en el pasado (o vacía) y la orden abierta. Reprogramar a otra fecha pasada, o a la misma, no la resuelve.",
    actualiza: "Si cambia la fecha (a otra pasada) o sube la prioridad: el mismo aviso, con el texto nuevo.",
    escala: "Por «OT vencida sin movimiento», que es otra condición.",
    atiende: "Al reprogramarse a una fecha futura, al terminarse, cerrarse o cancelarse. Si se reasigna, se cierra el de la persona anterior y lo recibe la nueva.",
    evaluar: deOrdenes(async (o, n, { c, actor, vigentes }) => {
      const fin = finDeOrden(o, actor);
      if (fin) return fin;
      const v = vencimiento(o!, c, actor);
      if (!v.sigue) return v;
      if (!(await vigentes("OT_VENCIDA", o!)).has(n.userId)) return porReasignacion(o!, actor);
      return v;
    }),
  },
  PREVENTIVO_INCUMPLIDO: {
    condicion: "Preventivo fuera de su tolerancia",
    nace: "Cuando un preventivo de plan pasa su fecha más los días de tolerancia del plan.",
    permanece: "Mientras siga abierto y fuera de tolerancia. Editarlo no lo resuelve.", actualiza: "Si cambia la fecha a otra fuera de tolerancia.",
    escala: "No escala: aparece en resúmenes e indicadores.",
    atiende: "Al terminarse, cerrarse o cancelarse, o al reprogramarse dentro de su tolerancia.",
    evaluar: deOrdenes((o, _n, { c, actor }) => {
      const fin = finDeOrden(o, actor);
      if (fin) return fin;
      if (!o!.dueDate) return sigue("Sin fecha compromiso válida: sigue pendiente");
      const tolerancia = (o!.plan?.toleranceDays ?? 0) * 24 * HORA;
      if (c.ahora.getTime() - o!.dueDate.getTime() > tolerancia) return sigue(`Fuera de tolerancia desde ${fecha(new Date(o!.dueDate.getTime() + tolerancia), c.cfg.zona)}`);
      return o!.dueDate.getTime() > c.ahora.getTime()
        ? resuelto(`Vence el ${fecha(o!.dueDate, c.cfg.zona)}`, `La fecha compromiso se cambió a una fecha futura (${fecha(o!.dueDate, c.cfg.zona)})`, "Reprogramación", actor(o!.id, "RESCHEDULED"))
        : resuelto(`Vence el ${fecha(o!.dueDate, c.cfg.zona)}, dentro de tolerancia`, `La fecha compromiso se cambió al ${fecha(o!.dueDate, c.cfg.zona)}, dentro de su tolerancia`, "Reprogramación", actor(o!.id, "RESCHEDULED"));
    }),
  },
  OT_DETENIDA: {
    condicion: "OT en espera",
    nace: "Al poner la orden en espera.", permanece: "Mientras siga en espera.", actualiza: "Cada vez que se detiene es un aviso nuevo.",
    escala: "No escala.", atiende: "Al reanudarse, o al terminarse, cerrarse o cancelarse.",
    evaluar: deOrdenes((o, _n, { actor }) => {
      const fin = finDeOrden(o, actor);
      if (fin) return fin;
      if (o!.status === "ON_HOLD") return sigue("En espera");
      return resuelto(`En estado ${ETIQUETA_OT[o!.status]}`, "La OT se reanudó", "Reanudación", actor(o!.id, "STATUS_CHANGED"));
    }),
  },
  OT_LISTA_REVISION: {
    condicion: "OT terminada, esperando revisión",
    nace: "Al terminarse la orden.", permanece: "Mientras siga terminada sin cerrar.", actualiza: "Cada terminación es un aviso nuevo.",
    escala: "No escala.", atiende: "Al cerrarse, devolverse a trabajo o cancelarse.",
    evaluar: deOrdenes((o, _n, { actor }) => {
      if (!o) return resuelto("La OT ya no existe", "La OT se eliminó", "Eliminación de la OT");
      if (o.status === "COMPLETED") return sigue("Terminada, sin cerrar");
      if (o.status === "CLOSED") return resuelto("Cerrada", "La OT fue cerrada", "Cierre", actor(o.id, "STATUS_CHANGED"));
      if (o.status === "CANCELLED") return resuelto("Cancelada", "La OT fue cancelada", "Cancelación", actor(o.id, "STATUS_CHANGED"));
      return resuelto(`En estado ${ETIQUETA_OT[o.status]}`, "La OT se devolvió a trabajo", "Devolución", actor(o.id, "STATUS_CHANGED"));
    }),
  },
  OT_DEVUELTA: {
    condicion: "OT devuelta en revisión",
    nace: "Al devolver una orden terminada.", permanece: "Mientras el responsable no la vuelva a terminar.", actualiza: "Cada devolución es un aviso nuevo.",
    escala: "No escala.", atiende: "Al volver a terminarse, cerrarse o cancelarse; si se reasigna, el de la persona anterior.",
    evaluar: deOrdenes(async (o, n, { actor, vigentes }) => {
      if (!o) return resuelto("La OT ya no existe", "La OT se eliminó", "Eliminación de la OT");
      if (o.status === "COMPLETED") return resuelto("Terminada", "La OT se volvió a terminar", "Terminación", actor(o.id, "STATUS_CHANGED"));
      const fin = finDeOrden(o, actor);
      if (fin) return fin;
      if (!(await vigentes("OT_DEVUELTA", o)).has(n.userId)) return porReasignacion(o, actor);
      return sigue(`Devuelta, en estado ${ETIQUETA_OT[o.status]}`);
    }),
  },
  SOLICITUD_NUEVA: {
    condicion: "Solicitud pendiente de revisión",
    nace: "Al recibirse una solicitud.", permanece: "Mientras siga pendiente.", actualiza: "Si cambia su texto.",
    escala: "Si es crítica o de riesgo, por «Solicitud crítica sin revisar».", atiende: "Al convertirse en orden, aprobarse o rechazarse.",
    evaluar: solicitud,
  },
  SOLICITUD_CRITICA_SIN_ATENDER: {
    condicion: "Solicitud crítica pendiente de revisión",
    nace: "Por escalamiento, si una solicitud crítica sigue pendiente.", permanece: "Mientras siga pendiente.", actualiza: "Cada recordatorio.",
    escala: "Revisores, luego administración.", atiende: "Al convertirse en orden, aprobarse o rechazarse.",
    evaluar: solicitud,
  },
  PLAN_FALLO_GENERAR: {
    condicion: "El programador de preventivos falló",
    nace: "Cuando falla la corrida del programador.", permanece: "Hasta que vuelva a correr bien.", actualiza: "Un aviso por día de falla.",
    escala: "No escala.", atiende: "Cuando el programador vuelve a correr sin error (lo confirma el programador).",
    evaluar: null,
  },
  PLAN_SIN_PROGRAMACION: {
    condicion: "Plan sin programación válida",
    nace: "Cuando el programador no puede calcular cuándo toca un plan.", permanece: "Mientras el programador lo siga reportando.",
    actualiza: "Si cambia el motivo.", escala: "No escala.", atiende: "Cuando el programador ya puede programarlo (lo confirma el programador).",
    evaluar: null,
  },
  ACTIVO_CRITICO_SIN_PLAN: {
    condicion: "Equipos críticos sin plan preventivo",
    nace: "Si hay equipos de criticidad A sin plan activo.", permanece: "Mientras quede al menos uno.", actualiza: "La lista, en el mismo aviso.",
    escala: "No escala.", atiende: "Cuando todos los equipos críticos tienen plan.",
    evaluar: agrupada(async (c) => {
      const n = (await criticosSinPlan(c.organizationId)).length;
      return n ? sigue(`${n} equipo(s) crítico(s) sin plan`) : resuelto("Todos con plan", "Todos los equipos críticos tienen plan preventivo", "Asignación de planes");
    }),
  },
  UMBRAL_CERCA: {
    condicion: "Sensor cerca de su límite",
    nace: "Cuando un sensor entra en advertencia.", permanece: "Mientras siga en advertencia.", actualiza: "Si cambia la lectura.",
    escala: "Si cruza el crítico nace «Umbral excedido».", atiende: "Al regresar a lo normal, o al pasar a umbral excedido (sigue en ese aviso).",
    evaluar: cadaUno(
      (c, x) => porId(prisma.sensor.findMany({ where: { organizationId: c.organizationId, id: { in: x } }, select: { id: true, active: true, lastStatus: true, lastValue: true, unit: true } })),
      (s) => {
        if (!s || !s.active) return resuelto("Sensor inactivo", "El sensor se desactivó o se eliminó", "Baja del sensor");
        if (s.lastStatus === "WARNING") return sigue("En advertencia");
        if (s.lastStatus === "CRITICAL") return resuelto("Crítico", "La condición pasó a umbral excedido: sigue en ese aviso", "Nueva lectura");
        return resuelto("Normal", `La condición regresó a lo normal (última lectura ${s.lastValue ?? "—"} ${s.unit})`, "Nueva lectura");
      },
    ),
  },
  UMBRAL_EXCEDIDO: {
    condicion: "Sensor fuera de su límite crítico",
    nace: "Cuando un sensor cruza su umbral crítico.", permanece: "Mientras siga en crítico.", actualiza: "Si cambia la lectura.",
    escala: "Por la alerta predictiva crítica.", atiende: "Al bajar del umbral crítico o regresar a lo normal.",
    evaluar: cadaUno(
      (c, x) => porId(prisma.sensor.findMany({ where: { organizationId: c.organizationId, id: { in: x } }, select: { id: true, active: true, lastStatus: true, lastValue: true, unit: true } })),
      (s) => {
        if (!s || !s.active) return resuelto("Sensor inactivo", "El sensor se desactivó o se eliminó", "Baja del sensor");
        if (s.lastStatus === "CRITICAL") return sigue("En crítico");
        if (s.lastStatus === "WARNING") return resuelto("En advertencia", "La lectura bajó del umbral crítico; sigue cerca del límite", "Nueva lectura");
        return resuelto("Normal", `La condición regresó a lo normal (última lectura ${s.lastValue ?? "—"} ${s.unit})`, "Nueva lectura");
      },
    ),
  },
  LECTURA_ANORMAL: {
    condicion: "Lectura anormal que suspende la proyección",
    nace: "Cuando una lectura inválida suspende la proyección del medidor.", permanece: "Mientras siga suspendida.", actualiza: "Si cambia el motivo.",
    escala: "No escala.", atiende: "Al corregirse o anularse la lectura.",
    evaluar: cadaUno(
      (c, x) => porId(prisma.meter.findMany({ where: { organizationId: c.organizationId, id: { in: x } }, select: { id: true, proyeccionSuspendida: true } })),
      (m) => {
        if (!m) return resuelto("El medidor ya no existe", "El medidor se eliminó", "Eliminación");
        return m.proyeccionSuspendida ? sigue("Proyección suspendida") : resuelto("Proyección activa", "La lectura anormal se corrigió o se anuló", "Corrección de lectura");
      },
    ),
  },
  MEDIDOR_SIN_LECTURA: {
    condicion: "Medidores de planes por uso sin lectura en 7 días",
    nace: "Si un medidor que alimenta un plan por uso no recibe lectura en 7 días.", permanece: "Mientras quede al menos uno.",
    actualiza: "La lista, en el mismo aviso.", escala: "No escala.", atiende: "Al registrarse las lecturas requeridas.",
    evaluar: agrupada(async (c) => {
      const n = (await medidoresSinLectura(c.organizationId, c.ahora)).length;
      return n ? sigue(`${n} medidor(es) sin lectura`) : resuelto("Todos con lectura", "Se registró la lectura requerida: todos los medidores tienen lectura de los últimos 7 días", "Registro de lecturas");
    }),
  },
  ALERTA_PREDICTIVA: {
    condicion: "Alerta predictiva abierta",
    nace: "Al abrirse una alerta predictiva.", permanece: "Mientras la alerta no se resuelva ni se descarte. Reconocerla no la resuelve.",
    actualiza: "Si la alerta empeora.", escala: "Si es crítica y nadie la reconoce, por «Alerta crítica sin reconocer».",
    atiende: "Al resolverse o descartarse la alerta.",
    evaluar: alertaPredictiva(false),
  },
  ALERTA_CRITICA_SIN_ATENDER: {
    condicion: "Alerta crítica sin reconocer",
    nace: "Por escalamiento, si una alerta crítica sigue sin reconocerse.", permanece: "Mientras nadie la reconozca en predictivo.",
    actualiza: "Cada recordatorio.", escala: "Supervisores, luego administración.",
    atiende: "Al reconocerse la alerta en predictivo (el aviso de la alerta sigue hasta resolverla), resolverse o descartarse.",
    evaluar: alertaPredictiva(true),
  },
  REFACCION_BAJO_MINIMO: {
    condicion: "Refacciones en o bajo su mínimo",
    nace: "Si una refacción llega a su mínimo.", permanece: "Mientras quede al menos una.", actualiza: "La lista, en el mismo aviso.",
    escala: "No escala.", atiende: "Cuando todas quedan por encima de su mínimo.",
    evaluar: agrupada(async (c) => {
      const n = (await refaccionesBajoMinimo(c.organizationId)).length;
      return n ? sigue(`${n} refacción(es) en o bajo su mínimo`) : resuelto("Todas sobre su mínimo", "La existencia se repuso: todas las refacciones están por encima de su mínimo", "Entradas de almacén");
    }),
  },
  REFACCION_CRITICA_AGOTADA: {
    condicion: "Refacción crítica agotada",
    nace: "Cuando una refacción crítica llega a cero.", permanece: "Mientras siga en cero y siga siendo crítica.", actualiza: "Si cambia el motivo.",
    escala: "Almacén, luego supervisión.", atiende: "Al reponerse la existencia, o si deja de ser crítica.",
    evaluar: refaccionAgotada,
  },
  REQUISICION_POR_AUTORIZAR: {
    condicion: "Requisición esperando autorización",
    nace: "Al pedirse una compra.", permanece: "Mientras siga solicitada.", actualiza: "Si sube la urgencia.",
    escala: "Autorizadores, luego el dueño.", atiende: "Al autorizarse, rechazarse o cancelarse.",
    evaluar: requisicion,
  },
  ORDEN_COMPRA_PENDIENTE: {
    condicion: "Compra autorizada sin orden de compra",
    nace: "Si una compra lleva un día autorizada sin orden de compra.", permanece: "Mientras no tenga orden de compra.", actualiza: "No cambia.",
    escala: "No escala.", atiende: "Al colocarse la orden de compra, o al cancelarse.",
    evaluar: cadaUno(
      (c, x) => porId(prisma.purchaseRequest.findMany({ where: { organizationId: c.organizationId, id: { in: x } }, select: { id: true, estado: true, ordenCompra: true, ordenes: { select: { folio: true }, take: 1 } } })),
      (r) => {
        if (!r) return resuelto("Ya no existe", "La requisición se eliminó", "Eliminación");
        const folio = r.ordenes[0]?.folio ?? r.ordenCompra;
        if (r.estado === "CANCELADA" || r.estado === "RECHAZADA") return resuelto(r.estado === "CANCELADA" ? "Cancelada" : "Rechazada", `La requisición fue ${r.estado === "CANCELADA" ? "cancelada" : "rechazada"}`, "Cancelación");
        // Con el proceso interno, la orden es un registro; con el del ERP, la requisición pasa a «en compra» con su folio.
        if (r.ordenes.length || r.estado !== "AUTORIZADA") return resuelto(folio ? `Con orden ${folio}` : "Colocada", folio ? `Se colocó la orden de compra ${folio}` : "Se colocó la orden de compra", "Orden de compra");
        return sigue("Autorizada, sin orden de compra");
      },
    ),
  },
  ENTREGA_VENCIDA: {
    condicion: "Compra vencida sin recibir completa",
    nace: "Cuando pasa la fecha prometida de una orden de compra abierta.", permanece: "Mientras siga sin recibirse completa y con la fecha en el pasado.",
    actualiza: "Si el proveedor promete otra fecha también pasada.", escala: "Compras, luego autorizadores.",
    atiende: "Al recibirse completa, cancelarse, o al comprometer el proveedor una fecha futura.",
    evaluar: ordenCompraVencida,
  },
  RECEPCION_PARCIAL: {
    condicion: "Compra recibida en parte",
    nace: "Al recibirse solo una parte.", permanece: "Mientras falte algo por llegar.", actualiza: "La lista de faltantes.",
    escala: "No escala.", atiende: "Al recibirse completa, cerrarse o cancelarse.",
    evaluar: cadaUno(
      (c, x) => porId(prisma.purchaseRequest.findMany({ where: { organizationId: c.organizationId, id: { in: x } }, select: { id: true, estado: true } })),
      (r) => {
        if (!r) return resuelto("Ya no existe", "La requisición se eliminó", "Eliminación");
        if (r.estado === "RECIBIDA_PARCIAL") return sigue("Recibida en parte");
        if (r.estado === "CANCELADA") return resuelto("Cancelada", "La compra se canceló", "Cancelación");
        return resuelto("Recibida completa", "La compra fue recibida completamente", "Recepción");
      },
    ),
  },
  PRUEBA_POR_TERMINAR: {
    condicion: "Periodo de prueba por terminar",
    nace: "Siete días antes de que termine la prueba.", permanece: "Mientras siga en prueba y la fecha esté cerca.", actualiza: "Si cambia la fecha.",
    escala: "No escala.", atiende: "Al elegir un plan, o si la prueba se extiende.",
    evaluar: agrupada(async (c) => {
      const org = await prisma.organization.findUnique({ where: { id: c.organizationId }, select: { status: true, trialEndsAt: true } });
      if (org?.status === "ACTIVE") return resuelto("Cuenta activa", "Se eligió un plan: la cuenta ya no está en periodo de prueba", "Contratación");
      if (org?.trialEndsAt && org.trialEndsAt.getTime() - c.ahora.getTime() > 7 * 24 * HORA) {
        return resuelto(`Prueba hasta el ${fecha(org.trialEndsAt, c.cfg.zona)}`, `El periodo de prueba se extendió al ${fecha(org.trialEndsAt, c.cfg.zona)}`, "Extensión de la prueba");
      }
      return sigue("En prueba, por terminar");
    }),
  },
  LIMITE_PLAN_ALCANZADO: {
    condicion: "Límite del plan alcanzado",
    nace: "Al llegar al límite de un recurso del plan.", permanece: "Mientras siga en el límite.", actualiza: "No cambia.",
    escala: "No escala.", atiende: "Cuando vuelve a haber cupo (se cambia de plan o se liberan registros).",
    evaluar: async (c, avisos) => {
      const org = await prisma.organization.findUnique({ where: { id: c.organizationId }, select: { plan: true } });
      const consumo = org ? await consumoDe(c.organizationId, org.plan) : [];
      return new Map(avisos.map((n) => {
        const recurso = consumo.find((x) => n.entidadId === `${c.organizationId}:${x.recurso}`);
        if (!recurso || recurso.ilimitado || !recurso.excedido) {
          return [n.id, resuelto("Con cupo", recurso && !recurso.ilimitado ? `Hay cupo de nuevo: ${recurso.uso} de ${recurso.limite}` : "El plan ya no limita este recurso", "Cambio de plan o de uso")];
        }
        return [n.id, sigue(`${recurso.uso} de ${recurso.limite}`)];
      }));
    },
  },
  INTEGRACION_CON_ERRORES: {
    condicion: "Integración con errores",
    nace: "Al suspenderse un webhook por fallas, o al rebasar una credencial su límite muchas veces.",
    permanece: "Mientras el webhook siga suspendido o la credencial siga activa.", actualiza: "Cada hora de abuso es un aviso nuevo.",
    escala: "No escala.", atiende: "Al reactivarse o eliminarse el webhook, o al revocarse la credencial.",
    evaluar: async (c, avisos) => {
      const x = ids(avisos);
      const [webhooks, credenciales] = await Promise.all([
        porId(prisma.webhook.findMany({ where: { organizationId: c.organizationId, id: { in: x } }, select: { id: true, estado: true } })),
        porId(prisma.credencialApi.findMany({ where: { organizationId: c.organizationId, id: { in: x } }, select: { id: true, estado: true, revocadaPorId: true } })),
      ]);
      return new Map(avisos.map((n) => {
        const w = n.entidadId ? webhooks.get(n.entidadId) : undefined;
        const k = n.entidadId ? credenciales.get(n.entidadId) : undefined;
        if (w) return [n.id, w.estado === "SUSPENDIDO" ? sigue("Webhook suspendido") : resuelto("Webhook activo", "El webhook se reactivó", "Reactivación")];
        if (k) return [n.id, k.estado === "REVOCADA" ? resuelto("Credencial revocada", "La credencial se revocó", "Revocación", k.revocadaPorId) : sigue("Credencial activa")];
        return [n.id, resuelto("Ya no existe", "La integración se eliminó", "Eliminación")];
      }));
    },
  },
  CONFIGURACION_INCOMPLETA: {
    condicion: "Avisos sin destinatario válido",
    nace: "Cuando un aviso no tiene a quién llegar.", permanece: "Mientras el último aviso de ese tipo siga sin destinatario.",
    actualiza: "Si cambia lo que falta.", escala: "No escala.", atiende: "Cuando un aviso posterior de ese tipo sí llega a alguien.",
    evaluar: async (c, avisos) => {
      const salida = new Map<string, Veredicto>();
      for (const n of avisos) {
        if (!n.entidadId) { salida.set(n.id, sigue("Sin destinatario")); continue; }
        const [ultimoSin, ultimoCon] = await Promise.all([
          prisma.entregaAviso.findFirst({ where: { organizationId: c.organizationId, tipo: n.entidadId, estado: "SIN_DESTINATARIO" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
          prisma.notification.findFirst({ where: { organizationId: c.organizationId, tipo: n.entidadId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
        ]);
        const llego = ultimoCon && (!ultimoSin || ultimoCon.createdAt.getTime() > ultimoSin.createdAt.getTime()) && ultimoCon.createdAt.getTime() > desdeAviso(n).getTime();
        const titulo = EVENTOS[n.entidadId as TipoEvento]?.titulo ?? n.entidadId;
        salida.set(n.id, llego ? resuelto("Con destinatario", `Los avisos de «${titulo}» ya tienen a quién llegar`, "Configuración de destinatarios") : sigue("Sin destinatario"));
      }
      return salida;
    },
  },

  OT_SIN_ACEPTAR: {
    condicion: "OT alta o crítica asignada sin iniciar",
    nace: "Por escalamiento, si una OT alta o crítica asignada no se inicia.", permanece: "Mientras siga sin iniciarse, alta o crítica y con el mismo responsable.",
    actualiza: "Cada recordatorio.", escala: "Responsable, luego supervisión.",
    atiende: "Al iniciarse, bajar de prioridad, quitarle el responsable, o al terminarse, cerrarse o cancelarse. «Enterado» detiene el escalamiento pero no atiende el aviso.",
    evaluar: sinAceptar(null),
  },

  // ─────────────────────────────────────────── Recordatorios de escalamiento
  "esc:OT_CRITICA_SIN_ACEPTAR": {
    condicion: "OT crítica asignada sin iniciar",
    nace: "Por escalamiento, si una OT crítica asignada no se inicia.", permanece: "Mientras siga sin iniciarse, crítica y con el mismo responsable.",
    actualiza: "Cada recordatorio.", escala: "Responsable, luego supervisores y administración.",
    atiende: "Al iniciarse, bajar de prioridad, quitarle el responsable, o al terminarse, cerrarse o cancelarse. Si se reasigna, el del responsable anterior. «Enterado» detiene el escalamiento pero no atiende el aviso.",
    evaluar: sinAceptar("CRITICAL"),
  },
  "esc:OT_ALTA_SIN_ACEPTAR": {
    condicion: "OT alta asignada sin iniciar",
    nace: "Por escalamiento, si una OT alta asignada no se inicia.", permanece: "Mientras siga sin iniciarse, alta y con el mismo responsable.",
    actualiza: "Cada recordatorio.", escala: "Responsable, luego supervisores.",
    atiende: "Al iniciarse, cambiar de prioridad, quitarle el responsable, o al terminarse, cerrarse o cancelarse. Si se reasigna, el del responsable anterior.",
    evaluar: sinAceptar("HIGH"),
  },
  "esc:OT_VENCIDA_SIN_ACTUALIZAR": {
    condicion: "OT vencida sin movimiento",
    nace: "Por escalamiento, si una OT vencida pasa una jornada sin movimiento válido.",
    permanece: "Mientras no haya movimiento válido después del recordatorio. Leerlo, «Enterado», comentar o editar un campo no cuentan.",
    actualiza: "Cada recordatorio.", escala: "Responsable, luego supervisores.",
    atiende: "Con movimiento válido (inicio, avance, cambio de estado, reprogramación a fecha futura con motivo), o si deja de estar vencida. El aviso «OT vencida» se evalúa aparte y sigue mientras siga vencida.",
    evaluar: deOrdenes((o, n, { c, actor, movimientos }) => {
      const fin = finDeOrden(o, actor);
      if (fin) return fin;
      const v = vencimiento(o!, c, actor);
      if (!v.sigue) return v;
      const m = movimientos.get(o!.id);
      if (m && m.el.getTime() > desdeAviso(n).getTime()) return resuelto(`Movimiento: ${m.que}`, `Hubo movimiento en la OT: ${m.que}. Sigue vencida`, "Movimiento", m.actorId);
      if (nivelDe(n) === 0 && o!.assignedToId !== n.userId) return porReasignacion(o!, actor);
      return sigue(`Vencida sin movimiento${m ? ` desde ${fecha(m.el, c.cfg.zona)}` : ""}`);
    }, true),
  },
  "esc:SOLICITUD_CRITICA_SIN_CLASIFICAR": {
    condicion: "Solicitud crítica pendiente de revisión",
    nace: "Por escalamiento.", permanece: "Mientras siga pendiente.", actualiza: "Cada recordatorio.", escala: "Revisores, luego administración.",
    atiende: "Al convertirse en orden, aprobarse o rechazarse.",
    evaluar: solicitud,
  },
  "esc:REQUISICION_SIN_AUTORIZAR": {
    condicion: "Requisición esperando autorización",
    nace: "Por escalamiento.", permanece: "Mientras siga solicitada.", actualiza: "Cada recordatorio.", escala: "Autorizadores, luego el dueño.",
    atiende: "Al autorizarse, rechazarse o cancelarse.",
    evaluar: requisicion,
  },
  "esc:ALERTA_CRITICA_SIN_RECONOCER": {
    condicion: "Alerta crítica sin reconocer",
    nace: "Por escalamiento.", permanece: "Mientras nadie la reconozca en predictivo.", actualiza: "Cada recordatorio.", escala: "Supervisores, luego administración.",
    atiende: "Al reconocerse, resolverse o descartarse la alerta.",
    evaluar: alertaPredictiva(true),
  },
  "esc:REFACCION_CRITICA_AGOTADA": {
    condicion: "Refacción crítica agotada",
    nace: "Por escalamiento.", permanece: "Mientras siga agotada y crítica.", actualiza: "Cada recordatorio.", escala: "Almacén, luego supervisión.",
    atiende: "Al reponerse, o si deja de ser crítica.",
    evaluar: refaccionAgotada,
  },
  "esc:COMPRA_VENCIDA_SIN_RECEPCION": {
    condicion: "Compra vencida sin recibir completa",
    nace: "Por escalamiento.", permanece: "Mientras siga vencida y sin recibir completa.", actualiza: "Cada recordatorio.", escala: "Compras, luego autorizadores.",
    atiende: "Al recibirse completa, cancelarse o comprometerse una fecha futura.",
    evaluar: ordenCompraVencida,
  },
};

/** Sin aceptar: de una prioridad dada, o (sin ella) alta o crítica. */
function sinAceptar(prioridad: "CRITICAL" | "HIGH" | null): Evaluador {
  return deOrdenes((o, n, { actor }) => {
    const fin = finDeOrden(o, actor);
    if (fin) return fin;
    if (o!.startedAt) return resuelto("Iniciada", "La OT se inició", "Inicio de la OT", actor(o!.id, "STATUS_CHANGED"));
    if (prioridad ? o!.priority !== prioridad : !["HIGH", "CRITICAL"].includes(o!.priority)) return resuelto(`Prioridad ${PRIORIDAD_OT[o!.priority]}`, `La prioridad cambió a ${PRIORIDAD_OT[o!.priority]}`, "Cambio de prioridad", actor(o!.id, "UPDATED"));
    if (!o!.assignedToId) return porReasignacion(o!, actor);
    if (nivelDe(n) === 0 && o!.assignedToId !== n.userId) return porReasignacion(o!, actor);
    return sigue(`Asignada a ${o!.assignedTo?.name ?? "—"}, sin iniciar`);
  });
}

// ─────────────────────────────────────────── Aplicar

export type Origen = "FLUJO" | "RECONCILIACION" | "PROGRAMADOR";

/**
 * Marca atendido un aviso y deja el porqué. Solo si sigue abierto: dos
 * procesos que lo resuelven a la vez no duplican el historial.
 */
export async function marcarAtendido(
  n: { id: string; organizationId: string; userId: string; tipo: string; entidadId: string | null; claveDedup: string | null },
  r: { motivo: string; condicionActual: string; evento: string; actorId?: string | null; origen: Origen },
  ahora = new Date(),
): Promise<boolean> {
  const hecho = await prisma.notification.updateMany({
    where: { id: n.id, atendidaEl: null },
    data: { atendidaEl: ahora, atendidaMotivo: r.motivo.slice(0, 180) },
  });
  if (!hecho.count) return false;
  await prisma.entregaAviso.updateMany({
    where: { notificationId: n.id, estado: { in: ["PENDIENTE", "EN_REINTENTO"] } },
    data: { estado: "CANCELADA", errorCategoria: "RESUELTO", errorDetalle: r.motivo.slice(0, 180) },
  });
  const regla = REGLAS_DE_AVISO[condicionDe(n) as Clave];
  await prisma.historialAviso.create({
    data: {
      organizationId: n.organizationId, notificationId: n.id, userId: n.userId, tipo: n.tipo, entidadId: n.entidadId,
      cambio: "ATENDIDA", condicionAnterior: regla?.condicion ?? EVENTOS[n.tipo as TipoEvento]?.titulo ?? n.tipo,
      condicionActual: r.condicionActual.slice(0, 180), evento: r.evento.slice(0, 120), actorId: r.actorId ?? null,
      origen: r.origen, motivo: r.motivo.slice(0, 180), createdAt: ahora,
    },
  }).catch(() => undefined);
  return true;
}

const SELECCION = { id: true, tipo: true, entidadId: true, userId: true, claveDedup: true, createdAt: true, actualizadaEl: true, organizationId: true } as const;

export type Decision = { id: string; tipo: string; condicion: string; entidadId: string | null; userId: string; sigue: boolean; motivo: string | null; estado: string };
export type ResultadoReconciliacion = { revisados: number; atendidos: number; unificados: number; decisiones?: Decision[] };

/**
 * Compara los avisos abiertos con el estado real de sus registros. Atiende
 * los que se resolvieron, con su motivo; deja los que siguen; y si una misma
 * persona tiene dos avisos abiertos de la misma condición sobre el mismo
 * registro, deja uno.
 *
 * `entidadId` la acota a un registro (lo que llaman los flujos, en el
 * momento); sin él, revisa toda la empresa (el proceso programado). Nunca
 * lanza: un aviso no tumba la operación.
 */
export async function reconciliar(p: {
  organizationId: string; ahora?: Date; entidadId?: string; tipos?: string[];
  origen?: Origen; actorId?: string | null; evento?: string; cfg?: ConfigEmpresa;
  /** Solo decir qué haría, sin escribir nada (para revisar datos reales antes de aplicar). */
  ensayo?: boolean;
}): Promise<ResultadoReconciliacion> {
  const res: ResultadoReconciliacion = { revisados: 0, atendidos: 0, unificados: 0, ...(p.ensayo ? { decisiones: [] } : {}) };
  const anotar = (n: AvisoAbierto, sigueAbierto: boolean, motivo: string | null, estado: string) =>
    res.decisiones?.push({ id: n.id, tipo: n.tipo, condicion: condicionDe(n), entidadId: n.entidadId, userId: n.userId, sigue: sigueAbierto, motivo, estado });
  try {
    const ahora = p.ahora ?? new Date();
    const abiertos = await prisma.notification.findMany({
      where: {
        organizationId: p.organizationId, requiereAccion: true, atendidaEl: null,
        ...(p.entidadId ? { entidadId: p.entidadId } : {}), ...(p.tipos ? { tipo: { in: p.tipos } } : {}),
      },
      select: SELECCION,
      take: 20_000,
    });
    if (!abiertos.length) return res;
    res.revisados = abiertos.length;
    const c: Ctx = { organizationId: p.organizationId, ahora, cfg: p.cfg ?? await configDe(p.organizationId, ahora) };

    const grupos = new Map<string, AvisoAbierto[]>();
    for (const n of abiertos) {
      const k = condicionDe(n);
      grupos.set(k, [...(grupos.get(k) ?? []), n]);
    }
    const siguen: AvisoAbierto[] = [];
    for (const [k, avisos] of grupos) {
      const regla = REGLAS_DE_AVISO[k as Clave];
      if (!regla?.evaluar) { siguen.push(...avisos); for (const n of avisos) anotar(n, true, null, "lo decide su proceso"); continue; }
      let veredictos: Map<string, Veredicto>;
      try { veredictos = await regla.evaluar(c, avisos); } catch (e) {
        console.error(`[avisos] reconciliar ${k}:`, e instanceof Error ? e.message : e);
        siguen.push(...avisos);
        continue;
      }
      for (const n of avisos) {
        const v = veredictos.get(n.id);
        if (!v || v.sigue) { siguen.push(n); anotar(n, true, null, v?.condicion ?? "sin regla"); continue; }
        if (p.ensayo) { anotar(n, false, v.motivo, v.condicion); res.atendidos++; continue; }
        const ok = await marcarAtendido(n, {
          motivo: v.motivo, condicionActual: v.condicion, evento: p.evento ? `${v.evento} (${p.evento})` : v.evento,
          // En un flujo se sabe quién actuó; en la reconciliación, lo dice la bitácora.
          actorId: p.actorId ?? v.actorId ?? null, origen: p.origen ?? "RECONCILIACION",
        }, ahora);
        if (ok) res.atendidos++;
      }
    }

    // Dos avisos abiertos de la misma condición, misma persona, mismo registro:
    // queda el más reciente (es al que llegan las actualizaciones).
    const vistos = new Map<string, AvisoAbierto[]>();
    for (const n of siguen) {
      if (!n.entidadId) continue;
      const k = `${n.userId}|${condicionDe(n)}|${n.entidadId}`;
      vistos.set(k, [...(vistos.get(k) ?? []), n]);
    }
    for (const lista of vistos.values()) {
      if (lista.length < 2) continue;
      lista.sort((a, b) => desdeAviso(b).getTime() - desdeAviso(a).getTime());
      for (const viejo of lista.slice(1)) {
        if (p.ensayo) {
          const d = res.decisiones?.find((x) => x.id === viejo.id);
          if (d) { d.sigue = false; d.motivo = "Se unificó con el aviso vigente del mismo registro"; }
          res.unificados++;
          continue;
        }
        const ok = await marcarAtendido(viejo, {
          motivo: "Se unificó con el aviso vigente del mismo registro", condicionActual: "Sigue en el aviso más reciente",
          evento: "Unificación de avisos repetidos", origen: "RECONCILIACION",
        }, ahora);
        if (ok) res.unificados++;
      }
    }
  } catch (e) {
    console.error("[avisos] reconciliar:", e instanceof Error ? e.message : e);
  }
  return res;
}

/**
 * Por qué se detuvo un escalamiento, dicho igual que en el aviso. Si la regla
 * no lo sabe decir, el motivo es el de la regla, no «el registro cambió».
 */
export async function motivoDeDetencion(organizationId: string, clave: ClaveRegla, entidadId: string, ahora: Date, cfg: ConfigEmpresa): Promise<string> {
  const regla = REGLAS_DE_AVISO[`esc:${clave}`];
  const falso: AvisoAbierto = { id: "-", tipo: REGLAS_RECOMENDADAS[clave].evento, entidadId, userId: "-", claveDedup: `x:${entidadId}:esc-${clave}-1`, createdAt: ahora, actualizadaEl: ahora, organizationId };
  try {
    const v = regla?.evaluar ? (await regla.evaluar({ organizationId, ahora, cfg }, [falso])).get("-") : null;
    if (v && !v.sigue) return v.motivo;
  } catch { /* abajo */ }
  return `Dejó de cumplirse: ${REGLAS_RECOMENDADAS[clave].cuando.replace(/\.$/, "").toLowerCase()}`;
}
