import { COMPLEMENTO_IA, ORDEN_PLANES, PLANES, type ClavePlan } from "./planes";
import { FUNCIONES_IA } from "./ia/funciones";

/**
 * Lo que MainTrack dice de sí mismo, en un solo lugar.
 *
 * El sitio, la contratación, la suscripción, las empresas cliente, los
 * documentos y la presentación leen de aquí. Un precio, un límite o una
 * promesa escritos a mano en una pantalla terminan desincronizados de la
 * siguiente: ya pasó con los planes antes de que existiera lib/planes.ts.
 *
 * Regla: solo se dice lo que el producto hace hoy. Nada de "próximamente"
 * presentado como si existiera.
 */

export const MARCA = "MainTrack";

export const DESCRIPCION =
  "MainTrack es una plataforma de gestión y confiabilidad del mantenimiento que conecta activos, trabajo, inventario, condición y costos para anticipar fallas y mostrar dónde se está perdiendo capacidad productiva.";

export const LEMA = "Anticipe fallas, controle el trabajo y descubra dónde se pierde capacidad productiva.";
export const SUBLEMA = "MainTrack conecta activos, mantenimiento, inventario, condición y costos en una sola operación.";

/** Lo que MainTrack no es, dicho sin rodeos: evita vender lo que no hay. */
export const NO_ES = [
  "No es un ERP ni un sistema contable: el ERP registra lo que pasó; MainTrack dirige, anticipa y documenta el mantenimiento, e intercambia información con el ERP cuando hace falta.",
  "No sustituye la nómina: registra las horas de mantenimiento para costear el trabajo, no para pagarlo.",
  "No sustituye el proceso financiero de compras: organiza requisiciones, órdenes de compra y recepciones de refacciones; el pago y la contabilidad siguen en su sistema.",
  "No es una plataforma IoT completa: recibe lecturas de medidores y sensores por captura, importación o API.",
  "No garantiza que no habrá fallas: ayuda a anticiparlas y a atenderlas antes y mejor.",
];

export type Problema = { problema: string; detalle: string; respuesta: string; capacidades: string[] };

export const PROBLEMAS: Problema[] = [
  {
    problema: "El mantenimiento se atiende tarde",
    detalle: "Se repara cuando el equipo ya se detuvo; el preventivo depende de la memoria de alguien.",
    respuesta: "Trabajo reactivo → trabajo anticipado",
    capacidades: ["Planes preventivos por calendario y por medidor", "Medidores y umbrales", "Alertas por tendencia", "Predictivo con vida útil remanente"],
  },
  {
    problema: "No hay visibilidad clara del trabajo",
    detalle: "Nadie sabe con certeza qué está pendiente, quién lo tiene ni qué se venció.",
    respuesta: "Falta de control → control del trabajo",
    capacidades: ["Órdenes de trabajo con responsable", "Calendario y backlog", "Solicitudes y QR para reportar", "Avisos y escalamiento"],
  },
  {
    problema: "Las refacciones no están conectadas con las necesidades reales",
    detalle: "Falta la pieza cuando se necesita y sobra la que nadie usa.",
    respuesta: "Refacciones desconectadas → almacén ligado al trabajo",
    capacidades: ["Inventario con kardex y costo promedio", "Requisiciones desde la orden", "Compras y recepciones", "Proveedores"],
  },
  {
    problema: "Los costos y las fallas están dispersos",
    detalle: "Mano de obra, refacciones y servicios viven en hojas distintas; nadie sabe cuánto cuesta cada equipo.",
    respuesta: "Costos dispersos → costo por activo",
    capacidades: ["Mano de obra, materiales y servicios en cada orden", "Costo por activo", "Códigos de falla y causa raíz"],
  },
  {
    problema: "La dirección conoce los resultados cuando el daño ya ocurrió",
    detalle: "El reporte llega a fin de mes, cuando ya no se puede hacer nada.",
    respuesta: "Información tardía → decisiones a tiempo",
    capacidades: ["Indicadores de disponibilidad y cumplimiento", "Dónde para la planta", "Avisos", "Diagnóstico con evidencia"],
  },
];

