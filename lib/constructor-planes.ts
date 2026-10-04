/**
 * El constructor de planes: cuantos planes faltan, y que le falta a cada uno.
 *
 * Es la pregunta que nadie contestaba. `lib/cobertura-planes.ts` dice QUE
 * EQUIPO no tiene plan, y lo hace bien. Aqui se contestan las otras dos, que
 * son las que hacen que una implementacion se pierda a la mitad:
 *
 *   1. Cuantos planes necesito en total —la meta—.
 *   2. Cual de los que ya tengo esta de verdad terminado.
 *
 * Tres decisiones de diseno que conviene no deshacer:
 *
 * **El minimo sugerido sale de una formula, no del modelo.** Un grupo de
 * equipos iguales es categoria mas fabricante y modelo normalizados con
 * `claveComparable`, la misma clave que ya usan el importador y el dedupe de
 * refacciones. Es verificable y reproducible. La IA de «por donde empezar»
 * sigue aportando el ORDEN, que si es criterio; el numero no se le pregunta.
 *
 * **El grupo es un candidato, no un veredicto.** El encabezado de
 * `cobertura-planes.ts` lo dice: ningun plan puede saber cuales compresores le
 * tocan, eso lo sabe la persona. Asi que el grupo sugiere y la persona decide;
 * nada se crea ni se asigna por su cuenta.
 *
 * **El avance se deriva, nunca se guarda.** Lo unico persistido es la DECISION
 * de la meta (numero, quien y cuando) en `Organization`. Igual que la puesta en
 * marcha, para que no haya dos porcentajes que se contradigan.
 *
 * Ojo con el vocabulario, porque hay dos preguntas parecidas y cada una vive en
 * un solo lugar:
 *
 *   - «plan que generara ordenes» — lo revisa `lib/puesta-en-marcha.ts` en su
 *     paso de planes: tiene equipo, frecuencia, actividades y proxima fecha.
 *   - «plan terminado» — lo revisa este archivo, y es mas exigente: ademas
 *     pide mano de obra en cada actividad, refacciones donde se reemplaza,
 *     rango donde se mide, herramientas donde hacen falta, procedimiento y
 *     todos los equipos del grupo con plan.
 *
 * Son dos preguntas distintas a proposito: la primera dice si el sistema va a
 * funcionar, la segunda si el plan sirve para presupuestar y preparar. Cada una
 * se calcula una sola vez, y ninguna copia a la otra.
 */
import { prisma } from "./db";
import { claveComparable } from "./normalizar";

/** Cuantas semanas de historia se miran para estimar el ritmo de construccion. */
const SEMANAS_DE_RITMO = 8;
/** Sin un plan nuevo en este plazo, la construccion esta detenida. */
const DIAS_PARA_DETENIDO = 14;

export type EstadoPlan = "LISTO" | "EN_FORMA" | "ESQUELETO";

/** Una pieza de la rubrica. `aplica: false` sale del denominador, no lo baja. */
export type PiezaPlan = {
  clave: string;
  /** Lo que falta, ya redactado y con la cantidad. Vacio si esta completa. */
  falta: string;
  completa: boolean;
  aplica: boolean;
  peso: number;
};

export type PlanEnConstruccion = {
  id: string;
  nombre: string;
  /** Las claves de los grupos a los que sirve, por sus equipos asignados. */
  grupos: string[];
  equipos: number;
  actividades: number;
  estado: EstadoPlan;
  /** 0 a 100 sobre las piezas que aplican. */
  avance: number;
  piezas: PiezaPlan[];
  /** Solo lo que falta, para pintar sin recorrer piezas. */
  falta: string[];
  creadoEl: Date;
};

export type EquipoDelGrupo = {
  id: string;
  code: string;
  name: string;
  criticality: string;
  conPlan: boolean;
};

