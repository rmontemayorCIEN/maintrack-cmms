import { prisma } from "./db";
import { FUNCIONES_IA, type ClaveConBolsa, type ClaveFuncionIA } from "./ia/funciones";

/**
 * Catalogo comercial: que incluye cada plan y hasta donde llega.
 *
 * El activo es la unidad de cobro natural en un CMMS: es lo que crece con el
 * cliente y lo que refleja el valor que recibe. Usuarios y sitios acompañan,
 * y el monitoreo predictivo separa los planes altos porque es la funcion que
 * mas cuesta operar y la que mas se paga.
 *
 * Infinity = sin limite.
 */
export type ClavePlan = "PROFESSIONAL" | "ENTERPRISE";

/**
 * El orden comercial, de menor a mayor.
 *
 * Vive aqui y no repetido en cada pantalla: estaba escrito a mano en tres
 * lugares, y quitar un plan obligaba a acordarse de los tres. El dia que se
 * agregue uno, se agrega una vez.
 */
export const ORDEN_PLANES: ClavePlan[] = ["PROFESSIONAL", "ENTERPRISE"];

export type DefinicionPlan = {
  nombre: string;
  precioMensual: number;
  moneda: string;
  descripcion: string;
  limites: {
    assets: number;
    users: number;
    sites: number;
    sensors: number;
    /// Almacenamiento de fotos, videos y documentos, en gigabytes.
    storageGb: number;
  };
  incluye: string[];
  /**
   * Que trae el plan de inteligencia artificial.
   *
   * `operaciones` es la bolsa mensual; `funciones` es lo que desbloquea. Un
   * plan sin operaciones no es un plan con la IA apagada: es la puerta de
   * entrada al complemento, y asi se le presenta al cliente.
   */
  ia: {
    operaciones: number;
    funciones: ClaveFuncionIA[];
    /**
     * Las bolsas que NO salen de las operaciones del plan.
     *
     * La ayuda va aparte porque preguntar como se usa el sistema no debe
     * competir con generar un plan de mantenimiento: un usuario que se atora y
     * no puede preguntar no compra el plan de arriba, se va. Por eso hasta los
     * planes sin IA la traen.
     *
     * El parte del dia y el dictado del tecnico van aparte por lo mismo, y el
     * dictado con mas razon todavia: es la funcion que hace que el sistema se
     * llene de datos. Si dictar el cierre le quitara un diagnostico al jefe,
     * el tecnico volveria a escribir con el pulgar —o a no escribir—, que es
     * el problema que vino a resolver.
     *
     * El mapa lo exige el tipo: agregar una funcion a `CON_BOLSA_PROPIA` sin
     * darle cupo aqui ya no compila.
     */
    bolsas: Record<ClaveConBolsa, number>;
  };
};

/**
 * Complemento "IA Avanzada": se contrata sobre cualquier plan de pago y se
 * cobra aparte en la misma factura mensual.
 *
 * Va como complemento y no incluido en el precio de los planes por dos
 * razones. La primera es comercial: es la funcion que mas se percibe como
 * valiosa y la que justifica una linea adicional en la factura sin renegociar
 * el plan. La segunda es de operacion: el costo del modelo sube con el uso, y
 * un complemento con bolsa propia permite crecerlo sin tocar la lista de
 * precios de los planes.
 */
export const COMPLEMENTO_IA = {
  clave: "IA_AVANZADA",
  nombre: "IA Avanzada",
  precioMensual: 990,
  moneda: "MXN",
  operaciones: 400,
  descripcion:
    "Todas las funciones de inteligencia artificial, con 400 operaciones al mes sobre cualquier plan de pago.",
  incluye: [
    "Diagnóstico semanal con hallazgos, evidencia y matriz FODA",
    "Asistente de cierre de órdenes de trabajo",
    "Generador de planes de mantenimiento",
    "Consulta en lenguaje natural sobre sus datos",
    "400 operaciones mensuales",
  ],
} as const;

