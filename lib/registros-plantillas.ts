/**
 * De donde arranca una tabla propia.
 *
 * Nadie arma bien una tabla desde cero en una pantalla vacia: pone tres
 * columnas de texto, ninguna descripcion, y a los dos meses la tabla tiene
 * «Bomba 3», «bomba tres» y «B-3» como si fueran equipos distintos. Una
 * plantilla entrega el caso ya pensado —con las llaves a los datos de
 * MainTrack donde corresponden— y se ajusta antes de guardar.
 *
 * Las siete salen de lo que las plantas llevan hoy en Excel. Ninguna es
 * mantenimiento: si lo fuera, seria un modulo, no una tabla del cliente.
 *
 * «Gestion de contratos» es la que mas cerca pasa de algo que ya existe, y por
 * eso se acoto a proposito: el contrato COMO PAPEL QUE SE VENCE vive en
 * Vigencias, que es lo unico que avisa. Esta tabla lleva el lado
 * administrativo —monto, forma de pago, entregables, penalizacion,
 * responsable— que hoy vive en el Excel de administracion. Si hubiera
 * duplicado la vigencia como fuente de aviso, dos lugares habrian contestado
 * la misma pregunta con dos fechas distintas: exactamente el defecto que ya
 * ocurrio en este proyecto entre `recurrencia.ts` y Reportes.
 *
 * ── Una que NO esta aqui, a proposito
 *
 * Los actos y condiciones inseguras (el requisito de la STPS) parecen la
 * plantilla obvia y no lo son: no es un registro, es un proceso corto
 * —hallazgo, responsable, correccion, cierre, estadistica—. Como tabla propia
 * se capturaria bonito y nadie cerraria nada, porque una tabla del cliente no
 * tiene estados ni avisos ni conversion a orden de trabajo. Eso ya existe al
 * ochenta por ciento en `RondinHallazgo`, que si tiene categoria de seguridad,
 * estado y conversion a solicitud; lo que falta ahi es poder levantarlo a mano
 * y la vista de conjunto. Resolverlo con el constructor seria elegir el peor
 * de los dos caminos.
 *
 * Sin dependencias de servidor: lo lee el armador, que corre en el navegador.
 */
import type { TipoCampo } from "./registros-tipos";

export type CampoDePlantilla = {
  etiqueta: string;
  tipo: TipoCampo;
  requerido?: boolean;
  opciones?: string[];
  /** Si aparece en la lista sin tener que abrir el renglon. */
  enLista?: boolean;
};

export type Plantilla = {
  clave: string;
  nombre: string;
  /** Va a la descripcion de la tabla: es lo que leera la IA y la ayuda. */
  descripcion: string;
  /** Por que esta tabla no es un modulo del sistema. Solo se muestra al elegir. */
  porQue: string;
  icono: string;
  campos: CampoDePlantilla[];
};

const p = (x: Plantilla) => x;

