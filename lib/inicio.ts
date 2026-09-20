/**
 * El inicio de cada rol: lo que tiene que ver primero para trabajar.
 *
 * No son siete pantallas: es una sola (app/(app)/dashboard) que pinta lo que
 * esta función arma para cada rol. Cada inicio trae, como máximo, un resumen
 * breve, las prioridades del día, los pendientes que piden acción y las
 * acciones rápidas; los indicadores solo donde de verdad sirven (dueño).
 *
 *   Propietario    riesgos, resultados, costos y excepciones
 *   Administrador  operación, configuración y calidad
 *   Supervisor     asignación, vencimientos y revisión
 *   Técnico        mis órdenes y acciones inmediatas
 *   Compras        requisiciones, órdenes y entregas
 *   Solicitante    crear y consultar sus reportes
 *   Consulta       información y reportes
 *
 * Los números se calculan aquí, en código; la pantalla no suma nada. Las
 * ligas solo apuntan a pantallas que el rol puede abrir (puedeVerRuta): un
 * inicio que manda a «Sin permiso» es peor que no tenerlo.
 */
import { prisma } from "./db";
import { formatDia, formatCurrency } from "./utils";
import { accionesRapidasDe, puedeVerRuta, TITULO_INICIO, type AccionRapida, type Rol } from "./pantallas";
import { OT_ACTIVAS, ordenesCompraEnEspera, refaccionesBajoMinimo, refaccionesCriticasAgotadas } from "./avisos/situaciones";
import { filtroDeVencidas } from "./vencimiento";

export type Tono = "normal" | "bien" | "atencion" | "critico";
export type Cifra = { etiqueta: string; valor: string; tono: Tono; enlace?: string };
export type Renglon = {
  id: string; folio: string; titulo: string; detalle?: string;
  estado?: string; prioridad?: string; fecha?: string; tono: Tono;
  enlace?: string; accion?: { texto: string; enlace: string };
};
export type Bloque = {
  id: string; titulo: string; descripcion?: string; total: number;
  renglones: Renglon[]; verTodo?: { texto: string; enlace: string };
};
export type Inicio = {
  rol: Rol; titulo: string; resumen: Cifra[]; bloques: Bloque[]; acciones: AccionRapida[];
  /** Dónde se consulta el detalle o se administra (Indicadores, Reportes, Usuarios…): el inicio no lo repite. */
  masDetalle: Array<{ texto: string; href: string }>;
  tituloDetalle: string;
  /** Si todo está al día: se dice, en vez de mostrar bloques vacíos. */
  alDia: boolean;
  /** Dueño y administración, mientras la cuenta no esté lista: cuánto falta (el mismo número de /puesta-en-marcha). */
  puesta: { porcentaje: number; siguiente: string | null; estado: string } | null;
};

type Usuario = { id: string; role: string; isSuperAdmin: boolean; organizationId: string; organization: { timezone: string | null; currency: string } };

const DIA = 86_400_000;
const MAX = 6;
const n = (x: number) => new Intl.NumberFormat("es-MX").format(x);
/**
 * Porcentaje para el inicio. Cerca de 100 se muestra con un decimal y hacia
 * abajo: 99.97 % redondeado a «100 %» dice que no hubo un solo paro, y sí hubo.
 */
const pct = (x: number | null) => (x === null ? "—" : x >= 99 && x < 100 ? `${(Math.floor(x * 10) / 10).toLocaleString("es-MX")} %` : `${Math.round(x)} %`);

const selOt = {
  id: true, number: true, title: true, status: true, priority: true, dueDate: true, estimatedHours: true,
  assignedTo: { select: { name: true } }, asset: { select: { code: true, name: true } }, location: { select: { name: true } },
} as const;
type OtFila = { id: string; number: string; title: string; status: string; priority: string; dueDate: Date | null; estimatedHours: number; assignedTo: { name: string } | null; asset: { code: string; name: string } | null; location: { name: string } | null };

function renglonOt(o: OtFila, zona: string, ahora: Date, opciones: { conResponsable?: boolean; accion?: Renglon["accion"] } = {}): Renglon {
  const vencida = Boolean(o.dueDate && o.dueDate < ahora && OT_ACTIVAS.includes(o.status));
  return {
    id: o.id, folio: o.number, titulo: o.title,
    detalle: [o.asset ? `${o.asset.code} · ${o.asset.name}` : null, o.location?.name ?? null, opciones.conResponsable ? (o.assignedTo?.name ?? "Sin responsable") : null].filter(Boolean).join(" · ") || undefined,
    estado: o.status, prioridad: o.priority,
    fecha: o.dueDate ? `${vencida ? "Venció" : "Para"} ${formatDia(o.dueDate, { zona })}` : "Sin fecha",
    tono: vencida || o.priority === "CRITICAL" ? "critico" : o.priority === "HIGH" ? "atencion" : "normal",
    enlace: `/work-orders/${o.id}`, accion: opciones.accion,
  };
}

function bloque(id: string, titulo: string, renglones: Renglon[], extra: { descripcion?: string; total?: number; verTodo?: Bloque["verTodo"] } = {}): Bloque {
  return { id, titulo, descripcion: extra.descripcion, total: extra.total ?? renglones.length, renglones: renglones.slice(0, MAX), verTodo: extra.verTodo };
}

