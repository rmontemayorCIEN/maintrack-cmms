import { prisma } from "./db";
import { saludDeDatos } from "./salud-datos";
import { claveComparable, serieComparable, rfc as validarRfc } from "./normalizar";

/**
 * Puesta en marcha de una empresa: qué tan lista está para operar, de verdad.
 *
 * Antes cada paso contaba registros: cinco activos daban el paso por hecho
 * aunque ninguno tuviera ubicación, y un plan contaba aunque no tuviera una
 * sola actividad ni asignación —y por lo tanto nunca generara una orden—. Una
 * lista que se palomea sola sin que el sistema sirva es un adorno.
 *
 * Ahora cada registro cuenta solo si tiene la calidad mínima para funcionar:
 *
 *   - Una ubicación, si tiene sitio, nombre y no está repetida.
 *   - Un responsable, si está activo y tiene un rol que puede ejecutar trabajo.
 *   - Un activo, si tiene código, nombre, estado válido, sitio y —cuando la
 *     empresa usa ubicaciones— ubicación.
 *   - Un plan, si está asignado a un equipo, tiene frecuencia, actividades y
 *     una próxima fecha: lo que el programador necesita para generar órdenes.
 *   - Una refacción, si su unidad existe y su existencia cuadra con la de los
 *     almacenes.
 *
 * Todo es consulta sobre la base: las palomitas son hechos, no opiniones. La
 * misma función alimenta el panel, esta pantalla y la consola del operador,
 * así que el porcentaje es el mismo en las tres.
 */

export type EstadoPaso = "COMPLETO" | "EN_PROCESO" | "CORREGIR" | "OPCIONAL" | "NO_APLICA";

/** Los módulos que la empresa puede declarar que no usará. */
export const MODULOS_OPCIONALES = {
  almacen: "Almacén y refacciones",
  compras: "Proveedores y compras",
  medidores: "Medidores",
} as const;
export type ModuloOpcional = keyof typeof MODULOS_OPCIONALES;

export type Paso = {
  clave: string;
  numero: number;
  titulo: string;
  /** Qué se configura en este paso. */
  que: string;
  /** Qué se pierde la empresa si no lo hace. */
  porQue: string;
  estado: EstadoPaso;
  /** Registros que ya están bien, de los que hay. Nulo en los de sí o no. */
  progreso: { hecho: number; meta: number } | null;
  /** Lo que falta, en una línea. Vacío cuando está completo. */
  falta: string;
  /** Problemas concretos de este paso. */
  problemas: string[];
  enlace: string;
  textoEnlace: string;
  peso: number;
  /** Si el paso depende de un módulo que la empresa puede declarar que no usa. */
  modulo?: ModuloOpcional;
};

export type Pendiente = {
  prioridad: number;
  problema: string;
  modulo: string;
  /** Qué deja de funcionar mientras siga así. */
  consecuencia: string;
  cantidad: number;
  /** Los primeros registros involucrados, para ir directo a ellos. */
  registros: Array<{ id: string; nombre: string; enlace?: string }>;
  accion: { texto: string; enlace: string };
};

export type PuestaEnMarcha = {
  porcentaje: number;
  /** Todos los pasos aplicables completos. */
  completa: boolean;
  pasos: Paso[];
  siguiente: Paso | null;
  pendientes: Pendiente[];
  /** Si ya se declaró en operación, y desde cuándo. */
  operandoDesde: Date | null;
  hayDemo: boolean;
  /** Lo que impide declararse en operación, si algo. */
  impideOperar: string[];
  modulos: Partial<Record<ModuloOpcional, boolean>>;
  /** Calidad de captura: la fase que sigue cuando la puesta en marcha termina. */
  saludDatos: number;
};

/** Qué pasa con cada pendiente, ordenado por lo que más estorba operar. */
const PRIORIDAD = {
  OT: 1,          // no se pueden crear ni asignar órdenes
  PROGRAMA: 2,    // no se puede programar el preventivo
  INDICADORES: 3, // los indicadores salen mal
  MATERIALES: 4,  // no se puede registrar material
  COMPRAS: 5,     // no se puede comprar
  IDENTIDAD: 6,   // cuesta identificar equipos y lugares
} as const;

/**
 * Ejecuta las consultas de a pocas. Cloud SQL en la instancia más chica admite
 * pocas conexiones, y la consola del operador corre esto por cada cliente.
 */
async function enLotes<T>(tareas: Array<() => Promise<T>>, tamano = 6): Promise<T[]> {
  const salida: T[] = [];
  for (let i = 0; i < tareas.length; i += tamano) {
    salida.push(...(await Promise.all(tareas.slice(i, i + tamano).map((t) => t()))));
  }
  return salida;
}

export function leerModulos(json: string | null | undefined): Partial<Record<ModuloOpcional, boolean>> {
  try {
    const m = JSON.parse(json || "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(MODULOS_OPCIONALES).filter((k) => typeof m[k] === "boolean").map((k) => [k, m[k] as boolean]),
    );
  } catch {
    return {};
  }
}

