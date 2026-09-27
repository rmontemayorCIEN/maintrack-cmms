import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { darDeAltaEmpresa } from "./alta-empresa";
import { aplicarMovimiento } from "./almacen";
import { altaDePlan } from "./alta-de-plan";
import { huellaDeSeguridad } from "./seguridad-ot";
import { registrarLectura } from "./medidores";
import { ingestSensorReading } from "./predictive";
import { generateScheduledWorkOrders } from "./scheduler";
import { recalcWorkOrder, transitionWorkOrder } from "./workorders";
import { siguienteFolio } from "./numbering";
import { aprobarSolicitud, rechazarSolicitud } from "./solicitudes";
import { autorizar, crearRequisicionDeCompra, elegirCotizacion, emitirOrdenDeCompra, recibir, registrarCotizacion } from "./compras";
import { detectar } from "./avisos/detectores";
import { configDe } from "./avisos/config";
import { guardarVigencia } from "./vigencias";
import { centroDeCostoDelActivo } from "./centro-de-costo";
import { logAudit } from "./audit";
import { sembrarCatalogosEstandar } from "./catalogos-estandar";
import { alertaAbierta } from "./alertas";

/**
 * La empresa demostrativa (Bloque 7).
 *
 * Una planta de envasado de bebidas: fácil de entender para cualquier
 * prospecto, con una línea que para cuando algo falla y servicios (aire,
 * vapor, frío, energía) que la sostienen. Trece equipos, ocho personas, diez
 * planes y 90 días de historia: suficiente para contar las cinco historias
 * sin saturar.
 *
 * Todo se crea por los mismos caminos que la operación real —aplicarMovimiento,
 * altaDePlan, registrarLectura, compras, el programador, las transiciones— y
 * en orden cronológico, para que el kardex, el costo promedio, los medidores
 * y los indicadores cuadren. Las fechas son relativas a «ahora»: restaurar la
 * demo la deja siempre al día.
 *
 * Nada aquí es real: nombres, correos (@demostrativa.maintrack.mx), proveedores y
 * cifras son de ejemplo.
 */

export const DEMO = {
  nombre: "Empresa demostrativa",
  slug: "empresa-demostrativa",
  dominio: "demostrativa.maintrack.mx",
  giro: "Alimentos y bebidas",
  tipoInstalacion: "PLANTA",
};

export const PERSONAS = [
  { clave: "direccion", nombre: "Mariana Salinas", puesto: "Directora de planta", rol: "OWNER", tarifa: 0 },
  { clave: "gerencia", nombre: "Ricardo Ibarra", puesto: "Gerente de mantenimiento", rol: "ADMIN", tarifa: 0 },
  { clave: "supervision", nombre: "Patricia Garza", puesto: "Supervisora de mantenimiento", rol: "SUPERVISOR", tarifa: 260 },
  { clave: "mecanico", nombre: "Luis Hernández", puesto: "Técnico mecánico", rol: "TECHNICIAN", tarifa: 210 },
  { clave: "electrico", nombre: "Diego Ramos", puesto: "Técnico electricista", rol: "TECHNICIAN", tarifa: 230 },
  { clave: "compras", nombre: "Sofía Medina", puesto: "Compradora", rol: "COMPRAS", tarifa: 0 },
  { clave: "operador", nombre: "Andrés Cantú", puesto: "Operador de llenado", rol: "REQUESTER", tarifa: 0 },
  { clave: "calidad", nombre: "Elena Rivas", puesto: "Jefa de calidad", rol: "VIEWER", tarifa: 0 },
] as const;
export type ClavePersona = (typeof PERSONAS)[number]["clave"];
export const correoDemo = (clave: ClavePersona, dominio = DEMO.dominio) => `${clave}@${dominio}`;

const UBICACIONES = [
  { code: "L1-LLE", name: "Línea 1 · Llenado", margen: 18000 },
  { code: "L1-EMP", name: "Línea 1 · Empaque", margen: 18000 },
  { code: "SRV", name: "Cuarto de servicios", margen: 0 },
  { code: "SUB", name: "Subestación eléctrica", margen: 0 },
  { code: "PAT", name: "Patio de maniobras", margen: 0 },
];

const ACTIVOS = [
  { code: "LLN-101", name: "Llenadora rotativa de 24 válvulas", loc: "L1-LLE", crit: "A", costo: 2_800_000, para: true, modelo: "Rotativa 24 válvulas, 12,000 botellas/h" },
  { code: "TAP-102", name: "Taponadora rotativa", loc: "L1-LLE", crit: "A", costo: 950_000, para: true, modelo: "8 cabezales" },
  { code: "ETQ-103", name: "Etiquetadora de manga termoencogible", loc: "L1-LLE", crit: "B", costo: 780_000, para: true, modelo: "Manga con túnel de vapor" },
  { code: "TRN-104", name: "Transportador de botellas", loc: "L1-LLE", crit: "B", costo: 240_000, para: true, modelo: "Banda modular, 18 m" },
  { code: "EMP-105", name: "Empacadora de cajas", loc: "L1-EMP", crit: "B", costo: 1_100_000, para: true, modelo: "Formadora y cerradora" },
  { code: "PAL-106", name: "Paletizadora semiautomática", loc: "L1-EMP", crit: "C", costo: 620_000, para: false, modelo: "Neumática" },
  { code: "CMP-201", name: "Compresor de tornillo 75 HP", loc: "SRV", crit: "A", costo: 690_000, para: true, modelo: "Tornillo lubricado, 75 HP" },
  { code: "SEC-202", name: "Secador de aire refrigerado", loc: "SRV", crit: "B", costo: 180_000, para: false, modelo: "350 pcm" },
  { code: "CAL-203", name: "Caldera de vapor 150 CC", loc: "SRV", crit: "A", costo: 1_450_000, para: true, modelo: "Pirotubular 150 CC" },
  { code: "CHL-204", name: "Chiller de agua helada 60 TR", loc: "SRV", crit: "A", costo: 1_250_000, para: true, modelo: "Enfriado por aire, 60 TR" },
  { code: "BOM-205", name: "Bomba de agua de proceso 15 HP", loc: "SRV", crit: "B", costo: 85_000, para: false, modelo: "Centrífuga, con bomba de respaldo" },
  { code: "SUB-206", name: "Transformador de subestación 500 kVA", loc: "SUB", crit: "A", costo: 900_000, para: true, modelo: "13.2 kV / 440 V" },
  { code: "MON-301", name: "Montacargas eléctrico 2.5 t", loc: "PAT", crit: "C", costo: 520_000, para: false, modelo: "Eléctrico, 48 V" },
];

/**
 * Los papeles que se vencen, con la historia que cuentan.
 *
 * Son seis a proposito, y con estados repartidos: uno VENCIDO, dos POR VENCER
 * y tres vigentes. Una demo con todo vigente no ensena para que sirve el
 * modulo, y una con todo vencido se lee como una planta mal llevada —que es lo
 * ultimo que uno quiere proyectar delante de un prospecto—.
 *
 * El permiso de la caldera vencido no es adorno: en Mexico una caldera sin
 * permiso vigente es una parada de planta, y es el ejemplo que hace entender
 * de un golpe por que esto no puede vivir en un Excel.
 *
 * La garantia de la llenadora esta VIGENTE porque es la que se ensena en vivo:
 * al abrir una correctiva de LLN-101 en la demostracion, el sistema advierte
 * que el proveedor todavia la cubre.
 *
 * `dias` es contra la fecha de la demo: negativo ya vencio.
 */
const VIGENCIAS = [
  { tipo: "GARANTIA", titulo: "Garantía de fábrica", folio: "G-2024-8841", activo: "LLN-101", prov: "rod", desdeDias: -300, dias: 240,
    cubre: "Cubre motor, tarjeta de control y válvulas de llenado. No cubre consumibles, empaques ni daño por sobretensión." },
  { tipo: "PERMISO", titulo: "Permiso de operación de caldera", folio: "STPS-RSP-4471", activo: "CAL-203", prov: null, desdeDias: -730, dias: -12,
    cubre: "Recipiente sujeto a presión. Requiere prueba hidrostática y dictamen de unidad verificadora para renovarse." },
  { tipo: "CONTRATO_SERVICIO", titulo: "Póliza de servicio del chiller", folio: "PS-KAPPA-2026", activo: "CHL-204", prov: "frio", desdeDias: -320, dias: 40,
    cubre: "Dos visitas preventivas al año y atención de urgencias en 24 h. No cubre refrigerante ni compresor." },
  { tipo: "LICENCIA", titulo: "Licencia de operador de montacargas", folio: "LIC-MTC-2026-19", persona: "mecanico", prov: null, desdeDias: -700, dias: 35,
    cubre: "Acreditación para operar montacargas eléctrico hasta 3 toneladas. Se renueva con curso y evaluación práctica." },
  { tipo: "POLIZA_SEGURO", titulo: "Póliza de daños de la subestación", folio: "POL-88-112340", activo: "SUB-206", prov: "elec", desdeDias: -120, dias: 245,
    cubre: "Daño eléctrico y por descarga atmosférica. Deducible de 10% con mínimo de 50 mil pesos." },
  { tipo: "CALIBRACION", titulo: "Calibración del manómetro de vapor", folio: "CAL-LAB-7781", activo: "CAL-203", prov: null, desdeDias: -90, dias: 275,
    cubre: "Certificado trazable a patrón nacional. Se agenda con el laboratorio con tres semanas de anticipación." },
] as const;

/**
 * Los centros de costo de la planta demostrativa, con claves que se ven como
 * las de una contabilidad de verdad.
 *
 * Tres y no uno: con uno solo la tabla de Reportes sale con un renglon y no
 * enseña para que sirve. Y el montacargas queda A PROPOSITO sin centro, para
 * que se vea el renglon «Sin centro de costo» —que es el que explica por que
 * la suma cuadra y por que conviene asignarlos todos—.
 */
/**
 * Las familias de equipo de la planta demostrativa.
 *
 * Sin ellas, el reporte de «preventivo contra correctivo por tipo de equipo»
 * —que es el corte por omision, y el que un gerente pide primero— salia entero
 * en «Sin asignar». La funcion existia y la demo no podia enseñarla.
 *
 * Siete para trece equipos: agrupadas mas grueso se pierde el contraste que
 * hace util el reporte (el aire comprimido se come todo el correctivo), y mas
 * fino queda un renglon por maquina, que ya es el Pareto de activos.
 */