export type GrupoDeEquipos = {
  clave: string;
  categoria: string;
  /** Fabricante y modelo tal como se capturaron. Nulo: nadie los escribio. */
  marca: string | null;
  /** Sin modelo no se puede saber si son uno o varios tipos: se dice. */
  modeloConocido: boolean;
  equipos: EquipoDelGrupo[];
  sinPlan: number;
  /** Los planes que cubren equipos de este grupo. */
  planes: { id: string; nombre: string; estado: EstadoPlan; avance: number }[];
  /** El peor estado de sus planes, o SIN_PLAN si no tiene ninguno. */
  estado: EstadoPlan | "SIN_PLAN";
  /** Criticidad mas alta del grupo (A manda): con eso se ordena la lista. */
  criticidad: string;
};

export type Constructor = {
  grupos: GrupoDeEquipos[];
  planes: PlanEnConstruccion[];
  /** Grupos de equipos iguales: el minimo de planes que se necesita. */
  sugeridos: number;
  /** La que rige: su decision, el sugerido si no hay, y nunca menos de lo construido. */
  meta: number;
  /** Lo que la persona fijo, si fijo algo. */
  metaFijada: number | null;
  metaFijadaPor: string | null;
  metaFijadaEl: Date | null;
  /** True cuando entraron equipos y el sugerido ya paso su meta. No se le pisa. */
  sugeridoSuperaMeta: boolean;
  construidos: number;
  listos: number;
  porEstado: { listos: number; enForma: number; esqueleto: number; sinPlan: number };
  equiposTotal: number;
  equiposCubiertos: number;
  /** Planes nuevos por semana en las ultimas ocho. Nulo si nunca creo uno. */
  ritmoSemanal: number | null;
  /** A ese ritmo, cuando llega a la meta. Nulo si ya llego o si no avanza. */
  fechaTermino: Date | null;
  /** Dias desde el ultimo plan nuevo. Nulo si no hay planes. */
  diasSinPlanNuevo: number | null;
  detenido: boolean;
};

/**
 * La clave de agrupacion: misma categoria y mismo modelo es el mismo plan.
 *
 * Sin modelo capturado se agrupa solo por categoria, y el grupo queda marcado
 * como `modeloConocido: false`. Es a proposito: el modelo es lo que distingue
 * un tipo de otro, asi que sin el no se puede afirmar que sean tres tipos
 * distintos. Se sugiere UN plan para la familia y se advierte que capturar el
 * modelo puede partir el grupo —sugerir de mas seria inventar trabajo—.
 */
function claveDeGrupo(a: { categoryId: string | null; manufacturer: string | null; model: string | null }): string {
  // Los espacios tambien se van: «GA-30», «GA30» y «ga 30» son el mismo
  // modelo escrito por tres personas. Es lo mismo que hace `unidad()` en
  // `lib/normalizar.ts` con «pza» y «pzas».
  const sinEspacios = (v: string | null) => claveComparable(v).replace(/\s+/g, "");
  const modelo = sinEspacios(a.model);
  const categoria = a.categoryId ?? "sin-categoria";
  if (!modelo) return `${categoria}|sin-modelo`;
  return `${categoria}|${sinEspacios(a.manufacturer)}|${modelo}`;
}

type TareaParaRubrica = {
  taskType: string;
  cadaCuanto: number | null;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  labor: unknown[];
  parts: unknown[];
  tools: unknown[];
};

/**
 * Que le falta a un plan para estar terminado.
 *
 * Las piezas que no aplican salen del denominador, como los pasos opcionales de
 * la puesta en marcha: un plan de pura inspeccion visual no necesita
 * refacciones, y exigirselas lo dejaria en una meta imposible.
 */
