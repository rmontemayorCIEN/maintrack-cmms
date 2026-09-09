/**
 * Catalogo de tipos de instalacion.
 *
 * Un CMMS se comporta muy distinto segun donde vive: un hospital tiene equipo
 * de soporte de vida con normativa encima, una plaza comercial vive del aire
 * acondicionado y las escaleras electricas, una flotilla no tiene edificio que
 * mantener. El tipo se captura una sola vez, al dar de alta al cliente, y
 * despues alimenta todo:
 *
 *   - El ejemplo que se muestra al describir la instalacion
 *   - El contexto que reciben los prompts de IA
 *   - El vocabulario con el que se le habla al usuario
 *
 * Sin este dato, cada funcion de IA tiene que adivinar el giro a partir de los
 * nombres de los activos, y adivina peor.
 */

export type ClaveInstalacion =
  | "PLANTA" | "EDIFICIO" | "PLAZA" | "HOSPITAL" | "ESCUELA" | "DEPORTIVO"
  | "HOTEL" | "RESTAURANTE" | "BODEGA" | "FLOTILLA" | "RESIDENCIAL" | "OTRO";

export type DefinicionInstalacion = {
  nombre: string;
  /** Como se refiere uno al lugar dentro del sistema. */
  sustantivo: string;
  /**
   * Como se le llama aqui a un conjunto de equipos que sirve o no sirve como
   * un todo. En una planta es "la linea 4"; en un club, "la alberca"; en un
   * edificio, "los elevadores". El objeto es el mismo, la palabra no.
   *
   * Si esto se llamara "linea" para todos, meteriamos una planta
   * manufacturera en el modelo para siempre: un socio del club no tiene
   * lineas y un administrador de edificio tampoco.
   */
  conjunto: { singular: string; plural: string; genero: "f" | "m" };
  /** Ejemplo de descripcion, para el campo del levantamiento. */
  ejemplo: string;
  /** Que sistemas dominan aqui. Va directo a los prompts. */
  contextoIa: string;
};

