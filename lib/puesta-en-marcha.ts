import { prisma } from "./db";
import { saludDeDatos } from "./salud-datos";

/**
 * Puesta en marcha de una cuenta.
 *
 * Un cliente nuevo no sabe como se ve "terminado". Captura tres activos, no
 * pasa nada, y a las seis semanas abandona sin entender por que el sistema no
 * le sirvio. Esta lista define que es estar listo.
 *
 * Todo es conteo sobre la base: las palomitas son hechos, no opiniones. Si un
 * modelo decidiera si un paso esta completo, el mismo estado podria dar
 * respuestas distintas en dos cargas —y lo unico que no puede fallar en una
 * lista de verificacion es la verificacion—. La interpretacion va aparte, bajo
 * demanda, en lib/ia/revision.ts.
 *
 * Los umbrales significan algo a proposito: un activo no es un inventario. Una
 * lista que se palomea sola sin que el sistema sirva es un adorno.
 */

export type EstadoPaso = "LISTO" | "EN_PROGRESO" | "PENDIENTE";

export type Paso = {
  clave: string;
  titulo: string;
  /** Que se pierde el cliente si no lo hace. Se muestra siempre. */
  porQue: string;
  estado: EstadoPaso;
  /** Avance real. Null cuando el paso es de si o no. */
  progreso: { hecho: number; meta: number } | null;
  /** Lo que falta, concreto. Vacio cuando ya esta listo. */
  falta: string;
  enlace: string;
  textoEnlace: string;
  peso: number;
};

export type PuestaEnMarcha = {
  porcentaje: number;
  completa: boolean;
  pasos: Paso[];
  siguiente: Paso | null;
  /** Calidad de captura: la fase que sigue cuando la puesta en marcha termina. */
  saludDatos: number;
};

/**
 * Ejecuta las consultas de a pocas.
 *
 * Cloud SQL en la instancia mas chica admite pocas conexiones simultaneas, y
 * esta funcion hace treinta y tantos conteos. Lanzarlos todos de golpe agota
 * el pool —y en la consola de operador se multiplicaba por cada cliente, que
 * era una pantalla condenada a caerse en cuanto hubiera unas cuantas cuentas.
 */
async function enLotes<T>(tareas: Array<() => Promise<T>>, tamano = 6): Promise<T[]> {
  const salida: T[] = [];
  for (let i = 0; i < tareas.length; i += tamano) {
    salida.push(...(await Promise.all(tareas.slice(i, i + tamano).map((t) => t()))));
  }
  return salida;
}

function paso(
  p: Omit<Paso, "estado" | "progreso"> & { hecho: number; meta: number; siNoAplica?: boolean },
): Paso {
  const estado: EstadoPaso =
    p.hecho >= p.meta ? "LISTO" : p.hecho > 0 ? "EN_PROGRESO" : "PENDIENTE";
  return {
    clave: p.clave, titulo: p.titulo, porQue: p.porQue,
    enlace: p.enlace, textoEnlace: p.textoEnlace, peso: p.peso,
    estado,
    progreso: p.meta > 1 ? { hecho: Math.min(p.hecho, p.meta), meta: p.meta } : null,
    falta: estado === "LISTO" ? "" : p.falta,
  };
}