/** El inicio de esta persona. */
export async function inicioDe(user: Usuario, ahora = new Date()): Promise<Inicio> {
  const rol = (user.role as Rol);
  const zona = user.organization.timezone || "America/Mexico_City";
  const org = user.organizationId;
  const ctx = { user, rol, zona, org, ahora };
  const armado = await (ARMADORES[rol] ?? inicioConsulta)(ctx);
  const bloques = armado.bloques.filter((b) => b.total > 0)
    // Una liga a una pantalla que el rol no abre no se ofrece.
    .map((b) => ({ ...b, verTodo: b.verTodo && puedeVerRuta(rol, b.verTodo.enlace) ? b.verTodo : undefined }));
  let puesta: Inicio["puesta"] = null;
  if (rol === "OWNER" || rol === "ADMIN") {
    const { puestaEnMarcha, ESTADO_OPERATIVO } = await import("./puesta-en-marcha");
    const m = await puestaEnMarcha(org).catch(() => null);
    if (m && !m.completa) {
      puesta = {
        porcentaje: m.porcentaje, estado: ESTADO_OPERATIVO[m.estadoOperativo].texto,
        siguiente: m.siguiente ? `Sigue: ${m.siguiente.titulo}. ${m.siguiente.falta}` : null,
      };
    }
  }
  return {
    rol, titulo: TITULO_INICIO[rol] ?? "Inicio", resumen: armado.resumen, bloques,
    acciones: accionesRapidasDe(rol),
    masDetalle: (armado.masDetalle ?? []).filter((d) => puedeVerRuta(rol, d.href)),
    tituloDetalle: armado.tituloDetalle ?? "Más detalle",
    alDia: bloques.length === 0, puesta,
  };
}

type Ctx = { user: Usuario; rol: Rol; zona: string; org: string; ahora: Date };
type Armado = { resumen: Cifra[]; bloques: Bloque[]; masDetalle?: Inicio["masDetalle"]; tituloDetalle?: string };

// ─────────────────────────────────────────── Piezas compartidas

async function ordenes(org: string, where: Record<string, unknown>, take = 50) {
  return prisma.workOrder.findMany({
    where: { organizationId: org, status: { in: OT_ACTIVAS }, ...where },
    select: selOt, orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }], take,
  }) as Promise<OtFila[]>;
}

async function criticasYVencidas(c: Ctx) {
  const [criticas, vencidas, nVencidas, nCriticas] = await Promise.all([
    ordenes(c.org, { priority: "CRITICAL" }, MAX),
    // El mismo criterio que la lista y que la etiqueta de cada orden: antes
    // aqui se contaba `dueDate < ahora` al instante y alla se comparaba el DIA
    // en la zona de la empresa, asi que el indicador y la pantalla a la que
    // lleva podian no coincidir. Incluye los borradores, como los cuenta
    // `estadoDeVencimiento`: un borrador con fecha pasada es trabajo vencido
    // que nadie solto.
    ordenes(c.org, filtroDeVencidas(c.zona, c.ahora), MAX),
    prisma.workOrder.count({ where: { organizationId: c.org, ...filtroDeVencidas(c.zona, c.ahora) } }),
    prisma.workOrder.count({ where: { organizationId: c.org, status: { in: OT_ACTIVAS }, priority: "CRITICAL" } }),
  ]);
  return { criticas, vencidas, nVencidas, nCriticas };
}

async function alertasAbiertas(c: Ctx) {
  const alertas = await prisma.predictiveAlert.findMany({
    where: { organizationId: c.org, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    select: { id: true, title: true, severity: true, status: true, asset: { select: { code: true, name: true } } },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }], take: 20,
  });
  return alertas.map<Renglon>((a) => ({
    id: a.id, folio: a.asset.code, titulo: a.title, detalle: a.asset.name,
    fecha: a.status === "ACKNOWLEDGED" ? "Reconocida" : "Sin reconocer",
    tono: a.severity === "CRITICAL" ? "critico" : "atencion", enlace: "/predictive",
  }));
}

async function comprasPorAutorizar(c: Ctx) {
  const compras = await prisma.purchaseRequest.findMany({
    where: { organizationId: c.org, estado: "SOLICITADA", NOT: { solicitanteId: c.user.id } },
    select: { id: true, folio: true, urgencia: true, montoEstimado: true, createdAt: true, justificacion: true },
    orderBy: { createdAt: "asc" }, take: 30,
  });
  return compras.map<Renglon>((x) => ({
    id: x.id, folio: x.folio, titulo: x.justificacion?.slice(0, 80) || "Requisición de compra",
    detalle: `${formatCurrency(x.montoEstimado, c.user.organization.currency)}${x.urgencia === "PARO" ? " · equipo parado" : ""}`,
    fecha: `Pedida ${formatDia(x.createdAt, { zona: c.zona })}`, tono: x.urgencia === "PARO" ? "critico" : "atencion",
    enlace: `/compras/${x.id}`, accion: { texto: "Revisar", enlace: `/compras/${x.id}` },
  }));
}

