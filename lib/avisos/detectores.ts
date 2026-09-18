/**
 * Lo que el sistema tiene que notar solo, sin que nadie abra MainTrack.
 *
 * El proceso programado recorre cada empresa y revisa condiciones: órdenes
 * por vencer o vencidas, preventivos incumplidos, planes sin programación,
 * equipos críticos sin plan, medidores sin lectura, refacciones bajo mínimo,
 * compras sin autorizar o vencidas, periodo de prueba, límites del plan.
 *
 * Dos garantías:
 *
 *  - Deduplicación: cada condición emite con su clave; correr el proceso cada
 *    cinco minutos no produce un aviso nuevo cada cinco minutos.
 *  - Conciliación: los avisos que piden acción se marcan «atendidos» solos
 *    cuando la condición deja de existir (la orden se terminó, la compra se
 *    autorizó, la refacción se repuso). Leer un aviso no lo atiende.
 *
 * Además es red de seguridad: si algún flujo creó una orden asignada o
 * crítica sin avisar (hay seis lugares que crean órdenes), aquí se avisa.
 */
import { prisma } from "../db";
import { emitirAviso, atenderAvisos } from "./emitir";
import { calcularPrioridad, tiempoPendiente } from "./prioridad";
import type { ConfigEmpresa } from "./config";
import type { TipoEvento } from "./catalogo";
import { consumoDe, planDe } from "../planes";

const ACTIVAS = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"];
const HORA = 3_600_000;
const fecha = (d: Date, zona: string) => d.toLocaleDateString("es-MX", { timeZone: zona, day: "numeric", month: "short" });

/** Avisos abiertos (sin atender) de ciertos tipos, por registro. */
async function abiertos(organizationId: string, tipos: TipoEvento[]) {
  const ns = await prisma.notification.findMany({
    where: { organizationId, tipo: { in: tipos }, atendidaEl: null, requiereAccion: true },
    select: { id: true, tipo: true, entidadId: true, userId: true, claveDedup: true },
  });
  return ns;
}

/** Registros que ya tienen aviso de un tipo, para la red de seguridad. */
async function yaAvisados(organizationId: string, tipo: TipoEvento, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const ns = await prisma.notification.findMany({
    where: { organizationId, tipo, entidadId: { in: ids } }, select: { entidadId: true },
  });
  return new Set(ns.map((n) => n.entidadId!));
}

export type ResultadoDeteccion = Record<string, number>;