export async function puestaEnMarcha(
  organizationId: string,
  opciones: { conSalud?: boolean } = {},
): Promise<PuestaEnMarcha> {
  // La organizacion se consulta aparte: el resto son conteos y asi el lote
  // queda homogeneo y tipado sin acrobacias.
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { tipoInstalacion: true, industry: true },
  });

  const [
    sitios, ubicaciones, usuarios, tecnicos,
    categorias, especialidades, familias, codigosFalla, causas,
    activos, activosUbicados, activosConPlan,
    planes, planesConRecursos,
    refacciones, refaccionesCompletas,
    ordenesCerradas,
  ] = await enLotes<number>([
    () => prisma.site.count({ where: { organizationId } }),
    () => prisma.location.count({ where: { organizationId } }),
    () => prisma.user.count({ where: { organizationId, active: true } }),
    () => prisma.user.count({ where: { organizationId, active: true, role: { in: ["TECHNICIAN", "SUPERVISOR"] } } }),

    () => prisma.assetCategory.count({ where: { organizationId } }),
    () => prisma.specialty.count({ where: { organizationId } }),
    () => prisma.partCategory.count({ where: { organizationId } }),
    () => prisma.failureCode.count({ where: { organizationId } }),
    () => prisma.rootCause.count({ where: { organizationId } }),

    () => prisma.asset.count({ where: { organizationId, active: true } }),
    () => prisma.asset.count({ where: { organizationId, active: true, locationId: { not: null } } }),
    () => prisma.asset.count({ where: { organizationId, active: true, plans: { some: { active: true } } } }),

    () => prisma.maintenancePlan.count({ where: { organizationId, active: true } }),
    () => prisma.maintenancePlan.count({
      where: { organizationId, active: true, tasks: { some: { labor: { some: {} } } } },
    }),

    () => prisma.part.count({ where: { organizationId, active: true } }),
    () => prisma.part.count({ where: { organizationId, active: true, minQuantity: { gt: 0 }, unitCost: { gt: 0 } } }),

    () => prisma.workOrder.count({ where: { organizationId, status: { in: ["COMPLETED", "CLOSED"] } } }),
  ]);

  // El indice de captura solo se calcula cuando se va a mostrar: son otras
  // dieciseis consultas y en un listado no se usa.
  const salud = opciones.conSalud
    ? await saludDeDatos(organizationId)
    : { indice: 0 };

  // La meta de activos con plan se mide contra lo que hay, no contra un numero
  // fijo: una cuenta con 8 activos no tiene por que llegar a 20.
  const metaActivosConPlan = Math.max(1, Math.ceil(activos * 0.6));

  const pasos: Paso[] = [
    paso({
      clave: "empresa",
      titulo: "Identificar la instalación",
      porQue: "Define los ejemplos de captura y el contexto con el que el sistema le sugiere planes y refacciones.",
      hecho: org.tipoInstalacion && org.tipoInstalacion !== "OTRO" ? 1 : 0,
      meta: 1,
      falta: "Falta indicar que tipo de instalación es. Pidalo a su proveedor del servicio.",
      enlace: "/settings?s=organizacion",
      textoEnlace: "Ver la organización",
      peso: 1,
    }),
    paso({
      clave: "estructura",
      titulo: "Sitios y ubicaciones",
      porQue: "Es como se filtra el trabajo por área y como el técnico encuentra el equipo en piso.",
      hecho: sitios > 0 ? Math.min(ubicaciones, 3) + 1 : 0,
      meta: 4,
      falta: sitios === 0
        ? "Falta dar de alta el sitio: planta, edificio o sucursal."
        : `Tiene ${ubicaciones} ubicaciones. Con al menos tres —areas, cuartos o lineas— el trabajo se organiza solo.`,
      enlace: "/catalogs?tipo=sites",
      textoEnlace: "Dar de alta sitios",
      peso: 2,
    }),
    paso({
      clave: "equipo",
      titulo: "Su equipo de trabajo",
      porQue: "Sin técnicos dados de alta no hay a quien asignar órdenes ni de donde salga el costo de mano de obra.",
      hecho: Math.min(usuarios, 2) + (tecnicos > 0 ? 1 : 0),
      meta: 3,
      falta: tecnicos === 0
        ? "Falta dar de alta al menos un técnico o supervisor."
        : "Agregue al resto de su equipo para poder repartir el trabajo.",
      enlace: "/settings?s=usuarios",
      textoEnlace: "Agregar usuarios",
      peso: 2,
    }),
    paso({
      clave: "catalogos",
      titulo: "Catálogos base",
      porQue: "Alimentan los campos de selección. Sin ellos se captura texto libre y después nada se puede agrupar ni comparar.",
      hecho: [categorias, especialidades, familias, codigosFalla, causas].filter((n) => n > 0).length,
      meta: 5,
      falta: [
        categorias === 0 ? "categorías de activo" : null,
        especialidades === 0 ? "especialidades" : null,
        familias === 0 ? "familias de refacción" : null,
        codigosFalla === 0 ? "códigos de falla" : null,
        causas === 0 ? "causas raiz" : null,
      ].filter(Boolean).join(", ") || "",
      enlace: "/catalogs",
      textoEnlace: "Ir a catálogos",
      peso: 2,
    }),
    paso({
      clave: "activos",
      titulo: "Inventario de activos",
      porQue: "Es el cimiento: sin activos no hay planes, ni historial, ni costo por equipo.",
      hecho: Math.min(activos, 5) + (activos > 0 && activosUbicados === activos ? 1 : 0),
      meta: 6,
      falta: activos === 0
        ? "Todavía no hay activos. El levantamiento asistido arma el inventario completo a partir de una descripción."
        : activosUbicados < activos
          ? `${activos - activosUbicados} de ${activos} activos no tienen ubicacion asignada.`
          : "Agregue el resto de los equipos que mantiene.",
      enlace: "/assets/levantamiento",
      textoEnlace: activos === 0 ? "Levantamiento asistido" : "Agregar activos",
      peso: 3,
    }),
    paso({
      clave: "planes",
      titulo: "Planes de mantenimiento",
      porQue: "Es lo que convierte el sistema en preventivo. Sin planes solo registra las fallas después de que ocurren.",
      hecho: activos === 0 ? 0 : activosConPlan,
      meta: metaActivosConPlan,
      falta: planes === 0
        ? "Ningún activo tiene plan. El generador de IA redacta uno completo a partir del equipo."
        : `${activosConPlan} de ${activos} activos tienen plan. Priorice los de criticidad A.`,
      enlace: "/plans",
      textoEnlace: planes === 0 ? "Crear el primer plan" : "Ver planes",
      peso: 3,
    }),
    paso({
      clave: "almacen",
      titulo: "Almacén de refacciones",
      porQue: "Con mínimo y costo capturados, el sistema avisa cuando reponer y carga el consumo al costo de la orden.",
      hecho: Math.min(refaccionesCompletas, 5),
      meta: 5,
      falta: refacciones === 0
        ? "Todavía no hay refacciones. Puede importarlas desde Excel o pedirle sugerencias a la IA por equipo."
        : `${refacciones - refaccionesCompletas} de ${refacciones} refacciones no tienen minimo o costo capturado.`,
      enlace: "/inventory",
      textoEnlace: refacciones === 0 ? "Dar de alta refacciones" : "Revisar almacén",
      peso: 2,
    }),
    paso({
      clave: "operacion",
      titulo: "Cerrar la primera orden",
      porQue: "Hasta que se cierra una orden con horas y causa raiz, los indicadores no tienen de donde salir.",
      hecho: Math.min(ordenesCerradas, 3),
      meta: 3,
      falta: ordenesCerradas === 0
        ? "Ejecute el programador para generar las primeras órdenes preventivas, o levante una manual."
        : `Lleva ${ordenesCerradas} ordenes cerradas. Con tres empiezan a tener sentido los indicadores.`,
      enlace: "/work-orders",
      textoEnlace: "Ver órdenes de trabajo",
      peso: 2,
    }),
  ];

  // Planes sin recursos no rompen el paso, pero si valen medio punto: un plan
  // sin mano de obra ni refacciones no se puede presupuestar ni preparar.
  const pesoTotal = pasos.reduce((s, p) => s + p.peso, 0);
  const logrado = pasos.reduce((s, p) => {
    const avance = p.progreso ? p.progreso.hecho / p.progreso.meta : p.estado === "LISTO" ? 1 : 0;
    return s + avance * p.peso;
  }, 0);

  const porcentaje = Math.round((logrado / pesoTotal) * 100);
  const siguiente = pasos.find((p) => p.estado !== "LISTO") ?? null;

  return {
    porcentaje,
    completa: siguiente === null,
    pasos,
    siguiente,
    saludDatos: salud.indice,
  };
}

/** Solo el avance, para listados. Evita traer todo el detalle. */
export async function avancePuestaEnMarcha(organizationId: string) {
  const r = await puestaEnMarcha(organizationId);
  return { porcentaje: r.porcentaje, completa: r.completa, siguiente: r.siguiente?.titulo ?? null };
}
