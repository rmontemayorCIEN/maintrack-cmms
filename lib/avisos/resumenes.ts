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
 *
 * Un registro aparece UNA vez por resumen. Quien es responsable de una OT
 * vencida y además supervisor y dueño de la cuenta la ve en «Mis pendientes»,
 * no repetida en «Pendientes de mi equipo»: ver `consolidar()`.
 */
import { prisma } from "../db";
import { notify } from "../audit";
import { can } from "../rbac";
import { formatCurrency } from "../utils";
import { claveDiaEnZona, diaEnZona, medianocheEnZona } from "../periodos";
import { PESO_PRIORIDAD } from "./catalogo";
import { leerJson, type ConfigEmpresa } from "./config";
import { diaSemanaEnZona, esDiaLaborable, horaLocal, minutosDeHora, type Ventana } from "./horario";
import { ordenesCompraEnEspera, refaccionesCriticasAgotadas } from "./situaciones";

export type Item = { texto: string; enlace: string; clave?: string };
export type Seccion = { titulo: string; total: number; items: Item[]; accion: string };
export type Resumen = { periodo: string; secciones: Seccion[]; primero: string | null };

const ACTIVAS = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"];
const DIA = 86_400_000;
const fmt = (d: Date, zona: string) => d.toLocaleDateString("es-MX", { timeZone: zona, weekday: "long", day: "numeric", month: "long" });
const MAX_ITEMS = 8;

type Persona = { id: string; role: string; name: string };

function seccion(titulo: string, total: number, items: Seccion["items"], accion: string): Seccion | null {
  return total > 0 ? { titulo, total, items: items.slice(0, 5), accion } : null;
}

// ─────────────────────────────────────────── Consolidación

/**
 * Qué tan directamente le toca a la persona. Un registro que cae en varias
 * se queda en la más específica (el número menor).
 *
 *   1. Requiere una acción directa suya (su OT vencida, crítica, que vence hoy)
 *   2. Es responsabilidad directa suya (compras: lo que tiene que colocar o perseguir)
 *   3. Requiere su autorización (compras por firmar, solicitudes por revisar)
 *   4. Es del equipo o área que supervisa
 *   5. Es una situación general de la empresa (escalados, refacciones)
 *   6. Es solo informativo
 */
export type Nivel = 1 | 2 | 3 | 4 | 5 | 6;
export const SECCION_DE_NIVEL: Record<Nivel, string> = {
  1: "Mis pendientes",
  2: "Mis pendientes",
  3: "Pendientes que debo autorizar",
  4: "Pendientes de mi equipo",
  5: "Situaciones generales de la empresa",
  6: "Información relevante",
};
/** Para el título del aviso: «Su día: 2 pendientes suyos · 1 por autorizar». */
const CORTO: Record<string, (n: number) => string> = {
  "Mis pendientes": (n) => `${n} ${n === 1 ? "pendiente suyo" : "pendientes suyos"}`,
  "Pendientes que debo autorizar": (n) => `${n} por autorizar`,
  "Pendientes de mi equipo": (n) => `${n} de su equipo`,
  "Situaciones generales de la empresa": (n) => `${n} ${n === 1 ? "situación general" : "situaciones generales"}`,
  "Información relevante": (n) => `${n} ${n === 1 ? "informativo" : "informativos"}`,
};

/** Una aparición de un registro, desde una de las consultas. */
export type Renglon = {
  /** El registro: «WorkOrder:<id>». Dos renglones con la misma clave son el mismo registro. */
  clave: string;
  nivel: Nivel;
  /** Peso de prioridad (PESO_PRIORIDAD). */
  prioridad: number;
  texto: string;
  enlace: string;
  /** Qué le pasa: «vencida», «crítica», «escalada». Se juntan al consolidar. */
  etiqueta: string;
  accion: string;
};

/**
 * Un registro, una vez. Antes de armar el resumen se juntan todas las
 * apariciones de cada registro —la persona puede verlo como responsable,
 * como supervisora y como dueña de la cuenta—: queda en la sección más
 * específica, con la prioridad más alta, la acción más importante y todas
 * sus etiquetas («crítica · vencida»). Registros distintos (una OT y la
 * alerta que la originó) siguen siendo dos renglones.
 */