export async function detectar(organizationId: string, cfg: ConfigEmpresa, ahora = new Date()): Promise<ResultadoDeteccion> {
  const r: ResultadoDeteccion = {};
  const suma = (k: string, n = 1) => { r[k] = (r[k] ?? 0) + n; };
  const zona = cfg.zona;

  // ─────────────────────────────────────────── Órdenes de trabajo
  const ordenes = await prisma.workOrder.findMany({
    where: { organizationId, status: { in: ACTIVAS } },
    select: {
      id: true, number: true, title: true, status: true, priority: true, maintenanceType: true, assignedToId: true,
      createdById: true, siteId: true, dueDate: true, createdAt: true, updatedAt: true, planId: true, startedAt: true,
      asset: { select: { code: true, criticality: true } },
      plan: { select: { toleranceDays: true } },
    },
    take: 5000,
  });

  // Red de seguridad: asignadas y críticas recientes sin aviso.
  const recientes = ordenes.filter((o) => ahora.getTime() - o.updatedAt.getTime() < 48 * HORA);
  const conAsignacion = await yaAvisados(organizationId, "OT_ASIGNADA", recientes.map((o) => o.id));
  for (const o of recientes) {
    if (o.assignedToId && !o.startedAt && !conAsignacion.has(o.id)) {
      await avisarAsignacion(organizationId, o);
      suma("OT_ASIGNADA");
    }
  }
  // Las predictivas ya se avisan como alerta predictiva, con liga a su orden.
  const criticas = recientes.filter((o) => o.priority === "CRITICAL" && !o.startedAt && o.maintenanceType !== "PREDICTIVE");
  const conCritica = await yaAvisados(organizationId, "OT_CRITICA_CREADA", criticas.map((o) => o.id));
  for (const o of criticas) {
    if (conCritica.has(o.id)) continue;
    await avisarOtCritica(organizationId, o);
    suma("OT_CRITICA_CREADA");
  }

  const anticipacion = cfg.anticipacionHoras * HORA;
  for (const o of ordenes) {
    if (!o.dueDate || o.status === "ON_HOLD") continue;
    const restante = o.dueDate.getTime() - ahora.getTime();
    const version = o.dueDate.toISOString();
    const asset = o.asset ? ` · ${o.asset.code}` : "";
    if (restante > 0 && restante <= anticipacion) {
      const { prioridad, razones } = calcularPrioridad("MEDIA", { prioridadRegistro: o.priority, criticidadActivo: o.asset?.criticality });
      await emitirAviso({
        organizationId, tipo: "OT_POR_VENCER", entidad: "WorkOrder", entidadId: o.id, version, prioridad,
        titulo: `${o.number} vence ${fecha(o.dueDate, zona)}${asset}`, cuerpo: o.title, enlace: `/work-orders/${o.id}`,
        porQue: `Vence en ${tiempoPendiente(ahora, o.dueDate)}${razones.length ? `; ${razones.join(", ")}` : ""}.`,
        accion: "Termínela a tiempo o reprograme la fecha si no se alcanza.",
        contexto: { responsableId: o.assignedToId, siteId: o.siteId }, tag: o.number,
        datos: { folio: o.number, vence: version },
      });
      suma("OT_POR_VENCER");
    } else if (restante <= 0) {
      const horas = restante / HORA;
      const { prioridad, razones } = calcularPrioridad("ALTA", { prioridadRegistro: o.priority, criticidadActivo: o.asset?.criticality, horasRestantes: horas });
      await emitirAviso({
        organizationId, tipo: "OT_VENCIDA", entidad: "WorkOrder", entidadId: o.id, version, prioridad,
        titulo: `${o.number} vencida desde ${fecha(o.dueDate, zona)}${asset}`, cuerpo: o.title, enlace: `/work-orders/${o.id}`,
        porQue: `Lleva ${tiempoPendiente(o.dueDate, ahora)} vencida${razones.length ? `; ${razones.join(", ")}` : ""}.`,
        accion: "Actualice su avance, termínela o reprograme con motivo.",
        contexto: { responsableId: o.assignedToId, siteId: o.siteId }, tag: o.number,
        datos: { folio: o.number, vencio: version },
      });
      suma("OT_VENCIDA");
      // Preventivo que ya pasó su tolerancia: además, incumplimiento.
      const tolerancia = (o.plan?.toleranceDays ?? 0) * 24 * HORA;
      if (o.planId && o.maintenanceType === "PREVENTIVE" && -restante > tolerancia) {
        await emitirAviso({
          organizationId, tipo: "PREVENTIVO_INCUMPLIDO", entidad: "WorkOrder", entidadId: o.id, version,
          titulo: `Preventivo incumplido: ${o.number}${asset}`, cuerpo: o.title, enlace: `/work-orders/${o.id}`,
          porQue: `Pasó su tolerancia de ${o.plan?.toleranceDays ?? 0} día(s); cuenta como incumplimiento del programa.`,
          accion: "Ejecútelo cuanto antes o documente por qué no se pudo.",
          contexto: { siteId: o.siteId }, datos: { folio: o.number },
        });
        suma("PREVENTIVO_INCUMPLIDO");
      }
    }
  }

  // Conciliación de avisos de órdenes.
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  for (const n of await abiertos(organizationId, ["OT_ASIGNADA", "OT_CRITICA_CREADA", "OT_POR_VENCER", "OT_VENCIDA", "OT_SIN_ACEPTAR", "OT_DETENIDA", "OT_LISTA_REVISION", "OT_DEVUELTA", "PREVENTIVO_INCUMPLIDO"])) {
    if (!n.entidadId) continue;
    const o = porId.get(n.entidadId);
    let motivo: string | null = null;
    if (n.tipo === "OT_LISTA_REVISION" || n.tipo === "OT_DEVUELTA") {
      const actual = o ?? await prisma.workOrder.findFirst({ where: { id: n.entidadId, organizationId }, select: { status: true } });
      if (!actual) motivo = "la orden ya no existe";
      else if (n.tipo === "OT_LISTA_REVISION" && actual.status !== "COMPLETED") motivo = actual.status === "CLOSED" ? "la orden se cerró" : "la orden regresó a trabajo";
      else if (n.tipo === "OT_DEVUELTA" && ["COMPLETED", "CLOSED", "CANCELLED"].includes(actual.status)) motivo = "la orden se volvió a terminar";
    } else if (!o) {
      motivo = "la orden se terminó, cerró o canceló";
    } else if (n.tipo === "OT_ASIGNADA" && (o.startedAt || o.assignedToId !== n.userId)) {
      motivo = o.startedAt ? "la orden se inició" : "la orden cambió de responsable";
    } else if (n.tipo === "OT_CRITICA_CREADA" && o.startedAt) {
      motivo = "la orden se inició";
    } else if (n.tipo === "OT_SIN_ACEPTAR" && o.startedAt) {
      motivo = "la orden se inició";
    } else if ((n.tipo === "OT_POR_VENCER" || n.tipo === "OT_VENCIDA" || n.tipo === "PREVENTIVO_INCUMPLIDO") && o.dueDate?.toISOString() !== n.claveDedup?.split(":").slice(2).join(":")) {
      motivo = "la orden se reprogramó";
    } else if (n.tipo === "OT_POR_VENCER" && o.dueDate && o.dueDate.getTime() <= ahora.getTime()) {
      motivo = "ya venció: pasó a vencidas";
    } else if (n.tipo === "OT_DETENIDA" && o.status !== "ON_HOLD") {
      motivo = "la orden se reanudó";
    }
    if (motivo) {
      await atenderAvisos({ organizationId, entidadId: n.entidadId, tipos: [n.tipo as TipoEvento], motivo });
      suma("atendidos");
    }
  }

  // ─────────────────────────────────────────── Solicitudes
  const pendientes = await prisma.workRequest.findMany({
    where: { organizationId, status: "PENDING" },
    select: { id: true, number: true, title: true, priority: true, riesgo: true, siteId: true, createdAt: true, requestedById: true },
    take: 2000,
  });
  const recientesSol = pendientes.filter((s) => ahora.getTime() - s.createdAt.getTime() < 48 * HORA);
  const conAviso = await yaAvisados(organizationId, "SOLICITUD_NUEVA", recientesSol.map((s) => s.id));
  for (const s of recientesSol) {
    if (conAviso.has(s.id)) continue;
    await avisarSolicitudNueva(organizationId, s);
    suma("SOLICITUD_NUEVA");
  }
  const pendientesIds = new Set(pendientes.map((s) => s.id));
  for (const n of await abiertos(organizationId, ["SOLICITUD_NUEVA", "SOLICITUD_CRITICA_SIN_ATENDER"])) {
    if (n.entidadId && !pendientesIds.has(n.entidadId)) {
      await atenderAvisos({ organizationId, entidadId: n.entidadId, tipos: [n.tipo as TipoEvento], motivo: "la solicitud ya se revisó" });
      suma("atendidos");
    }
  }

  // ─────────────────────────────────────────── Preventivo
  const criticosSinPlan = await prisma.asset.findMany({
    where: { organizationId, criticality: "A", status: { not: "RETIRED" }, planesAsignados: { none: { active: true } } },
    select: { code: true, name: true },
    orderBy: { code: "asc" },
    take: 200,
  });
  if (criticosSinPlan.length) {
    await emitirAviso({
      organizationId, tipo: "ACTIVO_CRITICO_SIN_PLAN", entidad: "Organization", entidadId: organizationId,
      titulo: `${criticosSinPlan.length} equipo(s) crítico(s) sin plan preventivo`,
      cuerpo: criticosSinPlan.slice(0, 5).map((a) => `${a.code} · ${a.name}`).join("\n") + (criticosSinPlan.length > 5 ? `\n… y ${criticosSinPlan.length - 5} más` : ""),
      porQue: "Lo que no puede fallar solo se está atendiendo cuando ya falló.",
      accion: "Asígneles un plan preventivo.", enlace: "/plans",
    });
    suma("ACTIVO_CRITICO_SIN_PLAN");
  } else {
    await atenderAvisos({ organizationId, entidadId: organizationId, tipos: ["ACTIVO_CRITICO_SIN_PLAN"], motivo: "todos los equipos críticos tienen plan" });
  }

  // ─────────────────────────────────────────── Medidores y predictivo
  const suspendidos = await prisma.meter.findMany({
    where: { organizationId, proyeccionSuspendida: true },
    select: { id: true, name: true, motivoSuspension: true, asset: { select: { code: true, siteId: true } } },
    take: 500,
  });
  for (const m of suspendidos) {
    await emitirAviso({
      organizationId, tipo: "LECTURA_ANORMAL", entidad: "Meter", entidadId: m.id, version: m.motivoSuspension ?? "suspendida",
      titulo: `Lectura anormal: ${m.asset.code} · ${m.name}`, cuerpo: m.motivoSuspension ?? undefined,
      porQue: "Mientras no se corrija, los planes por uso de este medidor no se programan.",
      accion: "Corrija o anule la lectura inválida.", enlace: "/meters", contexto: { siteId: m.asset.siteId },
      datos: { medidor: m.name, activo: m.asset.code },
    });
    suma("LECTURA_ANORMAL");
  }
  const suspIds = new Set(suspendidos.map((m) => m.id));
  for (const n of await abiertos(organizationId, ["LECTURA_ANORMAL"])) {
    if (n.entidadId && !suspIds.has(n.entidadId)) {
      await atenderAvisos({ organizationId, entidadId: n.entidadId, tipos: ["LECTURA_ANORMAL"], motivo: "la lectura se corrigió" });
    }
  }

  // Medidores que alimentan planes por uso y no reciben lectura en su periodo (7 días).
  const sieteDias = new Date(ahora.getTime() - 7 * 24 * HORA);
  const sinLectura = await prisma.meter.findMany({
    where: {
      organizationId,
      asignaciones: { some: { active: true, plan: { active: true, triggerType: "METER" } } },
      OR: [{ lastReadingAt: null }, { lastReadingAt: { lt: sieteDias } }],
    },
    select: { name: true, lastReadingAt: true, asset: { select: { code: true } } },
    take: 200,
  });
  if (sinLectura.length) {
    await emitirAviso({
      organizationId, tipo: "MEDIDOR_SIN_LECTURA", entidad: "Organization", entidadId: `${organizationId}:medidores`,
      titulo: `${sinLectura.length} medidor(es) sin lectura en 7 días`,
      cuerpo: sinLectura.slice(0, 5).map((m) => `${m.asset.code} · ${m.name}: ${m.lastReadingAt ? `última ${fecha(m.lastReadingAt, zona)}` : "nunca"}`).join("\n"),
      porQue: "Sus planes por uso no saben cuándo toca: pueden pasarse sin generar orden.",
      accion: "Registre las lecturas pendientes.", enlace: "/meters",
    });
    suma("MEDIDOR_SIN_LECTURA");
  } else {
    await atenderAvisos({ organizationId, entidadId: `${organizationId}:medidores`, tipos: ["MEDIDOR_SIN_LECTURA"], motivo: "todos los medidores tienen lectura reciente" });
  }

  // Condiciones: el estado del sensor, no cada lectura.
  const sensores = await prisma.sensor.findMany({
    where: { organizationId, active: true },
    select: { id: true, name: true, lastStatus: true, lastValue: true, unit: true, warningThreshold: true, criticalThreshold: true, asset: { select: { code: true, siteId: true, criticality: true } } },
    take: 2000,
  });
  const abiertosSensor = await abiertos(organizationId, ["UMBRAL_CERCA", "UMBRAL_EXCEDIDO"]);
  for (const s of sensores) {
    if (s.lastStatus === "WARNING" || s.lastStatus === "CRITICAL") {
      const critico = s.lastStatus === "CRITICAL";
      await emitirAviso({
        organizationId, tipo: critico ? "UMBRAL_EXCEDIDO" : "UMBRAL_CERCA", entidad: "Sensor", entidadId: s.id, version: s.lastStatus,
        titulo: `${critico ? "Umbral excedido" : "Cerca del límite"}: ${s.asset.code} · ${s.name}`,
        cuerpo: `Última lectura ${s.lastValue ?? "—"} ${s.unit} (advertencia ${s.warningThreshold ?? "—"}, crítico ${s.criticalThreshold ?? "—"}).`,
        porQue: critico ? "La condición está fuera de parámetros: el riesgo de falla es inmediato." : "La condición se acerca a su límite.",
        accion: critico ? "Revise el equipo y atienda la alerta predictiva." : "Programe una revisión antes de que cruce el límite.",
        enlace: "/predictive", contexto: { siteId: s.asset.siteId }, datos: { valor: s.lastValue, unidad: s.unit, activo: s.asset.code },
      });
      suma(critico ? "UMBRAL_EXCEDIDO" : "UMBRAL_CERCA");
    }
  }
  const estadoSensor = new Map(sensores.map((s) => [s.id, s]));
  for (const n of abiertosSensor) {
    const s = n.entidadId ? estadoSensor.get(n.entidadId) : null;
    if (!s || s.lastStatus === "NORMAL" || s.lastStatus === "OK") {
      await atenderAvisos({ organizationId, entidadId: n.entidadId!, tipos: ["UMBRAL_CERCA", "UMBRAL_EXCEDIDO"], motivo: "la condición regresó a lo normal" });
      if (s) {
        await emitirAviso({
          organizationId, tipo: "CONDICION_NORMALIZADA", entidad: "Sensor", entidadId: s.id, version: n.claveDedup ?? "normal",
          titulo: `Normalizada: ${s.asset.code} · ${s.name}`, cuerpo: `Última lectura ${s.lastValue ?? "—"} ${s.unit}.`,
          enlace: "/predictive", contexto: { siteId: s.asset.siteId },
        });
        suma("CONDICION_NORMALIZADA");
      }
    }
  }

  const alertas = await prisma.predictiveAlert.findMany({
    where: { organizationId, status: "OPEN", createdAt: { gte: new Date(ahora.getTime() - 7 * 24 * HORA) } },
    select: { id: true, title: true, message: true, severity: true, workOrderId: true, asset: { select: { code: true, siteId: true, criticality: true } } },
    take: 500,
  });
  const conAlerta = await yaAvisados(organizationId, "ALERTA_PREDICTIVA", alertas.map((a) => a.id));
  for (const a of alertas) {
    if (conAlerta.has(a.id)) continue;
    await avisarAlerta(organizationId, a.id);
    suma("ALERTA_PREDICTIVA");
  }
  const alertasAbiertas = await abiertos(organizationId, ["ALERTA_PREDICTIVA", "ALERTA_CRITICA_SIN_ATENDER"]);
  if (alertasAbiertas.length) {
    const vivas = new Set((await prisma.predictiveAlert.findMany({
      where: { organizationId, status: "OPEN", id: { in: alertasAbiertas.map((n) => n.entidadId!).filter(Boolean) } }, select: { id: true },
    })).map((a) => a.id));
    for (const n of alertasAbiertas) {
      if (n.entidadId && !vivas.has(n.entidadId)) {
        await atenderAvisos({ organizationId, entidadId: n.entidadId, tipos: ["ALERTA_PREDICTIVA", "ALERTA_CRITICA_SIN_ATENDER"], motivo: "la alerta se reconoció o resolvió" });
      }
    }
  }

  // ─────────────────────────────────────────── Almacén
  for (const [k, v] of Object.entries(await avisarInventario(organizationId))) suma(k, v);

  // ─────────────────────────────────────────── Compras
  const porAutorizar = await prisma.purchaseRequest.findMany({
    where: { organizationId, estado: "SOLICITADA" },
    select: { id: true, folio: true, urgencia: true, montoEstimado: true, solicitanteId: true, warehouseId: true, createdAt: true },
    take: 1000,
  });
  const montoAut = (await prisma.organization.findUnique({ where: { id: organizationId }, select: { montoAutorizacion: true } }))?.montoAutorizacion ?? 0;
  for (const c of porAutorizar) {
    await avisarCompraPorAutorizar(organizationId, c, montoAut);
    suma("REQUISICION_POR_AUTORIZAR");
  }
  const autorizadasSinOc = await prisma.purchaseRequest.findMany({
    where: { organizationId, estado: "AUTORIZADA", autorizadaEl: { lt: new Date(ahora.getTime() - 24 * HORA) }, ordenes: { none: {} } },
    select: { id: true, folio: true, warehouseId: true, autorizadaEl: true },
    take: 500,
  });
  for (const c of autorizadasSinOc) {
    await emitirAviso({
      organizationId, tipo: "ORDEN_COMPRA_PENDIENTE", entidad: "PurchaseRequest", entidadId: c.id,
      titulo: `${c.folio} autorizada y sin orden de compra`,
      porQue: `Lleva ${tiempoPendiente(c.autorizadaEl!, ahora)} autorizada; el material no se ha pedido.`,
      accion: "Coloque la orden de compra con el proveedor.", enlace: `/compras/${c.id}`,
      contexto: { warehouseId: c.warehouseId }, datos: { folio: c.folio },
    });
    suma("ORDEN_COMPRA_PENDIENTE");
  }
  const ocs = await prisma.purchaseOrder.findMany({
    where: { organizationId, estado: { in: ["ABIERTA", "RECIBIDA_PARCIAL"] }, fechaPrometida: { not: null } },
    select: { id: true, folio: true, estado: true, fechaPrometida: true, warehouseId: true, purchaseRequestId: true, supplier: { select: { name: true } } },
    take: 1000,
  });
  for (const oc of ocs) {
    const falta = oc.fechaPrometida!.getTime() - ahora.getTime();
    if (falta < 0) {
      await emitirAviso({
        organizationId, tipo: "ENTREGA_VENCIDA", entidad: "PurchaseOrder", entidadId: oc.id, version: oc.fechaPrometida!.toISOString(),
        titulo: `${oc.folio} vencida: ${oc.supplier.name} prometió ${fecha(oc.fechaPrometida!, zona)}`,
        porQue: `Lleva ${tiempoPendiente(oc.fechaPrometida!, ahora)} de retraso${oc.estado === "RECIBIDA_PARCIAL" ? "; llegó solo una parte" : ""}.`,
        accion: "Confirme con el proveedor la nueva fecha o busque otra opción.", enlace: `/compras/${oc.purchaseRequestId}`,
        contexto: { warehouseId: oc.warehouseId }, datos: { folio: oc.folio },
      });
      suma("ENTREGA_VENCIDA");
    } else if (falta <= 48 * HORA) {
      await emitirAviso({
        organizationId, tipo: "ENTREGA_PROXIMA", entidad: "PurchaseOrder", entidadId: oc.id, version: oc.fechaPrometida!.toISOString(),
        titulo: `${oc.folio} llega ${fecha(oc.fechaPrometida!, zona)} (${oc.supplier.name})`,
        enlace: `/compras/${oc.purchaseRequestId}`, contexto: { warehouseId: oc.warehouseId },
      });
      suma("ENTREGA_PROXIMA");
    }
  }
  const parciales = await prisma.purchaseRequest.findMany({
    where: { organizationId, estado: "RECIBIDA_PARCIAL" },
    select: { id: true, folio: true, warehouseId: true, renglones: { select: { descripcion: true, cantidadSolicitada: true, cantidadRecibida: true } } },
    take: 500,
  });
  for (const c of parciales) {
    const faltan = c.renglones.filter((x) => x.cantidadRecibida < x.cantidadSolicitada);
    await emitirAviso({
      organizationId, tipo: "RECEPCION_PARCIAL", entidad: "PurchaseRequest", entidadId: c.id,
      titulo: `${c.folio}: recepción parcial`,
      cuerpo: faltan.slice(0, 5).map((x) => `${x.descripcion}: llegaron ${x.cantidadRecibida} de ${x.cantidadSolicitada}`).join("\n"),
      porQue: "Lo que falta sigue sin llegar: la orden que lo espera no puede cerrarse.",
      accion: "Confirme el faltante con el proveedor.", enlace: `/compras/${c.id}`, contexto: { warehouseId: c.warehouseId },
      datos: { folio: c.folio, renglonesPendientes: faltan.length },
    });
    suma("RECEPCION_PARCIAL");
  }
  // Conciliación de compras.
  const vivasCompra = new Set([...porAutorizar.map((c) => c.id), ...autorizadasSinOc.map((c) => c.id), ...parciales.map((c) => c.id)]);
  const ocVencidas = new Set(ocs.filter((oc) => oc.fechaPrometida!.getTime() < ahora.getTime()).map((oc) => oc.id));
  for (const n of await abiertos(organizationId, ["REQUISICION_POR_AUTORIZAR", "ORDEN_COMPRA_PENDIENTE", "RECEPCION_PARCIAL", "ENTREGA_VENCIDA"])) {
    if (!n.entidadId) continue;
    const sigue = n.tipo === "ENTREGA_VENCIDA" ? ocVencidas.has(n.entidadId) : vivasCompra.has(n.entidadId);
    if (!sigue) {
      await atenderAvisos({ organizationId, entidadId: n.entidadId, tipos: [n.tipo as TipoEvento], motivo: "la compra avanzó" });
      suma("atendidos");
    }
  }

  // ─────────────────────────────────────────── Cuenta
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true, trialEndsAt: true, plan: true } });
  if (org?.status === "TRIAL" && org.trialEndsAt) {
    const dias = (org.trialEndsAt.getTime() - ahora.getTime()) / (24 * HORA);
    if (dias <= 7 && dias > -1) {
      await emitirAviso({
        organizationId, tipo: "PRUEBA_POR_TERMINAR", entidad: "Organization", entidadId: organizationId, version: org.trialEndsAt.toISOString().slice(0, 10),
        titulo: `El periodo de prueba termina ${fecha(org.trialEndsAt, zona)}`,
        porQue: "Al terminar, la cuenta queda suspendida y nadie podrá registrar trabajo.",
        accion: "Elija un plan en Configuración → Suscripción.", enlace: "/settings?s=suscripcion",
      });
      suma("PRUEBA_POR_TERMINAR");
    }
  }
  if (org) {
    const consumo = await consumoDe(organizationId, org.plan);
    for (const c of consumo) {
      if (c.ilimitado) continue;
      const tipo: TipoEvento | null = c.excedido ? "LIMITE_PLAN_ALCANZADO" : c.porcentaje >= 90 ? "LIMITE_PLAN_CERCA" : null;
      if (!tipo) {
        await atenderAvisos({ organizationId, entidadId: `${organizationId}:${c.recurso}`, tipos: ["LIMITE_PLAN_ALCANZADO"], motivo: "hay cupo de nuevo" });
        continue;
      }
      await emitirAviso({
        organizationId, tipo, entidad: "Organization", entidadId: `${organizationId}:${c.recurso}`, version: tipo,
        titulo: `${c.etiqueta}: ${c.uso} de ${c.limite} en el plan ${planDe(org.plan).nombre}`,
        porQue: c.excedido ? "Ya no se pueden dar de alta más." : "Queda poco cupo.",
        accion: "Revise su plan en Configuración → Suscripción.", enlace: "/settings?s=suscripcion",
      });
      suma(tipo);
    }
  }
  return r;
}

