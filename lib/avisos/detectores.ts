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
 *  - Reconciliación: al final, `reconciliar()` (lib/avisos/condiciones.ts)
 *    compara cada aviso abierto con el estado real de su registro y atiende
 *    solo los que de verdad se resolvieron, con su motivo. Leer un aviso,
 *    reconocerlo o editar el registro no lo atiende.
 *
 * Además es red de seguridad: si algún flujo creó una orden asignada o
 * crítica sin avisar (hay seis lugares que crean órdenes), aquí se avisa.
 */
import { prisma } from "../db";
import { emitirAviso } from "./emitir";
import { reconciliar } from "./condiciones";
import { criticosSinPlan, medidoresSinLectura, ordenesCompraEnEspera, refaccionesBajoMinimo, refaccionesCriticasAgotadas } from "./situaciones";
import { calcularPrioridad, tiempoPendiente } from "./prioridad";
import type { ConfigEmpresa } from "./config";
import type { TipoEvento } from "./catalogo";
import { consumoDe, planDe } from "../planes";
import { comoSeLlama, deQueCuelga, vigenciasQueVencen } from "../vigencias";
import { diasParaVencer } from "../vigencias-tipos";

const ACTIVAS = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"];
const HORA = 3_600_000;
const fecha = (d: Date, zona: string) => d.toLocaleDateString("es-MX", { timeZone: zona, day: "numeric", month: "short" });

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

  for (const o of ordenes) {
    const tipo = await avisarVencimiento(organizationId, o, cfg, ahora);
    if (tipo) for (const t of tipo) suma(t);
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

  // ─────────────────────────────────────────── Preventivo
  const sinPlan = await criticosSinPlan(organizationId);
  if (sinPlan.length) {
    await emitirAviso({
      organizationId, tipo: "ACTIVO_CRITICO_SIN_PLAN", entidad: "Organization", entidadId: organizationId,
      titulo: `${sinPlan.length} equipo(s) crítico(s) sin plan preventivo`,
      cuerpo: sinPlan.slice(0, 5).map((a) => `${a.code} · ${a.name}`).join("\n") + (sinPlan.length > 5 ? `\n… y ${sinPlan.length - 5} más` : ""),
      porQue: "Lo que no puede fallar solo se está atendiendo cuando ya falló.",
      accion: "Asígneles un plan preventivo.", enlace: "/plans",
    });
    suma("ACTIVO_CRITICO_SIN_PLAN");
  }

  // ─────────────────────────────────────────── Medidores y predictivo
  const suspendidos = await prisma.meter.findMany({
    where: { organizationId, proyeccionSuspendida: true },
    select: { id: true, name: true, motivoSuspension: true, asset: { select: { code: true, siteId: true } } },
    take: 500,
  });
  for (const m of suspendidos) {
    await emitirAviso({
      organizationId, tipo: "LECTURA_ANORMAL", entidad: "Meter", entidadId: m.id, continuar: true,
      titulo: `Lectura anormal: ${m.asset.code} · ${m.name}`, cuerpo: m.motivoSuspension ?? undefined,
      porQue: "Mientras no se corrija, los planes por uso de este medidor no se programan.",
      accion: "Corrija o anule la lectura inválida.", enlace: "/meters", contexto: { siteId: m.asset.siteId },
      datos: { medidor: m.name, activo: m.asset.code },
    });
    suma("LECTURA_ANORMAL");
  }

  // Medidores que alimentan planes por uso y no reciben lectura en su periodo (7 días).
  const sinLectura = await medidoresSinLectura(organizationId, ahora);
  if (sinLectura.length) {
    await emitirAviso({
      organizationId, tipo: "MEDIDOR_SIN_LECTURA", entidad: "Organization", entidadId: `${organizationId}:medidores`,
      titulo: `${sinLectura.length} medidor(es) sin lectura en 7 días`,
      cuerpo: sinLectura.slice(0, 5).map((m) => `${m.asset.code} · ${m.name}: ${m.lastReadingAt ? `última ${fecha(m.lastReadingAt, zona)}` : "nunca"}`).join("\n"),
      porQue: "Sus planes por uso no saben cuándo toca: pueden pasarse sin generar orden.",
      accion: "Registre las lecturas pendientes.", enlace: "/meters",
    });
    suma("MEDIDOR_SIN_LECTURA");
  }

  // Condiciones: el estado del sensor, no cada lectura.
  const sensores = await prisma.sensor.findMany({
    where: { organizationId, active: true },
    select: { id: true, name: true, lastStatus: true, lastValue: true, unit: true, warningThreshold: true, criticalThreshold: true, asset: { select: { code: true, siteId: true, criticality: true } } },
    take: 2000,
  });
  const abiertosSensor = await prisma.notification.findMany({
    where: { organizationId, tipo: { in: ["UMBRAL_CERCA", "UMBRAL_EXCEDIDO"] }, atendidaEl: null, requiereAccion: true },
    select: { entidadId: true, claveDedup: true },
  });
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
  // Regresó a lo normal: se avisa que se normalizó. Atender los avisos del
  // umbral le toca a la reconciliación, al final.
  const estadoSensor = new Map(sensores.map((s) => [s.id, s]));
  const normalizados = new Set<string>();
  for (const n of abiertosSensor) {
    const s = n.entidadId ? estadoSensor.get(n.entidadId) : null;
    if (s && s.lastStatus !== "WARNING" && s.lastStatus !== "CRITICAL" && !normalizados.has(s.id)) {
      normalizados.add(s.id);
      await emitirAviso({
        organizationId, tipo: "CONDICION_NORMALIZADA", entidad: "Sensor", entidadId: s.id, version: n.claveDedup ?? "normal",
        titulo: `Normalizada: ${s.asset.code} · ${s.name}`, cuerpo: `Última lectura ${s.lastValue ?? "—"} ${s.unit}.`,
        enlace: "/predictive", contexto: { siteId: s.asset.siteId },
      });
      suma("CONDICION_NORMALIZADA");
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

  // ─────────────────────────────────────────── Almacén
  for (const [k, v] of Object.entries(await avisarInventario(organizationId))) suma(k, v);

  // ─────────────────────────────────────────── Vigencias
  for (const [k, v] of Object.entries(await avisarVigencias(organizationId, ahora))) suma(k, v);

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
  const ocs = await ordenesCompraEnEspera(organizationId);
  for (const oc of ocs) {
    const falta = oc.fechaPrometida!.getTime() - ahora.getTime();
    if (falta < 0) {
      await emitirAviso({
        organizationId, tipo: "ENTREGA_VENCIDA", entidad: "PurchaseOrder", entidadId: oc.id, continuar: true,
        titulo: `${oc.folio} vencida: ${oc.supplier.name} prometió ${fecha(oc.fechaPrometida!, zona)}`,
        porQue: `Lleva ${tiempoPendiente(oc.fechaPrometida!, ahora)} de retraso${oc.purchaseRequest.estado === "RECIBIDA_PARCIAL" ? "; llegó solo una parte" : ""}.`,
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

  // ─────────────────────────────────────────── Cuenta
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true, trialEndsAt: true, plan: true } });
  if (org?.status === "TRIAL" && org.trialEndsAt) {
    const dias = (org.trialEndsAt.getTime() - ahora.getTime()) / (24 * HORA);
    if (dias <= 7 && dias > -1) {
      await emitirAviso({
        organizationId, tipo: "PRUEBA_POR_TERMINAR", entidad: "Organization", entidadId: organizationId, version: org.trialEndsAt.toISOString().slice(0, 10),
        titulo: `El periodo de prueba termina ${fecha(org.trialEndsAt, zona)}`,
        porQue: "Al terminar, la cuenta queda en solo lectura: se consulta y se exporta, pero nadie podrá registrar trabajo hasta contratar un plan.",
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
      if (!tipo) continue;
      await emitirAviso({
        organizationId, tipo, entidad: "Organization", entidadId: `${organizationId}:${c.recurso}`, version: tipo,
        titulo: `${c.etiqueta}: ${c.uso} de ${c.limite} en el plan ${planDe(org.plan).nombre}`,
        porQue: c.excedido ? "Ya no se pueden dar de alta más." : "Queda poco cupo.",
        accion: "Revise su plan en Configuración → Suscripción.", enlace: "/settings?s=suscripcion",
      });
      suma(tipo);
    }
  }

  // ─────────────────────────────────────────── Reconciliación
  const rec = await reconciliar({ organizationId, ahora, cfg });
  if (rec.atendidos) suma("atendidos", rec.atendidos);
  if (rec.unificados) suma("unificados", rec.unificados);
  return r;
}

/**
 * Garantías, pólizas, contratos, calibraciones y permisos que se vencen.
 *
 * Uno por documento, no uno agrupado: cada uno se renueva con un trámite
 * distinto, con un proveedor distinto, y quien lo atiende necesita saber cuál
 * es. Un aviso que dijera «se vencen 12 vigencias» obligaría a entrar a
 * buscarlas, y su regla de cierre no podría decidir nada —doce documentos no
 * se renuevan al mismo tiempo—.
 *
 * Los días de anticipación salen del tipo (`lib/vigencias-tipos.ts`): una
 * póliza avisa con 60 días porque hay que cotizar; una calibración con 30
 * porque se agenda con el laboratorio.
 */
export async function avisarVigencias(organizationId: string, ahora = new Date()): Promise<ResultadoDeteccion> {
  const r: ResultadoDeteccion = {};
  const suma = (k: string, n = 1) => { r[k] = (r[k] ?? 0) + n; };
  const porVencer = await vigenciasQueVencen(organizationId, ahora);

  for (const v of porVencer) {
    const dias = diasParaVencer(v.hasta, ahora) ?? 0;
    const vencida = v.estado === "VENCIDA";
    const cuelga = deQueCuelga(v);
    await emitirAviso({
      organizationId,
      tipo: vencida ? "VIGENCIA_VENCIDA" : "VIGENCIA_POR_VENCER",
      entidad: "Vigencia", entidadId: v.id,
      titulo: `${vencida ? "Venció" : "Por vencer"}: ${comoSeLlama(v)}`,
      cuerpo:
        `${cuelga}${v.folio ? ` · ${v.folio}` : ""}. `
        + (vencida
          ? `Venció hace ${Math.abs(dias)} día(s).`
          : `Vence en ${dias} día(s)${v.hasta ? ` (${v.hasta.toISOString().slice(0, 10)})` : ""}.`)
        + (v.supplier?.name ? ` Se renueva con ${v.supplier.name}.` : ""),
      porQue: vencida
        ? "Sin este documento vigente, lo que cubre quedó sin cobertura."
        : "Renovarlo tarde deja sin cobertura justo cuando se necesita, y algunos trámites no son de un día.",
      accion: "Renuévelo y registre la nueva vigencia; la vieja se conserva como historia.",
      enlace: "/vigencias",
      contexto: { siteId: v.asset?.siteId ?? undefined },
      datos: { tipo: v.tipo, hasta: v.hasta?.toISOString() ?? null, dias },
    });
    suma(vencida ? "VIGENCIA_VENCIDA" : "VIGENCIA_POR_VENCER");
  }

  // Lo ya renovado se atiende con el mismo criterio de la reconciliación.
  const rec = await reconciliar({ organizationId, tipos: ["VIGENCIA_POR_VENCER", "VIGENCIA_VENCIDA"], ahora });
  if (rec.atendidos) suma("atendidos", rec.atendidos);
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
  const bajas = await refaccionesBajoMinimo(organizationId);
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
  // Lo que ya se repuso se atiende en el momento, con el mismo criterio de la reconciliación.
  const rec = await reconciliar({ organizationId, tipos: ["REFACCION_BAJO_MINIMO", "REFACCION_CRITICA_AGOTADA"] });
  if (rec.atendidos) suma("atendidos", rec.atendidos);

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

type OtVencimiento = OtAviso & {
  status: string; maintenanceType: string; dueDate: Date | null; planId: string | null; plan?: { toleranceDays: number } | null;
};

/**
 * Por vencer, vencida e incumplida: una orden abierta contra su fecha
 * compromiso. Lo corre el detector para todas y la edición de una orden para
 * esa, en el momento (al reasignarla, el responsable nuevo recibe su aviso de
 * vencida sin esperar al proceso).
 *
 * Es la MISMA condición aunque la fecha cambie a otra que también ya pasó:
 * se continúa el aviso abierto, con el texto nuevo, en vez de abrir otro.
 */
export async function avisarVencimiento(organizationId: string, o: OtVencimiento, cfg: ConfigEmpresa, ahora = new Date()) {
  const emitidos: TipoEvento[] = [];
  if (!o.dueDate || o.status === "ON_HOLD" || !ACTIVAS.includes(o.status)) return emitidos;
  const zona = cfg.zona;
  const restante = o.dueDate.getTime() - ahora.getTime();
  const version = o.dueDate.toISOString();
  const asset = o.asset ? ` · ${o.asset.code}` : "";
  if (restante > 0 && restante <= cfg.anticipacionHoras * HORA) {
    const { prioridad, razones } = calcularPrioridad("MEDIA", { prioridadRegistro: o.priority, criticidadActivo: o.asset?.criticality });
    await emitirAviso({
      organizationId, tipo: "OT_POR_VENCER", entidad: "WorkOrder", entidadId: o.id, continuar: true, prioridad,
      titulo: `${o.number} vence ${fecha(o.dueDate, zona)}${asset}`, cuerpo: o.title, enlace: `/work-orders/${o.id}`,
      porQue: `Vence en ${tiempoPendiente(ahora, o.dueDate)}${razones.length ? `; ${razones.join(", ")}` : ""}.`,
      accion: "Termínela a tiempo o reprograme la fecha si no se alcanza.",
      contexto: { responsableId: o.assignedToId, siteId: o.siteId }, tag: o.number,
      datos: { folio: o.number, vence: version },
    });
    emitidos.push("OT_POR_VENCER");
  } else if (restante <= 0) {
    const { prioridad, razones } = calcularPrioridad("ALTA", { prioridadRegistro: o.priority, criticidadActivo: o.asset?.criticality, horasRestantes: restante / HORA });
    await emitirAviso({
      organizationId, tipo: "OT_VENCIDA", entidad: "WorkOrder", entidadId: o.id, continuar: true, prioridad,
      titulo: `${o.number} vencida desde ${fecha(o.dueDate, zona)}${asset}`, cuerpo: o.title, enlace: `/work-orders/${o.id}`,
      porQue: `Lleva ${tiempoPendiente(o.dueDate, ahora)} vencida${razones.length ? `; ${razones.join(", ")}` : ""}.`,
      accion: "Actualice su avance, termínela o reprograme con motivo a una fecha futura.",
      contexto: { responsableId: o.assignedToId, siteId: o.siteId }, tag: o.number,
      datos: { folio: o.number, vencio: version },
    });
    emitidos.push("OT_VENCIDA");
    // Preventivo que ya pasó su tolerancia: además, incumplimiento.
    const tolerancia = (o.plan?.toleranceDays ?? 0) * 24 * HORA;
    if (o.planId && o.maintenanceType === "PREVENTIVE" && -restante > tolerancia) {
      await emitirAviso({
        organizationId, tipo: "PREVENTIVO_INCUMPLIDO", entidad: "WorkOrder", entidadId: o.id, continuar: true,
        titulo: `Preventivo incumplido: ${o.number}${asset}`, cuerpo: o.title, enlace: `/work-orders/${o.id}`,
        porQue: `Pasó su tolerancia de ${o.plan?.toleranceDays ?? 0} día(s); cuenta como incumplimiento del programa.`,
        accion: "Ejecútelo cuanto antes o documente por qué no se pudo.",
        contexto: { siteId: o.siteId }, datos: { folio: o.number },
      });
      emitidos.push("PREVENTIVO_INCUMPLIDO");
    }
  }
  return emitidos;
}

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

export { refaccionesCriticasAgotadas };