async function avisosAbiertos(c: Ctx, tipos: string[]) {
  const avisos = await prisma.notification.findMany({
    where: { organizationId: c.org, userId: c.user.id, tipo: { in: tipos }, requiereAccion: true, atendidaEl: null },
    select: { id: true, title: true, body: true, link: true, prioridad: true, createdAt: true },
    orderBy: { createdAt: "desc" }, take: 20,
  });
  return avisos.map<Renglon>((a) => ({
    id: a.id, folio: "Aviso", titulo: a.title, detalle: a.body?.split("\n")[0]?.slice(0, 120),
    fecha: formatDia(a.createdAt, { zona: c.zona }), tono: a.prioridad === "CRITICA" ? "critico" : "atencion",
    enlace: a.link ?? "/notificaciones",
  }));
}

// ─────────────────────────────────────────── Propietario

async function inicioPropietario(c: Ctx): Promise<Armado> {
  const { calcularIndicadores, periodoDeLaEmpresa } = await import("./indicadores");
  const periodo = await periodoDeLaEmpresa(c.org, 30, c.ahora);
  const [kpi, cv, alertas, compras, agotadas, avisosAdmin] = await Promise.all([
    calcularIndicadores(c.org, periodo, { ahora: c.ahora }),
    criticasYVencidas(c),
    alertasAbiertas(c),
    comprasPorAutorizar(c),
    refaccionesCriticasAgotadas(c.org),
    avisosAbiertos(c, ["CONFIGURACION_INCOMPLETA", "INTEGRACION_CON_ERRORES", "LIMITE_PLAN_ALCANZADO", "PRUEBA_POR_TERMINAR", "PLAN_FALLO_GENERAR"]),
  ]);
  const i = kpi.indicadores;
  const criticas: Renglon[] = [
    ...cv.criticas.map((o) => renglonOt(o, c.zona, c.ahora, { conResponsable: true })),
    ...alertas.filter((a) => a.tono === "critico"),
    ...agotadas.filter((p) => p.detieneTrabajo).map<Renglon>((p) => ({ id: p.id, folio: p.code, titulo: `${p.name}: agotada`, detalle: p.motivo, tono: "critico", enlace: `/inventory?q=${encodeURIComponent(p.code)}` })),
  ];
  return {
    // Tendencias, mezcla, costo por equipo e indicadores secundarios viven en Indicadores y Reportes.
    masDetalle: [{ texto: "Indicadores y tendencias", href: "/indicadores" }, { texto: "Reportes", href: "/reports" }],
    resumen: [
      { etiqueta: "OT vencidas", valor: n(cv.nVencidas), tono: cv.nVencidas ? "critico" : "bien", enlace: "/work-orders?vencidas=1" },
      { etiqueta: "Cumplimiento preventivo (30 días)", valor: pct(i.cumplimientoPreventivo.valor), tono: (i.cumplimientoPreventivo.valor ?? 100) < 80 ? "atencion" : "bien", enlace: "/indicadores" },
      { etiqueta: "Disponibilidad (30 días)", valor: pct(i.disponibilidad.valor), tono: (i.disponibilidad.valor ?? 100) < 90 ? "atencion" : "bien", enlace: "/indicadores" },
      { etiqueta: "Costo de mantenimiento (30 días)", valor: formatCurrency(kpi.costos.total, c.user.organization.currency), tono: "normal", enlace: "/reports" },
    ],
    bloques: [
      bloque("situacion-critica", "Situación crítica", criticas, { descripcion: "Órdenes críticas, alertas críticas y refacciones agotadas que detienen trabajo.", total: cv.nCriticas + alertas.filter((a) => a.tono === "critico").length + agotadas.filter((p) => p.detieneTrabajo).length }),
      bloque("autorizaciones", "Compras que esperan su firma", compras, { verTodo: { texto: "Ver compras", enlace: "/compras" } }),
      // Las vencidas ya están en el resumen (con su liga a la lista): no se repiten como bloque.
      bloque("alertas", "Alertas importantes", alertas.filter((a) => a.tono !== "critico"), { verTodo: { texto: "Ver predictivo", enlace: "/predictive" } }),
      bloque("cuenta", "Configuración, plan y avisos", avisosAdmin, { descripcion: "Lo que falta configurar, límites del plan e integraciones con errores." }),
      ...(c.user.isSuperAdmin ? [bloque("clientes", "Empresas cliente", [{ id: "clientes", folio: "Plataforma", titulo: "Administrar empresas cliente", tono: "normal", enlace: "/clients" }])] : []),
    ],
  };
}

// ─────────────────────────────────────────── Administrador