/**
 * Refacciones bajo mínimo (un aviso agrupado) y críticas agotadas (uno por
 * refacción). Lo llama el proceso programado y, al momento, el consumo de
 * material: así el aviso sale en cuanto se cruza el mínimo, sin esperar.
 */
export async function avisarInventario(organizationId: string): Promise<ResultadoDeteccion> {
  const r: ResultadoDeteccion = {};
  const suma = (k: string, n = 1) => { r[k] = (r[k] ?? 0) + n; };
  const partes = await prisma.part.findMany({
    where: { organizationId, active: true, minQuantity: { gt: 0 } },
    select: { id: true, code: true, name: true, quantityOnHand: true, minQuantity: true, unit: true },
    take: 5000,
  });
  const bajas = partes.filter((p) => p.quantityOnHand <= p.minQuantity);
  const almacenGeneral = await prisma.warehouse.findFirst({ where: { organizationId, active: true }, orderBy: [{ esGeneral: "desc" }], select: { id: true } });
  if (bajas.length) {
    // Un solo aviso con la lista, no uno por refacción: diez refacciones bajas son una tarea de compra.
    await emitirAviso({
      organizationId, tipo: "REFACCION_BAJO_MINIMO", entidad: "Organization", entidadId: `${organizationId}:minimos`,
      titulo: `${bajas.length} refacción(es) en o bajo su mínimo`,
      cuerpo: bajas.slice(0, 8).map((p) => `${p.code} · ${p.name}: ${p.quantityOnHand} ${p.unit} (mín. ${p.minQuantity})`).join("\n") + (bajas.length > 8 ? `\n… y ${bajas.length - 8} más` : ""),
      porQue: "Si se usan antes de reponerse, una orden se queda esperando material.",
      accion: "Revise y pida lo necesario.", enlace: "/inventory",
      contexto: { warehouseId: almacenGeneral?.id }, datos: { refacciones: bajas.length },
    });
    suma("REFACCION_BAJO_MINIMO");
  } else {
    await atenderAvisos({ organizationId, entidadId: `${organizationId}:minimos`, tipos: ["REFACCION_BAJO_MINIMO"], motivo: "todas las refacciones están sobre su mínimo" });
  }
  const criticasAgotadas = await refaccionesCriticasAgotadas(organizationId);
  for (const p of criticasAgotadas) {
    await emitirAviso({
      organizationId, tipo: "REFACCION_CRITICA_AGOTADA", entidad: "Part", entidadId: p.id,
      titulo: `Agotada: ${p.code} · ${p.name}`, cuerpo: p.motivo,
      porQue: p.motivo, accion: "Pida la refacción o autorice un sustituto.", enlace: `/inventory/${p.id}`,
      contexto: { warehouseId: almacenGeneral?.id }, datos: { refaccion: p.code },
      prioridad: p.detieneTrabajo ? "ALTA" : undefined,
    });
    suma("REFACCION_CRITICA_AGOTADA");
  }
  const agotadasIds = new Set(criticasAgotadas.map((p) => p.id));
  for (const n of await abiertos(organizationId, ["REFACCION_CRITICA_AGOTADA"])) {
    if (n.entidadId && !agotadasIds.has(n.entidadId)) {
      await atenderAvisos({ organizationId, entidadId: n.entidadId, tipos: ["REFACCION_CRITICA_AGOTADA"], motivo: "la refacción se repuso" });
    }
  }

  return r;
}