const CATEGORIAS = [
  { code: "ENV", name: "Envasado" },
  { code: "EMP", name: "Empaque y paletizado" },
  { code: "AIR", name: "Aire comprimido" },
  { code: "TER", name: "Vapor y frío" },
  { code: "BOM", name: "Bombeo" },
  { code: "ELE", name: "Eléctrico" },
  { code: "MAN", name: "Manejo de materiales" },
] as const;

const CATEGORIA_POR_ACTIVO: Record<string, string> = {
  "LLN-101": "ENV", "TAP-102": "ENV", "ETQ-103": "ENV", "TRN-104": "ENV",
  "EMP-105": "EMP", "PAL-106": "EMP",
  "CMP-201": "AIR", "SEC-202": "AIR",
  "CAL-203": "TER", "CHL-204": "TER",
  "BOM-205": "BOM", "SUB-206": "ELE", "MON-301": "MAN",
};

const CENTROS_DE_COSTO = [
  { code: "5010-ENV", name: "Línea de envasado", descripcion: "Llenado, taponado, etiquetado y transporte de botella. Lo que para producción.", area: "L1" },
  { code: "5020-SERV", name: "Servicios auxiliares", descripcion: "Aire comprimido, vapor, agua helada y subestación. El gasto que sirve a toda la planta.", area: "SRV" },
  { code: "5030-EMP", name: "Empaque y embarque", descripcion: "Empacadora, paletizadora y maniobras de patio.", area: "EMP" },
] as const;

/** Qué centro le toca a cada equipo. El montacargas no lleva, a propósito. */
const CENTRO_POR_ACTIVO: Record<string, string> = {
  "LLN-101": "5010-ENV", "TAP-102": "5010-ENV", "ETQ-103": "5010-ENV", "TRN-104": "5010-ENV",
  "EMP-105": "5030-EMP", "PAL-106": "5030-EMP",
  "CMP-201": "5020-SERV", "SEC-202": "5020-SERV", "CAL-203": "5020-SERV",
  "CHL-204": "5020-SERV", "BOM-205": "5020-SERV", "SUB-206": "5020-SERV",
};

const PROVEEDORES = [
  { clave: "rod", name: "Rodamientos y Transmisiones Omega", leadTimeDays: 3 },
  { clave: "aire", name: "Aire Comprimido Industrial Delta", leadTimeDays: 7 },
  { clave: "elec", name: "Suministros Eléctricos Sigma", leadTimeDays: 5 },
  { clave: "frio", name: "Refrigeración Industrial Kappa", leadTimeDays: 2 },
];

// inicial: lo que había hace 90 días. El resto lo mueve la historia.
// Con familia a proposito: la franja del almacen agrupa por familia, y una
// demo sin familias la enseñaba en un solo renglon mudo. Es la primera
// pantalla de almacen que ve un prospecto.
const REFACCIONES = [
  { code: "KIT-VLL", familia: "Sellos y empaques", name: "Kit de empaques para válvula de llenado", unit: "pza", costo: 850, min: 4, inicial: 8, prov: "rod" },
  { code: "ROD-6205", familia: "Rodamientos", name: "Rodamiento 6205-2RS", unit: "pza", costo: 120, min: 6, inicial: 5, prov: "rod" },
  { code: "BND-TRN", familia: "Transmisión", name: "Banda modular para transportador (tramo de 1 m)", unit: "m", costo: 1450, min: 2, inicial: 4, prov: "rod" },
  { code: "SEN-FOT", familia: "Eléctrico", name: "Sensor fotoeléctrico difuso 24 V", unit: "pza", costo: 1980, min: 1, inicial: 2, prov: "elec" },
  { code: "FIL-ACE", familia: "Filtros", name: "Filtro de aceite para compresor", unit: "pza", costo: 1150, min: 2, inicial: 3, prov: "aire" },
  { code: "FIL-SEP", familia: "Filtros", name: "Elemento separador aire-aceite", unit: "pza", costo: 4800, min: 1, inicial: 0, prov: "aire" }, // agotado: historia 4
  { code: "ACE-CMP", familia: "Lubricantes", name: "Aceite sintético para compresor (cubeta 20 L)", unit: "pza", costo: 3900, min: 2, inicial: 3, prov: "aire" },
  // 30 y no 16: el preventivo la pide 18 veces en los 90 dias de historia
  // —semanal en la llenadora, mensual en taponadora y transportador— y con 16
  // el sembrado se quedaba sin existencia a media historia. Queda en 12, arriba
  // de su minimo, que es como se ve un almacen que si repone.
  { code: "GRS-ALI", familia: "Lubricantes", name: "Grasa grado alimenticio (cartucho 400 g)", unit: "pza", costo: 210, min: 10, inicial: 30, prov: "rod" },
  { code: "EMP-TAP", familia: "Sellos y empaques", name: "Juego de empaques para cabezal de taponadora", unit: "jgo", costo: 1600, min: 2, inicial: 3, prov: "rod" },
  { code: "FUS-30", familia: "Eléctrico", name: "Fusible 30 A clase J", unit: "pza", costo: 180, min: 6, inicial: 10, prov: "elec" },

  // ── Rodamientos ──
  { code: "ROD-6206", familia: "Rodamientos", name: "Rodamiento 6206-2RS", unit: "pza", costo: 165, min: 6, inicial: 14, prov: "rod" },
  { code: "ROD-6308", familia: "Rodamientos", name: "Rodamiento 6308-2Z", unit: "pza", costo: 340, min: 4, inicial: 0, prov: "rod" },
  { code: "CHU-35", familia: "Rodamientos", name: "Chumacera de pie 35 mm", unit: "pza", costo: 680, min: 3, inicial: 12, prov: "rod" },

  // ── Transmisión ──
  { code: "CAD-50", familia: "Transmisión", name: "Cadena de rodillos ASA 50 (tramo de 3 m)", unit: "m", costo: 1250, min: 2, inicial: 7, prov: "rod" },
  { code: "MTR-RED", familia: "Transmisión", name: "Motorreductor 1 HP para transportador", unit: "pza", costo: 8900, min: 1, inicial: 1, prov: "rod" },
  { code: "BND-V75", familia: "Transmisión", name: "Banda en V perfil B-75", unit: "pza", costo: 240, min: 4, inicial: 2, prov: "rod" },

  // ── Eléctrico ──
  { code: "RES-ETQ", familia: "Eléctrico", name: "Resistencia de 2 kW para túnel de manga", unit: "pza", costo: 890, min: 3, inicial: 1, prov: "elec" },
  { code: "CNT-40", familia: "Eléctrico", name: "Contactor 40 A con bobina de 24 V", unit: "pza", costo: 1450, min: 2, inicial: 4, prov: "elec" },
  { code: "VAR-3K", familia: "Eléctrico", name: "Variador de frecuencia 3 kW", unit: "pza", costo: 12800, min: 1, inicial: 0, prov: "elec" },

  // ── Filtros ──
  // La revision mensual de aire comprimido cubre dos equipos: seis al trimestre.
  { code: "FIL-AIR", familia: "Filtros", name: "Filtro de aire para compresor", unit: "pza", costo: 620, min: 3, inicial: 12, prov: "aire" },
  { code: "FIL-SEC", familia: "Filtros", name: "Filtro coalescente para secador", unit: "pza", costo: 980, min: 2, inicial: 1, prov: "aire" },
  { code: "FIL-AGU", familia: "Filtros", name: "Cartucho de filtro de agua de 10 pulgadas", unit: "pza", costo: 320, min: 6, inicial: 24, prov: "frio" },

  // ── Lubricantes ──
  { code: "ACE-RED", familia: "Lubricantes", name: "Aceite para reductores ISO 220 (cubeta 20 L)", unit: "pza", costo: 2400, min: 2, inicial: 3, prov: "rod" },
  { code: "REF-410", familia: "Lubricantes", name: "Refrigerante R-410A (cilindro de 11 kg)", unit: "pza", costo: 5600, min: 1, inicial: 2, prov: "frio" },

  // ── Sellos y empaques ──
  { code: "SEL-BOM", familia: "Sellos y empaques", name: "Sello mecánico para bomba de 15 HP", unit: "pza", costo: 1850, min: 2, inicial: 1, prov: "rod" },
  { code: "ORN-KIT", familia: "Sellos y empaques", name: "Juego surtido de o-rings de nitrilo", unit: "jgo", costo: 380, min: 3, inicial: 6, prov: "rod" },
  { code: "EMP-CAL", familia: "Sellos y empaques", name: "Empaque de tapa de registro para caldera", unit: "pza", costo: 740, min: 2, inicial: 2, prov: "aire" },

  // ── Neumática e hidráulica ──
  { code: "VAL-LLN", familia: "Neumática e hidráulica", name: "Válvula de llenado completa", unit: "pza", costo: 4200, min: 2, inicial: 3, prov: "rod" },
  { code: "CIL-NEU", familia: "Neumática e hidráulica", name: "Cilindro neumático 32 x 100 mm", unit: "pza", costo: 1350, min: 2, inicial: 0, prov: "aire" },
  { code: "ELV-52", familia: "Neumática e hidráulica", name: "Electroválvula 5/2 vías de 24 V", unit: "pza", costo: 980, min: 3, inicial: 5, prov: "aire" },
  // Sin minimo a proposito: un almacen real siempre trae algo sin capturar, y
  // la franja lo señala en gris —«no se sabe»— en vez de pintarlo de sano.
  { code: "MNG-AIR", familia: "Neumática e hidráulica", name: "Manguera de aire de 3/8 de pulgada (rollo de 15 m)", unit: "rollo", costo: 890, min: 0, inicial: 2, prov: "aire" },

  // ── Instrumentación ──
  { code: "MAN-16", familia: "Instrumentación", name: "Manómetro con glicerina 0-16 bar", unit: "pza", costo: 420, min: 4, inicial: 6, prov: "elec" },
  { code: "TRM-PT100", familia: "Instrumentación", name: "Termopar PT100 con vaina", unit: "pza", costo: 1680, min: 2, inicial: 2, prov: "elec" },
  { code: "SND-NIV", familia: "Instrumentación", name: "Sonda de nivel capacitiva", unit: "pza", costo: 3200, min: 0, inicial: 1, prov: "elec" },
];