export const INSTALACIONES: Record<ClaveInstalacion, DefinicionInstalacion> = {
  PLANTA: {
    nombre: "Planta de producción",
    sustantivo: "la planta",
    conjunto: { singular: "Línea", plural: "Líneas", genero: "f" },
    ejemplo:
      "Planta metalmecanica de 4,000 m2 en Apodaca. Nave de producción con tornos y centros de maquinado, cuarto de compresores, subestación propia y almacén. Opera dos turnos, seis días.",
    contextoIa:
      "Domina el equipo de produccion y sus servicios auxiliares: aire comprimido, energia electrica, agua de enfriamiento, extraccion. El paro de linea es la consecuencia que ordena las prioridades.",
  },
  EDIFICIO: {
    nombre: "Edificio corporativo",
    sustantivo: "el edificio",
    conjunto: { singular: "Sistema", plural: "Sistemas", genero: "m" },
    ejemplo:
      "Edificio de oficinas de ocho niveles y 6,000 m2 en Monterrey. Dos elevadores, aire acondicionado central con chiller en azotea, subestación, planta de emergencia y estacionamiento en sotano con extracción.",
    contextoIa:
      "Dominan climatizacion, transporte vertical, suministro electrico e hidrosanitario. La ocupacion y el confort mandan; la falla se mide en gente incomoda o evacuada, no en produccion perdida.",
  },
  PLAZA: {
    nombre: "Plaza o centro comercial",
    sustantivo: "la plaza",
    conjunto: { singular: "Sistema", plural: "Sistemas", genero: "m" },
    ejemplo:
      "Plaza comercial de 12,000 m2 con 40 locales, dos niveles. Aire acondicionado central, tres escaleras electricas, dos elevadores, planta de emergencia, sistema contra incendio y estacionamiento techado.",
    contextoIa:
      "Dominan climatización de áreas comunes, transporte vertical, contra incendio e iluminación. Todo lo que se mantiene esta a la vista del publico y en horario de operación extendido.",
  },
  HOSPITAL: {
    nombre: "Hospital o clinica",
    sustantivo: "el hospital",
    conjunto: { singular: "Servicio", plural: "Servicios", genero: "m" },
    ejemplo:
      "Hospital de 60 camas en Guadalupe. Cuatro quirofanos, terapia intensiva, laboratorio, central de gases medicinales, dos plantas de emergencia, chillers, calderas y lavanderia.",
    contextoIa:
      "Hay equipo de soporte de vida y gases medicinales con normatividad estricta y redundancia obligatoria. La criticidad se mide en riesgo al paciente: la energia, los gases y la climatizacion de areas criticas no admiten interrupcion.",
  },
  ESCUELA: {
    nombre: "Escuela o campus",
    sustantivo: "el campus",
    conjunto: { singular: "Sistema", plural: "Sistemas", genero: "m" },
    ejemplo:
      "Campus universitario de tres edificios y 15,000 m2. Aulas con minisplits, laboratorios, cafeteria, gimnasio, cisterna con hidroneumático, subestación y canchas con iluminación.",
    contextoIa:
      "Instalación dispersa en varios edificios, con uso concentrado en horario escolar y ventanas de mantenimiento en periodos vacacionales. Dominan climatización, hidrosanitario y seguridad.",
  },
  DEPORTIVO: {
    nombre: "Club o centro deportivo",
    sustantivo: "el club",
    conjunto: { singular: "Servicio", plural: "Servicios", genero: "m" },
    ejemplo:
      "Club deportivo de 3,000 m2 en Monterrey. Dos niveles, alberca semiolimpica techada, área de pesas y cardio, canchas de padel, vestidores con vapor y sauna, cafeteria y estacionamiento.",
    contextoIa:
      "La alberca y su cuarto de maquinas suelen ser el nucleo del inventario: bombas, filtros, calentamiento y dosificacion quimica. Se suman vapor, sauna, climatizacion y equipo de gimnasio. Horario extendido los siete dias.",
  },
  HOTEL: {
    nombre: "Hotel",
    sustantivo: "el hotel",
    conjunto: { singular: "Servicio", plural: "Servicios", genero: "m" },
    ejemplo:
      "Hotel de 120 habitaciones y cinco niveles. Alberca, restaurante con cocina industrial, lavanderia propia, calderas para agua caliente, chillers, dos elevadores y planta de emergencia.",
    contextoIa:
      "Opera 24 horas sin ventana de paro comoda. Dominan agua caliente sanitaria, climatización por habitación, lavanderia y cocina. La falla se percibe de inmediato en la experiencia del huesped.",
  },
  RESTAURANTE: {
    nombre: "Restaurante o cadena de alimentos",
    sustantivo: "el restaurante",
    conjunto: { singular: "Sistema", plural: "Sistemas", genero: "m" },
    ejemplo:
      "Restaurante de 300 m2 con cocina industrial: dos estufas, freidoras, plancha, campana con extraccion y sistema de supresion, camaras de refrigeracion y congelacion, y aire acondicionado.",
    contextoIa:
      "Dominan refrigeración, cocina industrial y extracción. La cadena de frio y el sistema de supresión de la campana son críticos por inocuidad y por normatividad, no solo por operación.",
  },
  BODEGA: {
    nombre: "Bodega o centro de distribución",
    sustantivo: "la bodega",
    conjunto: { singular: "Línea", plural: "Líneas", genero: "f" },
    ejemplo:
      "Centro de distribución de 8,000 m2 con doce andenes. Montacargas electricos con sala de carga, rampas niveladoras, sistema contra incendio, iluminación en altura y oficinas administrativas.",
    contextoIa:
      "Dominan manejo de materiales —montacargas, andenes, transportadores—, contra incendio e iluminación en altura. Si hay camaras frias, la refrigeración se vuelve lo mas crítico.",
  },
  FLOTILLA: {
    nombre: "Flotilla de vehiculos",
    sustantivo: "la flotilla",
    conjunto: { singular: "Ruta", plural: "Rutas", genero: "f" },
    ejemplo:
      "Flotilla de 25 unidades: 18 camionetas de reparto y 7 tractocamiones. Taller propio con dos fosas, compresor, equipo de lubricacion y area de lavado.",
    contextoIa:
      "Los activos son vehiculos y el mantenimiento se dispara por kilometraje u horas, no por calendario. Se suman las instalaciones del taller. La disponibilidad de unidades es el indicador que importa.",
  },
  RESIDENCIAL: {
    nombre: "Residencia o condominio",
    sustantivo: "la propiedad",
    conjunto: { singular: "Sistema", plural: "Sistemas", genero: "m" },
    ejemplo:
      "Casa de dos niveles y 450 m2 en Monterrey. Alberca de 40 m3, cisterna con hidroneumático, calentadores de paso, minisplits en recamaras, riego automático, porton eléctrico y planta de emergencia.",
    contextoIa:
      "Escala pequena pero variedad alta: alberca, hidroneumatico, agua caliente, climatizacion, riego y accesos. El dueño rara vez conoce marcas y capacidades, asi que conviene proponer por funcion y marcar todo para verificar en piso.",
  },
  OTRO: {
    nombre: "Otro",
    sustantivo: "la instalación",
    conjunto: { singular: "Sistema", plural: "Sistemas", genero: "m" },
    ejemplo:
      "Describa el lugar: giro, superficie aproximada, niveles, areas principales y horario de operacion.",
    contextoIa: "",
  },
};