export function consolidar(renglones: Renglon[]): Renglon[] {
  const porClave = new Map<string, Renglon & { etiquetas: string[] }>();
  for (const r of renglones) {
    const previo = porClave.get(r.clave);
    if (!previo) { porClave.set(r.clave, { ...r, etiquetas: [r.etiqueta] }); continue; }
    // La acción que manda: la de la sección más específica; a igualdad, la de mayor prioridad.
    const manda = r.nivel < previo.nivel || (r.nivel === previo.nivel && r.prioridad > previo.prioridad);
    porClave.set(r.clave, {
      ...previo,
      nivel: Math.min(previo.nivel, r.nivel) as Nivel,
      prioridad: Math.max(previo.prioridad, r.prioridad),
      accion: manda ? r.accion : previo.accion,
      texto: manda ? r.texto : previo.texto,
      enlace: manda ? r.enlace : previo.enlace,
      etiquetas: previo.etiquetas.includes(r.etiqueta) ? previo.etiquetas : [...previo.etiquetas, r.etiqueta],
    });
  }
  return [...porClave.values()].map(({ etiquetas, ...r }) => ({ ...r, etiqueta: etiquetas.filter(Boolean).join(" · ") }));
}

/** Las secciones, en su orden, sin vacías; cada registro en una sola. */
export function seccionesDe(renglones: Renglon[]): Seccion[] {
  const unicos = consolidar(renglones);
  const secciones: Seccion[] = [];
  for (const titulo of [...new Set(Object.values(SECCION_DE_NIVEL))]) {
    const aqui = unicos
      .filter((r) => SECCION_DE_NIVEL[r.nivel] === titulo)
      .sort((a, b) => b.prioridad - a.prioridad || a.nivel - b.nivel || a.texto.localeCompare(b.texto));
    if (!aqui.length) continue;
    const items = aqui.slice(0, MAX_ITEMS).map((r) => ({ texto: r.etiqueta ? `${r.texto} (${r.etiqueta})` : r.texto, enlace: r.enlace, clave: r.clave }));
    const lista: Item[] = items;
    if (aqui.length > MAX_ITEMS) lista.push({ texto: `… y ${aqui.length - MAX_ITEMS} más`, enlace: "/notificaciones" });
    secciones.push({ titulo, total: aqui.length, items: lista, accion: aqui[0].accion });
  }
  return secciones;
}

/**
 * Para resúmenes armados por secciones fijas (el semanal): un registro que ya
 * salió en una sección anterior no se repite en otra, y la sección que se
 * queda sin nada no aparece.
 */
export function sinRepetir(secciones: Array<Seccion | null>): Seccion[] {
  const vistos = new Set<string>();
  const salida: Seccion[] = [];
  for (const s of secciones) {
    if (!s) continue;
    const items = s.items.filter((i) => !i.clave || !vistos.has(i.clave));
    for (const i of items) if (i.clave) vistos.add(i.clave);
    const quitados = s.items.length - items.length;
    if (!items.length) continue;
    salida.push({ ...s, items, total: Math.max(items.length, s.total - quitados) });
  }
  return salida;
}

type OtResumen = { id: string; number: string; title: string; priority: string; dueDate: Date | null; maintenanceType: string; asset: { code: string } | null };
const textoOt = (o: OtResumen) => `${o.number}${o.asset ? ` · ${o.asset.code}` : ""} — ${o.title}`;

