import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { instalacionDe, type ClaveInstalacion } from "./instalaciones";

/**
 * Los catálogos con los que arranca una empresa, según el tipo de instalación.
 *
 * Un restaurante no necesita «Desalineación de acoplamiento» ni «Maniobra con
 * grúa»; una flotilla no tiene «Climatización» pero sí «Frenos». Darle a todos
 * la misma lista industrial llenaba la cuenta de opciones que nadie usa y
 * escondía las que sí. Aquí cada tipo recibe una lista CORTA y pertinente, y
 * lo que falte se agrega desde Catálogos.
 *
 * Antes había tres listas distintas repartidas en el código —alta desde el
 * panel del operador, registro público y el botón de catálogos estándar— que
 * ya no coincidían entre sí. Ahora hay una.
 *
 * Tres cosas distintas que no deben confundirse:
 *
 *  - **Catálogo base del sistema**: estados de OT, prioridades, tipos de
 *    mantenimiento, tipos de medidor. Son constantes del código
 *    (`lib/constants.ts`), iguales para todos, y no se siembran.
 *  - **Catálogos de la empresa** (este archivo): categorías, códigos de falla,
 *    causas, especialidades, familias, unidades y servicios. Se siembran una
 *    vez, son de la empresa y los puede editar.
 *  - **Datos de ejemplo** (`lib/demo.ts`): equipos, planes y refacciones de
 *    muestra, marcados como demostración y removibles.
 *
 * Es aditivo e idempotente: no toca lo que ya exista con el mismo código.
 */

type Par = [string, string];
type Trio = [string, string, string];

export type CatalogosDeInstalacion = {
  categorias: Par[];
  codigosFalla: Trio[];
  causas: Trio[];
  especialidades: Par[];
  familias: Par[];
  unidades: Par[];
  servicios: Trio[];
};

// ─────────────────────────────────────── Lo común a cualquier instalación ───

export const UNIDADES: Par[] = [
  ["pza", "Pieza"], ["jgo", "Juego"], ["par", "Par"], ["kit", "Kit"],
  ["m", "Metro"], ["kg", "Kilogramo"], ["lt", "Litro"], ["gal", "Galón"],
  ["caja", "Caja"], ["rollo", "Rollo"],
];

const FALLAS_BASE: Trio[] = [
  ["ELE-01", "Falla eléctrica", "ELECTRICO"],
  ["FUGA-01", "Fuga de agua, aceite o gas", "FUGA"],
  ["DES-01", "Desgaste o rotura de componente", "MECANICO"],
  ["USO-01", "Uso indebido o daño", "OPERACION"],
  ["OTR-01", "Otra causa", "OTRO"],
];

const CAUSAS_BASE: Trio[] = [
  ["PREVENTIVO-OMITIDO", "Preventivo omitido o postergado", "MANTENIMIENTO"],
  ["FIN-VIDA-UTIL", "Fin de vida útil del componente", "DESGASTE"],
  ["USO-INDEBIDO", "Uso fuera de lo previsto", "OPERACION"],
  ["INSTALACION", "Instalación o montaje incorrecto", "INSTALACION"],
  ["ENERGIA", "Variación o falla de suministro eléctrico", "EXTERNO"],
  ["AMBIENTE", "Corrosión, humedad o ambiente agresivo", "AMBIENTE"],
  ["SIN-DETERMINAR", "Sin determinar", "OTRO"],
];

const FAMILIAS_BASE: Par[] = [
  ["ELECTRICO", "Material eléctrico"],
  ["TORNILLERIA", "Tornillería y sujeción"],
  ["CONSUMIBLES", "Consumibles"],
  ["OTRO", "Otros"],
];

const ESPECIALIDADES_BASE: Par[] = [
  ["GRAL", "Auxiliar de mantenimiento"],
  ["ELE", "Electricista"],
];

// ─────────────────────────────────────── Lo propio de cada instalación ───