export const DIFERENCIADORES: Array<{ titulo: string; texto: string }> = [
  { titulo: "Dónde para la planta", texto: "Muestra qué equipos y qué áreas detienen la producción, cuánto tiempo y cuánto cuesta cada paro." },
  { titulo: "Diagnóstico accionable", texto: "Un diagnóstico periódico con hallazgos, la evidencia que los sostiene y qué hacer; los números los calcula el sistema, no la inteligencia artificial." },
  { titulo: "Expediente completo del activo", texto: "Historial de órdenes, costos, fallas, lecturas, planes, refacciones y documentos de cada equipo en una sola pantalla." },
  { titulo: "Puesta en marcha guiada", texto: "Pasos ordenados para dejar la empresa lista para operar, con importación desde hojas de cálculo." },
  { titulo: "Operación por rol", texto: "Cada rol ve su inicio, su menú y sus acciones: dirección, administración, supervisión, técnicos, compras, solicitantes y consulta." },
  { titulo: "El técnico desde su teléfono", texto: "La orden en el orden del trabajo, con fotos, lecturas, tiempo, material y el escaneo del QR del equipo." },
  { titulo: "Mantenimiento, inventario y compras conectados", texto: "La orden pide la refacción, el almacén la surte o la requisición la compra, y el costo regresa a la orden." },
  { titulo: "Condición, medidores y alertas", texto: "Lecturas y sensores que disparan trabajo antes de la falla." },
  { titulo: "Multiempresa", texto: "Varios sitios en una misma cuenta y, para quien da servicio, varias empresas cliente separadas por completo." },
  { titulo: "El sistema le habla", texto: "El parte del día cuenta en voz alta lo que hay que saber hoy, para oírlo camino a la planta; y se le puede preguntar hablando, como a un jefe de mantenimiento." },
  { titulo: "Se entiende antes de leerlo", texto: "El inicio y el almacén abren con una franja donde cada cuadro es un equipo o una refacción: en un segundo se ve qué área está parada y qué familia está sufriendo." },
];

export const MODULOS: Array<{ nombre: string; texto: string }> = [
  { nombre: "Activos", texto: "Catálogo con ubicación, criticidad, expediente y QR." },
  { nombre: "Órdenes de trabajo", texto: "Correctivas, preventivas y de mejora, con responsable, tiempo, material, evidencia y cierre validado." },
  { nombre: "Solicitudes", texto: "Cualquier persona reporta una falla, también sin cuenta desde el QR del equipo." },
  { nombre: "Preventivo", texto: "Planes por calendario o por medidor que generan sus órdenes." },
  { nombre: "Rondines", texto: "Rutas de inspección con sus puntos y su QR: el rondín se recorre desde el teléfono y lo que se encuentra se convierte en orden sin capturarlo dos veces." },
  { nombre: "Medidores y predictivo", texto: "Lecturas, umbrales, tendencias y vida útil remanente." },
  { nombre: "Almacén", texto: "Existencias por almacén, kardex, costo promedio y mínimos, con una franja que dice de un vistazo qué familia está sufriendo y dónde está parado el dinero." },
  { nombre: "Compras", texto: "Requisiciones, autorización, órdenes de compra, proveedores y recepción." },
  { nombre: "Indicadores y reportes", texto: "Disponibilidad, cumplimiento, costos, MTBF y MTTR, backlog, y dónde para la planta: qué falla, por qué y cuánto cuesta cada paro." },
  { nombre: "Avisos", texto: "En la campana y en el celular, sin costo por mensaje. Quien pide una refacción se entera cuando se autoriza y cuando llega." },
  { nombre: "Conversaciones y compromisos", texto: "Se habla del registro, en el registro: cada orden, activo, solicitud, compra, plan, rondín, refacción y conjunto tiene su hilo, con menciones a la persona y avisos para quien pidió enterarse. Y lo que se acordó y no es una orden —cotizar, hablar con seguridad— queda anotado con responsable y fecha, y se cierra solo cuando se cumple." },
  { nombre: "Registros propios", texto: "Se contrata aparte. Las tablas que cada empresa lleva en Excel porque ni su ERP ni el CMMS las tienen —la bitácora del diésel, la entrega de equipo de protección, el análisis del agua, el seguimiento de sus contratos—, armadas desde un formato ya hecho y amarradas a sus equipos, su personal y sus proveedores: la columna «equipo» es el equipo, así que ese registro aparece después en el expediente de ese equipo." },
  { nombre: "Integración con su ERP", texto: "API propia con permisos por llave, avisos firmados hacia sus sistemas y carga masiva del catálogo por archivo, con reversión. No hay conectores de fábrica: hay una puerta documentada y la abre su área de sistemas." },
];

