/**
 * Resúmenes diario y semanal, por persona y según su rol.
 *
 * No es una copia del panel: son las pocas cosas que esa persona tiene que
 * mover hoy, con liga directa y la acción recomendada. Todos los números se
 * calculan aquí —sin IA— y cada sección solo aparece si tiene algo.
 *
 *  - Diario: en días laborables, a la hora de resumen de la empresa (7:30 por
 *    omisión, en su zona). Si no hay nada, no se manda, salvo que la empresa
 *    pida el «sin pendientes».
 *  - Semanal: el primer día laborable de la semana, con la semana anterior
 *    completa y su comparación contra la previa.
 *
 * El técnico ve lo suyo; el supervisor, la operación; quien autoriza, lo que
 * espera su firma; compras, lo que hay que pedir o perseguir.
 */
import { prisma } from "../db";
import { notify } from "../audit";
import { can } from "../rbac";
import { claveDiaEnZona, diaEnZona, medianocheEnZona } from "../periodos";
import { leerJson, type ConfigEmpresa } from "./config";
import { diaSemanaEnZona, esDiaLaborable, horaLocal, minutosDeHora, type Ventana } from "./horario";
import { refaccionesCriticasAgotadas } from "./detectores";

export type Seccion = { titulo: string; total: number; items: Array<{ texto: string; enlace: string }>; accion: string };
export type Resumen = { periodo: string; secciones: Seccion[]; primero: string | null };

const ACTIVAS = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"];
const DIA = 86_400_000;
const fmt = (d: Date, zona: string) => d.toLocaleDateString("es-MX", { timeZone: zona, weekday: "long", day: "numeric", month: "long" });

type Persona = { id: string; role: string; name: string };

function seccion(titulo: string, total: number, items: Seccion["items"], accion: string): Seccion | null {
  return total > 0 ? { titulo, total, items: items.slice(0, 5), accion } : null;
}

const ot = (o: { id: string; number: string; title: string; asset?: { code: string } | null }) => ({
  texto: `${o.number}${o.asset ? ` · ${o.asset.code}` : ""} — ${o.title}`, enlace: `/work-orders/${o.id}`,
});