// ─────────────────────────────────────────── Avisos que también se emiten en el momento

/** Una alerta predictiva nueva, a supervisión, con liga a su orden si la tiene. */
export async function avisarAlerta(organizationId: string, alertId: string) {
  const a = await prisma.predictiveAlert.findFirst({
    where: { id: alertId, organizationId },
    select: { id: true, title: true, message: true, severity: true, workOrderId: true, asset: { select: { code: true, siteId: true, criticality: true } } },
  });
  if (!a) return;
  const { prioridad } = calcularPrioridad(a.severity === "CRITICAL" ? "CRITICA" : "ALTA", { criticidadActivo: a.asset.criticality });
  await emitirAviso({
    organizationId, tipo: "ALERTA_PREDICTIVA", entidad: "PredictiveAlert", entidadId: a.id, prioridad,
    titulo: `Alerta predictiva: ${a.asset.code} · ${a.title}`, cuerpo: a.message,
    porQue: "El predictivo detectó una condición que anticipa una falla.",
    accion: a.workOrderId ? "Revise la orden predictiva generada." : "Reconozca la alerta y decida la acción.",
    enlace: a.workOrderId ? `/work-orders/${a.workOrderId}` : "/predictive", contexto: { siteId: a.asset.siteId },
    datos: { activo: a.asset.code, severidad: a.severity },
  });
}