/** Lo que se suma a lo común, por tipo. Corto a propósito. */
const PROPIO: Record<ClaveInstalacion, Partial<CatalogosDeInstalacion>> = {
  PLANTA: {
    categorias: [["PROD", "Equipo de producción"], ["AIRE", "Aire comprimido"], ["ELE", "Sistema eléctrico"], ["CLIMA", "Climatización y ventilación"], ["HID", "Hidráulico y sanitario"], ["MANI", "Manejo de materiales"], ["SEG", "Seguridad y contra incendio"]],
    codigosFalla: [["MEC-01", "Desgaste de rodamiento", "MECANICO"], ["MEC-02", "Desalineación", "MECANICO"], ["LUB-01", "Lubricación deficiente", "MECANICO"], ["NEU-01", "Fuga neumática", "NEUMATICO"], ["INS-01", "Sensor dañado o lectura fuera de rango", "INSTRUMENTACION"]],
    causas: [["LUB-NO-EJECUTADA", "Ruta de lubricación no ejecutada", "MANTENIMIENTO"], ["DESALINEACION", "Desalineación de acoplamiento", "INSTALACION"], ["SOBRECARGA", "Operación fuera de condiciones de diseño", "OPERACION"]],
    especialidades: [["MEC", "Mecánico"], ["INST", "Instrumentista"], ["SOLD", "Soldador"], ["AUT", "Automatización y control"]],
    familias: [["RODAMIENTOS", "Rodamientos y baleros"], ["SELLOS", "Sellos y retenes"], ["BANDAS", "Bandas y cadenas"], ["LUBRICANTES", "Lubricantes y grasas"], ["FILTROS", "Filtros"], ["NEUMATICO", "Componentes neumáticos"], ["HIDRAULICO", "Componentes hidráulicos"]],
    servicios: [["SRV-REB", "Rebobinado de motor eléctrico", "servicio"], ["SRV-ALI", "Alineación láser", "servicio"], ["SRV-VIB", "Análisis de vibraciones", "servicio"], ["SRV-TERM", "Termografía infrarroja", "servicio"]],
  },
  EDIFICIO: {
    categorias: [["CLIMA", "Climatización"], ["ELEV", "Elevadores y escaleras"], ["ELE", "Sistema eléctrico y planta de emergencia"], ["HID", "Hidráulico y sanitario"], ["SEG", "Seguridad y contra incendio"], ["ACC", "Control de acceso"], ["INM", "Inmueble y acabados"]],
    codigosFalla: [["CLI-01", "No enfría o no calienta", "CLIMA"], ["ELV-01", "Paro o falla de elevador", "ELEVACION"], ["HID-01", "Obstrucción o baja presión", "HIDRAULICO"]],
    especialidades: [["REF", "Refrigeración y aire acondicionado"], ["PLOM", "Plomero"], ["GEN", "Mantenimiento general de inmueble"]],
    familias: [["FILTROS", "Filtros de aire"], ["ILUMINACION", "Iluminación"], ["PLOMERIA", "Plomería y conexiones"], ["REFRIGERACION", "Refrigeración"]],
    servicios: [["SRV-ELEV", "Servicio de elevadores", "visita"], ["SRV-FUM", "Fumigación", "servicio"], ["SRV-EXT", "Recarga de extintores", "pieza"]],
  },
  PLAZA: {
    categorias: [["CLIMA", "Climatización"], ["ELEV", "Elevadores y escaleras eléctricas"], ["ELE", "Sistema eléctrico"], ["HID", "Hidráulico y sanitario"], ["SEG", "Seguridad y contra incendio"], ["ESTAC", "Estacionamiento"], ["COM", "Áreas comunes"]],
    codigosFalla: [["CLI-01", "No enfría o no calienta", "CLIMA"], ["ELV-01", "Paro de elevador o escalera", "ELEVACION"], ["HID-01", "Obstrucción o baja presión", "HIDRAULICO"]],
    especialidades: [["REF", "Refrigeración y aire acondicionado"], ["PLOM", "Plomero"], ["GEN", "Mantenimiento general de inmueble"]],
    familias: [["FILTROS", "Filtros de aire"], ["ILUMINACION", "Iluminación"], ["PLOMERIA", "Plomería y conexiones"]],
    servicios: [["SRV-ELEV", "Servicio de elevadores y escaleras", "visita"], ["SRV-FUM", "Fumigación", "servicio"]],
  },
  HOSPITAL: {
    categorias: [["BIOM", "Equipo biomédico"], ["GAS", "Gases medicinales"], ["CLIMA", "Climatización y presión de áreas"], ["ELE", "Sistema eléctrico y planta de emergencia"], ["HID", "Hidráulico y sanitario"], ["ELEV", "Elevadores"], ["SEG", "Seguridad y contra incendio"]],
    codigosFalla: [["CAL-01", "Fuera de calibración", "BIOMEDICO"], ["ALM-01", "Alarma o autodiagnóstico del equipo", "BIOMEDICO"], ["CLI-01", "No enfría o no calienta", "CLIMA"]],
    especialidades: [["BIOM", "Ingeniería biomédica"], ["REF", "Refrigeración y aire acondicionado"], ["PLOM", "Plomero"]],
    familias: [["FILTROS", "Filtros de aire y HEPA"], ["ILUMINACION", "Iluminación"], ["BIOMEDICO", "Refacciones biomédicas"]],
    servicios: [["SRV-CAL", "Calibración certificada", "equipo"], ["SRV-FAB", "Servicio del fabricante", "visita"], ["SRV-GAS", "Certificación de gases medicinales", "servicio"]],
  },
  ESCUELA: {
    categorias: [["CLIMA", "Climatización"], ["ELE", "Sistema eléctrico"], ["HID", "Hidráulico y sanitario"], ["SEG", "Seguridad y protección civil"], ["INM", "Aulas e inmueble"], ["DEP", "Instalaciones deportivas"], ["TIC", "Cómputo y audiovisual"]],
    codigosFalla: [["CLI-01", "No enfría o no calienta", "CLIMA"], ["MOB-01", "Mobiliario dañado", "INMUEBLE"]],
    especialidades: [["PLOM", "Plomero"], ["CARP", "Carpintero"], ["TIC", "Soporte técnico"]],
    familias: [["ILUMINACION", "Iluminación"], ["PLOMERIA", "Plomería y conexiones"], ["PINTURA", "Pintura y acabados"]],
    servicios: [["SRV-FUM", "Fumigación", "servicio"], ["SRV-EXT", "Recarga de extintores", "pieza"]],
  },
  DEPORTIVO: {
    categorias: [["ALB", "Albercas, filtros y bombeo"], ["CLIMA", "Climatización"], ["ELE", "Sistema eléctrico"], ["HID", "Hidráulico y sanitario"], ["GIM", "Equipo de gimnasio"], ["DEP", "Canchas e instalaciones"], ["SEG", "Seguridad"]],
    codigosFalla: [["ALB-01", "Agua fuera de parámetros", "ALBERCA"], ["GIM-01", "Equipo de gimnasio dañado", "MECANICO"]],
    especialidades: [["ALB", "Albercas y tratamiento de agua"], ["PLOM", "Plomero"]],
    familias: [["QUIMICOS", "Químicos de alberca"], ["FILTROS", "Filtros"], ["PLOMERIA", "Plomería y conexiones"]],
    servicios: [["SRV-GIM", "Servicio de equipo de gimnasio", "visita"], ["SRV-ALB", "Mantenimiento mayor de alberca", "servicio"]],
  },
  HOTEL: {
    categorias: [["HAB", "Habitaciones"], ["COC", "Cocina"], ["LAV", "Lavandería"], ["CLIMA", "Climatización"], ["ALB", "Alberca"], ["ELE", "Sistema eléctrico"], ["HID", "Hidráulico y agua caliente"], ["ELEV", "Elevadores"]],
    codigosFalla: [["CLI-01", "No enfría o no calienta", "CLIMA"], ["REF-01", "No enfría (refrigeración)", "REFRIGERACION"], ["AGU-01", "Sin agua caliente", "HIDRAULICO"]],
    especialidades: [["REF", "Refrigeración y aire acondicionado"], ["PLOM", "Plomero"], ["GEN", "Mantenimiento general"]],
    familias: [["FILTROS", "Filtros"], ["ILUMINACION", "Iluminación"], ["PLOMERIA", "Plomería y conexiones"], ["REFRIGERACION", "Refrigeración"]],
    servicios: [["SRV-ELEV", "Servicio de elevadores", "visita"], ["SRV-FUM", "Fumigación", "servicio"]],
  },
  RESTAURANTE: {
    categorias: [["COC", "Equipo de cocina"], ["REFR", "Refrigeración"], ["GAS", "Gas y combustión"], ["EXT", "Extracción y campanas"], ["CLIMA", "Climatización"], ["HID", "Hidráulico y sanitario"], ["ELE", "Sistema eléctrico"]],
    codigosFalla: [["REF-01", "No enfría", "REFRIGERACION"], ["GAS-01", "No enciende o flama irregular", "GAS"], ["EXT-01", "Extracción deficiente", "VENTILACION"]],
    especialidades: [["REF", "Refrigeración"], ["GAS", "Instalaciones de gas"]],
    familias: [["REFRIGERACION", "Refrigeración"], ["GAS", "Gas y quemadores"], ["FILTROS", "Filtros de campana"]],
    servicios: [["SRV-CAMP", "Limpieza de campana y ductos", "servicio"], ["SRV-FUM", "Fumigación", "servicio"]],
  },
  BODEGA: {
    categorias: [["MANI", "Montacargas y manejo de materiales"], ["RACK", "Racks y estanterías"], ["ANDEN", "Andenes y cortinas"], ["ELE", "Sistema eléctrico e iluminación"], ["SEG", "Seguridad y contra incendio"], ["CLIMA", "Ventilación"]],
    codigosFalla: [["MAN-01", "Falla de montacargas", "MECANICO"], ["RACK-01", "Rack golpeado o deformado", "ESTRUCTURA"], ["CORT-01", "Cortina o puerta dañada", "MECANICO"]],
    especialidades: [["MECA", "Mecánico de montacargas"]],
    familias: [["MONTACARGAS", "Refacciones de montacargas"], ["BATERIAS", "Baterías"], ["ILUMINACION", "Iluminación"]],
    servicios: [["SRV-MONT", "Servicio de montacargas", "visita"]],
  },
  FLOTILLA: {
    categorias: [["VEH", "Vehículos"], ["MAQ", "Maquinaria móvil"], ["LLANT", "Llantas"], ["TALL", "Equipo de taller"]],
    codigosFalla: [["MOT-01", "Falla de motor", "MOTOR"], ["FRE-01", "Frenos", "FRENOS"], ["LLA-01", "Ponchadura o desgaste de llanta", "LLANTAS"], ["SUS-01", "Suspensión y dirección", "SUSPENSION"], ["TRA-01", "Transmisión", "TRANSMISION"]],
    causas: [["KM-EXCEDIDO", "Servicio pasado de kilometraje", "MANTENIMIENTO"], ["CONDUCCION", "Forma de conducir", "OPERACION"]],
    especialidades: [["MECA", "Mecánico automotriz"], ["ELEA", "Eléctrico automotriz"], ["LLAN", "Llantero"]],
    familias: [["FILTROS", "Filtros"], ["LUBRICANTES", "Aceites y lubricantes"], ["LLANTAS", "Llantas"], ["FRENOS", "Frenos"], ["BATERIAS", "Baterías"]],
    servicios: [["SRV-VERIF", "Verificación vehicular", "vehículo"], ["SRV-ALIN", "Alineación y balanceo", "vehículo"]],
  },
  RESIDENCIAL: {
    categorias: [["ELEV", "Elevadores"], ["HID", "Bombeo y cisternas"], ["ELE", "Sistema eléctrico"], ["ALB", "Alberca"], ["ACC", "Control de acceso"], ["COM", "Áreas comunes"], ["JARD", "Jardinería"]],
    codigosFalla: [["BOM-01", "Bomba sin presión", "HIDRAULICO"], ["ACC-01", "Falla de acceso o portón", "ACCESO"]],
    especialidades: [["PLOM", "Plomero"], ["JARD", "Jardinero"]],
    familias: [["PLOMERIA", "Plomería y conexiones"], ["ILUMINACION", "Iluminación"]],
    servicios: [["SRV-ELEV", "Servicio de elevadores", "visita"], ["SRV-FUM", "Fumigación", "servicio"]],
  },
  OTRO: {
    categorias: [["ELE", "Sistema eléctrico"], ["CLIMA", "Climatización y ventilación"], ["HID", "Hidráulico y sanitario"], ["MEC", "Equipo mecánico"], ["SEG", "Seguridad y contra incendio"], ["INM", "Inmueble"]],
    especialidades: [["MEC", "Mecánico"], ["PLOM", "Plomero"]],
    familias: [["FILTROS", "Filtros"], ["PLOMERIA", "Plomería y conexiones"]],
    servicios: [["SRV-FAB", "Servicio del fabricante", "visita"]],
  },
};

