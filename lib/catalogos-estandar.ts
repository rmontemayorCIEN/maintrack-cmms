import { prisma } from "./db";

/**
 * Listas estandar con las que arranca una cuenta nueva.
 *
 * Un cliente recien dado de alta enfrenta cinco catalogos vacios y no sabe que
 * poner: es la primera pared de la implementacion. Estas listas son el punto
 * de partida razonable para cualquier giro; lo que no aplique se borra desde
 * Catalogos, que cuesta menos que inventarlas de cero.
 *
 * Es aditivo e idempotente: no toca lo que ya exista con el mismo codigo.
 */

export const FAMILIAS_REFACCION: Array<[string, string]> = [
  ["RODAMIENTOS", "Rodamientos y baleros"],
  ["SELLOS", "Sellos y retenes"],
  ["FILTROS", "Filtros"],
  ["LUBRICANTES", "Lubricantes y grasas"],
  ["BANDAS", "Bandas y cadenas"],
  ["ELECTRICO", "Material electrico"],
  ["MOTORES", "Motores y reductores"],
  ["NEUMATICO", "Componentes neumaticos"],
  ["HIDRAULICO", "Componentes hidraulicos"],
  ["INSTRUMENTACION", "Instrumentacion y sensores"],
  ["TORNILLERIA", "Tornilleria y sujecion"],
  ["TUBERIA", "Tuberia y conexiones"],
  ["CONSUMIBLES", "Consumibles de taller"],
  ["SEGURIDAD", "Equipo de proteccion personal"],
  ["OTRO", "Otros"],
];

export const UNIDADES: Array<[string, string]> = [
  ["pza", "Pieza"], ["jgo", "Juego"], ["par", "Par"], ["kit", "Kit"],
  ["m", "Metro"], ["m2", "Metro cuadrado"], ["kg", "Kilogramo"], ["g", "Gramo"],
  ["lt", "Litro"], ["ml", "Mililitro"], ["gal", "Galon"], ["caja", "Caja"],
  ["cubeta", "Cubeta"], ["bote", "Bote"], ["rollo", "Rollo"], ["tramo", "Tramo"],
];

/** Tarifa en cero a proposito: la hora-hombre la pone cada empresa. */
export const ESPECIALIDADES: Array<[string, string]> = [
  ["MEC", "Mecanico"], ["ELE", "Electricista"], ["INST", "Instrumentista"],
  ["SOLD", "Soldador"], ["HID", "Hidraulico / neumatico"],
  ["REF", "Refrigeracion y aire acondicionado"], ["AUT", "Automatizacion y control"],
  ["GRAL", "Auxiliar de mantenimiento"], ["PRED", "Analista predictivo"],
];

export const SERVICIOS_EXTERNOS: Array<[string, string, string]> = [
  ["SRV-REB", "Rebobinado de motor electrico", "servicio"],
  ["SRV-BAL", "Balanceo dinamico de rotor", "servicio"],
  ["SRV-ALI", "Alineacion laser", "servicio"],
  ["SRV-TERM", "Termografia infrarroja", "servicio"],
  ["SRV-VIB", "Analisis de vibraciones", "servicio"],
  ["SRV-ACE", "Analisis de aceite de laboratorio", "muestra"],
  ["SRV-CAL", "Calibracion certificada de instrumentos", "instrumento"],
  ["SRV-GRUA", "Maniobra con grua o montacargas", "jornada"],
  ["SRV-MAQ", "Maquinado y rectificado en taller externo", "servicio"],
  ["SRV-LIMP", "Limpieza industrial especializada", "jornada"],
  ["SRV-OBRA", "Obra civil y estructural", "jornada"],
  ["SRV-EXT", "Servicio de fabricante en sitio", "visita"],
];

export const CODIGOS_FALLA: Array<[string, string, string]> = [
  ["MEC-01", "Desgaste de rodamiento", "MECANICO"],
  ["MEC-02", "Desalineacion", "MECANICO"],
  ["MEC-03", "Rotura o fatiga de componente", "MECANICO"],
  ["LUB-01", "Lubricacion deficiente", "MECANICO"],
  ["ELE-01", "Falla en contactor o relevador", "ELECTRICO"],
  ["ELE-02", "Sobrecalentamiento de motor", "ELECTRICO"],
  ["ELE-03", "Corto circuito o falla de aislamiento", "ELECTRICO"],
  ["HID-01", "Fuga hidraulica", "HIDRAULICO"],
  ["NEU-01", "Fuga neumatica", "NEUMATICO"],
  ["INS-01", "Lectura fuera de rango o sensor danado", "INSTRUMENTACION"],
  ["OPE-01", "Error de operacion", "OPERACION"],
  ["OTR-01", "Otra causa", "OTRO"],
];