async function inicioAdministrador(c: Ctx): Promise<Armado> {
  const [cv, alertas, compras, agotadas, bajas, avisosAdmin, avisosPlanes, fallidas, calidad] = await Promise.all([
    criticasYVencidas(c),
    alertasAbiertas(c),
    comprasPorAutorizar(c),
    refaccionesCriticasAgotadas(c.org),
    refaccionesBajoMinimo(c.org),
    avisosAbiertos(c, ["CONFIGURACION_INCOMPLETA", "INTEGRACION_CON_ERRORES", "LIMITE_PLAN_ALCANZADO", "PRUEBA_POR_TERMINAR"]),
    avisosAbiertos(c, ["PLAN_SIN_PROGRAMACION", "PLAN_FALLO_GENERAR", "ACTIVO_CRITICO_SIN_PLAN", "MEDIDOR_SIN_LECTURA"]),
    prisma.entregaAviso.count({ where: { organizationId: c.org, estado: "FALLIDA", createdAt: { gte: new Date(c.ahora.getTime() - 7 * DIA) } } }),
    import("./calidad-datos").then((m) => m.revisarCalidad(c.org, c.ahora)).catch(() => []),
  ]);
  const problemas = calidad.filter((r) => r.cantidad > 0).sort((a, b) => b.peso - a.peso);
  const puesta = await import("./puesta-en-marcha").then((m) => m.puestaEnMarcha(c.org)).catch(() => null);
  return {
    tituloDetalle: "Administración",
    masDetalle: [
      { texto: "Usuarios", href: "/settings?s=usuarios" }, { texto: "Configuración", href: "/settings?s=organizacion" },
      { texto: "Catálogos", href: "/catalogs" }, { texto: "Reglas de avisos", href: "/settings?s=avisos" },
      { texto: "Importar datos", href: "/import" }, { texto: "Puesta en marcha", href: "/puesta-en-marcha" },
      { texto: "Auditoría", href: "/settings?s=auditoria" },
    ],
    resumen: [
      { etiqueta: "Críticas abiertas", valor: n(cv.nCriticas), tono: cv.nCriticas ? "critico" : "bien", enlace: "/work-orders?prioridad=CRITICAL" },
      { etiqueta: "OT vencidas", valor: n(cv.nVencidas), tono: cv.nVencidas ? "atencion" : "bien", enlace: "/work-orders?vencidas=1" },
      { etiqueta: "Compras por autorizar", valor: n(compras.length), tono: compras.length ? "atencion" : "bien", enlace: "/compras" },
      { etiqueta: "Problemas de captura", valor: n(problemas.reduce((s, p) => s + p.cantidad, 0)), tono: problemas.length ? "atencion" : "bien", enlace: "/puesta-en-marcha" },
    ],
    bloques: [
      bloque("criticos", "Pendientes críticos", [
        ...cv.criticas.map((o) => renglonOt(o, c.zona, c.ahora, { conResponsable: true })),
        ...agotadas.filter((p) => p.detieneTrabajo).map<Renglon>((p) => ({ id: p.id, folio: p.code, titulo: `${p.name}: agotada`, detalle: p.motivo, tono: "critico", enlace: `/inventory?q=${encodeURIComponent(p.code)}` })),
      ]),
      bloque("vencidas", "Órdenes vencidas", cv.vencidas.map((o) => renglonOt(o, c.zona, c.ahora, { conResponsable: true })), { total: cv.nVencidas, verTodo: { texto: "Ver todas", enlace: "/work-orders?vencidas=1" } }),
      bloque("configuracion", "Configuración pendiente", [
        ...avisosAdmin,
        ...(puesta && !puesta.completa ? puesta.pendientes.slice(0, 3).map<Renglon>((p, k) => ({ id: `pm${k}`, folio: p.modulo, titulo: p.problema, detalle: p.consecuencia, tono: "atencion", enlace: p.accion.enlace, accion: { texto: p.accion.texto, enlace: p.accion.enlace } })) : []),
        ...(fallidas ? [{ id: "fallidas", folio: "Avisos", titulo: `${fallidas} aviso(s) no se entregaron en 7 días`, detalle: "Revise el historial de entregas.", tono: "atencion" as Tono, enlace: "/settings?s=avisos" }] : []),
      ], { descripcion: "Usuarios, responsabilidades, avisos y puesta en marcha." }),
      bloque("planes", "Planes con problemas", avisosPlanes, { verTodo: { texto: "Ver planes", enlace: "/plans" } }),
      bloque("inventario", "Inventario crítico", [
        ...agotadas.filter((p) => !p.detieneTrabajo).map<Renglon>((p) => ({ id: p.id, folio: p.code, titulo: `${p.name}: agotada`, detalle: p.motivo, tono: "critico", enlace: `/inventory?q=${encodeURIComponent(p.code)}` })),
        ...bajas.slice(0, MAX).map<Renglon>((p) => ({ id: p.id, folio: p.code, titulo: p.name, detalle: `${p.quantityOnHand} ${p.unit} · mínimo ${p.minQuantity}`, tono: "atencion", enlace: `/inventory?q=${encodeURIComponent(p.code)}` })),
      ], { total: agotadas.length + bajas.length, verTodo: { texto: "Ver almacén", enlace: "/inventory" } }),
      bloque("compras", "Compras por autorizar", compras, { verTodo: { texto: "Ver compras", enlace: "/compras" } }),
      bloque("alertas", "Alertas predictivas", alertas, { verTodo: { texto: "Ver predictivo", enlace: "/predictive" } }),
      bloque("calidad", "Calidad de datos", problemas.slice(0, MAX).map<Renglon>((p) => ({ id: p.clave, folio: `${p.cantidad}`, titulo: p.titulo, detalle: p.porque, tono: p.nivel === "ERROR" ? "critico" : "atencion", enlace: p.enlace })), { total: problemas.length }),
    ],
  };
}