/** El nombre del primer sitio, en el vocabulario de la instalación. */
const SITIO_INICIAL: Record<ClaveInstalacion, string> = {
  PLANTA: "Planta principal", EDIFICIO: "Edificio principal", PLAZA: "Plaza",
  HOSPITAL: "Hospital", ESCUELA: "Plantel principal", DEPORTIVO: "Club",
  HOTEL: "Hotel", RESTAURANTE: "Sucursal principal", BODEGA: "Bodega principal",
  FLOTILLA: "Base de operación", RESIDENCIAL: "Conjunto residencial", OTRO: "Sitio principal",
};

const claveDe = (tipo: string | null | undefined): ClaveInstalacion =>
  tipo && tipo in PROPIO ? (tipo as ClaveInstalacion) : "OTRO";

/** Lo que recibe una empresa de este tipo: lo común más lo propio, sin repetir códigos. */
export function catalogosPara(tipo: string | null | undefined): CatalogosDeInstalacion {
  const propio = PROPIO[claveDe(tipo)];
  const unir = <T extends [string, ...string[]]>(a: T[], b: T[] = []) => {
    const vistos = new Set<string>();
    return [...b, ...a].filter((x) => (vistos.has(x[0].toUpperCase()) ? false : (vistos.add(x[0].toUpperCase()), true)));
  };
  return {
    categorias: propio.categorias ?? [],
    codigosFalla: unir(FALLAS_BASE, propio.codigosFalla),
    causas: unir(CAUSAS_BASE, propio.causas),
    especialidades: unir(ESPECIALIDADES_BASE, propio.especialidades),
    familias: unir(FAMILIAS_BASE, propio.familias),
    unidades: UNIDADES,
    servicios: propio.servicios ?? [],
  };
}