/** El resumen del día para una persona. */
export async function resumenDiario(organizationId: string, p: Persona, cfg: ConfigEmpresa, ahora = new Date()): Promise<Resumen> {
  const zona = cfg.zona;
  const d = diaEnZona(ahora, zona);
  const hoy = medianocheEnZona(d.anio, d.mes, d.dia, zona);
  const manana = new Date(hoy.getTime() + DIA);
  const pasado = new Date(hoy.getTime() + 2 * DIA);
  const s: Array<Seccion | null> = [];
  const supervisa = can(p.role, "workorder:write");
  const selOt = { id: true, number: true, title: true, asset: { select: { code: true } } } as const;

  // Lo propio: cualquiera con órdenes asignadas.
  if (can(p.role, "workorder:execute")) {
    const mias = await prisma.workOrder.findMany({
      where: { organizationId, assignedToId: p.id, status: { in: ACTIVAS } },
      select: { ...selOt, priority: true, dueDate: true, maintenanceType: true }, orderBy: { dueDate: "asc" }, take: 200,
    });
    s.push(seccion("Sus órdenes críticas", mias.filter((o) => o.priority === "CRITICAL").length,
      mias.filter((o) => o.priority === "CRITICAL").map(ot), "Atiéndalas primero."));
    const vencidas = mias.filter((o) => o.dueDate && o.dueDate < ahora);
    s.push(seccion("Sus órdenes vencidas", vencidas.length, vencidas.map(ot), "Actualice su avance o pida reprogramarlas."));
    const proximas = mias.filter((o) => o.dueDate && o.dueDate >= ahora && o.dueDate < pasado);
    s.push(seccion("Vencen hoy o mañana", proximas.length, proximas.map(ot), "Planee su día para cerrarlas a tiempo."));
    if (!supervisa) {
      const prev = mias.filter((o) => o.maintenanceType === "PREVENTIVE" && o.dueDate && o.dueDate >= hoy && o.dueDate < manana);
      s.push(seccion("Sus preventivos de hoy", prev.length, prev.map(ot), "Ejecútelos hoy."));
    }
  }

  if (supervisa) {
    const [criticas, vencidas, proximas, solicitudes, preventivos, alertas, escaladas] = await Promise.all([
      prisma.workOrder.findMany({ where: { organizationId, status: { in: ACTIVAS }, priority: "CRITICAL" }, select: selOt, take: 50 }),
      prisma.workOrder.findMany({ where: { organizationId, status: { in: ACTIVAS }, dueDate: { lt: ahora } }, select: selOt, orderBy: { dueDate: "asc" }, take: 200 }),
      prisma.workOrder.count({ where: { organizationId, status: { in: ACTIVAS }, dueDate: { gte: ahora, lt: pasado } } }),
      prisma.workRequest.findMany({ where: { organizationId, status: "PENDING" }, select: { id: true, number: true, title: true }, orderBy: { createdAt: "asc" }, take: 100 }),
      prisma.workOrder.findMany({ where: { organizationId, status: { in: ACTIVAS }, maintenanceType: "PREVENTIVE", dueDate: { gte: hoy, lt: manana } }, select: selOt, take: 100 }),
      prisma.predictiveAlert.findMany({ where: { organizationId, status: "OPEN" }, select: { id: true, title: true, asset: { select: { code: true } } }, take: 50 }),
      prisma.escalamiento.count({ where: { organizationId, estado: { in: ["ACTIVO", "AGOTADO"] }, nivel: { gte: 1 } } }),
    ]);
    s.push(seccion("Órdenes críticas abiertas", criticas.length, criticas.map(ot), "Confirme que cada una tiene responsable y avance."));
    s.push(seccion("Órdenes vencidas", vencidas.length, vencidas.map(ot), "Reasigne o reprograme las que no avanzan."));
    if (proximas) s.push(seccion("Vencen hoy o mañana", proximas, [], "Revise la carga del equipo en el calendario."));
    s.push(seccion("Solicitudes sin revisar", solicitudes.length,
      solicitudes.map((x) => ({ texto: `${x.number} — ${x.title}`, enlace: "/requests" })), "Conviértalas en orden o recházelas con motivo."));
    s.push(seccion("Preventivos programados hoy", preventivos.length, preventivos.map(ot), "Verifique que tengan responsable y material."));
    s.push(seccion("Alertas predictivas activas", alertas.length,
      alertas.map((a) => ({ texto: `${a.asset.code} — ${a.title}`, enlace: "/predictive" })), "Reconózcalas y decida la acción."));
    s.push(seccion("Situaciones escaladas", escaladas, [], "Revise por qué no se atendieron en su primer nivel."));
  }

  if (supervisa || p.role === "COMPRAS") {
    const agotadas = await refaccionesCriticasAgotadas(organizationId);
    s.push(seccion("Refacciones críticas agotadas", agotadas.length,
      agotadas.map((x) => ({ texto: `${x.code} · ${x.name}`, enlace: `/inventory/${x.id}` })), "Pídalas o autorice un sustituto."));
  }
  if (can(p.role, "purchase:authorize")) {
    const porFirmar = await prisma.purchaseRequest.findMany({
      where: { organizationId, estado: "SOLICITADA", NOT: { solicitanteId: p.id } },
      select: { id: true, folio: true, urgencia: true, montoEstimado: true }, take: 50,
    });
    s.push(seccion("Compras por autorizar", porFirmar.length,
      porFirmar.map((c) => ({ texto: `${c.folio}${c.urgencia === "PARO" ? " (equipo parado)" : ""} — $${c.montoEstimado.toFixed(2)}`, enlace: `/compras/${c.id}` })),
      "Autorícelas o recházelas: el material no se pide sin su firma."));
  }
  if (p.role === "COMPRAS") {
    const [sinOc, vencidas] = await Promise.all([
      prisma.purchaseRequest.findMany({ where: { organizationId, estado: "AUTORIZADA", ordenes: { none: {} } }, select: { id: true, folio: true }, take: 50 }),
      prisma.purchaseOrder.findMany({ where: { organizationId, estado: { in: ["ABIERTA", "RECIBIDA_PARCIAL"] }, fechaPrometida: { lt: ahora } }, select: { folio: true, purchaseRequestId: true }, take: 50 }),
    ]);
    s.push(seccion("Autorizadas sin orden de compra", sinOc.length, sinOc.map((c) => ({ texto: c.folio, enlace: `/compras/${c.id}` })), "Coloque la orden con el proveedor."));
    s.push(seccion("Entregas vencidas", vencidas.length, vencidas.map((o) => ({ texto: o.folio, enlace: `/compras/${o.purchaseRequestId}` })), "Confirme la nueva fecha con el proveedor."));
  }
  if (p.role === "REQUESTER") {
    const mias = await prisma.workRequest.findMany({ where: { organizationId, requestedById: p.id, status: "PENDING" }, select: { number: true, title: true }, take: 20 });
    s.push(seccion("Sus solicitudes en revisión", mias.length, mias.map((x) => ({ texto: `${x.number} — ${x.title}`, enlace: "/requests" })), "No hace falta nada: se le avisará cuando se revisen."));
  }

  const secciones = s.filter((x): x is Seccion => Boolean(x));
  return { periodo: `Hoy, ${fmt(ahora, zona)}`, secciones, primero: secciones[0]?.accion ?? null };
}