// Clave interna → código del catálogo. Se usan los genéricos que trae toda empresa
// (lib/catalogos-estandar.ts) y solo se agregan los que faltan: nada duplicado.
const FALLAS = [
  { k: "FUG", code: "FUGA-01", description: "Fuga de agua, aceite o gas" }, { k: "DES", code: "DES-01", description: "Desgaste o rotura de componente" },
  { k: "SOB", code: "SOB-01", description: "Sobrecalentamiento" }, { k: "SEN", code: "ELE-01", description: "Falla eléctrica" },
  { k: "AJU", code: "AJU-01", description: "Desajuste" }, { k: "RUI", code: "RUI-01", description: "Ruido o vibración anormal" },
];
const CAUSAS = [
  { k: "DN", code: "FIN-VIDA-UTIL", description: "Fin de vida útil del componente" }, { k: "LUB", code: "LUBRICACION", description: "Lubricación deficiente" },
  { k: "SUC", code: "SUCIEDAD", description: "Suciedad o contaminación" }, { k: "AJI", code: "INSTALACION", description: "Instalación o montaje incorrecto" },
  { k: "OPE", code: "USO-INDEBIDO", description: "Uso fuera de lo previsto" }, { k: "VIB", code: "VIBRACION", description: "Aflojamiento por vibración" },
];

/** Los correctivos de los últimos 90 días: cada uno con su causa y su solución, no un texto repetido. */
const CORRECTIVOS = [
  { dias: 62, activo: "LLN-101", titulo: "Fuga de producto en la válvula de llenado 7", falla: "FUG", causa: "DN", horas: 1.5, paro: 45, quien: "mecanico", refacciones: [["KIT-VLL", 1]], solucion: "Se cambió el juego de empaques de la válvula 7; prueba de llenado sin fuga en 200 botellas." },
  { dias: 48, activo: "TRN-104", titulo: "La banda del transportador patina en la curva de salida", falla: "DES", causa: "AJI", horas: 2, paro: 90, quien: "mecanico", refacciones: [["BND-TRN", 1]], solucion: "Se reemplazó 1 m de banda con eslabones rotos y se ajustó la tensión según manual." },
  { dias: 35, activo: "CMP-201", titulo: "El compresor se dispara por alta temperatura", falla: "SOB", causa: "SUC", horas: 3, paro: 150, quien: "mecanico", refacciones: [], solucion: "Se lavó el enfriador de aceite, que estaba tapado de polvo; la temperatura de descarga bajó de 104 a 82 °C." },
  { dias: 28, activo: "EMP-105", titulo: "El sensor de caja no detecta y la empacadora se detiene", falla: "SEN", causa: "SUC", horas: 1, paro: 30, quien: "electrico", refacciones: [["SEN-FOT", 1]], solucion: "Lente del sensor opacado por cartón; se sustituyó el sensor y se agregó su limpieza a la rutina semanal." },
  { dias: 21, activo: "ETQ-103", titulo: "Etiqueta desalineada después del cambio de formato", falla: "AJU", causa: "OPE", horas: 0.75, paro: 20, quien: "mecanico", refacciones: [], solucion: "Se reajustó la guía de mangas a la medida de 600 ml y se dejó la medida anotada en el tablero." },
  { dias: 14, activo: "BOM-205", titulo: "Ruido en rodamientos de la bomba de agua de proceso", falla: "RUI", causa: "LUB", horas: 2.5, paro: 0, quien: "mecanico", refacciones: [["ROD-6205", 2]], solucion: "Se cambiaron los dos rodamientos y se lubricó; mientras tanto operó la bomba de respaldo, sin paro de línea." },
  { dias: 9, activo: "LLN-101", titulo: "Fuga de producto en la válvula de llenado 12", falla: "FUG", causa: "DN", horas: 1.25, paro: 35, quien: "mecanico", refacciones: [["KIT-VLL", 1]], solucion: "Se cambió el juego de empaques de la válvula 12. Segunda fuga en válvulas en dos meses: se revisará la frecuencia de cambio de empaques." },
  { dias: 5, activo: "CHL-204", titulo: "Baja presión de refrigerante en el chiller", falla: "FUG", causa: "VIB", horas: 3, paro: 120, quien: "electrico", refacciones: [], servicio: { prov: "frio", descripcion: "Localización de fuga, reapriete y recarga de refrigerante", costo: 6800 }, solucion: "El proveedor localizó una conexión aflojada por vibración, la reapretó y recargó refrigerante; presión normal." },
] as const;

type Plan = {
  clave: string; nombre: string; activos: string[]; tipo: "CALENDAR" | "METER"; cada: number; horas: number; paro: boolean; quien: ClavePersona;
  prioridad: string; ultimaHaceDias: number;
  /**
   * Lo que consume CADA actividad, no el plan.
   *
   * Estaba a nivel plan y el sembrador lo colgaba de la primera actividad,
   * que es un atajo: la grasa la pide la de lubricar, no la de medir
   * presion. Con el consumo en su actividad, la proyeccion de compras dice
   * la verdad —cada frecuencia tira de lo suyo— y el plan se lee como un
   * plan de verdad.
   */
  tareas: Array<{ t: string; tipo?: string; unit?: string; min?: number; max?: number; refs?: Array<[string, number]> }>;
  /**
   * Como se hace el trabajo y que cuidados tiene.
   *
   * No lo llevan todos los planes a proposito: una revision de bandas no
   * necesita un procedimiento escrito, y llenar de texto lo que no lo pide
   * enseña a saltarselo. Lo llevan los que de verdad tienen riesgo —equipo a
   * presion, energia almacenada, agua caliente— que es donde el tecnico
   * agradece leerlo y donde la confirmacion de haberlo leido significa algo.
   */
  procedimiento?: string;
  seguridad?: string;
};

/**
 * Todo lo que un plan consume en una visita: la suma de sus actividades.
 *
 * El historico de la demo carga a la orden lo que se gasto, y eso es la suma
 * de lo que pidio cada actividad. Antes venia de una lista a nivel plan, que
 * dejo de existir cuando el consumo se mudo a la actividad.
 */
function refaccionesDelPlan(p: Plan): Array<[string, number]> {
  const suma = new Map<string, number>();
  for (const t of p.tareas) for (const [code, q] of t.refs ?? []) suma.set(code, (suma.get(code) ?? 0) + q);
  return [...suma.entries()];
}