/** Un recorrido real del sistema, en el orden en que pasa en la planta. */
export const FLUJO_OPERATIVO: Array<{ paso: string; texto: string }> = [
  { paso: "Alguien reporta", texto: "El operador escanea el QR del equipo y describe la falla, con foto, sin necesidad de cuenta." },
  { paso: "Supervisión decide", texto: "Revisa la solicitud, la convierte en orden de trabajo y la asigna a un técnico con fecha." },
  { paso: "El técnico ejecuta", texto: "Desde su teléfono: actividades, tiempo, refacciones del almacén, lecturas y evidencia." },
  { paso: "Se valida y se cierra", texto: "Supervisión revisa horas, costo, causa y evidencia antes de cerrar." },
  { paso: "Queda en el activo", texto: "El historial, el costo y la falla alimentan los indicadores y el diagnóstico." },
];

export const BENEFICIOS_POR_ROL: Array<{ rol: string; beneficio: string }> = [
  { rol: "Dirección", beneficio: "Ve la situación crítica, la disponibilidad, el cumplimiento y el costo sin pedir un reporte." },
  { rol: "Administración", beneficio: "Configura la empresa, usuarios y catálogos, y revisa la calidad de los datos." },
  { rol: "Supervisión", beneficio: "Asigna, reprograma, da seguimiento y valida el trabajo cerrado." },
  { rol: "Técnicos", beneficio: "Tienen su trabajo del día en el teléfono y registran lo hecho sin papel." },
  { rol: "Compras", beneficio: "Recibe requisiciones con su porqué, compra y registra la recepción." },
  { rol: "Solicitantes", beneficio: "Reportan una falla en segundos y ven en qué va." },
];

// ─────────────────────────────────────────────────────── Prueba y cobro

/** Periodo de prueba: un mes gratis. Único valor para el alta, el sitio y los documentos. */
export const PRUEBA_DIAS = 30;
export const TEXTO_PRUEBA = "1 mes gratis";

export const MONEDA = "MXN";

/** Cómo se cobra hoy. Manual, y se dice. */
export const COBRO = {
  periodicidad: "Mensual",
  moneda: "Pesos mexicanos (MXN)",
  impuestos: "Los impuestos aplicables se indican en la propuesta comercial.",
  manual:
    "El cobro es manual: al inicio de cada mes se emite una nota de cobro con vencimiento a 15 días, y el pago se registra al confirmarse. La factura fiscal (CFDI) se emite aparte y no la genera MainTrack.",
  prueba: `La prueba dura ${PRUEBA_DIAS} días, no pide tarjeta y no genera cargos. Al terminar, la cuenta queda en solo lectura hasta que se contrate un plan: nada se borra.`,
  cambioDePlan:
    "El cambio de plan se solicita desde Configuración › Suscripción y surte efecto el día que se confirma. La siguiente nota de cobro usa el plan nuevo; no hay prorrateo.",
  cancelacion:
    "Se puede cancelar en cualquier momento, con efecto al final del mes pagado. La cuenta queda en solo lectura y los datos se pueden exportar; se eliminan definitivamente solo a solicitud escrita.",
  demo: "La empresa demostrativa no genera cargos ni puede suspenderse por cobranza.",
};

// ─────────────────────────────────────────────────── Comparación de planes

export type Celda =
  | { tipo: "incluido"; nota?: string }
  | { tipo: "no" }
  | { tipo: "limite"; valor: string }
  | { tipo: "complemento"; nota: string }
  | { tipo: "configuracion"; nota: string };