type OtAviso = { id: string; number: string; title: string; priority: string; assignedToId: string | null; siteId: string | null; asset?: { code: string; criticality: string } | null };

export async function avisarAsignacion(organizationId: string, o: OtAviso) {
  if (!o.assignedToId) return;
  const { prioridad, razones } = calcularPrioridad("MEDIA", { prioridadRegistro: o.priority, criticidadActivo: o.asset?.criticality });
  await emitirAviso({
    organizationId, tipo: "OT_ASIGNADA", entidad: "WorkOrder", entidadId: o.id, version: o.assignedToId, prioridad,
    titulo: `OT asignada ${o.number}${o.asset ? ` · ${o.asset.code}` : ""}`, cuerpo: o.title, enlace: `/work-orders/${o.id}`,
    porQue: razones.length ? `Importa porque ${razones.join(", ")}.` : undefined,
    accion: "Revísela e iníciela cuando empiece el trabajo.",
    contexto: { responsableId: o.assignedToId, siteId: o.siteId }, tag: o.number,
    datos: { folio: o.number, prioridad: o.priority },
  });
}

export async function avisarOtCritica(organizationId: string, o: OtAviso) {
  await emitirAviso({
    organizationId, tipo: "OT_CRITICA_CREADA", entidad: "WorkOrder", entidadId: o.id,
    titulo: `OT crítica ${o.number}${o.asset ? ` · ${o.asset.code}` : ""}`, cuerpo: o.title, enlace: `/work-orders/${o.id}`,
    porQue: "Es de prioridad crítica: normalmente hay un equipo parado o un riesgo.",
    accion: o.assignedToId ? "Confirme que el responsable ya la atiende." : "Asígnele responsable de inmediato.",
    contexto: { siteId: o.siteId }, tag: o.number, datos: { folio: o.number },
  });
}