const PLANES: Plan[] = [
  { clave: "lln-lub", nombre: "Lubricación y revisión de válvulas de la llenadora", activos: ["LLN-101"], tipo: "CALENDAR", cada: 7, horas: 1.5, paro: true, quien: "mecanico", prioridad: "HIGH", ultimaHaceDias: 6,
    procedimiento:
      "Trabajo en zona de contacto con producto: manos limpias, guantes nuevos y grasa grado alimenticio. Nada de grasa común «porque es la que había».\n\n"
      + "Lubrique estrella y carrusel con el equipo detenido y bloqueado. Revise los empaques de las 24 válvulas uno por uno: uno vencido gotea y se ve como falla de llenado, no como fuga.\n\n"
      + "Mida la presión de llenado y déjela entre 1.8 y 2.4 bar. Fuera de rango, ajuste y vuelva a medir.\n\n"
      + "Termine con limpieza sanitaria y libere con calidad antes de devolver la línea.",
    seguridad:
      "Bloquee y etiquete el arrancador antes de meter las manos al carrusel: el giro puede arrancar por señal de la línea aunque el tablero local esté en manual.\n"
      + "Cada quien pone su propio candado. Si entran dos, van dos candados.\n"
      + "No retire las guardas fijas con la máquina energizada.",
    tareas: [{ t: "Lubricar estrella y carrusel con grasa grado alimenticio", refs: [["GRS-ALI", 1]] }, { t: "Revisar empaques de las 24 válvulas" }, { t: "Medir presión de llenado", tipo: "MEASUREMENT", unit: "bar", min: 1.8, max: 2.4 }, { t: "Limpieza sanitaria y liberación con calidad" }] },
  { clave: "tap", nombre: "Inspección mensual de la taponadora", activos: ["TAP-102"], tipo: "CALENDAR", cada: 30, horas: 2, paro: true, quien: "mecanico", prioridad: "HIGH", ultimaHaceDias: 25,
    tareas: [{ t: "Revisar desgaste de cabezales" }, { t: "Medir torque de tapado", tipo: "MEASUREMENT", unit: "N·m", min: 1.8, max: 2.6 }, { t: "Lubricar leva y guías", refs: [["GRS-ALI", 1]] }] },
  { clave: "etq", nombre: "Mantenimiento trimestral de la etiquetadora", activos: ["ETQ-103"], tipo: "CALENDAR", cada: 90, horas: 3, paro: true, quien: "mecanico", prioridad: "MEDIUM", ultimaHaceDias: 50,
    tareas: [{ t: "Limpiar túnel de vapor y boquillas" }, { t: "Revisar cuchillas de corte" }, { t: "Cambiar juego de o-rings del túnel", refs: [["ORN-KIT", 1]] }, { t: "Calibrar sensor de registro de manga" }] },
  { clave: "trn", nombre: "Revisión de bandas y rodillos del transportador", activos: ["TRN-104"], tipo: "CALENDAR", cada: 30, horas: 1, paro: false, quien: "mecanico", prioridad: "MEDIUM", ultimaHaceDias: 34,
    tareas: [{ t: "Revisar tensión y eslabones de la banda" }, { t: "Engrasar rodillos y chumaceras", refs: [["GRS-ALI", 1]] }, { t: "Revisar rodillos y guías laterales" }] },
  { clave: "cmp-aceite", nombre: "Cambio de aceite y filtros del compresor (cada 2,000 h)", activos: ["CMP-201"], tipo: "METER", cada: 2000, horas: 3, paro: true, quien: "mecanico", prioridad: "HIGH", ultimaHaceDias: 0,
    procedimiento:
      "Coordine el paro con producción: sin compresor se quedan sin aire la llenadora y la paletizadora.\n\n"
      + "Pare el equipo y déjelo templado, no frío ni caliente: alrededor de 40 °C el aceite escurre completo y no quema.\n\n"
      + "Drene por el tapón de fondo del tanque separador, cambie filtro de aceite y elemento separador, y limpie el asiento antes de montar el nuevo. "
      + "Apriete el filtro a mano más un cuarto de vuelta: apretado de más se deforma el sello y escurre.\n\n"
      + "Llene al nivel de la mirilla con el equipo parado, arranque y verifique a los 10 minutos: el nivel baja al llenarse el circuito.\n\n"
      + "Registre el horómetro al terminar. De ahí se cuentan las próximas 2,000 h.",
    seguridad:
      "Bloquee y etiquete (LOTO) el interruptor del compresor en el tablero y verifique ausencia de tensión antes de abrir nada.\n"
      + "DESPRESURICE el tanque separador y confirme el manómetro en cero antes de aflojar el tapón de drenado: el aceite sale a presión aunque el compresor esté apagado, y sale caliente.\n"
      + "No confíe en la purga automática para despresurizar; abra la válvula manual y escuche.\n"
      + "Aceite caliente: guantes y careta. Recoja el derrame antes de moverse, el piso queda resbaloso.",
    tareas: [{ t: "Cambiar aceite", refs: [["ACE-CMP", 1]] }, { t: "Cambiar filtro de aceite", refs: [["FIL-ACE", 1]] }, { t: "Cambiar elemento separador aire-aceite", refs: [["FIL-SEP", 1]] }, { t: "Registrar horómetro" }] },
  { clave: "aire", nombre: "Revisión mensual de compresor y secador", activos: ["CMP-201", "SEC-202"], tipo: "CALENDAR", cada: 30, horas: 1, paro: false, quien: "mecanico", prioridad: "MEDIUM", ultimaHaceDias: 27,
    tareas: [{ t: "Purgar condensados" }, { t: "Cambiar filtro de aire", refs: [["FIL-AIR", 1]] }, { t: "Revisar fugas de aire en tuberías y conexiones" }, { t: "Revisar indicadores de presión y temperatura" }] },
  { clave: "cal", nombre: "Revisión mensual de la caldera", activos: ["CAL-203"], tipo: "CALENDAR", cada: 30, horas: 2, paro: false, quien: "electrico", prioridad: "HIGH", ultimaHaceDias: 32,
    procedimiento:
      "Avise a producción antes de purgar: la purga de fondo baja la presión y el vapor tarda en recuperarse.\n\n"
      + "Purgue con la caldera a presión de trabajo y nivel normal, abriendo y cerrando rápido —purgas cortas y repetidas, no una larga—. "
      + "Después purgue la columna de nivel y verifique que el flotador regresa solo: si se queda pegado, el corte por bajo nivel no va a actuar.\n\n"
      + "Pruebe la válvula de seguridad levantando la palanca a presión de trabajo y suéltela; debe reasentar sin gotear. Si gotea, repórtelo: no la apriete.\n\n"
      + "Revise la flama por la mirilla: azul y estable. Amarilla o con hollín es aire mal ajustado y se corrige, no se deja para la próxima.",
    seguridad:
      "Equipo a presión, con agua arriba de 100 °C. Careta, guantes de carnaza y mangas largas para purgar; nunca con la línea de descarga obstruida ni apuntando a un paso de gente.\n"
      + "NO aísle ni puentee el corte por bajo nivel para «terminar más rápido»: es lo único que impide que la caldera trabaje en seco.\n"
      + "Si va a intervenir el control de nivel, saque la caldera de servicio y espere a que baje la presión. Con presión no se abre nada.\n"
      + "Cierre el gas antes de trabajar en el quemador y ventile antes de encender.",
    tareas: [{ t: "Purga de fondo y de columna de nivel" }, { t: "Probar válvula de seguridad" }, { t: "Medir presión de operación", tipo: "MEASUREMENT", unit: "kg/cm²", min: 7, max: 9 }, { t: "Revisar quemador y flama" }] },
  { clave: "chl", nombre: "Mantenimiento trimestral del chiller", activos: ["CHL-204"], tipo: "CALENDAR", cada: 90, horas: 4, paro: true, quien: "electrico", prioridad: "MEDIUM", ultimaHaceDias: 70,
    tareas: [{ t: "Limpiar condensadores" }, { t: "Cambiar cartuchos del filtro de agua", refs: [["FIL-AGU", 2]] }, { t: "Revisar presiones de alta y baja" }, { t: "Apretar conexiones eléctricas" }] },
  { clave: "sub", nombre: "Termografía semestral de la subestación", activos: ["SUB-206"], tipo: "CALENDAR", cada: 180, horas: 2, paro: false, quien: "electrico", prioridad: "MEDIUM", ultimaHaceDias: 120,
    tareas: [{ t: "Termografía de conexiones de media y baja tensión" }, { t: "Revisar nivel y temperatura del aceite del transformador", tipo: "MEASUREMENT", unit: "°C", min: 20, max: 80 }] },
  { clave: "mon", nombre: "Servicio del montacargas (cada 250 h)", activos: ["MON-301"], tipo: "METER", cada: 250, horas: 1.5, paro: false, quien: "electrico", prioridad: "MEDIUM", ultimaHaceDias: 0,
    tareas: [{ t: "Revisar nivel y densidad de la batería" }, { t: "Revisar frenos y cadenas del mástil" }, { t: "Lubricar puntos de engrase", refs: [["GRS-ALI", 1]] }] },
];

/** Horómetros: uso diario y en qué valor quedan hoy. Los planes por horas se calculan contra esto. */
const MEDIDORES = [
  { activo: "CMP-201", porDia: 20, hoy: 18_540, ultimoServicio: 16_600 }, // faltan 60 h: el cambio de aceite está por tocar
  { activo: "CAL-203", porDia: 16, hoy: 22_310, ultimoServicio: null },
  { activo: "MON-301", porDia: 6, hoy: 4_732, ultimoServicio: 4_500 }, // faltan 18 h
];

const DIA = 86_400_000;

type Contexto = {
  orgId: string; ahora: Date; almacenId: string; siteId: string;
  u: Record<ClavePersona, { id: string; rate: number }>;
  activo: Record<string, { id: string; locationId: string | null }>;
  parte: Record<string, { id: string; costo: number }>;
  prov: Record<string, string>;
  falla: Record<string, string>; causa: Record<string, string>;
};

const hace = (c: Contexto, dias: number, horas = 0) => new Date(c.ahora.getTime() - dias * DIA + horas * 3_600_000);