export type Fila = { grupo: string; concepto: string; celdas: Record<ClavePlan, Celda> };

const miles = (n: number) => (n === Infinity ? "Sin límite" : n.toLocaleString("es-MX"));
const limite = (valor: number): Celda => ({ tipo: "limite", valor: miles(valor) });
const ambos = (c: Celda): Record<ClavePlan, Celda> => ({ PROFESSIONAL: c, ENTERPRISE: c });
const porPlan = (f: (p: ClavePlan) => Celda) => Object.fromEntries(ORDEN_PLANES.map((p) => [p, f(p)])) as Record<ClavePlan, Celda>;

/**
 * La comparación verificable: cada renglón sale de PLANES o describe algo que
 * el sistema hace igual en los dos planes. Nada de "funciones avanzadas".
 */
export function comparacion(): Fila[] {
  const iaTotal = Object.keys(FUNCIONES_IA).length;
  return [
    { grupo: "Capacidad", concepto: "Usuarios", celdas: porPlan((p) => limite(PLANES[p].limites.users)) },
    { grupo: "Capacidad", concepto: "Activos", celdas: porPlan((p) => limite(PLANES[p].limites.assets)) },
    { grupo: "Capacidad", concepto: "Sitios", celdas: porPlan((p) => limite(PLANES[p].limites.sites)) },
    { grupo: "Capacidad", concepto: "Almacenes", celdas: ambos({ tipo: "incluido", nota: "Sin límite" }) },
    { grupo: "Capacidad", concepto: "Puntos de monitoreo predictivo", celdas: porPlan((p) => limite(PLANES[p].limites.sensors)) },
    { grupo: "Capacidad", concepto: "Almacenamiento de fotos y documentos", celdas: porPlan((p) => ({ tipo: "limite", valor: PLANES[p].limites.storageGb === Infinity ? "Sin límite" : `${PLANES[p].limites.storageGb} GB` })) },
    { grupo: "Operación", concepto: "Órdenes de trabajo, solicitudes y QR", celdas: ambos({ tipo: "incluido" }) },
    { grupo: "Operación", concepto: "Mantenimiento preventivo por calendario y por medidor", celdas: ambos({ tipo: "incluido" }) },
    { grupo: "Operación", concepto: "Medidores, umbrales y alertas", celdas: ambos({ tipo: "incluido" }) },
    { grupo: "Operación", concepto: "Predictivo: tendencia y vida útil remanente", celdas: ambos({ tipo: "incluido" }) },
    { grupo: "Operación", concepto: "Almacén, requisiciones, compras y proveedores", celdas: ambos({ tipo: "incluido" }) },
    { grupo: "Operación", concepto: "Avisos en la campana y en el celular", celdas: ambos({ tipo: "incluido" }) },
    { grupo: "Análisis", concepto: "Indicadores, reportes y exportación", celdas: ambos({ tipo: "incluido" }) },
    { grupo: "Análisis", concepto: "Dónde para la planta", celdas: ambos({ tipo: "incluido" }) },
    { grupo: "Análisis", concepto: "Bitácora de auditoría", celdas: ambos({ tipo: "incluido" }) },
    { grupo: "Integración", concepto: "API y avisos a otros sistemas (webhooks)", celdas: ambos({ tipo: "incluido" }) },
    { grupo: "Integración", concepto: "Integración con su ERP", celdas: ambos({ tipo: "configuracion", nota: "Por API; el alcance se acuerda en la implementación" }) },
    { grupo: "Integración", concepto: "Varias empresas cliente (para quien da servicio)", celdas: ambos({ tipo: "configuracion", nota: "Se habilita a solicitud" }) },
    {
      grupo: "Inteligencia artificial", concepto: "Operaciones de IA al mes",
      celdas: porPlan((p) => ({ tipo: "limite", valor: `${PLANES[p].ia.operaciones}` })),
    },
    {
      grupo: "Inteligencia artificial", concepto: "Funciones de IA",
      celdas: porPlan((p) => ({ tipo: "limite", valor: `${PLANES[p].ia.funciones.length} de ${iaTotal}` })),
    },
    {
      /**
       * El dictado va en los dos planes, y es deliberado aunque sea lo
       * contrario de lo que se hizo con el chat de voz.
       *
       * El chat de voz es para quien ve el panorama —uno o dos por empresa— y
       * cada vuelta cuesta transcribir, pensar y hablar. El dictado es para
       * el tecnico en el piso, solo transcribe, y es de donde sale el dato
       * con el que funciona todo lo demas que el cliente ya paga: sin cierre
       * bien contado no hay causa raiz, ni MTTR, ni costo por equipo.
       * Racionarlo por plan seria cobrar por que el sistema sirva.
       */
      grupo: "Inteligencia artificial", concepto: "Dictar el cierre de la orden",
      celdas: ambos({ tipo: "incluido", nota: "Con su propia bolsa: no gasta las operaciones del plan" }),
    },
    {
      // El parte del dia se escucha en los dos planes; preguntarle HABLANDO y
      // que conteste es de Enterprise, porque transcribir y sintetizar se
      // cobran por caracter y hay un tope mensual por empresa.
      grupo: "Inteligencia artificial", concepto: "El parte del día, hablado",
      celdas: ambos({ tipo: "incluido", nota: "Con su propia bolsa: no gasta las operaciones del plan" }),
    },
    {
      grupo: "Inteligencia artificial", concepto: "Preguntarle hablando y que conteste",
      celdas: {
        PROFESSIONAL: { tipo: "configuracion", nota: "El parte del día sí se escucha; preguntar hablando es de Enterprise" },
        ENTERPRISE: { tipo: "incluido", nota: "Para quien ve el panorama, con tope mensual por empresa" },
      },
    },
    {
      // El rondin captura en todos los planes; lo que va con el complemento es
      // que una maquina mire esas fotos. La distincion importa al venderlo: no
      // se esta cobrando por caminar la planta, se cobra por la revision.
      grupo: "Inteligencia artificial", concepto: "Revisar las fotos del rondín",
      celdas: {
        PROFESSIONAL: { tipo: "complemento", nota: "Con IA Avanzada. El rondín y sus fotos funcionan sin él" },
        ENTERPRISE: { tipo: "incluido", nota: "Propone hallazgos; usted acepta o descarta" },
      },
    },
    {
      grupo: "Inteligencia artificial", concepto: COMPLEMENTO_IA.nombre,
      celdas: ambos({ tipo: "complemento", nota: `Las ${iaTotal} funciones y ${COMPLEMENTO_IA.operaciones} operaciones más al mes, por ${precio(COMPLEMENTO_IA.precioMensual)} al mes` }),
    },
    {
      grupo: "Servicio", concepto: "Soporte dentro de MainTrack",
      celdas: { PROFESSIONAL: { tipo: "incluido", nota: "Tiempos estándar" }, ENTERPRISE: { tipo: "incluido", nota: "Tiempos prioritarios" } },
    },
    { grupo: "Servicio", concepto: "Puesta en marcha guiada e importación", celdas: ambos({ tipo: "incluido" }) },
    { grupo: "Servicio", concepto: "Acompañamiento de implementación y capacitación", celdas: ambos({ tipo: "configuracion", nota: "Según la ruta de implementación acordada" }) },
  ];
}