export function piezasDelPlan(p: {
  tareas: TareaParaRubrica[];
  intervalDays: number | null;
  intervalMeter: number | null;
  procedure: string | null;
  enlaces: number;
  equiposAsignados: number;
  /** Equipos de los grupos del plan que no tienen ningun plan. */
  equiposDelGrupoSinPlan: number;
}): PiezaPlan[] {
  const t = p.tareas;
  const conFrecuencia = (x: TareaParaRubrica) =>
    Boolean(x.cadaCuanto) || Boolean(p.intervalDays) || Boolean(p.intervalMeter);
  const reemplazos = t.filter((x) => x.taskType === "REPLACE");
  const mediciones = t.filter((x) => x.taskType === "MEASURE");

  const sinFrecuencia = t.filter((x) => !conFrecuencia(x)).length;
  const sinManoDeObra = t.filter((x) => x.labor.length === 0).length;
  const reemplazosSinRefaccion = reemplazos.filter((x) => x.parts.length === 0).length;
  const medicionesSinRango = mediciones.filter((x) => !x.unit || (x.minValue === null && x.maxValue === null)).length;
  // Las herramientas se piden donde se cambia o se mide algo: ahi si hace falta
  // tener la llave o el instrumento en la mano. Una inspeccion visual no.
  const pideHerramienta = [...reemplazos, ...mediciones];
  const conHerramienta = pideHerramienta.filter((x) => x.tools.length > 0).length;

  const pieza = (clave: string, peso: number, aplica: boolean, completa: boolean, falta: string): PiezaPlan => ({
    clave, peso, aplica, completa: aplica ? completa : true, falta: aplica && !completa ? falta : "",
  });

  return [
    pieza("actividades", 3, true, t.length > 0, "sin actividades"),
    pieza("equipos", 2, true, p.equiposAsignados > 0, "sin equipos asignados"),
    pieza("frecuencia", 2, t.length > 0, sinFrecuencia === 0, `sin frecuencia en ${sinFrecuencia} actividad(es)`),
    pieza("manoDeObra", 2, t.length > 0, sinManoDeObra === 0, `sin mano de obra en ${sinManoDeObra} actividad(es)`),
    pieza("refacciones", 2, reemplazos.length > 0, reemplazosSinRefaccion === 0,
      `sin refacciones en ${reemplazosSinRefaccion} actividad(es) que reemplazan algo`),
    pieza("mediciones", 1, mediciones.length > 0, medicionesSinRango === 0,
      `sin unidad o rango en ${medicionesSinRango} medicion(es): sin rango no puede salir fuera de norma`),
    pieza("herramientas", 1, pideHerramienta.length > 0, conHerramienta > 0,
      "sin herramientas declaradas en las actividades que cambian o miden algo"),
    pieza("procedimiento", 1, true, Boolean(p.procedure?.trim()) || p.enlaces > 0,
      "sin procedimiento ni documento de referencia"),
    pieza("cobertura", 2, p.equiposAsignados > 0, p.equiposDelGrupoSinPlan === 0,
      `${p.equiposDelGrupoSinPlan} equipo(s) igual(es) siguen sin ningun plan`),
  ];
}

/** El avance y el estado que salen de las piezas. */
export function estadoDelPlan(piezas: PiezaPlan[]): { avance: number; estado: EstadoPlan } {
  const aplican = piezas.filter((p) => p.aplica);
  const total = aplican.reduce((s, p) => s + p.peso, 0);
  const logrado = aplican.filter((p) => p.completa).reduce((s, p) => s + p.peso, 0);
  const avance = total ? Math.round((logrado / total) * 100) : 0;
  const sinActividades = piezas.find((p) => p.clave === "actividades")?.completa === false;
  const estado: EstadoPlan = avance === 100 ? "LISTO" : sinActividades || avance < 50 ? "ESQUELETO" : "EN_FORMA";
  return { avance, estado };
}

const PEOR: Record<EstadoPlan, number> = { ESQUELETO: 0, EN_FORMA: 1, LISTO: 2 };