/** El resumen del día para una persona. */
export async function resumenDiario(organizationId: string, p: Persona, cfg: ConfigEmpresa, ahora = new Date()): Promise<Resumen> {
  const zona = cfg.zona;
  const d = diaEnZona(ahora, zona);
  const hoy = medianocheEnZona(d.anio, d.mes, d.dia, zona);
  const manana = new Date(hoy.getTime() + DIA);
  const pasado = new Date(hoy.getTime() + 2 * DIA);
  const R: Renglon[] = [];
  const supervisa = can(p.role, "workorder:write");
  const selOt = { id: true, number: true, title: true, priority: true, dueDate: true, maintenanceType: true, asset: { select: { code: true } } } as const;

  /** Una orden, con todo lo que le pasa, desde el nivel dado. */
  const orden = (o: OtResumen, nivel: Nivel, acciones: { critica: string; vencida: string; proxima: string; preventivo: string }) => {
    const r = (etiqueta: string, prioridad: number, accion: string) =>
      R.push({ clave: `WorkOrder:${o.id}`, nivel, prioridad, texto: textoOt(o), enlace: `/work-orders/${o.id}`, etiqueta, accion });
    if (o.priority === "CRITICAL") r("crítica", PESO_PRIORIDAD.CRITICA, acciones.critica);
    if (o.dueDate && o.dueDate < ahora) r("vencida", PESO_PRIORIDAD.ALTA, acciones.vencida);
    else if (o.dueDate && o.dueDate < pasado) r("vence hoy o mañana", PESO_PRIORIDAD.MEDIA, acciones.proxima);
    if (o.maintenanceType === "PREVENTIVE" && o.dueDate && o.dueDate >= hoy && o.dueDate < manana) r("preventivo de hoy", PESO_PRIORIDAD.MEDIA, acciones.preventivo);
  };

  // 1. Lo propio: cualquiera con órdenes asignadas.
  if (can(p.role, "workorder:execute")) {
    const mias = await prisma.workOrder.findMany({
      where: { organizationId, assignedToId: p.id, status: { in: ACTIVAS } },
      select: selOt, orderBy: { dueDate: "asc" }, take: 200,
    });
    for (const o of mias) {
      orden(o, 1, {
        critica: "Atiéndalas primero.", vencida: "Actualice su avance o reprográmelas con motivo a una fecha futura.",
        proxima: "Planee su día para cerrarlas a tiempo.", preventivo: "Ejecútelos hoy.",
      });
    }
  }

  // 4. El equipo, para quien supervisa. Lo que ya salió como suyo no se repite.
  if (supervisa) {
    const [equipo, alertas, escaladas] = await Promise.all([
      prisma.workOrder.findMany({
        where: {
          organizationId, status: { in: ACTIVAS },
          OR: [{ priority: "CRITICAL" }, { dueDate: { lt: pasado } }],
        },
        select: selOt, orderBy: { dueDate: "asc" }, take: 300,
      }),
      prisma.predictiveAlert.findMany({ where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, select: { id: true, title: true, severity: true, asset: { select: { code: true } } }, take: 50 }),
      prisma.escalamiento.findMany({ where: { organizationId, estado: { in: ["ACTIVO", "AGOTADO"] }, nivel: { gte: 1 } }, select: { entidad: true, entidadId: true }, take: 100 }),
    ]);
    for (const o of equipo) {
      orden(o, 4, {
        critica: "Confirme que cada una tiene responsable y avance.", vencida: "Reasigne o reprograme con motivo las que no avanzan.",
        proxima: "Revise la carga del equipo en el calendario.", preventivo: "Verifique que tengan responsable y material.",
      });
    }
    for (const a of alertas) {
      R.push({
        clave: `PredictiveAlert:${a.id}`, nivel: 4, prioridad: a.severity === "CRITICAL" ? PESO_PRIORIDAD.CRITICA : PESO_PRIORIDAD.ALTA,
        texto: `${a.asset.code} — ${a.title}`, enlace: "/predictive", etiqueta: "alerta predictiva", accion: "Revise la alerta y decida la acción.",
      });
    }
    // 5. Lo escalado: cada registro con su nombre; si ya aparece arriba, solo se le suma «escalado».
    for (const e of await nombresDe(organizationId, escaladas)) {
      R.push({ clave: e.clave, nivel: 5, prioridad: PESO_PRIORIDAD.ALTA, texto: e.texto, enlace: e.enlace, etiqueta: "escalado", accion: "Revise por qué no se atendió en su primer nivel." });
    }
  }

  // 3. Lo que espera su decisión: solicitudes por revisar y compras por firmar.
  if (can(p.role, "request:review")) {
    const solicitudes = await prisma.workRequest.findMany({
      where: { organizationId, status: "PENDING" }, select: { id: true, number: true, title: true, priority: true, riesgo: true }, orderBy: { createdAt: "asc" }, take: 100,
    });
    for (const x of solicitudes) {
      const critica = x.priority === "CRITICAL" || x.riesgo === "ALTO";
      R.push({
        clave: `WorkRequest:${x.id}`, nivel: 3, prioridad: critica ? PESO_PRIORIDAD.CRITICA : PESO_PRIORIDAD.MEDIA, texto: `${x.number} — ${x.title}`, enlace: `/requests/${x.id}`,
        etiqueta: critica ? "solicitud crítica sin revisar" : "solicitud sin revisar", accion: "Conviértalas en orden o recházelas con motivo.",
      });
    }
  }
  if (can(p.role, "purchase:authorize")) {
    const porFirmar = await prisma.purchaseRequest.findMany({
      where: { organizationId, estado: "SOLICITADA", NOT: { solicitanteId: p.id } },
      select: { id: true, folio: true, urgencia: true, montoEstimado: true }, take: 50,
    });
    for (const c of porFirmar) {
      R.push({
        clave: `PurchaseRequest:${c.id}`, nivel: 3, prioridad: c.urgencia === "PARO" ? PESO_PRIORIDAD.CRITICA : PESO_PRIORIDAD.MEDIA,
        texto: `${c.folio}${c.urgencia === "PARO" ? " (equipo parado)" : ""} — ${formatCurrency(c.montoEstimado, cfg.moneda)}`, enlace: `/compras/${c.id}`,
        etiqueta: "compra por autorizar", accion: "Autorícelas o recházelas: el material no se pide sin su firma.",
      });
    }
  }

  // 2. Compras: lo que le toca colocar o perseguir. 5: refacciones críticas agotadas.
  if (p.role === "COMPRAS") {
    const [sinOc, vencidas] = await Promise.all([
      prisma.purchaseRequest.findMany({ where: { organizationId, estado: "AUTORIZADA", ordenes: { none: {} } }, select: { id: true, folio: true }, take: 50 }),
      ordenesCompraEnEspera(organizationId).then((l) => l.filter((o) => o.fechaPrometida! < ahora)),
    ]);
    for (const c of sinOc) R.push({ clave: `PurchaseRequest:${c.id}`, nivel: 2, prioridad: PESO_PRIORIDAD.MEDIA, texto: c.folio, enlace: `/compras/${c.id}`, etiqueta: "autorizada sin orden de compra", accion: "Coloque la orden con el proveedor." });
    for (const o of vencidas) R.push({ clave: `PurchaseOrder:${o.id}`, nivel: 2, prioridad: PESO_PRIORIDAD.ALTA, texto: o.folio, enlace: `/compras/${o.purchaseRequestId}`, etiqueta: "entrega vencida", accion: "Confirme la nueva fecha con el proveedor." });
  }
  if (supervisa || p.role === "COMPRAS") {
    for (const x of await refaccionesCriticasAgotadas(organizationId)) {
      R.push({
        clave: `Part:${x.id}`, nivel: p.role === "COMPRAS" ? 2 : 5, prioridad: x.detieneTrabajo ? PESO_PRIORIDAD.ALTA : PESO_PRIORIDAD.MEDIA,
        texto: `${x.code} · ${x.name}`, enlace: `/inventory?q=${encodeURIComponent(x.code)}`, etiqueta: "refacción crítica agotada", accion: "Pídalas o autorice un sustituto.",
      });
    }
  }

  // 6. Informativo: el solicitante, sus solicitudes en revisión.
  if (p.role === "REQUESTER") {
    const mias = await prisma.workRequest.findMany({ where: { organizationId, requestedById: p.id, status: "PENDING" }, select: { id: true, number: true, title: true }, take: 20 });
    for (const x of mias) R.push({ clave: `WorkRequest:${x.id}`, nivel: 6, prioridad: PESO_PRIORIDAD.INFORMATIVA, texto: `${x.number} — ${x.title}`, enlace: `/requests/${x.id}`, etiqueta: "en revisión", accion: "No hace falta nada: se le avisará cuando se revisen." });
  }

  const secciones = seccionesDe(R);
  return { periodo: `Hoy, ${fmt(ahora, zona)}`, secciones, primero: secciones[0]?.accion ?? null };
}

