/**
 * Cumplimiento normativo: de que esta hecha una obligacion y como se cumple.
 *
 * Vive aparte de `lib/normas.ts` a proposito, como `registros-tipos.ts` y
 * `vigencias-tipos.ts`: las pantallas son componentes de cliente y solo
 * necesitan estos nombres. Tomarlos del modulo con la logica arrastraria
 * prisma al navegador.
 *
 * ── La idea que ordena todo el modulo
 *
 * MainTrack NO necesita un motor nuevo para cumplir una norma. Una obligacion
 * normativa periodica YA ES un plan de mantenimiento; un dictamen que vence YA
 * ES una vigencia; un dato de laboratorio YA ES un registro propio; un
 * recorrido de verificacion YA ES un rondin.
 *
 * Lo que falta —y es lo unico que construye este modulo— es el INDICE: saber
 * que pieza cumple cual obligacion, y si esa pieza esta viva y al corriente.
 *
 * ── Lo que este modulo NO promete
 *
 * No certifica cumplimiento. Organiza y conserva la evidencia de lo que el
 * cliente si hizo. La diferencia no es de redaccion: un sistema que dice
 * «usted cumple» y se equivoca le da al cliente una seguridad falsa justo en
 * el tema donde equivocarse cuesta multas o gente lastimada. Todos los textos
 * de pantalla se escriben con ese cuidado.
 */

// ─────────────────────────────────────────── Con que se cumple

/**
 * Los tipos de obligacion, y con que pieza del sistema se cumple cada uno.
 *
 * Es un catalogo cerrado porque cada tipo sabe como calcular su estado: un
 * plan se mide por su vencimiento, una vigencia por su fecha, un registro por
 * si hubo capturas en el periodo. Un tipo nuevo obliga a escribir como se
 * mide, y eso es deliberado.
 */
export const TIPOS_OBLIGACION = {
  ACTIVIDAD: {
    nombre: "Actividad periódica",
    descripcion: "Algo que hay que hacer cada cierto tiempo y dejar evidencia de que se hizo.",
    seCumpleCon: "un plan de mantenimiento que genera sus órdenes",
    pieza: "plan",
    ejemplo: "Revisar los extintores cada mes.",
  },
  DOCUMENTO: {
    nombre: "Documento con vigencia",
    descripcion: "Un papel que alguien expide, que vence y que hay que renovar a tiempo.",
    seCumpleCon: "una vigencia, que avisa antes de vencerse",
    pieza: "vigencia",
    ejemplo: "El dictamen de un recipiente sujeto a presión.",
  },
  DATO: {
    nombre: "Dato que se registra",
    descripcion: "Una medición o un resultado que hay que llevar anotado, aunque nadie lo revise a diario.",
    seCumpleCon: "un registro propio",
    pieza: "tabla",
    ejemplo: "El análisis del agua de la caldera.",
  },
  RECORRIDO: {
    nombre: "Recorrido de verificación",
    descripcion: "Caminar la instalación revisando puntos, y anotar lo que se encuentra.",
    // Un rondin es una EJECUCION, no una plantilla con frecuencia: no sabe
    // cuando toca el siguiente. Por eso lo que sostiene un recorrido
    // obligatorio periodico es el plan —que si programa y genera su orden— y
    // el rondin queda como la evidencia de que se camino.
    seCumpleCon: "un plan que lo programa; los rondines quedan como evidencia",
    pieza: "plan",
    ejemplo: "El recorrido trimestral de la comisión de seguridad e higiene.",
  },
  CAPACITACION: {
    nombre: "Capacitación o autorización del personal",
    descripcion: "Que quien hace el trabajo esté capacitado, y poder demostrarlo con su constancia vigente.",
    seCumpleCon: "una vigencia colgada de la persona",
    pieza: "vigencia",
    ejemplo: "La constancia del operador de montacargas.",
  },
} as const;

export type TipoObligacion = keyof typeof TIPOS_OBLIGACION;
export const ORDEN_TIPOS_OBLIGACION = Object.keys(TIPOS_OBLIGACION) as TipoObligacion[];
export const esTipoObligacion = (t: string): t is TipoObligacion => t in TIPOS_OBLIGACION;
export const definicionDeObligacion = (t: string) =>
  esTipoObligacion(t) ? TIPOS_OBLIGACION[t] : TIPOS_OBLIGACION.ACTIVIDAD;

/** La pieza del sistema con la que se amarra cada tipo. */
export type PiezaDeCumplimiento = "plan" | "vigencia" | "tabla" | "rondin" | "orden";

// ─────────────────────────────────────────── De donde viene una norma