// ─────────────────────────────────────────── Supervisor

async function inicioSupervisor(c: Ctx): Promise<Armado> {
  const manana = new Date(c.ahora.getTime() + DIA);
  const pasado = new Date(c.ahora.getTime() + 2 * DIA);
  const hace30 = new Date(c.ahora.getTime() - 30 * DIA);
  const [sinAsignar, cv, proximas, detenidas, revision, hoy, solicitudes, alertas, bloqueadas, tecnicos, carga, prevs] = await Promise.all([
    ordenes(c.org, { assignedToId: null }, 30),
    criticasYVencidas(c),
    ordenes(c.org, { dueDate: { gte: c.ahora, lt: pasado } }, 30),
    ordenes(c.org, { status: "ON_HOLD" }, 30),
    prisma.workOrder.findMany({ where: { organizationId: c.org, status: "COMPLETED" }, select: selOt, orderBy: { completedAt: "asc" }, take: 30 }) as Promise<OtFila[]>,
    ordenes(c.org, { maintenanceType: "PREVENTIVE", dueDate: { gte: new Date(c.ahora.getTime() - 12 * 3_600_000), lt: manana } }, 30),
    prisma.workRequest.findMany({ where: { organizationId: c.org, status: "PENDING" }, select: { id: true, number: true, title: true, priority: true, riesgo: true, createdAt: true, asset: { select: { code: true } } }, orderBy: { createdAt: "asc" }, take: 30 }),
    alertasAbiertas(c),
    prisma.workOrderTask.findMany({
      where: { bloqueadaPorPartId: { not: null }, done: false, workOrder: { organizationId: c.org, status: { in: OT_ACTIVAS } } },
      select: { id: true, title: true, workOrder: { select: { id: true, number: true } }, bloqueadaPor: { select: { code: true, name: true, quantityOnHand: true, unit: true } } }, take: 30,
    }),
    prisma.user.findMany({ where: { organizationId: c.org, active: true, role: { in: ["TECHNICIAN", "SUPERVISOR"] } }, select: { id: true, name: true } }),
    prisma.workOrder.groupBy({ by: ["assignedToId"], where: { organizationId: c.org, status: { in: OT_ACTIVAS }, assignedToId: { not: null } }, _count: true, _sum: { estimatedHours: true } }),
    prisma.workOrder.findMany({ where: { organizationId: c.org, maintenanceType: "PREVENTIVE", dueDate: { gte: hace30, lt: c.ahora }, status: { not: "CANCELLED" } }, select: { completedAt: true, dueDate: true } }),
  ]);
  const aTiempo = prevs.filter((o) => o.completedAt && o.dueDate && o.completedAt.getTime() <= o.dueDate.getTime() + DIA).length;
  const cumplimiento = prevs.length ? (aTiempo / prevs.length) * 100 : null;
  const cargaPor = new Map(carga.map((x) => [x.assignedToId, x]));
  const renglonesCarga = tecnicos
    .map((t) => ({ t, c: cargaPor.get(t.id) }))
    .sort((a, b) => (b.c?._sum.estimatedHours ?? 0) - (a.c?._sum.estimatedHours ?? 0))
    .map<Renglon>(({ t, c: x }) => {
      const horas = x?._sum.estimatedHours ?? 0;
      return { id: t.id, folio: `${x?._count ?? 0} OT`, titulo: t.name, detalle: `${n(Math.round(horas * 10) / 10)} h estimadas abiertas`, tono: horas > 40 ? "atencion" : "normal", enlace: "/equipo" };
    });
  const r = (o: OtFila, accion?: Renglon["accion"]) => renglonOt(o, c.zona, c.ahora, { conResponsable: true, accion });
  return {
    resumen: [
      { etiqueta: "Sin asignar", valor: n(sinAsignar.length), tono: sinAsignar.length ? "atencion" : "bien", enlace: "/work-orders?sinResponsable=1" },
      { etiqueta: "Vencidas", valor: n(cv.nVencidas), tono: cv.nVencidas ? "critico" : "bien", enlace: "/work-orders?vencidas=1" },
      { etiqueta: "Para revisión", valor: n(revision.length), tono: revision.length ? "atencion" : "bien", enlace: "/work-orders?estado=COMPLETED" },
      { etiqueta: "Cumplimiento preventivo (30 días)", valor: pct(cumplimiento), tono: (cumplimiento ?? 100) < 80 ? "atencion" : "bien", enlace: "/indicadores" },
    ],
    bloques: [
      bloque("criticas", "Críticas", cv.criticas.map((o) => r(o)), { total: cv.nCriticas }),
      bloque("sin-asignar", "Trabajo sin asignar", sinAsignar.map((o) => r(o, { texto: "Asignar", enlace: `/work-orders/${o.id}` })), { verTodo: { texto: "Ver todas", enlace: "/work-orders?sinResponsable=1" } }),
      bloque("vencidas", "Vencidas", cv.vencidas.map((o) => r(o, { texto: "Reprogramar", enlace: `/work-orders/${o.id}` })), { total: cv.nVencidas, verTodo: { texto: "Ver todas", enlace: "/work-orders?vencidas=1" } }),
      bloque("proximas", "Vencen hoy o mañana", proximas.map((o) => r(o))),
      bloque("revision", "Listas para revisión", revision.map((o) => r(o, { texto: "Revisar", enlace: `/work-orders/${o.id}` })), { verTodo: { texto: "Ver todas", enlace: "/work-orders?estado=COMPLETED" } }),
      bloque("detenidas", "Detenidas", detenidas.map((o) => r(o))),
      bloque("preventivos-hoy", "Preventivos de hoy", hoy.map((o) => r(o))),
      bloque("solicitudes", "Solicitudes por clasificar", solicitudes.map<Renglon>((s) => ({
        id: s.id, folio: s.number, titulo: s.title, detalle: s.asset?.code, prioridad: s.priority,
        fecha: `Recibida ${formatDia(s.createdAt, { zona: c.zona })}`, tono: s.riesgo === "ALTO" || s.priority === "CRITICAL" ? "critico" : "atencion",
        enlace: `/requests/${s.id}`, accion: { texto: "Clasificar", enlace: `/requests/${s.id}` },
      })), { verTodo: { texto: "Ver solicitudes", enlace: "/requests" } }),
      bloque("bloqueos", "Refacciones que bloquean trabajo", bloqueadas.map<Renglon>((t) => ({
        id: t.id, folio: t.workOrder.number, titulo: t.title, detalle: t.bloqueadaPor ? `Falta ${t.bloqueadaPor.code} · ${t.bloqueadaPor.name} (hay ${t.bloqueadaPor.quantityOnHand} ${t.bloqueadaPor.unit})` : undefined,
        tono: "atencion", enlace: `/work-orders/${t.workOrder.id}`,
      }))),
      bloque("alertas", "Alertas predictivas", alertas, { verTodo: { texto: "Ver predictivo", enlace: "/predictive" } }),
      bloque("carga", "Carga por técnico", renglonesCarga, { descripcion: "Horas estimadas de las órdenes abiertas a cargo de cada persona.", verTodo: { texto: "Ver personal", enlace: "/equipo" } }),
    ],
  };
}