export function textoCelda(c: Celda): string {
  switch (c.tipo) {
    case "incluido": return c.nota ? `Incluido · ${c.nota}` : "Incluido";
    case "no": return "No incluido";
    case "limite": return c.valor;
    case "complemento": return `Complemento · ${c.nota}`;
    case "configuracion": return `Bajo configuración · ${c.nota}`;
  }
}

export function precio(n: number, moneda = MONEDA) {
  return `$${n.toLocaleString("es-MX")} ${moneda}`;
}

// ───────────────────────────────────────────────────────────── Soporte

export const SEVERIDADES = [
  { clave: "CRITICA", nombre: "Crítica", cuando: "Nadie de la empresa puede usar MainTrack, o hay riesgo de pérdida de datos.", respuesta: { PROFESSIONAL: "4 horas hábiles", ENTERPRISE: "2 horas hábiles" }, actualizacion: "Cada 4 horas hábiles" },
  { clave: "ALTA", nombre: "Alta", cuando: "Una función principal no sirve para varias personas y no hay forma de rodearlo.", respuesta: { PROFESSIONAL: "1 día hábil", ENTERPRISE: "4 horas hábiles" }, actualizacion: "Diaria" },
  { clave: "MEDIA", nombre: "Media", cuando: "Algo falla, pero hay una forma de seguir trabajando.", respuesta: { PROFESSIONAL: "2 días hábiles", ENTERPRISE: "1 día hábil" }, actualizacion: "Cada 2 días hábiles" },
  { clave: "BAJA", nombre: "Baja", cuando: "Una duda, una sugerencia o un detalle que no impide trabajar.", respuesta: { PROFESSIONAL: "5 días hábiles", ENTERPRISE: "3 días hábiles" }, actualizacion: "Al resolverse" },
] as const;