export function sitioInicialPara(tipo: string | null | undefined) {
  return SITIO_INICIAL[claveDe(tipo)];
}

export type ResultadoSiembra = Record<keyof CatalogosDeInstalacion, number>;

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Siembra lo que falte del tipo de instalación. Devuelve cuántos creó de cada
 * catálogo. Si no se indica el tipo, se toma el de la empresa.
 */
export async function sembrarCatalogosEstandar(
  organizationId: string,
  tipo?: string | null,
  db: Db = prisma,
): Promise<ResultadoSiembra> {
  const tipoReal = tipo !== undefined
    ? tipo
    : (await db.organization.findUnique({ where: { id: organizationId }, select: { tipoInstalacion: true } }))?.tipoInstalacion;
  const c = catalogosPara(tipoReal);
  const nuevos = {} as ResultadoSiembra;

  const conCodigo = async <T extends [string, ...string[]]>(
    etiqueta: keyof CatalogosDeInstalacion,
    existentes: Promise<Array<{ code: string }>>,
    lista: T[],
    crear: (fila: T) => Promise<unknown>,
  ) => {
    const ya = new Set((await existentes).map((x) => x.code.toUpperCase()));
    const faltan = lista.filter((f) => !ya.has(f[0].toUpperCase()));
    for (const f of faltan) await crear(f);
    nuevos[etiqueta] = faltan.length;
  };

  await conCodigo("categorias", db.assetCategory.findMany({ where: { organizationId }, select: { code: true } }),
    c.categorias, ([code, name]) => db.assetCategory.create({ data: { organizationId, code, name } }));
  await conCodigo("familias", db.partCategory.findMany({ where: { organizationId }, select: { code: true } }),
    c.familias, ([code, name]) => db.partCategory.create({ data: { organizationId, code, name } }));
  await conCodigo("unidades", db.partUnit.findMany({ where: { organizationId }, select: { code: true } }),
    c.unidades, ([code, name]) => db.partUnit.create({ data: { organizationId, code, name } }));
  await conCodigo("especialidades", db.specialty.findMany({ where: { organizationId }, select: { code: true } }),
    c.especialidades, ([code, name]) => db.specialty.create({ data: { organizationId, code, name } }));
  await conCodigo("servicios", db.externalService.findMany({ where: { organizationId }, select: { code: true } }),
    c.servicios, ([code, name, unit]) => db.externalService.create({ data: { organizationId, code, name, unit } }));
  await conCodigo("codigosFalla", db.failureCode.findMany({ where: { organizationId }, select: { code: true } }),
    c.codigosFalla, ([code, description, category]) => db.failureCode.create({ data: { organizationId, code, description, category } }));
  await conCodigo("causas", db.rootCause.findMany({ where: { organizationId }, select: { code: true } }),
    c.causas, ([code, description, category]) => db.rootCause.create({ data: { organizationId, code, description, category } }));

  return nuevos;
}

