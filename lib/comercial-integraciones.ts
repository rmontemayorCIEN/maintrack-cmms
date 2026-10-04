/**
 * Lo que MainTrack dice de sí mismo cuando el cliente pregunta por su ERP.
 *
 * Existe porque esa pregunta llega en la primera junta —«tenemos SAP», «todo
 * está en CONTPAQi»— y la respuesta no puede improvisarse: o se promete algo
 * que no hay, o se calla algo que sí hay. Aquí está la postura, lo que ya
 * funciona y lo que falta, en el mismo lugar donde se mantiene.
 *
 * Los datos duros —qué permisos existen, cuántos eventos salen, cuánto aguanta
 * la API— NO se escriben aquí: se leen de `lib/integraciones/alcances.ts` y del
 * catálogo de avisos, que es de donde los toma el sistema. Si mañana se agrega
 * un permiso, el documento comercial lo dice sin que nadie lo actualice.
 *
 * Sin dependencias de servidor a propósito: lo lee la presentación, y la
 * presentación termina en el navegador.
 */
import { ALCANCES, LIMITES_API, type Alcance } from "./integraciones/alcances";
import { EVENTOS_WEBHOOK } from "./avisos/catalogo";

/** Cuántos permisos y cuántos eventos hay, contados del código. */
export const CUANTOS = {
  alcances: (Object.keys(ALCANCES) as Alcance[]).length,
  eventos: EVENTOS_WEBHOOK.length,
  porCredencialPorMinuto: LIMITES_API.porCredencial,
  porEmpresaPorMinuto: LIMITES_API.porEmpresa,
  lecturasPorMinuto: LIMITES_API.lecturasPorCredencial,
} as const;

/**
 * La postura. Se dice tal cual, y conviene decirla temprano en la junta: saca
 * la conversación del terreno donde MainTrack sería rehén de la versión del
 * ERP del cliente.
 */
export const POSTURA =
  "MainTrack no se conecta a su ERP: publica una API y recibe eventos. Su equipo de sistemas —o nosotros, " +
  "con un agente instalado en su red— empuja y jala lo que haga falta. Es la única forma de integrar dos " +
  "sistemas sin que la actualización de uno rompa al otro.";

/** Por qué esa postura, para cuando pregunten «¿y no tienen un conector?». */
export const POR_QUE_ASI = [
  "Un conector se hace contra una versión. El cliente actualiza su ERP y el conector se cae, con el proveedor del CMMS de culpable.",
  "La API no cambia cuando cambia el ERP. Lo que se adapta es el lado del cliente, que es quien conoce su propio sistema.",
  "Cada empresa quiere campos distintos en lugares distintos. Un conector genérico no atina, y uno a la medida es un desarrollo que hay que cotizar como tal.",
];

/** Lo que ya está hecho y en producción. Nada de esto es un plan. */
export const LO_QUE_YA_HAY: Array<{ titulo: string; texto: string }> = [
  {
    titulo: "API propia, con versión",
    texto:
      `Rutas bajo /api/v1 para consultar activos, ubicaciones, órdenes, inventario y el estado general, y para ` +
      `recibir solicitudes, lecturas de medidores, condiciones de sensores y eventos. El índice de la API se ` +
      `consulta en línea y dice qué rutas hay y qué permiso pide cada una.`,
  },
  {
    titulo: "Credenciales que da el cliente, no nosotros",
    texto:
      `En Configuración › Integración la empresa crea sus propias llaves y elige de ${CUANTOS.alcances} permisos ` +
      `qué puede hacer cada una. El secreto se muestra una sola vez; en la base solo queda su huella. Se revoca ` +
      `o se rota sin llamarnos.`,
  },
  {
    titulo: "La empresa sale de la llave",
    texto:
      "Nunca de un parámetro de la petición. Un sistema externo no puede leer los datos de otro cliente ni por " +
      "error ni a propósito; pedirlos responde «no encontrado», igual que pedir algo que no existe.",
  },
  {
    titulo: "Reintentar no duplica",
    texto:
      "Las rutas que escriben aceptan una clave de idempotencia: si la red se cae a media petición y el ERP " +
      "reintenta, no se crea un segundo registro; se devuelve la misma respuesta de la primera vez.",
  },
  {
    titulo: `Webhooks firmados, ${CUANTOS.eventos} eventos`,
    texto:
      "MainTrack avisa al sistema del cliente cuando pasa algo: se abrió una orden crítica, se venció un " +
      "preventivo, una refacción quedó bajo mínimo, hay una compra por autorizar, llegó la mercancía. Cada " +
      "webhook tiene su secreto de firma, con reintentos, historial de entregas y suspensión automática si el " +
      "destino deja de responder.",
  },
  {
    titulo: "Bitácora de todo lo que entra",
    texto:
      "Quién llamó, qué ruta, cuándo y con qué resultado —incluidos los intentos rechazados—. Cuando algo no " +
      "llegó, se puede decir de qué lado se quedó sin discutirlo.",
  },
  {
    titulo: "Carga masiva por archivo",
    texto:
      "Para arrancar, o para lo que no valga la pena automatizar: el catálogo completo entra por archivo —sitios " +
      "y ubicaciones, activos, medidores y sus lecturas, refacciones y existencias, proveedores, planes y " +
      "catálogos de falla—. Se valida en seco antes de escribir, se confirma, y si algo salió mal el lote " +
      "completo se revierte.",
  },
  {
    titulo: "Límites para que una integración no tire el sistema",
    texto:
      `${CUANTOS.porCredencialPorMinuto} peticiones por minuto por llave y ${CUANTOS.porEmpresaPorMinuto} por ` +
      `empresa; las lecturas tienen ${CUANTOS.lecturasPorMinuto}, porque una pasarela de sensores manda en ` +
      `ráfagas. Cada empresa tiene su propio contador: nadie consume el de otro.`,
  },
];