export const CAUSAS_RAIZ: Array<[string, string, string]> = [
  ["LUB-NO-EJECUTADA", "Ruta de lubricacion no ejecutada", "MANTENIMIENTO"],
  ["LUB-INCORRECTO", "Lubricante incorrecto o contaminado", "MANTENIMIENTO"],
  ["PREVENTIVO-OMITIDO", "Preventivo omitido o postergado", "MANTENIMIENTO"],
  ["DESALINEACION", "Desalineacion de acoplamiento", "INSTALACION"],
  ["MONTAJE", "Montaje o apriete incorrecto", "INSTALACION"],
  ["SOBRECARGA", "Operacion fuera de condiciones de diseño", "OPERACION"],
  ["FIN-VIDA-UTIL", "Fin de vida util del componente", "DESGASTE"],
  ["CORROSION", "Corrosion o ambiente agresivo", "AMBIENTE"],
  ["ENERGIA", "Variacion o falla de suministro electrico", "EXTERNO"],
  ["SIN-DETERMINAR", "Sin determinar", "OTRO"],
];

export const CATEGORIAS_ACTIVO: Array<[string, string]> = [
  ["ELE", "Sistema electrico"],
  ["CLIMA", "Climatizacion y ventilacion"],
  ["HID", "Hidraulico y sanitario"],
  ["MEC", "Equipo mecanico"],
  ["TRANS", "Transporte y elevacion"],
  ["SEG", "Seguridad y contra incendio"],
  ["PROD", "Equipo de produccion"],
  ["OTRO", "Otros"],
];

export type ResultadoSiembra = Record<string, number>;

/** Siembra lo que falte. Devuelve cuantos se crearon de cada catalogo. */
export async function sembrarCatalogosEstandar(organizationId: string): Promise<ResultadoSiembra> {
  const nuevos: ResultadoSiembra = {};

  const conCodigo = async <T>(
    etiqueta: string,
    existentes: Promise<Array<{ code: string }>>,
    lista: Array<[string, ...string[]]>,
    crear: (fila: [string, ...string[]]) => Promise<T>,
  ) => {
    const ya = new Set((await existentes).map((x) => x.code.toUpperCase()));
    const faltan = lista.filter((f) => !ya.has(f[0].toUpperCase()));
    for (const f of faltan) await crear(f);
    nuevos[etiqueta] = faltan.length;
  };

  await conCodigo("categorias", prisma.assetCategory.findMany({ where: { organizationId }, select: { code: true } }),
    CATEGORIAS_ACTIVO, ([code, name]) => prisma.assetCategory.create({ data: { organizationId, code, name } }));

  await conCodigo("familias", prisma.partCategory.findMany({ where: { organizationId }, select: { code: true } }),
    FAMILIAS_REFACCION, ([code, name]) => prisma.partCategory.create({ data: { organizationId, code, name } }));

  await conCodigo("unidades", prisma.partUnit.findMany({ where: { organizationId }, select: { code: true } }),
    UNIDADES, ([code, name]) => prisma.partUnit.create({ data: { organizationId, code, name } }));

  await conCodigo("especialidades", prisma.specialty.findMany({ where: { organizationId }, select: { code: true } }),
    ESPECIALIDADES, ([code, name]) => prisma.specialty.create({ data: { organizationId, code, name } }));

  await conCodigo("servicios", prisma.externalService.findMany({ where: { organizationId }, select: { code: true } }),
    SERVICIOS_EXTERNOS, ([code, name, unit]) => prisma.externalService.create({ data: { organizationId, code, name, unit } }));

  await conCodigo("codigosFalla", prisma.failureCode.findMany({ where: { organizationId }, select: { code: true } }),
    CODIGOS_FALLA, ([code, description, category]) => prisma.failureCode.create({ data: { organizationId, code, description, category } }));

  await conCodigo("causasRaiz", prisma.rootCause.findMany({ where: { organizationId }, select: { code: true } }),
    CAUSAS_RAIZ, ([code, description, category]) => prisma.rootCause.create({ data: { organizationId, code, description, category } }));

  return nuevos;
}