// ─────────────────────────────────────────── Técnico

async function inicioTecnico(c: Ctx): Promise<Armado> {
  const finHoy = new Date(c.ahora.getTime() + DIA);
  const semana = new Date(c.ahora.getTime() + 7 * DIA);
  const mias = await ordenes(c.org, { assignedToId: c.user.id }, 200);
  const avisos = await avisosAbiertos(c, ["OT_ASIGNADA", "OT_SIN_ACEPTAR", "OT_DEVUELTA", "OT_VENCIDA", "OT_POR_VENCER", "OT_PRIORIDAD_CAMBIADA"]);
  const vencidas = mias.filter((o) => o.dueDate && o.dueDate < c.ahora && o.status !== "ON_HOLD");
  const criticas = mias.filter((o) => o.priority === "CRITICAL" && o.status !== "ON_HOLD");
  const detenidas = mias.filter((o) => o.status === "ON_HOLD");
  const hoy = mias.filter((o) => o.status === "IN_PROGRESS" || (o.dueDate && o.dueDate >= c.ahora && o.dueDate < finHoy));
  const proximas = mias.filter((o) => o.dueDate && o.dueDate >= finHoy && o.dueDate < semana && o.status !== "ON_HOLD");
  const vistos = new Set<string>();
  // Cada orden una vez, en el primer bloque que le toca: la crítica vencida no se repite abajo.
  const unicas = (xs: OtFila[]) => xs.filter((o) => (vistos.has(o.id) ? false : (vistos.add(o.id), true)));
  const accion = (o: OtFila): Renglon["accion"] => ({ texto: o.status === "IN_PROGRESS" ? "Continuar" : o.status === "ON_HOLD" ? "Ver" : "Abrir e iniciar", enlace: `/work-orders/${o.id}` });
  const r = (o: OtFila) => renglonOt(o, c.zona, c.ahora, { accion: accion(o) });
  return {
    resumen: [
      { etiqueta: "Para hoy", valor: n(hoy.length), tono: "normal", enlace: "/work-orders?mias=1" },
      { etiqueta: "Vencidas", valor: n(vencidas.length), tono: vencidas.length ? "critico" : "bien", enlace: "/work-orders?mias=1&vencidas=1" },
      { etiqueta: "Críticas", valor: n(criticas.length), tono: criticas.length ? "critico" : "bien", enlace: "/work-orders?mias=1&prioridad=CRITICAL" },
      { etiqueta: "Detenidas", valor: n(detenidas.length), tono: detenidas.length ? "atencion" : "bien", enlace: "/work-orders?mias=1&estado=ON_HOLD" },
    ],
    bloques: [
      bloque("criticas", "Mis órdenes críticas", unicas(criticas).map(r)),
      bloque("vencidas", "Mis órdenes vencidas", unicas(vencidas).map(r)),
      bloque("hoy", "Mis órdenes de hoy", unicas(hoy).map(r)),
      bloque("proximas", "Próximas (7 días)", unicas(proximas).map(r)),
      bloque("detenidas", "Trabajo detenido", unicas(detenidas).map(r)),
      bloque("avisos", "Avisos de mi trabajo", avisos, { verTodo: { texto: "Ver avisos", enlace: "/notificaciones" } }),
    ],
  };
}