/** Los repetidos por nombre comparable dentro de un ámbito. */
function repetidos<T extends { id: string; name: string }>(filas: T[], ambito: (f: T) => string = () => "") {
  const vistos = new Map<string, T>();
  const salida: T[] = [];
  for (const f of filas) {
    const k = `${ambito(f)}|${claveComparable(f.name)}`;
    if (vistos.has(k)) salida.push(f);
    else vistos.set(k, f);
  }
  return salida;
}

const ESTADOS_ACTIVO = ["OPERATIONAL", "DEGRADED", "DOWN", "STANDBY", "RETIRED"];
const ROLES_QUE_EJECUTAN = ["TECHNICIAN", "SUPERVISOR"];
const muestra = <T extends { id: string }>(filas: T[], nombre: (f: T) => string, enlace?: (f: T) => string) =>
  filas.slice(0, 5).map((f) => ({ id: f.id, nombre: nombre(f), ...(enlace ? { enlace: enlace(f) } : {}) }));

export async function puestaEnMarcha(
  organizationId: string,
  opciones: { conSalud?: boolean } = {},
): Promise<PuestaEnMarcha> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      name: true, tipoInstalacion: true, timezone: true, currency: true, horasJornada: true, diasHabiles: true,
      comprasInternas: true, operandoDesde: true, modulosPuesta: true,
    },
  });
  const modulos = leerModulos(org.modulosPuesta);

  const [
    sitiosTodos, ubicacionesTodas, usuarios, activosTodos, planesTodos, medidores, planesPorMedidor,
    almacenes, refaccionesTodas, existencias, unidades, proveedoresTodos, demo,
  ] = await enLotes<unknown>([
    () => prisma.site.findMany({ where: { organizationId }, select: { id: true, code: true, name: true } }),
    () => prisma.location.findMany({
      where: { organizationId },
      select: { id: true, code: true, name: true, siteId: true, _count: { select: { assets: true } } },
    }),
    () => prisma.user.findMany({ where: { organizationId }, select: { id: true, name: true, role: true, active: true, hourlyRate: true } }),
    () => prisma.asset.findMany({
      where: { organizationId, active: true },
      select: {
        id: true, code: true, name: true, status: true, siteId: true, locationId: true, criticality: true, serialNumber: true,
        planesAsignados: { where: { active: true, plan: { active: true } }, select: { id: true } },
      },
    }),
    () => prisma.maintenancePlan.findMany({
      where: { organizationId, active: true },
      select: {
        id: true, name: true, triggerType: true, intervalDays: true, intervalMeter: true,
        _count: { select: { tasks: true } },
        tasks: { select: { cadaCuanto: true } },
        asignaciones: { where: { active: true }, select: { id: true, nextDueDate: true, meterId: true } },
      },
    }),
    () => prisma.meter.findMany({ where: { organizationId }, select: { id: true, name: true, lastReadingAt: true, currentValue: true, asset: { select: { code: true } } } }),
    () => prisma.maintenancePlan.count({ where: { organizationId, active: true, triggerType: "METER" } }),
    () => prisma.warehouse.findMany({ where: { organizationId, active: true }, select: { id: true } }),
    () => prisma.part.findMany({
      where: { organizationId, active: true },
      select: { id: true, code: true, name: true, unit: true, quantityOnHand: true, minQuantity: true, maxQuantity: true, unitCost: true },
    }),
    () => prisma.partStock.groupBy({ by: ["partId"], where: { part: { organizationId } }, _sum: { quantity: true }, _min: { quantity: true } }),
    () => prisma.partUnit.findMany({ where: { organizationId }, select: { code: true } }),
    () => prisma.supplier.findMany({ where: { organizationId }, select: { id: true, name: true, rfc: true } }),
    () => prisma.importBatch.count({ where: { organizationId, tipo: "DEMO", estado: { in: ["IMPORTADO", "REVERSION_PARCIAL"] } } }),
  ]) as [
    Array<{ id: string; code: string; name: string }>,
    Array<{ id: string; code: string; name: string; siteId: string; _count: { assets: number } }>,
    Array<{ id: string; name: string; role: string; active: boolean; hourlyRate: number }>,
    Array<{ id: string; code: string; name: string; status: string; siteId: string; locationId: string | null; criticality: string; serialNumber: string | null; planesAsignados: Array<{ id: string }> }>,
    Array<{ id: string; name: string; triggerType: string; intervalDays: number | null; intervalMeter: number | null; _count: { tasks: number }; tasks: Array<{ cadaCuanto: number | null }>; asignaciones: Array<{ id: string; nextDueDate: Date | null; meterId: string | null }> }>,
    Array<{ id: string; name: string; lastReadingAt: Date | null; currentValue: number; asset: { code: string } }>,
    number,
    Array<{ id: string }>,
    Array<{ id: string; code: string; name: string; unit: string; quantityOnHand: number; minQuantity: number; maxQuantity: number; unitCost: number }>,
    Array<{ partId: string; _sum: { quantity: number | null }; _min: { quantity: number | null } }>,
    Array<{ code: string }>,
    Array<{ id: string; name: string; rfc: string | null }>,
    number,
  ];

  /**
   * Los datos de demostración NO cuentan como preparación.
   *
   * Sin esto, cargar la demo subía el avance de 20% a 88% sin que la empresa
   * hubiera capturado nada suyo: tres equipos de ejemplo pasaban por activos
   * completos y un plan de ejemplo por plan válido. El avance tiene que decir
   * qué tan lista está la empresa, no qué tan completa está la demostración.
   */
  const deDemo = new Set(
    (await prisma.importRecord.findMany({
      where: { batch: { organizationId, tipo: "DEMO", estado: { in: ["IMPORTADO", "REVERSION_PARCIAL"] } } },
      select: { entityId: true },
    })).map((r) => r.entityId),
  );
  const real = <T extends { id: string }>(filas: T[]) => filas.filter((f) => !deDemo.has(f.id));
  const sitios = real(sitiosTodos);
  const ubicaciones = real(ubicacionesTodas);
  const activos = real(activosTodos);
  const planes = real(planesTodos);
  const refacciones = real(refaccionesTodas);
  const proveedores = real(proveedoresTodos);

  const pendientes: Pendiente[] = [];
  const pendiente = (p: Pendiente) => { if (p.cantidad > 0) pendientes.push(p); };

  // ───────────────────────────────────────────── Estados de cada paso
  const estadoDe = (p: { total: number; validos: number; problemas: number; aplica?: boolean; opcional?: boolean; modulo?: ModuloOpcional }): EstadoPaso => {
    if (p.modulo && modulos[p.modulo] === false) return "NO_APLICA";
    if (p.aplica === false) return "NO_APLICA";
    if (p.problemas > 0) return "CORREGIR";
    if (p.opcional && p.total === 0) return "OPCIONAL";
    if (p.total > 0 && p.validos >= p.total) return "COMPLETO";
    return p.opcional ? "OPCIONAL" : "EN_PROCESO";
  };

  // ───────────────────────────────────────────── 1. Datos de la empresa
  const empresaBien = Boolean(org.name.trim() && org.timezone && org.currency);

  // ───────────────────────────────────────────── 2. Tipo de instalación
  const conTipo = Boolean(org.tipoInstalacion);

  // ───────────────────────────────────────────── 3. Sitios
  const sitiosRepetidos = repetidos(sitios);
  pendiente({
    prioridad: PRIORIDAD.IDENTIDAD, problema: "Sitios con el mismo nombre", modulo: "Sitios",
    consecuencia: "El trabajo se reparte entre dos sitios que en realidad son uno, y los indicadores por sitio salen partidos.",
    cantidad: sitiosRepetidos.length, registros: muestra(sitiosRepetidos, (s) => `${s.code} · ${s.name}`),
    accion: { texto: "Revisar sitios", enlace: "/catalogs?tipo=sites" },
  });

  // ───────────────────────────────────────────── 4. Ubicaciones
  const ubicacionesAplican = org.tipoInstalacion !== "FLOTILLA";
  const ubicacionesRepetidas = repetidos(ubicaciones, (u) => u.siteId);
  const ubicacionesValidas = ubicaciones.filter((u) => u.name.trim() && !ubicacionesRepetidas.includes(u)).length;
  const ubicacionesVacias = ubicaciones.filter((u) => u._count.assets === 0);
  pendiente({
    prioridad: PRIORIDAD.IDENTIDAD, problema: "Ubicaciones repetidas en el mismo sitio", modulo: "Ubicaciones",
    consecuencia: "Los equipos de una misma área quedan repartidos en dos, y al técnico le cuesta encontrarlos.",
    cantidad: ubicacionesRepetidas.length, registros: muestra(ubicacionesRepetidas, (u) => `${u.code} · ${u.name}`),
    accion: { texto: "Revisar ubicaciones", enlace: "/catalogs?tipo=locations" },
  });

  // ───────────────────────────────────────────── 5. Equipo y responsables
  const activosUsuarios = usuarios.filter((u) => u.active);
  const ejecutores = activosUsuarios.filter((u) => ROLES_QUE_EJECUTAN.includes(u.role));
  const sinTarifa = ejecutores.filter((u) => !u.hourlyRate || u.hourlyRate <= 0);
  pendiente({
    prioridad: PRIORIDAD.OT, problema: "No hay técnicos ni supervisores activos", modulo: "Usuarios",
    consecuencia: "No hay a quién asignar las órdenes de trabajo ni quién las ejecute.",
    cantidad: ejecutores.length === 0 ? 1 : 0, registros: [],
    accion: { texto: "Dar de alta a su equipo", enlace: "/settings?s=usuarios" },
  });
  pendiente({
    prioridad: PRIORIDAD.INDICADORES, problema: "Técnicos sin tarifa por hora", modulo: "Usuarios",
    consecuencia: "Sus horas se registran pero no cuestan: el costo de mano de obra de las órdenes sale en cero.",
    cantidad: sinTarifa.length, registros: muestra(sinTarifa, (u) => u.name),
    accion: { texto: "Capturar tarifas", enlace: "/settings?s=usuarios" },
  });

  // ───────────────────────────────────────────── 6. Activos
  const exigeUbicacion = ubicacionesAplican && ubicaciones.length > 0;
  const activoProblemas = (a: (typeof activos)[number]) => {
    const p: string[] = [];
    if (!a.code.trim()) p.push("sin código");
    if (!a.name.trim()) p.push("sin nombre");
    if (!ESTADOS_ACTIVO.includes(a.status)) p.push("estado inválido");
    if (exigeUbicacion && !a.locationId) p.push("sin ubicación");
    return p;
  };
  const activosIncompletos = activos.filter((a) => activoProblemas(a).length);
  const sinUbicacion = activos.filter((a) => exigeUbicacion && !a.locationId);
  const activosRepetidos = repetidos(activos, (a) => a.locationId ?? a.siteId);
  const series = new Map<string, string>();
  const serieRepetida = activos.filter((a) => {
    if (!a.serialNumber) return false;
    const k = serieComparable(a.serialNumber);
    if (!k) return false;
    if (series.has(k)) return true;
    series.set(k, a.id);
    return false;
  });
  pendiente({
    prioridad: PRIORIDAD.IDENTIDAD, problema: "Activos sin ubicación", modulo: "Activos",
    consecuencia: "El técnico no sabe dónde encontrar el equipo, y el trabajo no se puede filtrar por área.",
    cantidad: sinUbicacion.length, registros: muestra(sinUbicacion, (a) => `${a.code} · ${a.name}`, (a) => `/assets/${a.id}`),
    accion: { texto: "Asignar ubicaciones", enlace: "/assets" },
  });
  pendiente({
    prioridad: PRIORIDAD.IDENTIDAD, problema: "Posibles activos duplicados: mismo nombre en la misma ubicación", modulo: "Activos",
    consecuencia: "El historial y el costo de un equipo quedan partidos entre dos registros.",
    cantidad: activosRepetidos.length, registros: muestra(activosRepetidos, (a) => `${a.code} · ${a.name}`, (a) => `/assets/${a.id}`),
    accion: { texto: "Revisar activos", enlace: "/assets" },
  });
  pendiente({
    prioridad: PRIORIDAD.IDENTIDAD, problema: "Activos con el mismo número de serie", modulo: "Activos",
    consecuencia: "Dos registros del mismo equipo físico: sus fallas y costos no se suman.",
    cantidad: serieRepetida.length, registros: muestra(serieRepetida, (a) => `${a.code} · ${a.serialNumber}`, (a) => `/assets/${a.id}`),
    accion: { texto: "Revisar activos", enlace: "/assets" },
  });

  // ───────────────────────────────────────────── 7. Medidores
  const medidoresExigidos = modulos.medidores !== false && (org.tipoInstalacion === "FLOTILLA" || planesPorMedidor > 0);
  const medidoresSinLectura = medidores.filter((m) => !m.lastReadingAt);
  const planesSinMedidor = planes.filter((p) => p.triggerType === "METER" && p.asignaciones.some((a) => !a.meterId));
  pendiente({
    prioridad: PRIORIDAD.PROGRAMA, problema: "Medidores sin ninguna lectura", modulo: "Medidores",
    consecuencia: "Los planes por horas o kilómetros no saben cuándo toca: no generan órdenes hasta tener lecturas.",
    cantidad: medidoresSinLectura.length, registros: muestra(medidoresSinLectura, (m) => `${m.asset.code} · ${m.name}`),
    accion: { texto: "Registrar lecturas", enlace: "/meters" },
  });
  pendiente({
    prioridad: PRIORIDAD.PROGRAMA, problema: "Planes por medidor en equipos sin medidor", modulo: "Planes",
    consecuencia: "Esos planes nunca van a generar órdenes: no tienen lectura de donde calcular.",
    cantidad: planesSinMedidor.length, registros: muestra(planesSinMedidor, (p) => p.name, (p) => `/plans/${p.id}`),
    accion: { texto: "Revisar planes", enlace: "/plans" },
  });

  // ───────────────────────────────────────────── 8. Planes preventivos
  const planProblemas = (p: (typeof planes)[number]) => {
    const r: string[] = [];
    if (!p.asignaciones.length) r.push("sin equipo asignado");
    const conFrecuencia = p.triggerType === "METER"
      ? (p.intervalMeter ?? 0) > 0
      : (p.intervalDays ?? 0) > 0 || p.tasks.some((t) => (t.cadaCuanto ?? 0) > 0);
    if (!conFrecuencia) r.push("sin frecuencia");
    if (p._count.tasks === 0) r.push("sin actividades");
    if (p.triggerType !== "METER" && p.asignaciones.length && p.asignaciones.some((a) => !a.nextDueDate)) r.push("sin próxima fecha");
    return r;
  };
  const planesInvalidos = planes.filter((p) => planProblemas(p).length);
  const planesSinEquipo = planes.filter((p) => !p.asignaciones.length);
  const planesSinActividades = planes.filter((p) => p._count.tasks === 0);
  const planesSinFrecuencia = planes.filter((p) => planProblemas(p).includes("sin frecuencia"));
  const criticosSinPlan = activos.filter((a) => a.criticality === "A" && !a.planesAsignados.length);
  pendiente({
    prioridad: PRIORIDAD.PROGRAMA, problema: "Planes sin equipo asignado", modulo: "Planes",
    consecuencia: "Se ven bien en la lista pero el programador no los lee: nunca generan una orden.",
    cantidad: planesSinEquipo.length, registros: muestra(planesSinEquipo, (p) => p.name, (p) => `/plans/${p.id}`),
    accion: { texto: "Asignar equipos", enlace: "/plans" },
  });
  pendiente({
    prioridad: PRIORIDAD.PROGRAMA, problema: "Planes sin frecuencia", modulo: "Planes",
    consecuencia: "Sin frecuencia no hay próxima fecha: el plan no se programa.",
    cantidad: planesSinFrecuencia.length, registros: muestra(planesSinFrecuencia, (p) => p.name, (p) => `/plans/${p.id}`),
    accion: { texto: "Definir frecuencias", enlace: "/plans" },
  });
  pendiente({
    prioridad: PRIORIDAD.PROGRAMA, problema: "Planes sin actividades", modulo: "Planes",
    consecuencia: "La orden que generen llega vacía: el técnico no sabe qué hacer.",
    cantidad: planesSinActividades.length, registros: muestra(planesSinActividades, (p) => p.name, (p) => `/plans/${p.id}`),
    accion: { texto: "Agregar actividades", enlace: "/plans" },
  });
  pendiente({
    prioridad: PRIORIDAD.PROGRAMA, problema: "Equipos críticos (A) sin plan preventivo", modulo: "Planes",
    consecuencia: "Lo que no puede fallar solo se atiende cuando ya falló.",
    cantidad: criticosSinPlan.length, registros: muestra(criticosSinPlan, (a) => `${a.code} · ${a.name}`, (a) => `/assets/${a.id}`),
    accion: { texto: "Crear o asignar planes", enlace: "/plans" },
  });

  // ───────────────────────────────────────────── 9. Almacén y refacciones
  const usaAlmacen = modulos.almacen !== false;
  const codigosUnidad = new Set(unidades.map((u) => u.code.toUpperCase()));
  const stockDe = new Map(existencias.map((e) => [e.partId, e]));
  const refaccionProblemas = (r: (typeof refacciones)[number]) => {
    const p: string[] = [];
    if (!r.unit || !codigosUnidad.has(r.unit.toUpperCase())) p.push("unidad inexistente");
    const s = stockDe.get(r.id);
    const enAlmacenes = s?._sum.quantity ?? 0;
    if (Math.abs(enAlmacenes - r.quantityOnHand) > 0.001) p.push("existencia que no cuadra con los almacenes");
    if ((s?._min.quantity ?? 0) < 0) p.push("existencia negativa");
    if (r.maxQuantity > 0 && r.minQuantity > r.maxQuantity) p.push("mínimo mayor que máximo");
    return p;
  };
  const refaccionesMal = refacciones.filter((r) => refaccionProblemas(r).length);
  const conExistenciaSinCosto = refacciones.filter((r) => r.quantityOnHand > 0 && r.unitCost <= 0);
  pendiente({
    prioridad: PRIORIDAD.MATERIALES, problema: "No hay almacén activo", modulo: "Almacén",
    consecuencia: "No se pueden registrar existencias, surtir requisiciones ni cargar refacciones a las órdenes.",
    cantidad: usaAlmacen && almacenes.length === 0 ? 1 : 0, registros: [],
    accion: { texto: "Dar de alta el almacén", enlace: "/inventory" },
  });
  pendiente({
    prioridad: PRIORIDAD.MATERIALES, problema: "Refacciones con datos inconsistentes", modulo: "Almacén",
    consecuencia: "El kardex no cuadra con la existencia: lo que dice el sistema no es lo que hay en el anaquel.",
    cantidad: refaccionesMal.length,
    registros: muestra(refaccionesMal, (r) => `${r.code} · ${refaccionProblemas(r).join(", ")}`, (r) => `/inventory/${r.id}`),
    accion: { texto: "Revisar refacciones", enlace: "/inventory" },
  });
  pendiente({
    prioridad: PRIORIDAD.INDICADORES, problema: "Refacciones con existencia pero sin costo", modulo: "Almacén",
    consecuencia: "El inventario vale $0 y el consumo no le carga costo a las órdenes.",
    cantidad: conExistenciaSinCosto.length, registros: muestra(conExistenciaSinCosto, (r) => `${r.code} · ${r.name}`, (r) => `/inventory/${r.id}`),
    accion: { texto: "Capturar costos", enlace: "/inventory" },
  });

  // Sin almacén el paso no está completo aunque las refacciones cuadren: no
  // hay dónde surtirlas.
  const estadoAlmacenBase = estadoDe({
    total: refacciones.length + (almacenes.length ? 1 : 0),
    validos: refacciones.length - refaccionesMal.length + (almacenes.length ? 1 : 0),
    problemas: refaccionesMal.length, modulo: "almacen",
  });
  const estadoAlmacen: EstadoPaso = estadoAlmacenBase === "COMPLETO" && almacenes.length === 0 ? "EN_PROCESO" : estadoAlmacenBase;

  // ───────────────────────────────────────────── 10. Proveedores
  const usaCompras = modulos.compras !== false;
  const exigeProveedores = usaCompras && (org.comprasInternas || modulos.compras === true);
  const proveedoresRepetidos = repetidos(proveedores);
  const rfcs = new Map<string, string>();
  const rfcRepetido = proveedores.filter((p) => {
    if (!p.rfc) return false;
    if (rfcs.has(p.rfc)) return true;
    rfcs.set(p.rfc, p.id);
    return false;
  });
  const rfcInvalido = proveedores.filter((p) => p.rfc && !validarRfc(p.rfc).ok);
  pendiente({
    prioridad: PRIORIDAD.COMPRAS, problema: "Proveedores repetidos (mismo nombre o mismo RFC)", modulo: "Proveedores",
    consecuencia: "Las compras de un mismo proveedor quedan repartidas y no se puede comparar cuánto se le compra.",
    cantidad: new Set([...proveedoresRepetidos, ...rfcRepetido]).size,
    registros: muestra([...new Set([...proveedoresRepetidos, ...rfcRepetido])], (p) => p.name),
    accion: { texto: "Revisar proveedores", enlace: "/suppliers" },
  });
  pendiente({
    prioridad: PRIORIDAD.COMPRAS, problema: "Proveedores con RFC mal formado", modulo: "Proveedores",
    consecuencia: "El RFC no sirve para identificar al proveedor ni para cruzar sus facturas.",
    cantidad: rfcInvalido.length, registros: muestra(rfcInvalido, (p) => `${p.name} · ${p.rfc}`),
    accion: { texto: "Corregir RFC", enlace: "/suppliers" },
  });

  // ───────────────────────────────────────────── 11. Reglas operativas
  const diasHabiles = (org.diasHabiles || "").split(",").filter(Boolean);
  const reglasBien = org.horasJornada > 0 && diasHabiles.length > 0 && Boolean(org.timezone);

  const pasos: Paso[] = [
    {
      clave: "empresa", numero: 1, titulo: "Datos de la empresa",
      que: "Nombre, zona horaria y moneda.",
      porQue: "La zona decide a qué hora empieza cada día en el calendario y en los reportes; la moneda, cómo se leen los costos.",
      estado: empresaBien ? "COMPLETO" : "EN_PROCESO", progreso: null,
      falta: empresaBien ? "" : "Falta la zona horaria o la moneda.", problemas: [],
      enlace: "/settings?s=organizacion", textoEnlace: "Ver datos de la empresa", peso: 1,
    },
    {
      clave: "instalacion", numero: 2, titulo: "Tipo de instalación",
      que: "Planta, edificio, hospital, restaurante, flotilla…",
      porQue: "Define los catálogos con que arranca, el vocabulario de las pantallas y los ejemplos de captura.",
      estado: conTipo ? "COMPLETO" : "EN_PROCESO", progreso: null,
      falta: conTipo ? "" : "Indique qué tipo de instalación es.", problemas: [],
      enlace: "/settings?s=organizacion", textoEnlace: "Elegir tipo", peso: 1,
    },
    {
      clave: "sitios", numero: 3, titulo: "Sitios",
      que: "Plantas, edificios, sucursales o bases de operación.",
      porQue: "Todo activo vive en un sitio: sin él no se puede dar de alta ningún equipo.",
      estado: estadoDe({ total: sitios.length, validos: sitios.length - sitiosRepetidos.length, problemas: sitiosRepetidos.length }),
      progreso: sitios.length ? { hecho: sitios.length - sitiosRepetidos.length, meta: sitios.length } : null,
      falta: sitios.length === 0 ? "Dé de alta su primer sitio." : sitiosRepetidos.length ? `${sitiosRepetidos.length} sitio(s) con nombre repetido.` : "",
      problemas: sitiosRepetidos.length ? [`${sitiosRepetidos.length} con nombre repetido`] : [],
      enlace: "/catalogs?tipo=sites", textoEnlace: "Sitios", peso: 1,
    },
    {
      clave: "ubicaciones", numero: 4, titulo: "Áreas y ubicaciones",
      que: "Naves, líneas, pisos, cuartos o áreas dentro de cada sitio.",
      porQue: "Es como el técnico encuentra el equipo en piso y como se filtra el trabajo por área.",
      estado: estadoDe({ total: ubicaciones.length, validos: ubicacionesValidas, problemas: ubicacionesRepetidas.length, aplica: ubicacionesAplican }),
      progreso: ubicaciones.length ? { hecho: ubicacionesValidas, meta: ubicaciones.length } : null,
      falta: !ubicacionesAplican ? "" : ubicaciones.length === 0
        ? "Dé de alta las áreas donde están sus equipos."
        : ubicacionesRepetidas.length ? `${ubicacionesRepetidas.length} ubicación(es) repetidas.` : "",
      problemas: [
        ...(ubicacionesRepetidas.length ? [`${ubicacionesRepetidas.length} repetidas`] : []),
        ...(ubicacionesVacias.length ? [`${ubicacionesVacias.length} sin ningún activo todavía`] : []),
      ],
      enlace: "/catalogs?tipo=locations", textoEnlace: "Ubicaciones", peso: 1,
    },
    {
      clave: "equipo", numero: 5, titulo: "Equipo de trabajo y responsables",
      que: "Técnicos y supervisores activos, con su tarifa por hora.",
      porQue: "Sin técnicos no hay a quién asignar órdenes; sin tarifa, la mano de obra no cuesta.",
      estado: ejecutores.length === 0 ? "EN_PROCESO" : sinTarifa.length ? "CORREGIR" : "COMPLETO",
      progreso: ejecutores.length ? { hecho: ejecutores.length - sinTarifa.length, meta: ejecutores.length } : null,
      falta: ejecutores.length === 0
        ? "Falta al menos un técnico o supervisor activo."
        : sinTarifa.length ? `${sinTarifa.length} técnico(s) sin tarifa por hora.` : "",
      problemas: sinTarifa.length ? [`${sinTarifa.length} sin tarifa`] : [],
      enlace: "/settings?s=usuarios", textoEnlace: "Usuarios", peso: 2,
    },
    {
      clave: "activos", numero: 6, titulo: "Activos",
      que: "Los equipos que mantiene, cada uno con código, nombre, estado y ubicación.",
      porQue: "Es el cimiento: sin activos no hay planes, ni historial, ni costo por equipo.",
      estado: estadoDe({ total: activos.length, validos: activos.length - activosIncompletos.length, problemas: activosIncompletos.length + activosRepetidos.length + serieRepetida.length }),
      progreso: activos.length ? { hecho: activos.length - activosIncompletos.length, meta: activos.length } : null,
      falta: activos.length === 0
        ? "Todavía no hay activos: impórtelos o use el levantamiento asistido."
        : activosIncompletos.length ? `${activosIncompletos.length} de ${activos.length} activos incompletos.` : "",
      problemas: [
        ...(sinUbicacion.length ? [`${sinUbicacion.length} sin ubicación`] : []),
        ...(activosRepetidos.length ? [`${activosRepetidos.length} posibles duplicados`] : []),
        ...(serieRepetida.length ? [`${serieRepetida.length} con número de serie repetido`] : []),
      ],
      enlace: activos.length === 0 ? "/import" : "/assets", textoEnlace: activos.length === 0 ? "Importar activos" : "Activos", peso: 3,
    },
    {
      clave: "medidores", numero: 7, titulo: "Medidores",
      que: "Horómetros, odómetros o contadores, con al menos una lectura.",
      porQue: "Los planes por horas o kilómetros se programan con la lectura: sin ella no saben cuándo toca.",
      estado: estadoDe({
        total: medidores.length, validos: medidores.length - medidoresSinLectura.length,
        problemas: medidoresSinLectura.length + planesSinMedidor.length, opcional: !medidoresExigidos, modulo: "medidores",
      }),
      progreso: medidores.length ? { hecho: medidores.length - medidoresSinLectura.length, meta: medidores.length } : null,
      falta: medidoresExigidos && medidores.length === 0 ? "Sus planes por medidor necesitan medidores." : medidoresSinLectura.length ? `${medidoresSinLectura.length} medidor(es) sin lectura.` : "",
      problemas: [
        ...(medidoresSinLectura.length ? [`${medidoresSinLectura.length} sin lectura`] : []),
        ...(planesSinMedidor.length ? [`${planesSinMedidor.length} plan(es) por medidor sin medidor`] : []),
      ],
      enlace: "/meters", textoEnlace: "Medidores", peso: 1, modulo: "medidores",
    },
    {
      clave: "planes", numero: 8, titulo: "Planes preventivos",
      que: "Planes asignados a equipos, con frecuencia, actividades y próxima fecha.",
      porQue: "Es lo que convierte el sistema en preventivo. Un plan incompleto se ve en la lista y no genera órdenes.",
      estado: estadoDe({ total: planes.length, validos: planes.length - planesInvalidos.length, problemas: planesInvalidos.length + criticosSinPlan.length }),
      progreso: planes.length ? { hecho: planes.length - planesInvalidos.length, meta: planes.length } : null,
      falta: planes.length === 0
        ? "Ningún equipo tiene plan preventivo."
        : planesInvalidos.length ? `${planesInvalidos.length} de ${planes.length} planes no generarían órdenes.` : criticosSinPlan.length ? `${criticosSinPlan.length} equipo(s) crítico(s) sin plan.` : "",
      problemas: [
        ...(planesSinEquipo.length ? [`${planesSinEquipo.length} sin equipo`] : []),
        ...(planesSinFrecuencia.length ? [`${planesSinFrecuencia.length} sin frecuencia`] : []),
        ...(planesSinActividades.length ? [`${planesSinActividades.length} sin actividades`] : []),
        ...(criticosSinPlan.length ? [`${criticosSinPlan.length} equipos A sin plan`] : []),
      ],
      enlace: "/plans", textoEnlace: planes.length === 0 ? "Crear el primer plan" : "Planes", peso: 3,
    },
    {
      clave: "almacen", numero: 9, titulo: "Almacenes y refacciones",
      que: "El almacén activo y sus refacciones, con unidad y existencia que cuadre.",
      porQue: "Con el almacén en orden se surten requisiciones, se carga el consumo a las órdenes y se sabe cuándo reponer.",
      estado: estadoAlmacen,
      progreso: refacciones.length ? { hecho: refacciones.length - refaccionesMal.length, meta: refacciones.length } : null,
      falta: almacenes.length === 0 ? "Falta dar de alta el almacén." : refaccionesMal.length ? `${refaccionesMal.length} refacción(es) inconsistentes.` : refacciones.length === 0 ? "Todavía no hay refacciones." : "",
      problemas: refaccionesMal.length ? [`${refaccionesMal.length} inconsistentes`] : [],
      enlace: refacciones.length === 0 ? "/import" : "/inventory", textoEnlace: refacciones.length === 0 ? "Importar refacciones" : "Almacén", peso: 2, modulo: "almacen",
    },
    {
      clave: "proveedores", numero: 10, titulo: "Proveedores",
      que: "Quién le surte, sin repetidos y con RFC válido cuando lo tenga.",
      porQue: "Las compras se colocan con un proveedor; repetido, lo que se le compra no se puede comparar.",
      estado: estadoDe({
        total: proveedores.length, validos: proveedores.length - proveedoresRepetidos.length - rfcInvalido.length,
        problemas: proveedoresRepetidos.length + rfcRepetido.length + rfcInvalido.length, opcional: !exigeProveedores, modulo: "compras",
      }),
      progreso: proveedores.length ? { hecho: Math.max(0, proveedores.length - proveedoresRepetidos.length - rfcInvalido.length), meta: proveedores.length } : null,
      falta: exigeProveedores && proveedores.length === 0 ? "Su proceso de compras necesita al menos un proveedor." : "",
      problemas: [
        ...(proveedoresRepetidos.length || rfcRepetido.length ? [`${new Set([...proveedoresRepetidos, ...rfcRepetido]).size} repetidos`] : []),
        ...(rfcInvalido.length ? [`${rfcInvalido.length} con RFC mal formado`] : []),
      ],
      enlace: "/suppliers", textoEnlace: "Proveedores", peso: 1, modulo: "compras",
    },
    {
      clave: "reglas", numero: 11, titulo: "Reglas operativas",
      que: "Jornada, días laborables y, si compra por el sistema, el monto que pide autorización.",
      porQue: "De la jornada sale si un día del calendario cabe; de los días laborables, cuándo vence un preventivo.",
      estado: reglasBien ? "COMPLETO" : "EN_PROCESO", progreso: null,
      falta: reglasBien ? "" : "Revise la jornada y los días laborables.", problemas: [],
      enlace: "/settings?s=jornada", textoEnlace: "Jornada y reglas", peso: 1,
    },
  ];

  // ───────────────────────────────────────────── 12. Validación final
  const obligatoriosIncompletos = pasos.filter((p) => p.estado === "EN_PROCESO" || p.estado === "CORREGIR");
  const impideOperar = [
    ...obligatoriosIncompletos.map((p) => `${p.titulo}: ${p.falta || p.problemas.join(", ")}`),
    ...(demo > 0 ? ["Hay datos de demostración cargados: quítelos antes de operar, para que no entren a los indicadores."] : []),
  ];
  pasos.push({
    clave: "validacion", numero: 12, titulo: "Validación final: comenzar a operar",
    que: "Revisar que todo esté en regla y declarar que la empresa empieza a operar.",
    porQue: "A partir de aquí los indicadores cuentan de verdad. Por eso no se puede con datos de demostración cargados.",
    estado: org.operandoDesde ? "COMPLETO" : impideOperar.length ? "EN_PROCESO" : "EN_PROCESO",
    progreso: null,
    falta: org.operandoDesde ? "" : impideOperar.length ? `${impideOperar.length} punto(s) por resolver antes de operar.` : "Todo listo: puede declarar que empieza a operar.",
    problemas: [],
    enlace: "/puesta-en-marcha#validacion", textoEnlace: "Comenzar a operar", peso: 0,
  });

  // ───────────────────────────────────────────── Porcentaje
  // Solo los pasos que la empresa tiene que hacer. Los opcionales y los que no
  // aplican no le bajan el avance; la validación final es el resultado, no un
  // paso más que sume.
  const cuentan = pasos.filter((p) => p.peso > 0 && (p.estado === "COMPLETO" || p.estado === "EN_PROCESO" || p.estado === "CORREGIR"));
  const pesoTotal = cuentan.reduce((s, p) => s + p.peso, 0);
  const logrado = cuentan.reduce((s, p) => {
    if (p.estado === "COMPLETO") return s + p.peso;
    const r = p.progreso && p.progreso.meta > 0 ? p.progreso.hecho / p.progreso.meta : 0;
    // Un paso por corregir nunca cuenta completo, aunque casi todo esté bien.
    return s + p.peso * Math.min(r, 0.9);
  }, 0);
  const porcentaje = pesoTotal ? Math.round((logrado / pesoTotal) * 100) : 0;

  pendientes.sort((a, b) => a.prioridad - b.prioridad || b.cantidad - a.cantidad);

  const salud = opciones.conSalud ? await saludDeDatos(organizationId) : { indice: 0 };
  const siguiente = pasos.find((p) => p.estado === "EN_PROCESO" || p.estado === "CORREGIR") ?? null;

  return {
    porcentaje,
    completa: obligatoriosIncompletos.length === 0,
    pasos,
    siguiente,
    pendientes,
    operandoDesde: org.operandoDesde,
    hayDemo: demo > 0,
    impideOperar,
    modulos,
    saludDatos: salud.indice,
  };
}

/** Solo el avance, para listados. La misma cuenta que la pantalla completa. */
export async function avancePuestaEnMarcha(organizationId: string) {
  const r = await puestaEnMarcha(organizationId);
  return { porcentaje: r.porcentaje, completa: r.completa, siguiente: r.siguiente?.titulo ?? null };
}