export const PLANES: Record<ClavePlan, DefinicionPlan> = {
  PROFESSIONAL: {
    nombre: "Professional",
    precioMensual: 2990,
    moneda: "MXN",
    descripcion: "Para una planta completa que ya opera con indicadores.",
    limites: { assets: 1000, users: 50, sites: 10, sensors: 50, storageGb: 100 },
    // Es el plan de entrada: la lista tiene que sostenerse sola, sin
    // apoyarse en un plan de abajo que ya no existe.
    incluye: [
      "Preventivo por calendario y por medidor",
      "Órdenes de trabajo, solicitudes y reportes de falla",
      "Almacén de refacciones, requisiciones y compras",
      "Mantenimiento predictivo y monitoreo de condición",
      "Alertas por tendencia y vida útil remanente",
      "Avisos al celular, sin costo por mensaje",
      "Reportes, indicadores y exportación",
      "Bitácora de auditoría",
      "API para integrar sistemas externos y sensores",
      "100 GB para fotos, videos y documentos",
      "Diagnóstico semanal con inteligencia artificial",
      "El parte del día, para escucharlo camino a la planta",
      "El técnico cierra la orden dictándola, con el teléfono y las manos ocupadas",
      "Decir a dónde ir y que el sistema lo lleve, desde cualquier pantalla",
      "El inicio y el almacén con su franja: se ve el estado antes de leerlo",
    ],
    // Suficiente para el diagnostico semanal y para que prueben el resto: la
    // bolsa chica es deliberada, es lo que hace que el complemento se venda.
    ia: { operaciones: 20, funciones: ["BRIEF", "DIAGNOSTICO", "CIERRE_OT", "REVISION", "AYUDA", "TRIAGE", "RECURRENCIA", "DEDUPE", "PROCEDIMIENTO", "DICTADO", "NAVEGAR"], bolsas: { AYUDA: 60, BRIEF: 90, DICTADO: 1200, NAVEGAR: 1200 } },
  },
  ENTERPRISE: {
    nombre: "Enterprise",
    precioMensual: 8990,
    moneda: "MXN",
    descripcion: "Para grupos con varias plantas y volumen alto.",
    limites: { assets: Infinity, users: Infinity, sites: Infinity, sensors: Infinity, storageGb: Infinity },
    incluye: [
      "Todo lo de Professional",
      "Activos, usuarios y sitios sin límite",
      "Monitoreo predictivo sin límite",
      "Diagnóstico semanal y asistentes de IA (detalle en la comparación)",
      "Consulta en lenguaje natural, y preguntarle hablando con respuesta en voz",
      "Soporte con tiempos de respuesta prioritarios",
    ],
    ia: { operaciones: 80, funciones: ["BRIEF", "DIAGNOSTICO", "CIERRE_OT", "PLAN", "REFACCIONES", "BUSQUEDA", "LEVANTAMIENTO", "PLACA", "FOTO_AREA", "REVISION", "AYUDA", "TRIAGE", "RECURRENCIA", "DEDUPE", "PROCEDIMIENTO", "DICTADO", "NAVEGAR"], bolsas: { AYUDA: 200, BRIEF: 90, DICTADO: 5000, NAVEGAR: 5000 } },
  },
};

export type Recurso = keyof DefinicionPlan["limites"];

export const NOMBRE_RECURSO: Record<Recurso, string> = {
  assets: "activos",
  users: "usuarios",
  sites: "sitios",
  sensors: "puntos de monitoreo predictivo",
  storageGb: "almacenamiento (GB)",
};

/**
 * Lo que una organizacion tiene realmente disponible de IA: lo del plan mas
 * lo del complemento, si lo contrato, mas los paquetes sueltos del periodo.
 */