/** Mueve el almacén por el camino único y fecha el movimiento cuando ocurrió. */
async function mover(c: Contexto, cuando: Date, m: { code: string; tipo: "IN" | "OUT"; cantidad: number; costo?: number; referencia: string; workOrderId?: string; userId: string }) {
  await aplicarMovimiento({
    organizationId: c.orgId, partId: c.parte[m.code].id, warehouseId: c.almacenId, tipo: m.tipo, cantidad: m.cantidad,
    costoUnitario: m.costo, referencia: m.referencia, workOrderId: m.workOrderId ?? null, userId: m.userId,
  });
  const ultimo = await prisma.stockMovement.findFirst({ where: { organizationId: c.orgId, partId: c.parte[m.code].id }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (ultimo) await prisma.stockMovement.update({ where: { id: ultimo.id }, data: { createdAt: cuando } });
}

/** Una orden cerrada del pasado, con su tiempo, material, paro y costo calculado por el sistema. */
async function ordenCerrada(c: Contexto, o: {
  titulo: string; tipo: "PREVENTIVE" | "CORRECTIVE"; activo: string; prioridad: string; creada: Date; vence: Date; inicio: Date; horas: number; paroMin: number; paroPlaneado: boolean;
  quien: ClavePersona; solucion: string; tareas: Array<{ t: string; tipo?: string; unit?: string; min?: number; max?: number }>; refacciones: ReadonlyArray<readonly [string, number]>;
  planId?: string; falla?: string; causa?: string; servicio?: { prov: string; descripcion: string; costo: number };
}) {
  const tecnico = c.u[o.quien];
  const fin = new Date(o.inicio.getTime() + o.horas * 3_600_000);
  const cierre = new Date(fin.getTime() + 20 * 3_600_000);
  const folio = await siguienteFolio(c.orgId, "ordenTrabajo");
  const a = c.activo[o.activo];
  const esFalla = o.tipo === "CORRECTIVE";
  const wo = await prisma.workOrder.create({
    data: {
      organizationId: c.orgId, number: folio, title: o.titulo, maintenanceType: o.tipo, status: "CLOSED", priority: o.prioridad,
      assetId: a.id, siteId: c.siteId, locationId: a.locationId, planId: o.planId ?? null, assignedToId: tecnico.id, createdById: c.u.supervision.id,
      // Igual que el sistema: la orden hereda el centro del equipo.
      centroDeCostoId: await centroDeCostoDelActivo(c.orgId, a.id),
      createdAt: o.creada, dueDate: o.vence, startedAt: o.inicio, completedAt: fin, closedAt: cierre,
      responseMinutes: Math.round((o.inicio.getTime() - o.creada.getTime()) / 60_000), estimatedHours: o.horas, actualHours: o.horas,
      downtimeMinutes: o.paroMin, requiresShutdown: o.paroMin > 0, sinParoConfirmado: o.paroMin === 0,
      failureCodeId: esFalla ? c.falla[o.falla!] : null, rootCauseId: esFalla ? c.causa[o.causa!] : null, resolution: o.solucion,
      tasks: {
        create: o.tareas.map((t, i) => {
          const medida = t.tipo === "MEASUREMENT";
          const valor = medida ? Math.round(((t.min! + t.max!) / 2) * 10) / 10 : null;
          return {
            position: i, title: t.t, taskType: t.tipo ?? "CHECK", unit: t.unit ?? null, minValue: t.min ?? null, maxValue: t.max ?? null,
            maintenanceType: o.tipo, done: true, completedById: tecnico.id, completedAt: fin, resultNumber: valor, passed: medida ? true : null,
            ...(esFalla && i === 0 ? { failureCodeId: c.falla[o.falla!], rootCauseId: c.causa[o.causa!], downtimeMinutes: o.paroMin } : {}),
          };
        }),
      },
      labor: { create: { userId: tecnico.id, hours: o.horas, rate: tecnico.rate, cost: Math.round(o.horas * tecnico.rate * 100) / 100, workedAt: fin, notes: o.solucion.split(";")[0] } },
    },
  });
  for (const [code, cantidad] of o.refacciones) {
    await mover(c, fin, { code, tipo: "OUT", cantidad, referencia: folio, workOrderId: wo.id, userId: tecnico.id });
    const costo = (await prisma.part.findUniqueOrThrow({ where: { id: c.parte[code].id }, select: { unitCost: true } })).unitCost;
    await prisma.workOrderPart.create({ data: { workOrderId: wo.id, partId: c.parte[code].id, quantity: cantidad, unitCost: costo, cost: Math.round(costo * cantidad * 100) / 100 } });
  }
  if (o.servicio) {
    await prisma.workOrderService.create({ data: { workOrderId: wo.id, supplierId: c.prov[o.servicio.prov], descripcion: o.servicio.descripcion, quantity: 1, unitCost: o.servicio.costo, cost: o.servicio.costo, folioProveedor: `F-${folio.slice(-4)}`, createdAt: fin } });
  }
  if (o.paroMin > 0) {
    await prisma.downtimeEvent.create({ data: { organizationId: c.orgId, assetId: a.id, workOrderId: wo.id, startedAt: o.inicio, endedAt: new Date(o.inicio.getTime() + o.paroMin * 60_000), minutes: o.paroMin, planned: o.paroPlaneado, reason: o.titulo } });
  }
  await recalcWorkOrder(wo.id);
  return wo;
}

/** Crea la empresa demostrativa y la llena. Solo si no existe. */
/** `slug` y `dominio` distintos solo para las pruebas, que crean su propia demo desechable. */
export async function crearEmpresaDemostrativa(p: { contrasena: string; ahora?: Date; slug?: string; dominio?: string }) {
  const slug = p.slug ?? DEMO.slug;
  const dominio = p.dominio ?? DEMO.dominio;
  if (await prisma.organization.findUnique({ where: { slug } })) throw new Error(`Ya existe una empresa con el identificador «${slug}».`);
  const ocupados = await prisma.user.findMany({ where: { email: { in: PERSONAS.map((x) => correoDemo(x.clave, dominio)) } }, select: { email: true } });
  if (ocupados.length) throw new Error(`Esos correos ya existen en otra cuenta: ${ocupados.map((x) => x.email).join(", ")}. No se creó nada.`);
  const [primera, ...resto] = PERSONAS;
  const { org, responsable } = await darDeAltaEmpresa({
    nombre: DEMO.nombre, giro: DEMO.giro, tipoInstalacion: DEMO.tipoInstalacion, plan: "ENTERPRISE", diasPrueba: 0, slug, esDemo: true,
    responsable: { nombre: primera.nombre, correo: correoDemo(primera.clave, dominio), contrasena: p.contrasena, puesto: primera.puesto },
    modo: "VACIA", origen: "DEMO",
  });
  const { hashPassword } = await import("./auth");
  const hash = await hashPassword(p.contrasena);
  for (const x of resto) {
    await prisma.user.create({ data: { organizationId: org.id, email: correoDemo(x.clave, dominio), name: x.nombre, role: x.rol, jobTitle: x.puesto, hourlyRate: x.tarifa, passwordHash: hash } });
  }
  void responsable;
  await poblarDemo(org.id, p.ahora ?? new Date());
  return org;
}

/** Llena una empresa demostrativa vacía (recién creada o recién limpiada) con su historia. */
export async function poblarDemo(orgId: string, ahora = new Date()) {
  await prisma.organization.update({ where: { id: orgId }, data: { timezone: "America/Monterrey", montoAutorizacion: 5_000, esDemo: true, status: "ACTIVE", trialEndsAt: null } });
  const usuarios = await prisma.user.findMany({ where: { organizationId: orgId } });
  const u = Object.fromEntries(PERSONAS.map((x) => {
    // Por la parte local del correo: la demo de pruebas usa otro dominio.
    const usr = usuarios.find((y) => y.email.startsWith(`${x.clave}@`));
    if (!usr) throw new Error(`Falta el usuario demo ${x.clave}@…`);
    return [x.clave, { id: usr.id, rate: x.tarifa }];
  })) as Contexto["u"];
  // Las tarifas se reponen en cada restauración: la mano de obra de la historia se costea con ellas.
  for (const x of PERSONAS) if (x.tarifa) await prisma.user.update({ where: { id: u[x.clave].id }, data: { hourlyRate: x.tarifa } });

  const sitio = await prisma.site.create({ data: { organizationId: orgId, code: "PEN", name: "Planta de envasado", city: "Monterrey", timezone: "America/Monterrey" } });
  const locs: Record<string, string> = {};
  for (const l of UBICACIONES) locs[l.code] = (await prisma.location.create({ data: { organizationId: orgId, siteId: sitio.id, code: l.code, name: l.name, margenPorHora: l.margen } })).id;
  const almacen = await prisma.warehouse.create({ data: { organizationId: orgId, siteId: sitio.id, code: "ALM", name: "Almacén de refacciones", esGeneral: true, responsableId: u.compras.id } });
  const prov: Record<string, string> = {};
  for (const x of PROVEEDORES) prov[x.clave] = (await prisma.supplier.create({ data: { organizationId: orgId, name: x.name, leadTimeDays: x.leadTimeDays } })).id;

  const asegurar = async (modelo: "failureCode" | "rootCause", code: string, description: string) => {
    const tabla = prisma[modelo] as unknown as { findFirst: (a: unknown) => Promise<{ id: string } | null>; create: (a: unknown) => Promise<{ id: string }> };
    return (await tabla.findFirst({ where: { organizationId: orgId, code } }))?.id ?? (await tabla.create({ data: { organizationId: orgId, code, description } })).id;
  };
  const falla: Record<string, string> = {}, causa: Record<string, string> = {};
  for (const f of FALLAS) falla[f.k] = await asegurar("failureCode", f.code, f.description);
  for (const f of CAUSAS) causa[f.k] = await asegurar("rootCause", f.code, f.description);

  const activo: Contexto["activo"] = {};
  // Las familias de equipo y el eje contable, antes de los activos porque el
  // activo refiere a los dos.
  const categoria: Record<string, string> = {};
  for (const x of CATEGORIAS) {
    const cat = await prisma.assetCategory.create({
      data: { organizationId: orgId, code: x.code, name: x.name },
      select: { id: true },
    });
    categoria[x.code] = cat.id;
  }

  const centro: Record<string, string> = {};
  for (const x of CENTROS_DE_COSTO) {
    const cc = await prisma.centroDeCosto.create({
      data: { organizationId: orgId, code: x.code, name: x.name, descripcion: x.descripcion },
      select: { id: true },
    });
    centro[x.code] = cc.id;
  }

  for (const x of ACTIVOS) {
    const a = await prisma.asset.create({
      data: { organizationId: orgId, siteId: sitio.id, locationId: locs[x.loc], code: x.code, name: x.name, model: x.modelo, criticality: x.crit, detieneLinea: x.para,
        categoryId: categoria[CATEGORIA_POR_ACTIVO[x.code]] ?? null,
        centroDeCostoId: centro[CENTRO_POR_ACTIVO[x.code]] ?? null,
        purchaseCost: x.costo, replacementCost: Math.round(x.costo * 1.15), commissionedAt: new Date(ahora.getTime() - 6 * 365 * DIA), expectedLifeYears: 15 },
    });
    activo[x.code] = { id: a.id, locationId: a.locationId };
  }
  const parte: Contexto["parte"] = {};
  for (const x of REFACCIONES) {
    const pt = await prisma.part.create({ data: { organizationId: orgId, supplierId: prov[x.prov], code: x.code, name: x.name, category: x.familia, unit: x.unit, unitCost: x.costo, minQuantity: x.min, maxQuantity: x.min * 3 } });
    await prisma.partStock.create({ data: { organizationId: orgId, partId: pt.id, warehouseId: almacen.id, quantity: 0, minQuantity: x.min, maxQuantity: x.min * 3 } });
    parte[x.code] = { id: pt.id, costo: x.costo };
  }
  const c: Contexto = { orgId, ahora, almacenId: almacen.id, siteId: sitio.id, u, activo, parte, prov, falla, causa };

  // ── Inventario inicial, hace 90 días.
  for (const x of REFACCIONES) if (x.inicial > 0) await mover(c, hace(c, 90, -2), { code: x.code, tipo: "IN", cantidad: x.inicial, costo: x.costo, referencia: "Inventario inicial", userId: u.compras.id });

  // ── Medidores con lecturas cada 3 días (60 días) hasta el valor de hoy.
  const medidores: Record<string, string> = {};
  for (const m of MEDIDORES) {
    const inicio = m.hoy - m.porDia * 60;
    const med = await prisma.meter.create({ data: { organizationId: orgId, assetId: activo[m.activo].id, name: "Horómetro", unit: "h", tipo: "HOROMETRO", currentValue: inicio, valorInicial: inicio, valorInicialEl: hace(c, 60), lastReadingAt: hace(c, 60), maxIncrementoDiario: 24 } });
    medidores[m.activo] = med.id;
    for (let d = 57; d >= 0; d -= 3) {
      const cuando = hace(c, d, d === 0 ? -1 : 0);
      await registrarLectura({ organizationId: orgId, meterId: med.id, userId: u.mecanico.id, value: m.hoy - m.porDia * d, readingAt: cuando, ahora: cuando, source: "MANUAL" });
    }
  }

  // ── Planes, con su última ejecución.
  const planes: Record<string, { id: string }> = {};
  for (const p of PLANES) {
    const alta = await altaDePlan(orgId, u.supervision.id, {
      name: p.nombre, maintenanceType: "PREVENTIVE", triggerType: p.tipo, intervalDays: p.tipo === "CALENDAR" ? p.cada : null, intervalMeter: p.tipo === "METER" ? p.cada : null,
      leadTimeDays: p.tipo === "METER" ? 7 : 3, toleranceDays: 2, priority: p.prioridad, estimatedHours: p.horas, requiresShutdown: p.paro, active: true, assignedToId: u[p.quien].id,
      // El programador copia esto a cada orden que nace del plan.
      procedure: p.procedimiento ?? null, safetyNotes: p.seguridad ?? null,
      assetIds: p.activos.map((x) => activo[x].id), desde: p.tipo === "CALENDAR" ? dia(hace(c, p.ultimaHaceDias)) : null, desdeEsUltima: true,
      tasks: p.tareas.map((t) => ({
        title: t.t, taskType: t.tipo ?? "CHECK", unit: t.unit ?? null, minValue: t.min ?? null, maxValue: t.max ?? null, required: true,
        labor: [], services: [], parts: (t.refs ?? []).map(([code, q]) => ({ partId: parte[code].id, quantity: q })),
      })),
    });
    if ("error" in alta) throw new Error(`Plan «${p.nombre}»: ${alta.error}`);
    planes[p.clave] = alta.plan;
    if (p.tipo === "METER") {
      const m = MEDIDORES.find((x) => x.activo === p.activos[0])!;
      await prisma.planAsset.updateMany({ where: { planId: alta.plan.id }, data: { meterId: medidores[m.activo], nextDueMeter: (m.ultimoServicio ?? m.hoy) + p.cada, lastCompletedAt: hace(c, Math.round((m.hoy - (m.ultimoServicio ?? m.hoy)) / m.porDia)) } });
    }
  }

  // ── La historia: preventivos a su ritmo y correctivos, en orden cronológico.
  type Evento = { cuando: Date; hacer: () => Promise<unknown> };
  const eventos: Evento[] = [];
  for (const p of PLANES.filter((x) => x.tipo === "CALENDAR")) {
    for (const cod of p.activos) {
      for (let d = p.ultimaHaceDias, n = 0; d <= 90; d += p.cada, n++) {
        const inicio = hace(c, d, 9 + (n % 3));
        // Uno de cada ocho preventivos se hizo tarde: el cumplimiento no es perfecto, y así se ve.
        const tarde = n % 8 === 5;
        eventos.push({ cuando: inicio, hacer: () => ordenCerrada(c, {
          titulo: p.nombre, tipo: "PREVENTIVE", activo: cod, prioridad: p.prioridad, creada: hace(c, d + 5), vence: hace(c, tarde ? d + 3 : d - 1),
          inicio, horas: p.horas, paroMin: p.paro ? Math.round(p.horas * 60) : 0, paroPlaneado: true, quien: p.quien,
          solucion: `Rutina completa. ${p.tareas.length} actividades sin hallazgos que requieran correctivo.`, tareas: p.tareas, refacciones: refaccionesDelPlan(p), planId: planes[p.clave].id,
        }) });
      }
    }
  }
  // Los preventivos por horas que ya se hicieron: el último servicio del compresor y del montacargas.
  for (const p of PLANES.filter((x) => x.tipo === "METER")) {
    const m = MEDIDORES.find((x) => x.activo === p.activos[0])!;
    const diasAtras = Math.round((m.hoy - (m.ultimoServicio ?? m.hoy)) / m.porDia);
    if (diasAtras > 90 || !m.ultimoServicio) continue;
    const inicio = hace(c, diasAtras, 8);
    eventos.push({ cuando: inicio, hacer: () => ordenCerrada(c, {
      titulo: p.nombre, tipo: "PREVENTIVE", activo: p.activos[0], prioridad: p.prioridad, creada: hace(c, diasAtras + 3), vence: hace(c, diasAtras - 1),
      inicio, horas: p.horas, paroMin: p.paro ? Math.round(p.horas * 60) : 0, paroPlaneado: true, quien: p.quien,
      solucion: `Servicio completo a ${m.ultimoServicio!.toLocaleString("es-MX")} h de horómetro.`, tareas: p.tareas,
      // El separador del compresor se cambia en cada servicio; el montacargas solo lleva grasa.
      refacciones: refaccionesDelPlan(p), planId: planes[p.clave].id,
    }) });
  }
  for (const k of CORRECTIVOS) {
    const inicio = hace(c, k.dias, 10);
    eventos.push({ cuando: inicio, hacer: () => ordenCerrada(c, {
      titulo: k.titulo, tipo: "CORRECTIVE", activo: k.activo, prioridad: k.paro > 60 ? "HIGH" : "MEDIUM", creada: new Date(inicio.getTime() - 40 * 60_000), vence: new Date(inicio.getTime() + DIA),
      inicio, horas: k.horas, paroMin: k.paro, paroPlaneado: false, quien: k.quien, solucion: k.solucion,
      tareas: [{ t: "Localizar y corregir la falla; probar el equipo antes de entregarlo" }], refacciones: k.refacciones, falla: k.falla, causa: k.causa,
      servicio: "servicio" in k ? k.servicio : undefined,
    }) });
  }
  // Una compra completa de hace un mes: rodamientos y grasa, del proveedor al almacén.
  eventos.push({ cuando: hace(c, 30), hacer: () => compraCompleta(c) });
  eventos.sort((a, b) => a.cuando.getTime() - b.cuando.getTime());
  for (const e of eventos) await e.hacer();
  // Cada asignación sabe cuándo se hizo por última vez: la última orden cerrada de su plan en ese equipo.
  for (const pa of await prisma.planAsset.findMany({ where: { organizationId: orgId } })) {
    const ultima = await prisma.workOrder.findFirst({ where: { organizationId: orgId, planId: pa.planId, assetId: pa.assetId, status: "CLOSED" }, orderBy: { completedAt: "desc" }, select: { completedAt: true } });
    if (ultima?.completedAt) await prisma.planAsset.update({ where: { id: pa.id }, data: { lastCompletedAt: ultima.completedAt, ejecuciones: await prisma.workOrder.count({ where: { planId: pa.planId, assetId: pa.assetId, status: "CLOSED" } }) } });
  }

  // ── Condición: temperatura de descarga del compresor, 30 días, subiendo otra vez.
  const temp = await prisma.sensor.create({ data: { organizationId: orgId, assetId: activo["CMP-201"].id, name: "Temperatura de descarga", sensorType: "TEMPERATURE", unit: "°C", warningThreshold: 95, criticalThreshold: 105, direction: "ABOVE", samplingHours: 12 } });
  const vib = await prisma.sensor.create({ data: { organizationId: orgId, assetId: activo["BOM-205"].id, name: "Vibración en rodamiento lado acople", sensorType: "VIBRATION", unit: "mm/s", warningThreshold: 4.5, criticalThreshold: 7.1, direction: "ABOVE", samplingHours: 24 } });
  for (let h = 30 * 24; h >= 0; h -= 12) {
    const cuando = new Date(ahora.getTime() - h * 3_600_000);
    const dias = h / 24;
    // Después de lavar el enfriador (hace 35 días) quedó en 82 °C; sube ~0.5 °C diarios y cruza 95 °C hace un par de días.
    const valor = Math.round((82 + (30 - dias) * 0.47 + Math.sin(h / 7) * 0.6) * 10) / 10;
    await ingestSensorReading({ organizationId: orgId, sensorId: temp.id, value: valor, readingAt: cuando, ahora: cuando, source: "MANUAL", autoWorkOrder: false });
    if (h % 24 === 0) await ingestSensorReading({ organizationId: orgId, sensorId: vib.id, value: Math.round((1.8 + Math.sin(h / 30) * 0.3) * 10) / 10, readingAt: cuando, ahora: cuando, source: "MANUAL", autoWorkOrder: false });
  }

  // ── Solicitudes de hoy y de los últimos días.
  const solicitud = async (titulo: string, codigo: string, horasAtras: number, prioridad = "MEDIUM", descripcion?: string) => prisma.workRequest.create({
    data: { organizationId: orgId, number: await siguienteFolio(orgId, "solicitud"), title: titulo, description: descripcion ?? null, assetId: activo[codigo].id, siteId: sitio.id,
      locationId: activo[codigo].locationId, priority: prioridad, requestedById: u.operador.id, createdAt: new Date(ahora.getTime() - horasAtras * 3_600_000) },
  });
  // Historia 1 empieza aquí: el operador acaba de reportar.
  await solicitud("Gotea producto por una válvula de la llenadora", "LLN-101", 1, "HIGH", "En la válvula 18 se ve un chorro fino cuando llena. Se está desperdiciando producto.");
  await solicitud("El montacargas hace ruido al levantar", "MON-301", 20, "MEDIUM", "Rechina el mástil cuando sube la tarima.");
  const convertida = await solicitud("La etiquetadora arruga la manga en botellas de 600 ml", "ETQ-103", 30, "HIGH");
  await aprobarSolicitud({ organizationId: orgId, userId: u.supervision.id, solicitudId: convertida.id, assignedToId: u.mecanico.id, dueDate: new Date(ahora.getTime() + DIA).toISOString(), reviewNotes: "Se programa para mañana a primera hora." });
  const rechazada = await solicitud("Pintar de nuevo las líneas del piso en empaque", "EMP-105", 50, "LOW");
  await rechazarSolicitud({ organizationId: orgId, userId: u.supervision.id, solicitudId: rechazada.id, motivo: "No es mantenimiento de equipo: se turnó a Seguridad e Higiene." });

  // ── Trabajo abierto hoy: lo que genera el programador, más correctivos en curso.
  await generateScheduledWorkOrders(orgId, { userId: u.supervision.id });
  const abiertas = await prisma.workOrder.findMany({ where: { organizationId: orgId, status: { notIn: ["CLOSED", "CANCELLED"] } }, include: { asset: { select: { code: true } } } });
  const mover2 = async (id: string | undefined, a: string, quien: ClavePersona, extra: Record<string, unknown> = {}) => {
    if (!id) return;
    const persona = PERSONAS.find((x) => x.clave === quien)!;
    await transitionWorkOrder({ workOrderId: id, to: a, userId: u[quien].id, organizationId: orgId, rol: persona.rol, ...extra } as Parameters<typeof transitionWorkOrder>[0]);
  };
  // Revisión mensual del compresor: el mecánico ya la empezó.
  await mover2(abiertas.find((w) => w.planId === planes.aire.id && w.asset?.code === "CMP-201")?.id, "IN_PROGRESS", "mecanico");
  // El cambio de aceite por horas está detenido: no hay elemento separador (historia 4).
  const aceite = abiertas.find((w) => w.planId === planes["cmp-aceite"].id);
  if (aceite) {
    await mover2(aceite.id, "ON_HOLD", "supervision", { motivo: "Falta el elemento separador aire-aceite: no hay existencia." });
    // La actividad queda bloqueada por esa refacción: así la ve la dirección en «Situación crítica».
    await prisma.workOrderTask.updateMany({ where: { workOrderId: aceite.id, title: { contains: "separador" } }, data: { bloqueadaPorPartId: parte["FIL-SEP"].id } });
  }

  // Correctivos abiertos.
  const correctivo = async (
    titulo: string, codigo: string, quien: ClavePersona | null, prioridad: string,
    horasAtras: number, venceEnDias: number,
    // Lo que hay que saber y cuidar. No todas lo llevan: una correctiva de
    // diagnostico no necesita procedimiento escrito, y ponerlo en todas
    // enseña a saltarselo.
    con: { procedimiento?: string; seguridad?: string } = {},
  ) => prisma.workOrder.create({
    data: { organizationId: orgId, number: await siguienteFolio(orgId, "ordenTrabajo"), title: titulo, maintenanceType: "CORRECTIVE", status: quien ? "ASSIGNED" : "OPEN", priority: prioridad,
      procedure: con.procedimiento ?? null, safetyNotes: con.seguridad ?? null,
      assetId: activo[codigo].id, siteId: sitio.id, locationId: activo[codigo].locationId, assignedToId: quien ? u[quien].id : null, createdById: u.supervision.id,
      // La demo hereda el centro igual que el sistema: si no, el reporte de
      // contabilidad sale entero en «Sin centro de costo» y no enseña nada.
      centroDeCostoId: centro[CENTRO_POR_ACTIVO[codigo]] ?? null,
      createdAt: new Date(ahora.getTime() - horasAtras * 3_600_000), dueDate: new Date(ahora.getTime() + venceEnDias * DIA), estimatedHours: 2,
      tasks: { create: [{ position: 0, title: "Localizar y corregir la falla; probar el equipo antes de entregarlo", maintenanceType: "CORRECTIVE" }] } },
  });
  const ruido = await correctivo("Revisar ruido en el motorreductor del transportador", "TRN-104", "electrico", "MEDIUM", 26, 1, {
    procedimiento:
      "Escuche primero con el equipo en marcha y la guarda puesta: identifique si el ruido viene del motor, del reductor o del acoplamiento antes de desarmar nada.\n\n"
      + "Mida temperatura de chumaceras con el infrarrojo y compare los dos lados; una diferencia grande apunta a rodamiento.\n\n"
      + "Con el equipo bloqueado, revise nivel y estado del aceite del reductor —si sale lechoso hay agua, si sale con brillo metálico hay desgaste—, la tensión de la cadena y la alineación.",
    seguridad:
      "Bloquee y etiquete (LOTO) el interruptor en el tablero y verifique ausencia de tensión antes de abrir la caja de conexiones o retirar la guarda.\n"
      + "Las mediciones con el equipo en marcha se hacen CON la guarda puesta. Si para medir hay que quitarla, no se mide en marcha.\n"
      + "Nada de ropa suelta ni guantes flojos cerca de la transmisión.",
  });
  await mover2(ruido.id, "IN_PROGRESS", "electrico");
  await correctivo("Alarma intermitente de nivel en el tanque de condensados", "CAL-203", null, "MEDIUM", 5, 2, {
    procedimiento:
      "Intermitente casi nunca es el transmisor: revise primero el flotador y la columna, que se ensucian y se pegan.\n\n"
      + "Purgue la columna de nivel y compruebe que el flotador baja y sube solo. Después revise continuidad y aterrizamiento del transmisor; una señal que fluctúa con la bomba encendida es problema de tierra, no de nivel.",
    seguridad:
      "NO aísle la alarma «mientras se arregla». Esa alarma es la que avisa que el tanque se está quedando sin agua, y una caldera sin agua de reposición se queda seca en minutos.\n"
      + "Si hay que sacarla de servicio para intervenirla, avise a producción y deje a alguien vigilando el nivel a la vista.\n"
      + "Condensado caliente: guantes y careta al purgar la columna.",
  });
  // Un trabajo ya terminado por el técnico que espera la revisión de supervisión.
  const cilindro = await correctivo("Fuga de aire en el cilindro de la paletizadora", "PAL-106", "electrico", "MEDIUM", 30, 1, {
    procedimiento:
      "Localice la fuga con agua jabonosa y el circuito presurizado, antes de desconectar nada: una vez desarmado ya no se ve de dónde salía.\n\n"
      + "Si es por el vástago, son los sellos; si es por las conexiones, casi siempre es el racor o la manguera mordida.\n\n"
      + "Al armar, limpie el vástago y no use herramienta sobre el cromado: una raya vuelve a cortar el sello nuevo.",
    seguridad:
      "DESPRESURICE el circuito y purgue el acumulador antes de desconectar mangueras: un cilindro con aire retenido se mueve solo al aflojar una conexión, y mueve lo que tenga encima.\n"
      + "Bloquee la válvula de corte de aire de la paletizadora y verifique el manómetro en cero.\n"
      + "Asegure mecánicamente el brazo si queda en alto; no confíe en que se quede por su peso.",
  });
  await mover2(cilindro.id, "IN_PROGRESS", "electrico");
  /*
   * El electrico confirmo haber leido la seguridad antes de meter mano, que
   * es el orden real: se lee, se bloquea, se trabaja. Asi la demo enseña el
   * chip en verde y no solo el ambar de las que nadie ha confirmado.
   */
  await prisma.workOrder.update({
    where: { id: cilindro.id },
    data: {
      seguridadLeidaPorId: u.electrico.id,
      seguridadLeidaEl: new Date(ahora.getTime() - 29 * 3_600_000),
      seguridadLeidaHuella: huellaDeSeguridad({ procedure: cilindro.procedure, safetyNotes: cilindro.safetyNotes }),
    },
  });
  await prisma.workOrderLabor.create({ data: { workOrderId: cilindro.id, userId: u.electrico.id, hours: 1, rate: 230, cost: 230, notes: "Cambio de sellos del cilindro" } });
  await prisma.workOrderTask.updateMany({ where: { workOrderId: cilindro.id }, data: { done: true, completedById: u.electrico.id, completedAt: ahora } });
  await mover2(cilindro.id, "COMPLETED", "electrico", {
    resolution: "Se cambiaron los sellos del cilindro de empuje; sin fugas a 6 bar.",
    fallas: [{ taskId: (await prisma.workOrderTask.findFirst({ where: { workOrderId: cilindro.id, position: 0 } }))!.id, failureCodeId: falla.FUG, rootCauseId: causa.DN, downtimeMinutes: 0 }],
    sinParoConfirmado: true,
  });

  // Compras: el cambio de aceite necesita una requisición que espera la firma de dirección.
  await crearRequisicionDeCompra({
    organizationId: orgId, userId: u.compras.id, warehouseId: almacen.id, proveedorSugeridoId: prov.aire, urgencia: "NORMAL", montoAutorizacion: 5_000,
    justificacion: "Aceite para los próximos dos cambios del compresor (plan por horas).",
    renglones: [{ partId: parte["ACE-CMP"].id, descripcion: "Aceite sintético para compresor (cubeta 20 L)", cantidadSolicitada: 4, costoEstimado: 3900 }],
  });

  /**
   * Los papeles que se vencen. Van ANTES de `detectar` a proposito: asi el
   * permiso vencido de la caldera y las dos por vencer producen sus avisos
   * solos, con la misma regla que en produccion, en vez de quedar como filas
   * mudas en una pantalla.
   */
  for (const v of VIGENCIAS) {
    const cuelga = "activo" in v && v.activo
      ? { assetId: activo[v.activo].id }
      : { userId: u[(v as { persona: ClavePersona }).persona].id };
    await guardarVigencia({
      organizationId: orgId, userId: u.gerencia.id,
      tipo: v.tipo, titulo: v.titulo, folio: v.folio, cubre: v.cubre,
      desde: new Date(ahora.getTime() + v.desdeDias * DIA),
      hasta: new Date(ahora.getTime() + v.dias * DIA),
      supplierId: v.prov ? prov[v.prov] : null,
      cuelgaDe: cuelga,
    });
  }

  // Avisos: los que el propio sistema detecta con estos datos, no mensajes escritos a mano.
  await detectar(orgId, await configDe(orgId, ahora), ahora);
  return resumenDemo(orgId);
}

async function compraCompleta(c: Contexto) {
  const req = await crearRequisicionDeCompra({
    organizationId: c.orgId, userId: c.u.compras.id, warehouseId: c.almacenId, proveedorSugeridoId: c.prov.rod, urgencia: "NORMAL", montoAutorizacion: 5_000,
    justificacion: "Rodamientos bajo mínimo y grasa para la lubricación semanal de la llenadora.",
    renglones: [
      { partId: c.parte["ROD-6205"].id, descripcion: "Rodamiento 6205-2RS", cantidadSolicitada: 10, costoEstimado: 120 },
      { partId: c.parte["GRS-ALI"].id, descripcion: "Grasa grado alimenticio (cartucho 400 g)", cantidadSolicitada: 12, costoEstimado: 210 },
    ],
  });
  const id = req.id;
  const lineas = await prisma.purchaseRequestLine.findMany({ where: { requestId: id } });
  if ((await prisma.purchaseRequest.findUniqueOrThrow({ where: { id } })).estado === "SOLICITADA") {
    await autorizar({ organizationId: c.orgId, requestId: id, userId: c.u.direccion.id, aprueba: true });
  }
  const cot = await registrarCotizacion({
    organizationId: c.orgId, purchaseRequestId: id, supplierId: c.prov.rod, userId: c.u.compras.id, diasEntrega: 3, condicionesPago: "Contado",
    renglones: lineas.map((l) => ({ requestLineId: l.id, partId: l.partId, descripcion: l.descripcion, cantidad: l.cantidadSolicitada, costoUnitario: l.partId === c.parte["ROD-6205"].id ? 118 : 205, disponible: true })),
  });
  await elegirCotizacion({ organizationId: c.orgId, purchaseRequestId: id, quoteId: cot.id });
  const oc = await emitirOrdenDeCompra({ organizationId: c.orgId, purchaseRequestId: id, userId: c.u.compras.id, fechaPrometida: hace(c, 27) });
  await recibir({
    organizationId: c.orgId, userId: c.u.compras.id, purchaseRequestId: id, warehouseId: c.almacenId, supplierId: c.prov.rod, remision: "R-2231",
    ordenCompra: oc.folio,
    renglones: lineas.map((l) => ({ requestLineId: l.id, partId: l.partId!, cantidad: l.cantidadSolicitada, costoUnitario: l.partId === c.parte["ROD-6205"].id ? 118 : 205, conforme: true })),
  });
  // Todo ocurrió hace un mes: requisición, firma y orden; la recepción, tres días después.
  const solicitada = hace(c, 30), recibida = hace(c, 27);
  await prisma.purchaseRequest.update({ where: { id }, data: { createdAt: solicitada, autorizadaEl: hace(c, 30, 3) } });
  await prisma.quote.updateMany({ where: { purchaseRequestId: id }, data: { createdAt: hace(c, 30, 4) } });
  await prisma.purchaseOrder.updateMany({ where: { purchaseRequestId: id }, data: { createdAt: hace(c, 30, 5) } });
  const recep = await prisma.goodsReceipt.findFirst({ where: { purchaseRequestId: id } });
  if (recep) {
    await prisma.goodsReceipt.update({ where: { id: recep.id }, data: { createdAt: recibida } });
    await prisma.stockMovement.updateMany({ where: { goodsReceiptId: recep.id }, data: { createdAt: recibida } });
  }
  // Los avisos de esa compra ya se atendieron hace un mes: no se quedan en la campana como pendientes.
  await prisma.notification.updateMany({ where: { organizationId: c.orgId, entidadId: id }, data: { read: true, leidaEl: recibida, createdAt: solicitada } });
}

const dia = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Monterrey" });

/** Lo que tiene la demo, para la vista previa de la restauración y para las pruebas. */
export async function resumenDemo(orgId: string) {
  const w = { organizationId: orgId };
  const [activos, planes, ordenes, abiertas, solicitudes, refacciones, compras, lecturas, alertas, usuarios] = await Promise.all([
    prisma.asset.count({ where: w }), prisma.maintenancePlan.count({ where: w }), prisma.workOrder.count({ where: w }),
    prisma.workOrder.count({ where: { ...w, status: { notIn: ["CLOSED", "CANCELLED"] } } }), prisma.workRequest.count({ where: w }),
    prisma.part.count({ where: w }), prisma.purchaseRequest.count({ where: w }), prisma.meterReading.count({ where: w }),
    prisma.predictiveAlert.count({ where: { ...w, ...alertaAbierta() } }), prisma.user.count({ where: w }),
  ]);
  return { activos, planes, ordenes, abiertas, solicitudes, refacciones, compras, lecturas, alertas, usuarios };
}

// ───────────────────────────────────────────────────────── Restauración

export class ErrorDeDemo extends Error {
  constructor(message: string, readonly codigo = 409) { super(message); }
}

/**
 * Los modelos con datos de una empresa, en el orden de borrado.
 *
 * Sale del esquema (Prisma.dmmf), no de una lista a mano: una tabla nueva
 * entra sola. Se conservan la empresa y sus usuarios —la configuración base
 * y las cuentas con las que se presenta—; todo lo demás se borra y se vuelve
 * a sembrar.
 */
function modelosConDatos() {
  const conOrg = new Set(Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === "organizationId")).map((m) => m.name));
  const res: Array<{ modelo: string; filtro: (orgId: string) => Record<string, unknown> }> = [];
  for (const m of Prisma.dmmf.datamodel.models) {
    if (m.name === "Organization" || m.name === "User") continue;
    if (conOrg.has(m.name)) { res.push({ modelo: m.name, filtro: (orgId) => ({ organizationId: orgId }) }); continue; }
    // Hijos sin organizationId (renglones, tareas, horas…): por su padre.
    const padre = m.fields.find((f) => f.kind === "object" && f.relationFromFields?.length && conOrg.has(f.type) && f.type !== "Organization" && f.type !== "User");
    if (padre) res.push({ modelo: m.name, filtro: (orgId) => ({ [padre.name]: { organizationId: orgId } }) });
  }
  // Primero los hijos: un modelo se borra antes que aquellos a los que apunta.
  const nombres = new Set(res.map((r) => r.modelo));
  const apuntaA = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name,
    new Set(m.fields.filter((f) => f.kind === "object" && f.relationFromFields?.length && f.type !== m.name && nombres.has(f.type)).map((f) => f.type))]));
  const orden: string[] = [];
  const visto = new Set<string>();
  const visitar = (n: string, pila = new Set<string>()) => {
    if (visto.has(n) || pila.has(n)) return;
    pila.add(n);
    // Quien apunta a n tiene que salir antes que n.
    for (const [otro, destinos] of apuntaA) if (destinos.has(n) && nombres.has(otro)) visitar(otro, pila);
    visto.add(n);
    orden.push(n);
  };
  for (const r of res) visitar(r.modelo);
  return orden.map((n) => res.find((r) => r.modelo === n)!);
}