/** En qué dirección va cada cosa. Es la diapositiva que el cliente entiende. */
export const LAS_DOS_DIRECCIONES = {
  entra: {
    titulo: "Lo que el ERP —o un sensor, o una pasarela— le mete a MainTrack",
    /** Una línea, para proyectar. El detalle está en los items. */
    resumen: "Solicitudes de trabajo, lecturas de medidor, condiciones de sensores, y los catálogos completos por archivo.",
    items: [
      "Solicitudes de trabajo, desde cualquier sistema que detecte un problema",
      "Lecturas de medidor: horómetros, odómetros, ciclos. Pasan la misma validación que la captura en pantalla",
      "Condiciones de sensores: vibración, temperatura, presión, con sus umbrales",
      "Catálogos y existencias por archivo, con reversión",
    ],
  },
  sale: {
    titulo: "Lo que MainTrack le entrega al ERP",
    resumen: "Consultas de activos, órdenes y existencias; avisos firmados en el momento; compras por colocar; recepciones y consumo.",
    items: [
      "Consultas: activos con su estado, ubicaciones, órdenes, existencias por almacén, conteos de pendientes",
      `Avisos en el momento: ${CUANTOS.eventos} eventos del catálogo, firmados y con reintentos`,
      "Compras por colocar, con su justificación y su renglonaje",
      "Recepciones y consumo, para que el ERP descargue y contabilice",
    ],
  },
} as const;

/**
 * La decisión que define el proyecto de integración, y que conviene tomar en la
 * primera junta y no en la tercera.
 */
export const DE_QUIEN_ES_EL_ALMACEN = {
  pregunta: "¿De quién es el almacén de refacciones?",
  porQueImporta:
    "De esta respuesta depende todo lo demás. Si no se define, se descubre a medio camino y se rehace.",
  opciones: [
    {
      titulo: "El almacén vive en MainTrack",
      texto:
        "El técnico consume del almacén de mantenimiento y MainTrack mueve la existencia con su kardex y su " +
        "costo promedio ponderado; después le informa al ERP el movimiento para que lo contabilice.",
      aFavor:
        "Es lo que hace que el costo por activo, el costo por orden y los indicadores sean reales. Los mínimos " +
        "disparan la compra solos.",
      enContra: "Hay que acordar con contabilidad quién manda en el número.",
      recomendado: true,
    },
    {
      titulo: "El almacén vive en el ERP y MainTrack lo refleja",
      texto:
        "MainTrack muestra la existencia de solo lectura para poder planear el trabajo, y cuando el técnico " +
        "consume le avisa al ERP para que descargue.",
      aFavor: "Nadie pelea por la verdad del inventario y el contador sigue en su sistema.",
      enContra:
        "La existencia que se ve tiene el retraso del último jalón, y MainTrack pierde el kardex y el costeo " +
        "propios: con eso se van el costo real por activo y parte de los indicadores.",
      recomendado: false,
    },
  ],
  enLaPractica:
    "Muchas plantas acaban partiéndolo: el almacén general en el ERP y el de mantenimiento en MainTrack, con " +
    "traspasos entre los dos. Funciona bien y es la salida cuando el cliente no quiere ceder ninguno de los dos.",
} as const;

/**
 * Qué esperar de cada ERP. La diferencia entre estos cuatro es enorme y no
 * decirla en la junta cuesta semanas después.
 */