export async function avisarSolicitudNueva(
  organizationId: string,
  s: { id: string; number: string; title: string; priority: string; riesgo: string; siteId: string | null; requestedById: string | null },
  extra: { cuerpo?: string; porQue?: string } = {},
) {
  const riesgo = s.riesgo === "ALTO";
  const { prioridad } = calcularPrioridad("MEDIA", { prioridadRegistro: s.priority, seguridad: riesgo });
  await emitirAviso({
    organizationId, tipo: "SOLICITUD_NUEVA", entidad: "WorkRequest", entidadId: s.id, prioridad,
    titulo: `${riesgo ? "RIESGO · " : ""}Solicitud ${s.number}: ${s.title.slice(0, 60)}`, enlace: `/requests/${s.id}`,
    cuerpo: extra.cuerpo,
    porQue: extra.porQue ?? (riesgo ? "El reporte describe un riesgo de seguridad." : undefined),
    accion: "Revísela: conviértala en orden o recházela con motivo.",
    contexto: { siteId: s.siteId, excluir: s.requestedById ? [s.requestedById] : [] }, tag: s.number,
    datos: { folio: s.number, prioridad: s.priority },
  });
}

export async function avisarCompraPorAutorizar(
  organizationId: string,
  c: { id: string; folio: string; urgencia: string; montoEstimado: number; solicitanteId: string | null; warehouseId: string },
  montoAutorizacion: number,
) {
  const paro = c.urgencia === "PARO";
  const calculada = calcularPrioridad("MEDIA", { detieneEquipo: paro, montoAlto: montoAutorizacion > 0 && c.montoEstimado >= montoAutorizacion * 5 });
  // «Paro» es un equipo detenido AHORA esperando este material: crítico, sin
  // importar la criticidad del equipo (que la compra no conoce).
  const prioridad = paro ? "CRITICA" : calculada.prioridad;
  const razones = calculada.razones;
  await emitirAviso({
    organizationId, tipo: "REQUISICION_POR_AUTORIZAR", entidad: "PurchaseRequest", entidadId: c.id, prioridad,
    titulo: `Compra ${c.folio} por autorizar${paro ? " · equipo parado" : ""}`,
    cuerpo: `Monto estimado $${c.montoEstimado.toFixed(2)}.`,
    porQue: razones.length ? `Importa porque ${razones.join(", ")}.` : "Mientras no se autorice, el material no se pide.",
    accion: "Autorícela o recházela con motivo.", enlace: `/compras/${c.id}`,
    contexto: { solicitanteId: c.solicitanteId, excluir: c.solicitanteId ? [c.solicitanteId] : [], warehouseId: c.warehouseId },
    tag: c.folio, datos: { folio: c.folio, urgencia: c.urgencia },
  });
}