// ─────────────────────────────────────────── Compras

async function inicioCompras(c: Ctx): Promise<Armado> {
  const semana = new Date(c.ahora.getTime() + 7 * DIA);
  const [porAutorizar, sinOrden, enEspera, parciales, bajas] = await Promise.all([
    prisma.purchaseRequest.findMany({ where: { organizationId: c.org, estado: "SOLICITADA" }, select: { id: true, folio: true, urgencia: true, createdAt: true, justificacion: true }, orderBy: { createdAt: "asc" }, take: 30 }),
    prisma.purchaseRequest.findMany({ where: { organizationId: c.org, estado: "AUTORIZADA", ordenes: { none: {} } }, select: { id: true, folio: true, urgencia: true, autorizadaEl: true, justificacion: true }, orderBy: { autorizadaEl: "asc" }, take: 30 }),
    ordenesCompraEnEspera(c.org),
    prisma.purchaseRequest.findMany({
      where: { organizationId: c.org, estado: "RECIBIDA_PARCIAL" },
      select: { id: true, folio: true, renglones: { select: { descripcion: true, cantidadSolicitada: true, cantidadRecibida: true } } }, take: 30,
    }),
    refaccionesBajoMinimo(c.org),
  ]);
  const vencidas = enEspera.filter((o) => o.fechaPrometida! < c.ahora);
  const proximas = enEspera.filter((o) => o.fechaPrometida! >= c.ahora && o.fechaPrometida! < semana);
  const oc = (o: (typeof enEspera)[number]): Renglon => ({
    id: o.id, folio: o.folio, titulo: o.supplier.name, detalle: o.purchaseRequest.estado === "RECIBIDA_PARCIAL" ? "Llegó una parte" : undefined,
    fecha: `Prometida ${formatDia(o.fechaPrometida!, { zona: c.zona })}`, tono: o.fechaPrometida! < c.ahora ? "critico" : "normal",
    enlace: `/compras/${o.purchaseRequestId}`, accion: { texto: "Dar seguimiento", enlace: `/compras/${o.purchaseRequestId}` },
  });
  return {
    resumen: [
      { etiqueta: "Autorizadas sin orden", valor: n(sinOrden.length), tono: sinOrden.length ? "atencion" : "bien", enlace: "/compras?estado=AUTORIZADA" },
      { etiqueta: "Órdenes de compra abiertas", valor: n(enEspera.length), tono: "normal", enlace: "/compras?estado=EN_COMPRA" },
      { etiqueta: "Entregas vencidas", valor: n(vencidas.length), tono: vencidas.length ? "critico" : "bien", enlace: "/compras?estado=EN_COMPRA" },
      { etiqueta: "Recepciones parciales", valor: n(parciales.length), tono: parciales.length ? "atencion" : "bien", enlace: "/compras?estado=RECIBIDA_PARCIAL" },
    ],
    bloques: [
      bloque("sin-orden", "Autorizadas, sin orden de compra", sinOrden.map<Renglon>((x) => ({
        id: x.id, folio: x.folio, titulo: x.justificacion?.slice(0, 80) || "Requisición de compra",
        fecha: x.autorizadaEl ? `Autorizada ${formatDia(x.autorizadaEl, { zona: c.zona })}` : undefined, tono: x.urgencia === "PARO" ? "critico" : "atencion",
        enlace: `/compras/${x.id}`, accion: { texto: "Preparar orden", enlace: `/compras/${x.id}` },
      }))),
      bloque("vencidas", "Entregas vencidas", vencidas.map(oc)),
      bloque("proximas", "Entregas de esta semana", proximas.map(oc)),
      bloque("parciales", "Recepciones parciales: diferencias", parciales.map<Renglon>((x) => {
        const faltan = x.renglones.filter((l) => l.cantidadRecibida < l.cantidadSolicitada);
        return {
          id: x.id, folio: x.folio, titulo: `${faltan.length} renglón(es) con faltante`,
          detalle: faltan.slice(0, 2).map((l) => `${l.descripcion}: llegaron ${l.cantidadRecibida} de ${l.cantidadSolicitada}`).join(" · "),
          tono: "atencion", enlace: `/compras/${x.id}`, accion: { texto: "Atender diferencia", enlace: `/compras/${x.id}` },
        };
      })),
      bloque("por-autorizar", "Esperando autorización", porAutorizar.map<Renglon>((x) => ({
        id: x.id, folio: x.folio, titulo: x.justificacion?.slice(0, 80) || "Requisición de compra",
        fecha: `Pedida ${formatDia(x.createdAt, { zona: c.zona })}`, tono: "normal", enlace: `/compras/${x.id}`,
      })), { descripcion: "Todavía no se pueden comprar: esperan la firma de quien autoriza." }),
      bloque("bajo-minimo", "Refacciones bajo mínimo", bajas.map<Renglon>((p) => ({
        id: p.id, folio: p.code, titulo: p.name, detalle: `${p.quantityOnHand} ${p.unit} · mínimo ${p.minQuantity}`, tono: p.quantityOnHand <= 0 ? "critico" : "atencion",
        enlace: `/inventory?q=${encodeURIComponent(p.code)}`,
      })), { verTodo: { texto: "Ver almacén", enlace: "/inventory" } }),
    ],
  };
}