async function limpiarDatos(orgId: string) {
  const modelos = modelosConDatos();
  const delegado = (nombre: string) => (prisma as unknown as Record<string, { deleteMany: (a: unknown) => Promise<unknown>; count: (a: unknown) => Promise<number> }>)[nombre.charAt(0).toLowerCase() + nombre.slice(1)];
  // Varias pasadas: lo que no se pudo borrar por una llave pendiente cae en la siguiente.
  for (let pasada = 0; pasada < 12; pasada++) {
    let quedan = 0;
    for (const m of modelos) {
      const d = delegado(m.modelo);
      try { await d.deleteMany({ where: m.filtro(orgId) }); } catch { /* depende de otro: siguiente pasada */ }
      quedan += await d.count({ where: m.filtro(orgId) });
    }
    if (!quedan) return;
  }
  throw new ErrorDeDemo("No se pudieron borrar todos los datos de la demo; nada se volvió a sembrar.", 500);
}

/** Qué se va a restaurar: lo que hay hoy y a qué vuelve. */
export async function vistaPreviaRestauracion(orgId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { esDemo: true, name: true, demoRestauradaAt: true } });
  if (!org.esDemo) throw new ErrorDeDemo("Solo la empresa demostrativa se puede restaurar.", 403);
  return {
    empresa: org.name, ultimaRestauracion: org.demoRestauradaAt, hoy: await resumenDemo(orgId),
    seConserva: ["La empresa y su configuración", "Las cuentas de usuario y sus contraseñas"],
    seRestaura: ["Activos, planes, medidores y lecturas", "Órdenes de trabajo, solicitudes e historial de 90 días", "Almacén, existencias, compras y proveedores", "Alertas, avisos e indicadores", "Todo lo capturado durante las demostraciones"],
  };
}