/**
 * El origen de una norma, y —lo que de verdad importa— QUE SE PROMETE de ella.
 *
 * Una norma del catalogo la mantenemos nosotros y avisa cuando cambia. Una que
 * escribio el cliente no la actualiza nadie. Si eso no se distingue a simple
 * vista, el cliente supone que le avisaremos de un cambio en una norma que el
 * mismo escribio —y no—. Por eso el origen no es un dato interno: se muestra.
 */
export const ORIGENES_NORMA = {
  CATALOGO: {
    nombre: "Del catálogo",
    promesa: "La mantenemos al día y le avisamos cuando cambie.",
    etiquetaCorta: "Catálogo",
  },
  PROPIA: {
    nombre: "Propia de la empresa",
    promesa: "La definió usted. No se actualiza sola: si el requisito cambia, hay que cambiarla aquí.",
    etiquetaCorta: "Propia",
  },
} as const;

export type OrigenNorma = keyof typeof ORIGENES_NORMA;
export const esOrigenNorma = (o: string): o is OrigenNorma => o in ORIGENES_NORMA;

// ─────────────────────────────────────────── Como va el cumplimiento

/**
 * El estado de una obligacion.
 *
 * `SIN_SABER` existe a proposito y es el mas importante: una obligacion sin
 * nada amarrado NO se cuenta como incumplida ni como cumplida, porque el
 * sistema no tiene con que opinar. Contarla de cualquiera de los dos lados
 * seria inventar. Es el mismo criterio del resto del proyecto: si no se puede
 * saber, se dice que no se sabe.
 */
export type EstadoObligacion = "AL_CORRIENTE" | "POR_VENCER" | "VENCIDA" | "SIN_SABER" | "NO_APLICA";

export const ETIQUETA_ESTADO_OBLIGACION: Record<EstadoObligacion, string> = {
  AL_CORRIENTE: "Al corriente",
  POR_VENCER: "Por vencer",
  VENCIDA: "Vencida",
  SIN_SABER: "Sin nada que lo respalde",
  NO_APLICA: "No aplica",
};

export const TONO_ESTADO_OBLIGACION: Record<EstadoObligacion, "success" | "warning" | "danger" | "muted" | "info"> = {
  AL_CORRIENTE: "success",
  POR_VENCER: "warning",
  VENCIDA: "danger",
  SIN_SABER: "info",
  NO_APLICA: "muted",
};

/** Lo vencido primero, y lo que no aplica al final. Es el orden en que alguien quiere verlo. */
export const PESO_ESTADO: Record<EstadoObligacion, number> = {
  VENCIDA: 0, POR_VENCER: 1, SIN_SABER: 2, AL_CORRIENTE: 3, NO_APLICA: 4,
};

/**
 * El resumen de una norma a partir de sus obligaciones.
 *
 * No devuelve un porcentaje de cumplimiento, y es a proposito: un «87%
 * cumplido» es una cifra que se ve seria, que nadie puede reproducir y que
 * invita a presumirla. Se devuelven los conteos, que son verificables.
 */
export function resumirObligaciones(estados: EstadoObligacion[]) {
  const cuenta = (e: EstadoObligacion) => estados.filter((x) => x === e).length;
  const consideradas = estados.filter((e) => e !== "NO_APLICA").length;
  return {
    total: estados.length,
    consideradas,
    alCorriente: cuenta("AL_CORRIENTE"),
    porVencer: cuenta("POR_VENCER"),
    vencidas: cuenta("VENCIDA"),
    sinSaber: cuenta("SIN_SABER"),
    noAplican: cuenta("NO_APLICA"),
    /** El peor estado que hay: es lo que decide el color de la norma completa. */
    peor: estados.filter((e) => e !== "NO_APLICA").sort((a, b) => PESO_ESTADO[a] - PESO_ESTADO[b])[0] ?? "NO_APLICA",
  };
}

// ─────────────────────────────────────────── Lo que NO se promete

/**
 * El aviso que acompana al modulo dondequiera que se muestre un estado.
 *
 * No es letra chica ni es cortesia legal: es la frontera del producto. Lo que
 * el sistema puede demostrar es que el trabajo se hizo y que la evidencia esta
 * guardada. Si cumple o no cumple con la ley lo dictamina una autoridad o un
 * especialista, no un software.
 */
export const LO_QUE_NO_PROMETE =
  "MainTrack le ayuda a organizar y conservar la evidencia de lo que su empresa hace. No dictamina si cumple con la ley: eso lo determina la autoridad o su especialista en seguridad e higiene.";

/** Mientras el catalogo no lo revise un especialista, se dice en pantalla. */
export const CATALOGO_EN_BORRADOR =
  "El contenido de las normas está en revisión. Úselo para organizarse; confirme con su especialista antes de darlo por definitivo.";