export async function constructorDePlanes(organizationId: string): Promise<Constructor> {
  const [org, activos, planes] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      // Sin relacion, igual que `operandoPorId` en la puesta en marcha: el
      // nombre se busca aparte y solo si hay alguien.
      select: { metaPlanes: true, metaPlanesEl: true, metaPlanesPorId: true },
    }),
    prisma.asset.findMany({
      // Un equipo retirado no necesita preventivo: mismo criterio que la cobertura.
      where: { organizationId, active: true, status: { not: "RETIRED" } },
      select: {
        id: true, code: true, name: true, criticality: true,
        categoryId: true, manufacturer: true, model: true,
        category: { select: { name: true } },
        _count: { select: { planesAsignados: { where: { active: true } } } },
      },
      orderBy: [{ criticality: "asc" }, { code: "asc" }],
    }),
    prisma.maintenancePlan.findMany({
      where: { organizationId, active: true },
      select: {
        id: true, name: true, intervalDays: true, intervalMeter: true,
        procedure: true, createdAt: true,
        _count: { select: { links: true } },
        asignaciones: { where: { active: true }, select: { assetId: true } },
        tasks: {
          select: {
            taskType: true, cadaCuanto: true, unit: true, minValue: true, maxValue: true,
            labor: { select: { id: true } },
            parts: { select: { id: true } },
            tools: { select: { id: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // ── Los grupos de equipos iguales.
  const grupos = new Map<string, GrupoDeEquipos>();
  const grupoDe = new Map<string, string>(); // assetId → clave de grupo
  for (const a of activos) {
    const clave = claveDeGrupo(a);
    grupoDe.set(a.id, clave);
    const marca = [a.manufacturer, a.model].filter(Boolean).join(" ").trim();
    const g = grupos.get(clave) ?? {
      clave,
      categoria: a.category?.name ?? "Sin categoría",
      marca: marca || null,
      modeloConocido: Boolean(claveComparable(a.model)),
      equipos: [],
      sinPlan: 0,
      planes: [],
      estado: "SIN_PLAN" as GrupoDeEquipos["estado"],
      criticidad: a.criticality,
    };
    const conPlan = a._count.planesAsignados > 0;
    g.equipos.push({ id: a.id, code: a.code, name: a.name, criticality: a.criticality, conPlan });
    if (!conPlan) g.sinPlan += 1;
    if (a.criticality < g.criticidad) g.criticidad = a.criticality;
    grupos.set(clave, g);
  }

  // ── Los planes, con su rubrica.
  const enConstruccion: PlanEnConstruccion[] = planes.map((p) => {
    const clavesDelPlan = [...new Set(p.asignaciones.map((a) => grupoDe.get(a.assetId)).filter((c): c is string => Boolean(c)))];
    // Cuantos equipos iguales a los que cubre siguen sin NINGUN plan. No se
    // afirma que le toquen a este: se dice que estan descubiertos, que es lo
    // que si se puede saber.
    const equiposDelGrupoSinPlan = clavesDelPlan.reduce((s, c) => s + (grupos.get(c)?.sinPlan ?? 0), 0);
    const piezas = piezasDelPlan({
      tareas: p.tasks,
      intervalDays: p.intervalDays,
      intervalMeter: p.intervalMeter,
      procedure: p.procedure,
      enlaces: p._count.links,
      equiposAsignados: p.asignaciones.length,
      equiposDelGrupoSinPlan,
    });
    const { avance, estado } = estadoDelPlan(piezas);
    return {
      id: p.id, nombre: p.name,
      grupos: clavesDelPlan,
      equipos: p.asignaciones.length,
      actividades: p.tasks.length,
      estado, avance, piezas,
      falta: piezas.filter((x) => x.aplica && !x.completa).map((x) => x.falta),
      creadoEl: p.createdAt,
    };
  });

  for (const p of enConstruccion) {
    for (const clave of p.grupos) {
      const g = grupos.get(clave);
      if (!g) continue;
      g.planes.push({ id: p.id, nombre: p.nombre, estado: p.estado, avance: p.avance });
      g.estado = g.estado === "SIN_PLAN" ? p.estado : PEOR[p.estado] < PEOR[g.estado as EstadoPlan] ? p.estado : g.estado;
    }
  }

  // ── La meta. Trinquete: nunca por debajo de lo ya construido, y el sugerido
  // no pisa su numero —se le avisa, que es distinto—.
  const lista = [...grupos.values()].sort((a, b) =>
    a.criticidad.localeCompare(b.criticidad) || b.sinPlan - a.sinPlan || a.categoria.localeCompare(b.categoria));
  const sugeridos = lista.length;
  const construidos = planes.length;
  const metaFijada = org?.metaPlanes ?? null;
  const meta = Math.max(metaFijada ?? sugeridos, construidos);

  // ── Ritmo de construccion, con los planes que de verdad se crearon.
  const ahora = Date.now();
  const desde = ahora - SEMANAS_DE_RITMO * 7 * 86_400_000;
  const recientes = planes.filter((p) => p.createdAt.getTime() >= desde).length;
  const ritmoSemanal = planes.length === 0 ? null : Math.round((recientes / SEMANAS_DE_RITMO) * 10) / 10;
  const faltan = Math.max(0, meta - construidos);
  const fechaTermino = faltan === 0 || !ritmoSemanal
    ? null
    : new Date(ahora + Math.ceil(faltan / ritmoSemanal) * 7 * 86_400_000);
  const ultimo = planes.reduce<Date | null>((m, p) => (!m || p.createdAt > m ? p.createdAt : m), null);
  const diasSinPlanNuevo = ultimo ? Math.floor((ahora - ultimo.getTime()) / 86_400_000) : null;

  const metaFijadaPor = org?.metaPlanesPorId
    ? (await prisma.user.findUnique({ where: { id: org.metaPlanesPorId }, select: { name: true } }))?.name ?? null
    : null;

  const porEstado = {
    listos: enConstruccion.filter((p) => p.estado === "LISTO").length,
    enForma: enConstruccion.filter((p) => p.estado === "EN_FORMA").length,
    esqueleto: enConstruccion.filter((p) => p.estado === "ESQUELETO").length,
    sinPlan: Math.max(0, meta - construidos),
  };

  return {
    grupos: lista,
    planes: enConstruccion,
    sugeridos,
    meta,
    metaFijada,
    metaFijadaPor,
    metaFijadaEl: org?.metaPlanesEl ?? null,
    sugeridoSuperaMeta: metaFijada !== null && sugeridos > meta,
    construidos,
    listos: porEstado.listos,
    porEstado,
    equiposTotal: activos.length,
    equiposCubiertos: activos.filter((a) => a._count.planesAsignados > 0).length,
    ritmoSemanal,
    fechaTermino,
    diasSinPlanNuevo,
    detenido: diasSinPlanNuevo !== null && diasSinPlanNuevo > DIAS_PARA_DETENIDO && meta > construidos,
  };
}

export class ErrorDeMeta extends Error {
  constructor(mensaje: string, readonly codigo = 422) {
    super(mensaje);
    this.name = "ErrorDeMeta";
  }
}

/**
 * Fijar la meta, o volver al minimo sugerido con `null`.
 *
 * Se guarda su numero tal cual, aunque quede por debajo de lo construido: la
 * meta efectiva la sube el trinquete al leer. Guardar el numero inflado haria
 * imposible distinguir lo que pidio de lo que calculamos.
 */
export async function fijarMetaDePlanes(p: {
  organizationId: string;
  userId: string;
  meta: number | null;
}) {
  if (p.meta !== null && (!Number.isInteger(p.meta) || p.meta < 1 || p.meta > 5000)) {
    throw new ErrorDeMeta("La meta tiene que ser un número entero entre 1 y 5000.");
  }
  await prisma.organization.update({
    where: { id: p.organizationId },
    data: {
      metaPlanes: p.meta,
      metaPlanesPorId: p.meta === null ? null : p.userId,
      metaPlanesEl: p.meta === null ? null : new Date(),
    },
  });
  return constructorDePlanes(p.organizationId);
}