export const CLAVES_INSTALACION = Object.keys(INSTALACIONES) as ClaveInstalacion[];

export function instalacionDe(clave: string | null | undefined): DefinicionInstalacion {
  return INSTALACIONES[(clave ?? "OTRO") as ClaveInstalacion] ?? INSTALACIONES.OTRO;
}

/**
 * Bloque de contexto para los prompts. Devuelve null cuando no aporta nada,
 * para no meter ruido en la instruccion.
 */
export function contextoDeInstalacion(org: { tipoInstalacion?: string | null; industry?: string | null }) {
  const def = instalacionDe(org.tipoInstalacion);
  if (!org.tipoInstalacion || org.tipoInstalacion === "OTRO") {
    return org.industry ? { tipo: null, giro: org.industry, queEsperar: null } : null;
  }
  return { tipo: def.nombre, giro: org.industry ?? null, queEsperar: def.contextoIa };
}

/**
 * Como se le llama a un conjunto de equipos en esta cuenta.
 *
 * ── Por que existe esta funcion y no una constante ──
 *
 * Toda etiqueta, ficha de ayuda e instruccion a la IA tiene que LEER el
 * termino, nunca escribirlo. Si alguien teclea "Línea" en una pantalla, el
 * dia que un club abra esa pantalla va a leer una palabra que no significa
 * nada en su mundo — y no hay forma de encontrar esos literales despues, mas
 * que a mano y uno por uno.
 *
 * La organizacion puede imponer el suyo: hay plantas que dicen "celda" y
 * hospitales que dicen "area critica". Si `terminoConjunto` esta lleno, gana.
 */
export type TerminoConjunto = {
  singular: string;
  plural: string;
  genero: "f" | "m";
  /** Los articulos ya concordados. Ninguna pantalla los escribe a mano. */
  el: string;
  un: string;
  algun: string;
  ningun: string;
  /** Para el boton de alta: "Nuevo" o "Nueva". */
  nuevo: string;
  /** Para hablar de mas de uno: "varios" o "varias". */
  varios: string;
};

export function terminoConjunto(org: {
  tipoInstalacion?: string | null;
  terminoConjunto?: string | null;
  terminoConjuntoPlural?: string | null;
}): TerminoConjunto {
  const porTipo = instalacionDe(org.tipoInstalacion).conjunto;
  const propio = org.terminoConjunto?.trim();
  const singular = propio || porTipo.singular;
  const plural =
    org.terminoConjuntoPlural?.trim() ||
    // Sin plural propio pero con singular propio, el plural del tipo no
    // corresponde: "celda" con plural "Líneas" seria peor que pluralizar mal.
    (propio ? `${propio}s` : porTipo.plural);

  /**
   * El genero, porque en espanol el articulo concuerda y no hay forma de
   * escribirlo neutro.
   *
   * "Nuevo línea" y "en algún línea" fue lo primero que se vio en pantalla, y
   * se lee como un sistema mal traducido. Los terminos del catalogo traen su
   * genero; para el que escribe el cliente se usa la regla de que termina en
   * -a, que en espanol acierta casi siempre y falla en "sistema" —justo la
   * palabra que ya viene resuelta por el catalogo—.
   */
  const genero: "f" | "m" = propio
    ? (propio.toLowerCase().endsWith("a") ? "f" : "m")
    : porTipo.genero;
  const f = genero === "f";

  return {
    singular, plural, genero,
    el: f ? "la" : "el",
    un: f ? "una" : "un",
    algun: f ? "alguna" : "algún",
    ningun: f ? "ninguna" : "ningún",
    nuevo: f ? "Nueva" : "Nuevo",
    varios: f ? "varias" : "varios",
  };
}