export const POR_ERP: Array<{ erp: string; dificultad: string; texto: string; ojo?: string }> = [
  {
    erp: "Dynamics 365",
    dificultad: "El más sencillo",
    texto:
      "Business Central y Finance & Operations exponen OData y Dataverse, con avisos propios. La integración es " +
      "cuestión de días de trabajo del lado del cliente, no de meses.",
  },
  {
    erp: "Oracle",
    dificultad: "Sencillo",
    texto: "Fusion y NetSuite tienen servicios REST bien documentados. Técnicamente el más limpio de todos.",
  },
  {
    erp: "SAP",
    dificultad: "Técnicamente sí, políticamente despacio",
    texto:
      "S/4HANA y Business One tienen servicios para esto. El obstáculo no es técnico: el área de SAP del cliente " +
      "tiene su propio calendario, su consultor y su presupuesto. No se comprometen fechas que dependan de ellos.",
    ojo:
      "Si el cliente ya usa el módulo de mantenimiento de SAP (PM), la conversación no es de integración sino de " +
      "reemplazo, y el argumento es otro.",
  },
  {
    erp: "CONTPAQi",
    dificultad: "Necesita un agente en su red",
    texto:
      "Es el caso más frecuente en México y el más delicado: normalmente es software de escritorio sobre una base " +
      "de datos en la red del cliente, sin nada a qué llamarle desde internet. Se resuelve con un programa chico " +
      "instalado en su red que lee su base y empuja a la API de MainTrack —que ya está lista para recibir—.",
    ojo:
      "Confírmelo caso por caso: depende del producto y la versión, y CONTPAQi ha ido moviendo cosas a la nube.",
  },
];

/**
 * Lo que hay que preguntarle al área de sistemas del cliente antes de
 * comprometer nada. Sin estas respuestas no hay alcance, y sin alcance no hay
 * cotización.
 */
export const PREGUNTAS_AL_AREA_DE_SISTEMAS = [
  "¿Qué ERP, qué versión, y está en la nube o en un servidor de la planta?",
  "¿Tiene servicios web habilitados, o habría que instalar algo en su red?",
  "¿Quién del lado de ustedes desarrolla y mantiene la integración, y con qué disponibilidad?",
  "¿De quién es el almacén de refacciones: del ERP o de mantenimiento?",
  "¿El código de la refacción y el del activo van a ser los mismos en los dos sistemas?",
  "¿Qué tiene que ver el ERP de lo que pasa en mantenimiento: el consumo, el costo por activo, las compras, todo?",
  "¿Cada cuándo necesitan que la información esté igual en los dos lados: al instante, cada hora, una vez al día?",
];

/**
 * Lo que NO hace, dicho antes de que lo pregunten. Es lo que hace creíble todo
 * lo de arriba.
 */
export const LO_QUE_NO_HACE = [
  "No hay conectores de fábrica para ningún ERP. Hay una API y un catálogo de eventos; la parte que habla con el ERP la hace quien conoce ese ERP.",
  "MainTrack no jala solo de un sistema ajeno: el cliente empuja, o se instala un agente en su red que lo haga por él. Un jalón programado se puede construir, pero hoy no está.",
  "La API no da acceso a usuarios, contraseñas, bitácora ni configuración: esos datos no existen ahí. Los costos solo se ven con el permiso que los incluye.",
  "Nada externo mueve una orden de trabajo ni un plan directamente. Manda un hecho —una lectura, una solicitud— y las reglas del sistema deciden qué hacer con él.",
];

/**
 * Lo que de verdad hay que vender, y que no es la plomería.
 *
 * Va aquí porque es el argumento que se olvida cuando la junta se vuelve
 * técnica: acaba discutiéndose cómo se sincronizan dos almacenes, que es la
 * parte que cualquier CMMS resuelve, y nadie dice la única cosa que el ERP no
 * puede hacer.
 */
export const EL_ARGUMENTO_DE_FONDO = {
  titulo: "El ERP sabe cuánto costó. No sabe por qué se volvió a romper.",
  texto:
    "Un ERP registra que se compró un rodamiento y cuánto se pagó. No sabe que ese rodamiento fue a la bomba 3, " +
    "que es la cuarta vez en ocho meses, que la causa raíz es desalineación, y que el paro cuesta más que la " +
    "refacción. MainTrack sí. Integrarlos no es sincronizar almacenes: es devolverle al ERP el costo real de " +
    "mantenimiento por activo, por línea y por centro de costo —mano de obra, refacciones, servicios externos y " +
    "tiempo perdido— que hoy no tiene de dónde sacar.",
};