export type ClaveSeveridad = (typeof SEVERIDADES)[number]["clave"];

export const SOPORTE = {
  canal: "Solicitud de soporte dentro de MainTrack (menú › Soporte)",
  canalAlterno: "Si no puede entrar a MainTrack, su administrador lo reporta desde otra cuenta de la empresa.",
  horario: "Lunes a viernes, de 9:00 a 18:00, hora del centro de México (Monterrey), días hábiles.",
  disponibilidad:
    "MainTrack opera en Google Cloud con respaldos diarios. Por ahora no se compromete un porcentaje de disponibilidad: se informa cada incidente y su causa.",
  noIncluye: [
    "Tiempo de solución: se comprometen tiempos de respuesta y de actualización, no de solución, porque dependen de la causa.",
    "Captura de datos del cliente, salvo lo acordado en la implementación.",
    "Fallas de la red, los equipos o los navegadores del cliente.",
    "Integraciones de terceros no acordadas.",
  ],
};

/** Cómo se respalda hoy (verificado en Cloud SQL, instancia maintrack-db). */
export const RESPALDOS = {
  resumen: "Sí. La base de datos se respalda automáticamente cada día y se conservan los últimos 7 respaldos; además se puede recuperar a cualquier momento de los últimos 7 días. Los archivos viven en un almacén privado de Google Cloud.",
  ubicacion: "Google Cloud, región us-central1 (Estados Unidos).",
  diario: "Respaldo automático diario de la base de datos; se conservan 7.",
  puntoEnElTiempo: "Recuperación a un punto en el tiempo dentro de los últimos 7 días.",
};

/** Cómo se cuida la información del cliente. Lo usan el sitio y la presentación. */
export const SEGURIDAD = [
  "Cada empresa ve solo su información: toda consulta se filtra por empresa.",
  "Acceso por rol: cada persona ve y hace solo lo de su función.",
  "Los archivos no son públicos; cada descarga se autoriza por unos minutos.",
  "Bitácora de auditoría: quién hizo qué y cuándo.",
  `${RESPALDOS.diario} ${RESPALDOS.puntoEnElTiempo}`,
  `Opera en ${RESPALDOS.ubicacion}`,
];

// ────────────────────────────────────────────────────── Implementación

/**
 * Las cuatro etapas del arranque, para decirlas en una junta.
 *
 * El detalle —los doce pasos con responsable y entregable— vive en
 * `Docs/comercial/implementacion.md`. Aquí va la versión corta, que es lo
 * único que cabe en una diapositiva; si cambian las etapas, se cambian en
 * los dos lados a propósito.
 */
export const RUTA_IMPLEMENTACION: Array<{ etapa: string; texto: string; quien: string }> = [
  { etapa: "Acuerdo y alta", texto: "Plan, documentos y fecha de arranque. Se crea la empresa y su responsable.", quien: "MainTrack con la dirección" },
  { etapa: "Carga de información", texto: "Equipos, ubicaciones, refacciones, planes y usuarios, con plantillas de importación.", quien: "El administrador del cliente" },
  { etapa: "Capacitación", texto: "Una sesión por rol: dirección, supervisión, técnicos, compras y solicitantes.", quien: "MainTrack" },
  { etapa: "Operación acompañada", texto: "Puesta en marcha al 100 %, revisión semanal de la calidad de los datos el primer mes.", quien: "Los dos" },
];