/** El resumen semanal: la semana anterior completa, y cómo cambió contra la previa. */
export async function resumenSemanal(organizationId: string, p: Persona, cfg: ConfigEmpresa, ahora = new Date()): Promise<Resumen> {
  const zona = cfg.zona;
  const d = diaEnZona(ahora, zona);
  const hoy = medianocheEnZona(d.anio, d.mes, d.dia, zona);
  const lunes = new Date(hoy.getTime() - (diaSemanaEnZona(ahora, zona) - 1) * DIA);
  const desde = new Date(lunes.getTime() - 7 * DIA);
  const previa = new Date(desde.getTime() - 7 * DIA);
  const propio = !can(p.role, "workorder:write");
  const alcance = propio ? { assignedToId: p.id } : {};
  const s: Array<Seccion | null> = [];

  const contar = async (a: Date, b: Date) => {
    const [creadas, completadas, prevVencen, prevATiempo] = await Promise.all([
      prisma.workOrder.count({ where: { organizationId, ...alcance, createdAt: { gte: a, lt: b } } }),
      prisma.workOrder.count({ where: { organizationId, ...alcance, completedAt: { gte: a, lt: b } } }),
      prisma.workOrder.count({ where: { organizationId, ...alcance, maintenanceType: "PREVENTIVE", dueDate: { gte: a, lt: b }, status: { not: "CANCELLED" } } }),
      prisma.workOrder.findMany({ where: { organizationId, ...alcance, maintenanceType: "PREVENTIVE", dueDate: { gte: a, lt: b }, completedAt: { not: null } }, select: { completedAt: true, dueDate: true } }),
    ]);
    const cumplidos = prevATiempo.filter((o) => o.completedAt! <= new Date(o.dueDate!.getTime() + DIA)).length;
    return { creadas, completadas, cumplimiento: prevVencen ? Math.round((cumplidos / prevVencen) * 100) : null };
  };
  const [esta, antes] = await Promise.all([contar(desde, lunes), contar(previa, desde)]);
  const vencidasAhora = await prisma.workOrder.count({ where: { organizationId, ...alcance, status: { in: ACTIVAS }, dueDate: { lt: ahora } } });

  const cambio = (actual: number, anterior: number) => {
    if (!anterior) return actual ? " (la semana previa: 0)" : "";
    const pct = Math.round(((actual - anterior) / anterior) * 100);
    return Math.abs(pct) >= 20 && Math.abs(actual - anterior) >= 3 ? ` (${pct > 0 ? "+" : ""}${pct}% contra la semana previa)` : "";
  };
  const lineas = [
    { texto: `Creadas: ${esta.creadas}${cambio(esta.creadas, antes.creadas)}`, enlace: "/work-orders" },
    { texto: `Completadas: ${esta.completadas}${cambio(esta.completadas, antes.completadas)}`, enlace: "/work-orders?status=COMPLETED" },
    { texto: `Vencidas hoy: ${vencidasAhora}`, enlace: "/work-orders" },
  ];
  if (esta.cumplimiento !== null) {
    lineas.push({ texto: `Cumplimiento preventivo: ${esta.cumplimiento}%${antes.cumplimiento !== null ? ` (previa ${antes.cumplimiento}%)` : ""}`, enlace: "/indicadores" });
  }
  s.push(seccion(propio ? "Sus órdenes de la semana" : "Órdenes de la semana", esta.creadas + esta.completadas + vencidasAhora,
    lineas, vencidasAhora ? "Empiece la semana por las vencidas." : "Sin atrasos: mantenga el ritmo."));

  if (!propio) {
    const [completadasTipo, alertasCrit, correctivos, respuesta, pendientesCompra, escaladas] = await Promise.all([
      prisma.workOrder.groupBy({ by: ["maintenanceType"], where: { organizationId, completedAt: { gte: desde, lt: lunes } }, _count: true }),
      prisma.predictiveAlert.count({ where: { organizationId, severity: "CRITICAL", createdAt: { gte: desde, lt: lunes } } }),
      prisma.workOrder.groupBy({ by: ["assetId"], where: { organizationId, maintenanceType: "CORRECTIVE", createdAt: { gte: desde, lt: lunes }, assetId: { not: null } }, _count: true, orderBy: { _count: { assetId: "desc" } }, take: 3 }),
      prisma.workOrder.findMany({ where: { organizationId, maintenanceType: "CORRECTIVE", startedAt: { gte: desde, lt: lunes } }, select: { createdAt: true, startedAt: true }, take: 2000 }),
      prisma.purchaseRequest.count({ where: { organizationId, OR: [{ estado: "SOLICITADA" }, { estado: "AUTORIZADA", ordenes: { none: {} } }] } }),
      prisma.escalamiento.count({ where: { organizationId, estado: { in: ["ACTIVO", "AGOTADO"] }, nivel: { gte: 1 } } }),
    ]);
    const total = completadasTipo.reduce((a, x) => a + x._count, 0);
    const planeadas = completadasTipo.filter((x) => x.maintenanceType !== "CORRECTIVE").reduce((a, x) => a + x._count, 0);
    const activos = correctivos.length
      ? await prisma.asset.findMany({ where: { organizationId, id: { in: correctivos.map((c) => c.assetId!) } }, select: { id: true, code: true, name: true } })
      : [];
    const horas = respuesta.length
      ? Math.round(respuesta.reduce((a, o) => a + (o.startedAt!.getTime() - o.createdAt.getTime()), 0) / respuesta.length / 3_600_000 * 10) / 10
      : null;
    const items = [
      ...(total ? [{ texto: `Trabajo planeado: ${Math.round((planeadas / total) * 100)}% de ${total} órdenes completadas`, enlace: "/indicadores" }] : []),
      ...(horas !== null ? [{ texto: `Tiempo de atención de correctivos: ${horas} h en promedio`, enlace: "/indicadores" }] : []),
      ...(alertasCrit ? [{ texto: `Alertas predictivas críticas: ${alertasCrit}`, enlace: "/predictive" }] : []),
      ...(pendientesCompra ? [{ texto: `Compras pendientes: ${pendientesCompra}`, enlace: "/compras" }] : []),
      ...(escaladas ? [{ texto: `Pendientes escalados: ${escaladas}`, enlace: "/notificaciones" }] : []),
    ];
    s.push(seccion("La operación", items.length, items, "Revise lo escalado y lo que espera compra."));
    s.push(seccion("Equipos con más fallas", activos.length,
      correctivos.map((c) => {
        const a = activos.find((x) => x.id === c.assetId);
        return { texto: `${a?.code ?? "—"} · ${a?.name ?? ""}: ${c._count} correctivo(s)`, enlace: `/assets/${c.assetId}` };
      }), "Revise si necesitan plan o análisis de causa."));
    if (can(p.role, "data:export") || p.role === "COMPRAS") {
      const salidas = await prisma.stockMovement.findMany({
        where: { organizationId, movementType: "OUT", createdAt: { gte: desde, lt: lunes } }, select: { quantity: true, unitCost: true },
      });
      const costo = salidas.reduce((a, m) => a + m.quantity * m.unitCost, 0);
      if (salidas.length) {
        s.push(seccion("Consumo de refacciones", salidas.length,
          [{ texto: `${salidas.length} salida(s) por $${costo.toFixed(2)}`, enlace: "/inventory" }], "Compare contra lo planeado del mes."));
      }
    }
  }

  const secciones = s.filter((x): x is Seccion => Boolean(x));
  const hasta = new Date(lunes.getTime() - 1);
  return {
    periodo: `Semana del ${fmt(desde, zona)} al ${fmt(hasta, zona)}`,
    secciones, primero: secciones[0]?.accion ?? null,
  };
}