/** El nombre y la liga de los registros escalados, para listarlos (y juntarlos con los demás). */
async function nombresDe(organizationId: string, filas: Array<{ entidad: string; entidadId: string }>) {
  const de = (e: string) => filas.filter((f) => f.entidad === e).map((f) => f.entidadId);
  const [ots, sols, comp, ocs, alts, partes] = await Promise.all([
    prisma.workOrder.findMany({ where: { organizationId, id: { in: de("WorkOrder") } }, select: { id: true, number: true, title: true, asset: { select: { code: true } } } }),
    prisma.workRequest.findMany({ where: { organizationId, id: { in: de("WorkRequest") } }, select: { id: true, number: true, title: true } }),
    prisma.purchaseRequest.findMany({ where: { organizationId, id: { in: de("PurchaseRequest") } }, select: { id: true, folio: true } }),
    prisma.purchaseOrder.findMany({ where: { organizationId, id: { in: de("PurchaseOrder") } }, select: { id: true, folio: true, purchaseRequestId: true } }),
    prisma.predictiveAlert.findMany({ where: { organizationId, id: { in: de("PredictiveAlert") } }, select: { id: true, title: true, asset: { select: { code: true } } } }),
    prisma.part.findMany({ where: { organizationId, id: { in: de("Part") } }, select: { id: true, code: true, name: true } }),
  ]);
  return [
    ...ots.map((o) => ({ clave: `WorkOrder:${o.id}`, texto: `${o.number}${o.asset ? ` · ${o.asset.code}` : ""} — ${o.title}`, enlace: `/work-orders/${o.id}` })),
    ...sols.map((x) => ({ clave: `WorkRequest:${x.id}`, texto: `${x.number} — ${x.title}`, enlace: `/requests/${x.id}` })),
    ...comp.map((x) => ({ clave: `PurchaseRequest:${x.id}`, texto: x.folio, enlace: `/compras/${x.id}` })),
    ...ocs.map((x) => ({ clave: `PurchaseOrder:${x.id}`, texto: x.folio, enlace: `/compras/${x.purchaseRequestId}` })),
    ...alts.map((x) => ({ clave: `PredictiveAlert:${x.id}`, texto: `${x.asset.code} — ${x.title}`, enlace: "/predictive" })),
    ...partes.map((x) => ({ clave: `Part:${x.id}`, texto: `${x.code} · ${x.name}`, enlace: `/inventory?q=${encodeURIComponent(x.code)}` })),
  ];
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
  const lineas: Item[] = [
    { texto: `Creadas: ${esta.creadas}${cambio(esta.creadas, antes.creadas)}`, enlace: "/work-orders", clave: "cifra:creadas" },
    { texto: `Completadas: ${esta.completadas}${cambio(esta.completadas, antes.completadas)}`, enlace: "/work-orders?status=COMPLETED", clave: "cifra:completadas" },
    { texto: `Vencidas hoy: ${vencidasAhora}`, enlace: "/work-orders", clave: "cifra:vencidas" },
  ];
  if (esta.cumplimiento !== null) {
    lineas.push({ texto: `Cumplimiento preventivo: ${esta.cumplimiento}%${antes.cumplimiento !== null ? ` (previa ${antes.cumplimiento}%)` : ""}`, enlace: "/indicadores", clave: "cifra:cumplimiento" });
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
    const items: Item[] = [
      ...(total ? [{ texto: `Trabajo planeado: ${Math.round((planeadas / total) * 100)}% de ${total} órdenes completadas`, enlace: "/indicadores", clave: "cifra:planeado" }] : []),
      ...(horas !== null ? [{ texto: `Tiempo de atención de correctivos: ${horas} h en promedio`, enlace: "/indicadores", clave: "cifra:atencion" }] : []),
      ...(alertasCrit ? [{ texto: `Alertas predictivas críticas: ${alertasCrit}`, enlace: "/predictive", clave: "cifra:alertas" }] : []),
      ...(pendientesCompra ? [{ texto: `Compras pendientes: ${pendientesCompra}`, enlace: "/compras", clave: "cifra:compras" }] : []),
      ...(escaladas ? [{ texto: `Pendientes escalados: ${escaladas}`, enlace: "/notificaciones", clave: "cifra:escalados" }] : []),
    ];
    s.push(seccion("La operación", items.length, items, "Revise lo escalado y lo que espera compra."));
    s.push(seccion("Equipos con más fallas", activos.length,
      correctivos.map((c) => {
        const a = activos.find((x) => x.id === c.assetId);
        return { texto: `${a?.code ?? "—"} · ${a?.name ?? ""}: ${c._count} correctivo(s)`, enlace: `/assets/${c.assetId}`, clave: `Asset:${c.assetId}` };
      }), "Revise si necesitan plan o análisis de causa."));
    if (can(p.role, "data:export") || p.role === "COMPRAS") {
      const salidas = await prisma.stockMovement.findMany({
        where: { organizationId, movementType: "OUT", createdAt: { gte: desde, lt: lunes } }, select: { quantity: true, unitCost: true },
      });
      const costo = salidas.reduce((a, m) => a + m.quantity * m.unitCost, 0);
      if (salidas.length) {
        s.push(seccion("Consumo de refacciones", salidas.length,
          [{ texto: `${salidas.length} salida(s) por ${formatCurrency(costo, cfg.moneda)}`, enlace: "/inventory", clave: "cifra:consumo" }], "Compare contra lo planeado del mes."));
      }
    }
  }

  const secciones = sinRepetir(s);
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
          ? (r.secciones.length ? `Su día: ${r.secciones.map((x) => CORTO[x.titulo]?.(x.total) ?? `${x.total} ${x.titulo.toLowerCase()}`).slice(0, 3).join(" · ")}` : "Su día: sin pendientes")
          : "Resumen de la semana",
        body: r.secciones.length ? textoDeResumen(r) : `${r.periodo}\nNo hay pendientes que requieran su atención.`,
        link: "/notificaciones", claveDedup: clave, accion: r.primero ?? undefined,
      });
      if (tipo === "RESUMEN_DIARIO") res.diarios++; else res.semanales++;
    }
  }
  return res;
}