export function iaDeLaOrganizacion(org: { plan: string; iaComplemento: boolean; iaExtra: number }) {
  const base = planDe(org.plan).ia;
  const funciones = new Set<ClaveFuncionIA>(base.funciones);
  if (org.iaComplemento) {
    for (const clave of Object.keys(FUNCIONES_IA) as ClaveFuncionIA[]) funciones.add(clave);
  }
  return {
    operaciones: base.operaciones + (org.iaComplemento ? COMPLEMENTO_IA.operaciones : 0) + (org.iaExtra ?? 0),
    /**
     * Las bolsas propias NO las altera el complemento, y es deliberado: ya
     * vienen generosas, y el complemento se vende por lo caro y puntual
     * —planes, levantamientos, procedimientos—, no por poder dictar mas.
     */
    bolsas: base.bolsas,
    funciones: [...funciones],
    /** Si el plan por si solo no da IA, el complemento es la unica via. */
    soloPorComplemento: base.operaciones === 0,
    complementoActivo: org.iaComplemento,
  };
}

/**
 * Nombre legible de lo que se solicita.
 *
 * Las solicitudes de cambio reutilizan el mismo flujo para los planes y para
 * el complemento de IA, y `IA_AVANZADA` no es un plan: sin esto se mostraria
 * como "Professional" por la degradacion de planDe.
 */
export function nombreSolicitado(clave: string): string {
  return clave === COMPLEMENTO_IA.clave ? COMPLEMENTO_IA.nombre : planDe(clave).nombre;
}

/**
 * La definicion de un plan, tolerando un valor que ya no existe.
 *
 * Cae en Profesional y no revienta. Importa: una copia de respaldo restaurada
 * o una cuenta vieja pueden traer "FREE" o "STARTER" en la columna, y el
 * sistema tiene que seguir de pie. Degradar hacia ARRIBA es lo correcto aqui:
 * dejar a alguien con menos de lo que pago seria el error caro.
 */
export function planDe(clave: string): DefinicionPlan {
  return PLANES[clave as ClavePlan] ?? PLANES.PROFESSIONAL;
}

/** Consumo actual de una organizacion contra los topes de su plan. */
export async function consumoDe(organizationId: string, plan: string) {
  const definicion = planDe(plan);
  const [assets, users, sites, sensors, bytes] = await Promise.all([
    prisma.asset.count({ where: { organizationId, active: true } }),
    prisma.user.count({ where: { organizationId, active: true } }),
    prisma.site.count({ where: { organizationId } }),
    prisma.sensor.count({ where: { organizationId, active: true } }),
    prisma.attachment.aggregate({ where: { organizationId }, _sum: { size: true } }),
  ]);

  // Se redondea hacia arriba a un decimal para que 0.03 GB no se vea como 0.
  const storageGb = Math.round((Number(bytes._sum.size ?? 0) / 1_073_741_824) * 10) / 10;
  const uso = { assets, users, sites, sensors, storageGb };
  return (Object.keys(uso) as Recurso[]).map((recurso) => {
    const limite = definicion.limites[recurso];
    return {
      recurso,
      etiqueta: NOMBRE_RECURSO[recurso],
      uso: uso[recurso],
      limite,
      ilimitado: limite === Infinity,
      porcentaje: limite === Infinity ? 0 : Math.min(100, (uso[recurso] / limite) * 100),
      excedido: uso[recurso] >= limite,
    };
  });
}

/**
 * Verifica si queda cupo antes de dar de alta un recurso.
 * Devuelve un mensaje listo para mostrar cuando no lo hay.
 */