/**
 * La estructura mínima para operar: el primer sitio, con el nombre que se usa
 * en esa instalación, y el almacén general. Es lo que agrega la opción
 * «estructura recomendada»; no se crea sola.
 */
export async function sembrarEstructura(organizationId: string, tipo: string | null | undefined, db: Db = prisma) {
  let sitio = await db.site.findFirst({ where: { organizationId }, orderBy: { createdAt: "asc" }, select: { id: true } });
  let sitioCreado = false;
  if (!sitio) {
    sitio = await db.site.create({
      data: { organizationId, code: "S01", name: sitioInicialPara(tipo), country: "Mexico" },
      select: { id: true },
    });
    sitioCreado = true;
  }
  let almacenCreado = false;
  const almacen = await db.warehouse.findFirst({ where: { organizationId, active: true }, select: { id: true } });
  if (!almacen) {
    await db.warehouse.create({
      data: { organizationId, siteId: sitio.id, code: "ALM-01", name: "Almacén general", esGeneral: true },
    });
    almacenCreado = true;
  }
  return { sitioId: sitio.id, sitioCreado, almacenCreado };
}

/** Para mostrar en pantalla qué recibiría cada tipo, sin sembrar nada. */
export function resumenDeCatalogos(tipo: string | null | undefined) {
  const c = catalogosPara(tipo);
  return {
    instalacion: instalacionDe(tipo).nombre,
    sitio: sitioInicialPara(tipo),
    conteos: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.length])) as Record<keyof CatalogosDeInstalacion, number>,
    categorias: c.categorias.map(([, n]) => n),
  };
}