export function textoDeResumen(r: Resumen): string {
  const partes = [r.periodo];
  for (const s of r.secciones) {
    partes.push(`\n${s.titulo} (${s.total})`);
    for (const i of s.items) partes.push(`• ${i.texto}`);
    partes.push(`→ ${s.accion}`);
  }
  return partes.join("\n");
}

/**
 * Manda los resúmenes que ya tocan. Idempotente: un resumen por persona por
 * día (o semana); correr el proceso cada cinco minutos no los repite.
 */
export async function enviarResumenes(organizationId: string, cfg: ConfigEmpresa, ahora = new Date()) {
  const ventana: Ventana = { zona: cfg.zona, horaInicio: "00:00", horaFin: "23:59", diasHabiles: cfg.diasHabiles, festivos: cfg.festivos };
  const res = { diarios: 0, semanales: 0, vacios: 0 };
  if (!esDiaLaborable(ahora, ventana)) return res;
  if (minutosDeHora(horaLocal(ahora, cfg.zona)) < minutosDeHora(cfg.horaResumen)) return res;

  const dia = claveDiaEnZona(ahora, cfg.zona);
  // El semanal sale el primer día laborable de la semana.
  const hoyNum = diaSemanaEnZona(ahora, cfg.zona);
  const primerLaborable = [1, 2, 3, 4, 5, 6, 7].find((n) => cfg.diasHabiles.includes(n)) ?? 1;
  const tocaSemanal = cfg.resumenSemanal && hoyNum === primerLaborable;

  const personas = await prisma.user.findMany({
    where: { organizationId, active: true, role: { not: "VIEWER" } },
    select: { id: true, role: true, name: true, preferenciaAvisos: { select: { resumenDiario: true, resumenSemanal: true, tiposApagados: true } } },
  });
  for (const p of personas) {
    const apagados = leerJson<string[]>(p.preferenciaAvisos?.tiposApagados, []);
    const quiereDiario = cfg.resumenDiario && (p.preferenciaAvisos?.resumenDiario ?? true) && !apagados.includes("RESUMEN_DIARIO");
    const quiereSemanal = tocaSemanal && (p.preferenciaAvisos?.resumenSemanal ?? true) && !apagados.includes("RESUMEN_SEMANAL");
    for (const [tipo, quiere] of [["RESUMEN_DIARIO", quiereDiario], ["RESUMEN_SEMANAL", quiereSemanal]] as const) {
      if (!quiere) continue;
      const clave = `${tipo}:${p.id}:${dia}`;
      const ya = await prisma.notification.findUnique({ where: { userId_claveDedup: { userId: p.id, claveDedup: clave } }, select: { id: true } });
      if (ya) continue;
      const r = tipo === "RESUMEN_DIARIO" ? await resumenDiario(organizationId, p, cfg, ahora) : await resumenSemanal(organizationId, p, cfg, ahora);
      if (!r.secciones.length && !cfg.resumenSinPendientes) { res.vacios++; continue; }
      await notify({
        organizationId, userId: p.id, tipo, prioridad: "INFORMATIVA", modulo: "RESUMENES",
        title: tipo === "RESUMEN_DIARIO"
          ? (r.secciones.length ? `Su día: ${r.secciones.map((x) => `${x.total} ${x.titulo.toLowerCase()}`).slice(0, 2).join(", ")}` : "Su día: sin pendientes")
          : "Resumen de la semana",
        body: r.secciones.length ? textoDeResumen(r) : `${r.periodo}\nNo hay pendientes que requieran su atención.`,
        link: "/notificaciones", claveDedup: clave, accion: r.primero ?? undefined,
      });
      if (tipo === "RESUMEN_DIARIO") res.diarios++; else res.semanales++;
    }
  }
  return res;
}