export const IMPLEMENTACION_HONESTA =
  "La implementación no es automática: la puesta en marcha guía paso por paso, pero la información la aporta el cliente y la revisamos juntos. Con el catálogo de equipos en una hoja de cálculo, una planta empieza a registrar órdenes la primera semana.";

// ───────────────────────────────────────────────── Preguntas frecuentes

export const PREGUNTAS: Array<{ p: string; r: string }> = [
  { p: "¿Qué es MainTrack?", r: DESCRIPCION },
  { p: "¿Qué no es?", r: NO_ES.join(" ") },
  { p: "¿En qué se diferencia de un ERP?", r: "El ERP registra lo que ya pasó: la compra, la factura, la póliza. MainTrack dirige el mantenimiento antes y durante: qué toca, quién lo hace, qué refacción hace falta, qué equipo se está degradando. Convive con el ERP e intercambia información por API cuando hace falta." },
  { p: "¿Cuánto tarda la implementación?", r: "Depende de cuánta información tenga lista. Con un catálogo de equipos en hoja de cálculo, una planta puede empezar a registrar órdenes en la primera semana; la puesta en marcha guiada indica qué falta. No es automática: se acompaña." },
  { p: "¿Qué información necesito?", r: "Para empezar: la lista de equipos (clave, nombre, ubicación), las personas que usarán el sistema y sus roles. Después: refacciones, planes preventivos y medidores. Hay plantillas de importación para cada uno." },
  { p: "¿Se puede usar desde el teléfono?", r: "Sí, desde el navegador del teléfono, sin instalar nada. El técnico ve su trabajo del día, registra tiempo, material, lecturas y fotos, y escanea el QR del equipo. Necesita conexión: si se pierde la señal, las notas y los reportes que se estaban escribiendo se conservan para enviarlos al volver." },
  { p: "¿Cómo funciona el QR?", r: "Cada equipo o área puede tener su código QR. Quien lo escanea con su teléfono puede reportar una falla sin cuenta; el personal con cuenta abre directamente el equipo o su orden." },
  { p: "¿Cuántos usuarios y activos puedo tener?", r: `Professional: hasta ${miles(PLANES.PROFESSIONAL.limites.users)} usuarios y ${miles(PLANES.PROFESSIONAL.limites.assets)} activos. Enterprise: sin límite.` },
  { p: "¿Maneja inventario y compras?", r: "Sí: existencias por almacén, kardex con costo promedio, mínimos, requisiciones desde la orden, órdenes de compra a proveedores y recepción. No sustituye la contabilidad ni el pago a proveedores." },
  { p: "¿Qué tan segura está mi información?", r: "Cada empresa ve solo lo suyo; el acceso es por rol; los archivos no son públicos y cada descarga se firma por minutos; todo cambio relevante queda en una bitácora de auditoría. Opera en Google Cloud, con servidores en Estados Unidos." },
  { p: "¿Hay respaldos?", r: RESPALDOS.resumen },
  { p: "¿Se integra con otros sistemas?", r: "Sí, por API y avisos automáticos a otros sistemas (webhooks). La integración con un ERP específico se acuerda en la implementación." },
  { p: "¿Cómo pido soporte?", r: `Desde MainTrack, en Soporte. ${SOPORTE.horario}` },
  { p: "¿Puedo exportar mis datos?", r: "Sí: las listas principales se exportan a CSV en cualquier momento, también con la cuenta en solo lectura." },
  { p: "¿Cómo cancelo?", r: COBRO.cancelacion },
  { p: "¿Hay periodo de prueba?", r: `${TEXTO_PRUEBA}. ${COBRO.prueba}` },
  { p: "¿Puedo empezar con datos de ejemplo?", r: "Sí: al crear la empresa se puede arrancar vacía, con la configuración recomendada para su giro o con unos datos de demostración marcados como tales, que se quitan con un clic antes de operar." },
];