export async function verificarCupo(
  organizationId: string,
  plan: string,
  recurso: Recurso,
  /**
   * Cuántos se van a dar de alta de un golpe. Una importación de 400 activos
   * con 380 lugares libres tiene que rechazarse ANTES de empezar: contar solo
   * «¿cabe uno más?» dejaba pasar la carga completa por encima del plan.
   */
  cantidad = 1,
  /**
   * Bytes que se van a agregar, solo para `storageGb`.
   *
   * Existe porque el cupo se revisaba ANTES de subir, con el tamano que
   * declaraba el navegador: declarar un mega, obtener la URL firmada y subir
   * cinco gigas rebasaba el plan despues del hecho. Con el peso real en la
   * mano, la cuenta se hace de verdad.
   */
  bytesAdicionales = 0,
): Promise<{ permitido: true } | { permitido: false; mensaje: string }> {
  const definicion = planDe(plan);
  const limite = definicion.limites[recurso];
  if (limite === Infinity) return { permitido: true };

  const contadores: Record<Recurso, () => Promise<number>> = {
    assets: () => prisma.asset.count({ where: { organizationId, active: true } }),
    users: () => prisma.user.count({ where: { organizationId, active: true } }),
    sites: () => prisma.site.count({ where: { organizationId } }),
    sensors: () => prisma.sensor.count({ where: { organizationId, active: true } }),
    storageGb: async () => {
      const r = await prisma.attachment.aggregate({ where: { organizationId }, _sum: { size: true } });
      return (Number(r._sum.size ?? 0) + bytesAdicionales) / 1_073_741_824;
    },
  };

  const actual = await contadores[recurso]();
  // El almacenamiento se mide en gigas, no en piezas: ahi basta con no haberse
  // pasado ya. Lo demas se cuenta con lo que se va a agregar.
  // El almacenamiento ya trae sumado lo que se va a agregar, asi que aqui se
  // compara con «cabe», no con «no se ha pasado».
  const cabe = recurso === "storageGb" ? actual <= limite : actual + cantidad <= limite;
  if (cabe) return { permitido: true };

  if (cantidad > 1 && actual < limite) {
    return {
      permitido: false,
      mensaje: `El plan ${definicion.nombre} permite ${limite} ${NOMBRE_RECURSO[recurso]}. Ya hay ${actual} y la carga agregaría ${cantidad}: caben ${limite - actual}. Divida el archivo o actualice su plan.`,
    };
  }

  // El limite 0 significa que la funcion no viene en el plan, no que se agoto.
  if (limite === 0) {
    return {
      permitido: false,
      mensaje: `El plan ${definicion.nombre} no incluye ${NOMBRE_RECURSO[recurso]}. Disponible desde el plan Professional.`,
    };
  }

  if (recurso === "storageGb") {
    return {
      permitido: false,
      mensaje: `Alcanzo el limite de ${limite} GB de almacenamiento del plan ${definicion.nombre}. Libere espacio o actualice su plan.`,
    };
  }

  return {
    permitido: false,
    mensaje: `Alcanzo el limite de ${limite} ${NOMBRE_RECURSO[recurso]} del plan ${definicion.nombre}. Actualice su plan para agregar mas.`,
  };
}

/**
 * Estado comercial de la suscripcion.
 *
 * Una prueba vencida no bloquea el acceso: deja la cuenta en solo lectura. El
 * cliente conserva la vista de sus datos y sus indicadores, pero no puede
 * seguir capturando. Sacarlo por completo de su informacion seria una forma
 * pesima de pedirle que pague.
 */
export function estadoSuscripcion(org: {
  status: string;
  plan: string;
  trialEndsAt: Date | null;
}) {
  if (org.status === "SUSPENDED") {
    return { activa: false, soloLectura: true, motivo: "La cuenta esta suspendida. Contacte a su proveedor para reactivarla." };
  }
  if (org.status === "CANCELLED") {
    return { activa: false, soloLectura: true, motivo: "La cuenta esta cancelada. Sus datos se conservan, pero no se pueden modificar." };
  }
  if (org.status === "TRIAL" && org.trialEndsAt && org.trialEndsAt < new Date()) {
    return {
      activa: false,
      soloLectura: true,
      motivo: "Su periodo de prueba termino. Puede consultar su información, pero para seguir capturando hay que activar un plan.",
    };
  }
  return { activa: true, soloLectura: false, motivo: null };
}

/** Dias que faltan para que termine la prueba, o null si no aplica. */
export function diasDePruebaRestantes(org: { status: string; trialEndsAt: Date | null }) {
  if (org.status !== "TRIAL" || !org.trialEndsAt) return null;
  const dias = Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 86_400_000);
  return dias;
}