/**
 * Refacción crítica: la usa un plan de un equipo de criticidad A, o detiene
 * una actividad de una orden abierta. Agotada: existencia en cero o menos.
 * Regla fija, sin marca manual: no depende de que alguien se acuerde de marcarla.
 */
export async function refaccionesCriticasAgotadas(organizationId: string) {
  const agotadas = await prisma.part.findMany({
    where: { organizationId, active: true, quantityOnHand: { lte: 0 } },
    select: { id: true, code: true, name: true },
    take: 2000,
  });
  if (!agotadas.length) return [];
  const ids = agotadas.map((p) => p.id);
  const [enPlanesA, bloqueando] = await Promise.all([
    prisma.planTaskPart.findMany({
      where: { partId: { in: ids }, task: { plan: { active: true, organizationId, OR: [{ asset: { criticality: "A" } }, { asignaciones: { some: { active: true, asset: { criticality: "A" } } } }] } } },
      select: { partId: true },
    }),
    prisma.workOrderTask.findMany({
      where: { bloqueadaPorPartId: { in: ids }, workOrder: { organizationId, status: { in: ACTIVAS } } },
      select: { bloqueadaPorPartId: true },
    }),
  ]);
  const deA = new Set(enPlanesA.map((x) => x.partId));
  const detienen = new Map<string, number>();
  for (const b of bloqueando) detienen.set(b.bloqueadaPorPartId!, (detienen.get(b.bloqueadaPorPartId!) ?? 0) + 1);
  return agotadas
    .filter((p) => deA.has(p.id) || detienen.has(p.id))
    .map((p) => ({
      ...p,
      detieneTrabajo: detienen.has(p.id),
      motivo: detienen.has(p.id)
        ? `Detiene ${detienen.get(p.id)} actividad(es) de órdenes abiertas.`
        : "La usa el preventivo de un equipo crítico.",
    }));
}