/**
 * Deja la demo como nueva. Solo la empresa demostrativa; nunca otra.
 * Mientras corre, la demo responde «se está restaurando» (lib/api.ts) y un
 * segundo intento se rechaza de inmediato: el candado vive en la base, así
 * que también vale entre instancias de Cloud Run.
 */
export async function restaurarDemo(p: { orgId: string; userId: string; ahora?: Date }) {
  {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: p.orgId }, select: { esDemo: true, demoRestaurandoDesde: true } });
    if (!org.esDemo) throw new ErrorDeDemo("Solo la empresa demostrativa se puede restaurar.", 403);
    // Candado en la base: sirve también entre instancias.
    const tomado = await prisma.organization.updateMany({
      where: { id: p.orgId, esDemo: true, OR: [{ demoRestaurandoDesde: null }, { demoRestaurandoDesde: { lt: new Date(Date.now() - 15 * 60_000) } }] },
      data: { demoRestaurandoDesde: new Date() },
    });
    if (!tomado.count) throw new ErrorDeDemo("La demo ya se está restaurando. Espere a que termine.");
    const inicio = Date.now();
    try {
      await limpiarDatos(p.orgId);
      // Los catálogos indispensables con que nace toda empresa (unidades, fallas y causas genéricas).
      await sembrarCatalogosEstandar(p.orgId, DEMO.tipoInstalacion, prisma, "INDISPENSABLES");
      await prisma.organization.update({ where: { id: p.orgId }, data: { woSequence: 0, wrSequence: 0, poSequence: 0, tsSequence: 0, rmSequence: 0, rcSequence: 0, reSequence: 0, icSequence: 0, spSequence: 0 } });
      const resumen = await poblarDemo(p.orgId, p.ahora ?? new Date());
      await prisma.organization.update({ where: { id: p.orgId }, data: { demoRestaurandoDesde: null, demoRestauradaAt: new Date() } });
      await logAudit({ organizationId: p.orgId, userId: p.userId, entity: "Organization", entityId: p.orgId, action: "DEMO_RESTORED", summary: "Empresa demostrativa restaurada a su estado inicial", changes: { ...resumen, segundos: Math.round((Date.now() - inicio) / 1000) } });
      return resumen;
    } catch (e) {
      // El candado se suelta para poder reintentar; la demo queda a medias hasta el siguiente intento.
      await prisma.organization.update({ where: { id: p.orgId }, data: { demoRestaurandoDesde: null } });
      await logAudit({ organizationId: p.orgId, userId: p.userId, entity: "Organization", entityId: p.orgId, action: "DEMO_RESTORE_FAILED", summary: `La restauración de la demo falló: ${e instanceof Error ? e.message : e}` }).catch(() => undefined);
      throw e;
    }
  }
}

/**
 * Borra por completo una empresa demostrativa (datos, cuentas y empresa).
 * Solo la usan las pruebas, para su demo desechable; se niega con cualquier
 * empresa que no esté marcada como demo.
 */
export async function borrarDemo(orgId: string) {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { esDemo: true } });
  if (!org) return;
  if (!org.esDemo) throw new ErrorDeDemo("Solo se borra una empresa demostrativa.", 403);
  await limpiarDatos(orgId);
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
}