// ─────────────────────────────────────────── Solicitante

async function inicioSolicitante(c: Ctx): Promise<Armado> {
  const mias = await prisma.workRequest.findMany({
    where: { organizationId: c.org, requestedById: c.user.id },
    select: { id: true, number: true, title: true, status: true, createdAt: true, reviewNotes: true, workOrder: { select: { number: true, status: true, completedAt: true } } },
    orderBy: { createdAt: "desc" }, take: 60,
  });
  const enRevision = mias.filter((s) => s.status === "PENDING");
  const enAtencion = mias.filter((s) => s.workOrder && !["COMPLETED", "CLOSED", "CANCELLED"].includes(s.workOrder.status));
  const atendidas = mias.filter((s) => s.workOrder && ["COMPLETED", "CLOSED"].includes(s.workOrder.status));
  const rechazadas = mias.filter((s) => s.status === "REJECTED");
  // Lo que quien revisa le respondió o le pide va a la vista: es la «respuesta» que espera.
  const renglon = (s: (typeof mias)[number], estado: string, tono: Tono): Renglon => ({
    id: s.id, folio: s.number, titulo: s.title,
    detalle: s.reviewNotes && !estado.includes(s.reviewNotes) ? `${estado} · Respuesta: ${s.reviewNotes}` : estado,
    fecha: formatDia(s.createdAt, { zona: c.zona }), tono, enlace: `/requests/${s.id}`,
  });
  return {
    resumen: [
      { etiqueta: "En revisión", valor: n(enRevision.length), tono: "normal", enlace: "/requests" },
      { etiqueta: "Se están atendiendo", valor: n(enAtencion.length), tono: "normal", enlace: "/requests" },
      { etiqueta: "Atendidos", valor: n(atendidas.length), tono: "bien", enlace: "/requests" },
    ],
    bloques: [
      bloque("revision", "Esperando revisión", enRevision.map((s) => renglon(s, "Quien lo revisa todavía no lo ve", "normal"))),
      bloque("atencion", "Se están atendiendo", enAtencion.map((s) => renglon(s, `Con la orden ${s.workOrder!.number}`, "normal"))),
      bloque("rechazados", "No se van a atender", rechazadas.map((s) => renglon(s, s.reviewNotes ? `Motivo: ${s.reviewNotes}` : "Revise el motivo en el reporte", "atencion"))),
      bloque("atendidos", "Atendidos", atendidas.slice(0, MAX).map((s) => renglon(s, s.workOrder?.completedAt ? `Terminado ${formatDia(s.workOrder.completedAt, { zona: c.zona })}` : "Terminado", "bien")), { total: atendidas.length }),
    ],
  };
}

// ─────────────────────────────────────────── Consulta

async function inicioConsulta(c: Ctx): Promise<Armado> {
  const [cv, abiertas, alertas] = await Promise.all([
    criticasYVencidas(c),
    prisma.workOrder.count({ where: { organizationId: c.org, status: { in: OT_ACTIVAS } } }),
    alertasAbiertas(c),
  ]);
  return {
    resumen: [
      { etiqueta: "Órdenes abiertas", valor: n(abiertas), tono: "normal", enlace: "/work-orders" },
      { etiqueta: "Vencidas", valor: n(cv.nVencidas), tono: cv.nVencidas ? "atencion" : "bien", enlace: "/work-orders?vencidas=1" },
      { etiqueta: "Críticas", valor: n(cv.nCriticas), tono: cv.nCriticas ? "atencion" : "bien", enlace: "/work-orders?prioridad=CRITICAL" },
    ],
    bloques: [
      bloque("criticas", "Órdenes críticas abiertas", cv.criticas.map((o) => renglonOt(o, c.zona, c.ahora, { conResponsable: true })), { total: cv.nCriticas }),
      bloque("vencidas", "Órdenes vencidas", cv.vencidas.map((o) => renglonOt(o, c.zona, c.ahora, { conResponsable: true })), { total: cv.nVencidas, verTodo: { texto: "Ver todas", enlace: "/work-orders?vencidas=1" } }),
      bloque("alertas", "Alertas predictivas", alertas, { verTodo: { texto: "Ver predictivo", enlace: "/predictive" } }),
    ],
  };
}

const ARMADORES: Record<Rol, (c: Ctx) => Promise<Armado>> = {
  OWNER: inicioPropietario,
  ADMIN: inicioAdministrador,
  SUPERVISOR: inicioSupervisor,
  TECHNICIAN: inicioTecnico,
  COMPRAS: inicioCompras,
  REQUESTER: inicioSolicitante,
  VIEWER: inicioConsulta,
};