export const PLANTILLAS: Plantilla[] = [
  p({
    clave: "contratos",
    nombre: "Gestión de contratos",
    descripcion:
      "El seguimiento administrativo de cada contrato con un tercero: qué se contrató, con quién, cuánto cuesta al mes, cómo se factura, qué incluye y quién responde por él adentro de la empresa. Para avisar ANTES de que se venza, el contrato se registra también en «Garantías y vigencias»: ahí es donde el sistema avisa.",
    porQue:
      "«Garantías y vigencias» ya guarda el contrato como papel que se vence, y es lo único que avisa. Lo que no tiene es el lado administrativo —monto, forma de pago, entregables, penalización, responsable—, que es lo que hoy vive en un Excel de compras o de administración. Esta tabla cubre eso y no repite la vigencia como fuente de aviso: dos lugares avisando lo mismo terminan con dos fechas distintas y nadie sabe cuál manda.",
    icono: "contrato",
    campos: [
      { etiqueta: "Proveedor", tipo: "PROVEEDOR", requerido: true, enLista: true },
      { etiqueta: "Objeto del contrato", tipo: "TEXTO", requerido: true, enLista: true },
      { etiqueta: "Número de contrato", tipo: "TEXTO", enLista: true },
      {
        etiqueta: "Tipo", tipo: "LISTA", requerido: true, enLista: true,
        opciones: ["Mantenimiento", "Servicio", "Suministro", "Arrendamiento", "Obra", "Vigilancia", "Limpieza", "Software o licencias", "Otro"],
      },
      {
        etiqueta: "Estado", tipo: "LISTA", requerido: true, enLista: true,
        opciones: ["En trámite", "Vigente", "Por renovar", "En renegociación", "Terminado", "Cancelado"],
      },
      { etiqueta: "Importe mensual", tipo: "DINERO", enLista: true },
      { etiqueta: "Importe total del contrato", tipo: "DINERO" },
      {
        etiqueta: "Forma de pago", tipo: "LISTA",
        opciones: ["Mensual", "Bimestral", "Trimestral", "Semestral", "Anual", "Por evento", "Contra entrega"],
      },
      { etiqueta: "Fecha de firma", tipo: "FECHA", enLista: true },
      { etiqueta: "Vigente desde", tipo: "FECHA" },
      { etiqueta: "Vigente hasta", tipo: "FECHA", enLista: true },
      { etiqueta: "Se renueva solo si nadie avisa", tipo: "SI_NO" },
      { etiqueta: "Responsable dentro de la empresa", tipo: "PERSONA", enLista: true },
      { etiqueta: "Centro de costo", tipo: "CENTRO_COSTO" },
      { etiqueta: "Equipo o sistema que cubre", tipo: "ACTIVO" },
      { etiqueta: "Qué incluye y qué no", tipo: "TEXTO_LARGO" },
      { etiqueta: "Penalización por incumplimiento", tipo: "TEXTO_LARGO" },
      { etiqueta: "Ya quedó en Garantías y vigencias", tipo: "SI_NO" },
    ],
  }),
  p({
    clave: "combustible",
    nombre: "Bitácora de combustible",
    descripcion:
      "Cada carga de diésel o gasolina a un equipo: cuántos litros, a qué precio, con qué lectura de horómetro u odómetro y quién la hizo. Sirve para ver el rendimiento por equipo y para cuadrar el tanque.",
    porQue:
      "El consumo de combustible no es mantenimiento, pero se mide por equipo y se compara contra sus horas. En la mayoría de las plantas vive en una libreta junto al tanque.",
    icono: "combustible",
    campos: [
      { etiqueta: "Equipo", tipo: "ACTIVO", requerido: true, enLista: true },
      { etiqueta: "Fecha", tipo: "FECHA", requerido: true, enLista: true },
      { etiqueta: "Litros", tipo: "NUMERO", requerido: true, enLista: true },
      { etiqueta: "Importe", tipo: "DINERO", enLista: true },
      { etiqueta: "Lectura del horómetro u odómetro", tipo: "NUMERO" },
      { etiqueta: "Quién cargó", tipo: "PERSONA", enLista: true },
      { etiqueta: "Proveedor", tipo: "PROVEEDOR" },
      { etiqueta: "Folio del ticket", tipo: "TEXTO" },
      { etiqueta: "Nota", tipo: "TEXTO_LARGO" },
    ],
  }),
  p({
    clave: "epp",
    nombre: "Entrega de equipo de protección",
    descripcion:
      "Qué equipo de protección personal se le entregó a cada persona, cuándo y de qué talla. Es el respaldo de que se entregó, que es lo que pide una inspección.",
    porQue:
      "Se lleva por persona, no por equipo, y lo pide seguridad e higiene. Es el papel que nadie encuentra el día de la visita.",
    icono: "proteccion",
    campos: [
      { etiqueta: "Persona", tipo: "PERSONA", requerido: true, enLista: true },
      { etiqueta: "Fecha de entrega", tipo: "FECHA", requerido: true, enLista: true },
      {
        etiqueta: "Qué se entregó", tipo: "LISTA", requerido: true, enLista: true,
        opciones: ["Casco", "Lentes de seguridad", "Guantes", "Botas", "Faja", "Tapones auditivos", "Careta", "Arnés", "Respirador", "Chaleco", "Overol", "Mandil"],
      },
      { etiqueta: "Cantidad", tipo: "NUMERO", enLista: true },
      { etiqueta: "Talla", tipo: "TEXTO" },
      { etiqueta: "Quién entregó", tipo: "PERSONA" },
      { etiqueta: "Sitio", tipo: "SITIO" },
      { etiqueta: "Observaciones", tipo: "TEXTO_LARGO" },
    ],
  }),
  p({
    clave: "analisis-agua",
    nombre: "Análisis de agua",
    descripcion:
      "Los resultados del análisis del agua de una caldera, torre de enfriamiento o sistema de proceso: pH, conductividad, dureza y cloruros, con la acción que se tomó si salió fuera de rango.",
    porQue:
      "Es un resultado de laboratorio, no una actividad de mantenimiento, pero se sigue por equipo y su tendencia explica corrosión e incrustación.",
    icono: "agua",
    campos: [
      { etiqueta: "Equipo", tipo: "ACTIVO", requerido: true, enLista: true },
      { etiqueta: "Fecha de la muestra", tipo: "FECHA", requerido: true, enLista: true },
      { etiqueta: "pH", tipo: "NUMERO", enLista: true },
      { etiqueta: "Conductividad (µS/cm)", tipo: "NUMERO", enLista: true },
      { etiqueta: "Dureza (ppm)", tipo: "NUMERO" },
      { etiqueta: "Cloruros (ppm)", tipo: "NUMERO" },
      { etiqueta: "Dentro de rango", tipo: "SI_NO", enLista: true },
      { etiqueta: "Quién tomó la muestra", tipo: "PERSONA" },
      { etiqueta: "Laboratorio", tipo: "PROVEEDOR" },
      { etiqueta: "Acción que se tomó", tipo: "TEXTO_LARGO" },
    ],
  }),
  p({
    clave: "herramienta",
    nombre: "Herramienta asignada",
    descripcion:
      "Qué herramienta o instrumento tiene cada persona, desde cuándo y en qué estado se entregó. Se cierra cuando la devuelve.",
    porQue:
      "No es una refacción que se consume, así que no va al almacén: es un resguardo que se presta y se devuelve.",
    icono: "herramienta",
    campos: [
      { etiqueta: "Persona", tipo: "PERSONA", requerido: true, enLista: true },
      { etiqueta: "Herramienta", tipo: "TEXTO", requerido: true, enLista: true },
      { etiqueta: "Número de serie o inventario", tipo: "TEXTO" },
      { etiqueta: "Fecha de entrega", tipo: "FECHA", requerido: true, enLista: true },
      { etiqueta: "Fecha de devolución", tipo: "FECHA", enLista: true },
      {
        etiqueta: "Estado al entregar", tipo: "LISTA", enLista: true,
        opciones: ["Nueva", "Buena", "Usada", "Para reparar"],
      },
      { etiqueta: "Quién la entregó", tipo: "PERSONA" },
      { etiqueta: "Nota", tipo: "TEXTO_LARGO" },
    ],
  }),
  p({
    clave: "contratistas",
    nombre: "Visitas de contratistas",
    descripcion:
      "Quién entró a la planta a hacer un trabajo que no es del personal propio: de qué proveedor, cuánta gente, a qué área y con qué orden de trabajo.",
    porQue:
      "Es control de acceso y de responsabilidad, no una orden de trabajo. Pero se amarra a la orden cuando existe.",
    icono: "contratista",
    campos: [
      { etiqueta: "Proveedor", tipo: "PROVEEDOR", requerido: true, enLista: true },
      { etiqueta: "Fecha", tipo: "FECHA", requerido: true, enLista: true },
      { etiqueta: "Trabajo que viene a hacer", tipo: "TEXTO", requerido: true, enLista: true },
      { etiqueta: "Cuántas personas", tipo: "NUMERO", enLista: true },
      { etiqueta: "Área", tipo: "UBICACION", enLista: true },
      { etiqueta: "Orden de trabajo", tipo: "ORDEN" },
      { etiqueta: "Hora de entrada", tipo: "TEXTO" },
      { etiqueta: "Hora de salida", tipo: "TEXTO" },
      { etiqueta: "Quién autorizó", tipo: "PERSONA" },
      { etiqueta: "Trajo su documentación completa", tipo: "SI_NO" },
    ],
  }),
  p({
    clave: "energia",
    nombre: "Consumo de energía",
    descripcion:
      "La lectura mensual del recibo de luz por sitio: energía consumida, demanda máxima, factor de potencia e importe. Sirve para ver el efecto de lo que se hizo en mantenimiento.",
    porQue:
      "Viene de un recibo, no de un medidor del sistema, y es del sitio completo en vez de un equipo. El medidor de MainTrack es para lo que se lee en campo y dispara preventivos.",
    icono: "energia",
    campos: [
      { etiqueta: "Sitio", tipo: "SITIO", requerido: true, enLista: true },
      { etiqueta: "Fecha del periodo", tipo: "FECHA", requerido: true, enLista: true },
      { etiqueta: "Energía (kWh)", tipo: "NUMERO", requerido: true, enLista: true },
      { etiqueta: "Demanda máxima (kW)", tipo: "NUMERO", enLista: true },
      { etiqueta: "Factor de potencia", tipo: "NUMERO" },
      { etiqueta: "Importe", tipo: "DINERO", enLista: true },
      { etiqueta: "Centro de costo", tipo: "CENTRO_COSTO" },
      { etiqueta: "Nota", tipo: "TEXTO_LARGO" },
    ],
  }),
];

export const PLANTILLAS_POR_CLAVE: Record<string, Plantilla> = Object.fromEntries(
  PLANTILLAS.map((x) => [x.clave, x]),
);

export const plantillaDe = (clave: string): Plantilla | null => PLANTILLAS_POR_CLAVE[clave] ?? null;
