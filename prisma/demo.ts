/**
 * Generador de datos de demostracion: una planta metalmecanica con historial
 * de 6 meses. Activos, planes con sus recursos, medidores, sensores, almacen y
 * ordenes cerradas con costos reales, para que los indicadores tengan sentido
 * desde el primer minuto.
 *
 * Aqui vive solo el generador. Quien lo llama decide sobre que base escribe:
 *
 *   prisma/seed.ts          borra la base local y siembra de cero
 *   scripts/sembrar-demo.ts siembra una empresa demo sin tocar a las demas
 *
 * Es deliberado que este modulo no borre nada por su cuenta.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export const prisma = new PrismaClient();

type SeedTask = {
  title: string;
  taskType: string;
  unit?: string;
  minValue?: number;
  maxValue?: number;
  required?: boolean;
};

type SeedPlan = {
  assetCode: string;
  name: string;
  description?: string;
  trigger: string;
  meterName?: string;
  intervalDays?: number;
  intervalMeter?: number;
  priority: string;
  hours: number;
  assignee: string;
  shutdown?: boolean;
  type?: string;
  safety?: string;
  tasks: SeedTask[];
};

type SeedBacklog = {
  title: string;
  asset: string;
  type: string;
  status: string;
  priority: string;
  due: number;
  tech: { id: string; hourlyRate: number };
  hours: number;
  planIndex?: number;
};

const DAY = 86_400_000;
const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
const daysAhead = (days: number) => new Date(now.getTime() + days * DAY);

// Generador pseudoaleatorio con semilla: el seed es reproducible.
let seedState = 20260826;
function random() {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
function pick<T>(items: T[]): T {
  return items[Math.floor(random() * items.length)];
}
function between(min: number, max: number) {
  return min + random() * (max - min);
}


export type OpcionesDemo = {
  /** Nombre comercial de la organizacion. */
  nombre: string;
  /** Identificador corto y unico. */
  slug: string;
  /** Dominio de los correos de los usuarios de ejemplo. */
  dominio: string;
  /** Contraseña en claro que compartiran los usuarios de ejemplo. */
  password: string;
  /** Plan comercial con el que nace la organizacion. */
  plan: string;
  /**
   * Si el director queda como operador de la plataforma. Cierto solo en la
   * demo local: en la nube daria acceso a los datos de todos los clientes.
   */
  superAdmin: boolean;
};

export async function sembrarDemo(opciones: OpcionesDemo) {
  // La semilla se reinicia en cada corrida: dos ejecuciones producen la misma
  // planta, con los mismos costos y las mismas fallas.
  seedState = 20260826;

  const passwordHash = await bcrypt.hash(opciones.password, 10);

  console.log("Creando organizacion…");
  const org = await prisma.organization.create({
    data: {
      name: opciones.nombre,
      slug: opciones.slug,
      industry: "Manufactura metalmecanica",
      plan: opciones.plan,
      status: "ACTIVE",
      currency: "MXN",
      timezone: "America/Monterrey",
    },
  });

  const users = await Promise.all(
    [
      { name: "Rafael Montemayor", email: `director@${opciones.dominio}`, role: "OWNER",
      isSuperAdmin: opciones.superAdmin, jobTitle: "Direccion de operaciones", hourlyRate: 900, color: "#1d4ed8" },
      { name: "Laura Cisneros", email: `supervisor@${opciones.dominio}`, role: "SUPERVISOR", jobTitle: "Jefa de mantenimiento", hourlyRate: 480, color: "#0891b2" },
      { name: "Miguel Aguirre", email: `tecnico@${opciones.dominio}`, role: "TECHNICIAN", jobTitle: "Tecnico mecanico A", hourlyRate: 260, color: "#7c3aed" },
      { name: "Jose Trevino", email: `electrico@${opciones.dominio}`, role: "TECHNICIAN", jobTitle: "Tecnico electrico", hourlyRate: 280, color: "#db2777" },
      { name: "Ana Robles", email: `confiabilidad@${opciones.dominio}`, role: "ADMIN", jobTitle: "Ingeniera de confiabilidad", hourlyRate: 520, color: "#ea580c" },
      { name: "Carlos Pena", email: `produccion@${opciones.dominio}`, role: "REQUESTER", jobTitle: "Supervisor de produccion", hourlyRate: 0, color: "#059669" },
    ].map((user) =>
      prisma.user.create({ data: { ...user, organizationId: org.id, passwordHash } }),
    ),
  );

  const [director, supervisor, mecanico, electrico, confiabilidad, produccion] = users;

  const site = await prisma.site.create({
    data: {
      organizationId: org.id,
      name: "Planta Apodaca",
      code: "APO",
      address: "Parque Industrial Milenium, Apodaca, N.L.",
      city: "Apodaca",
      timezone: "America/Monterrey",
    },
  });

  const locations = await Promise.all(
    [
      { name: "Nave de produccion", code: "NAVE" },
      { name: "Cuarto de compresores", code: "COMP" },
      { name: "Subestacion electrica", code: "SUBE" },
      { name: "Almacen y patio", code: "ALMA" },
    ].map((location) =>
      prisma.location.create({ data: { ...location, organizationId: org.id, siteId: site.id } }),
    ),
  );
  const [nave, compresores, subestacion, patio] = locations;

  const categories = await Promise.all(
    [
      { name: "Maquinado", code: "MAQ" },
      { name: "Aire comprimido", code: "AIR" },
      { name: "Electrico", code: "ELE" },
      { name: "Manejo de materiales", code: "MAT" },
      { name: "Bombeo", code: "BOM" },
    ].map((category) =>
      prisma.assetCategory.create({ data: { ...category, organizationId: org.id } }),
    ),
  );
  const [maquinado, aire, electricoCat, materiales, bombeo] = categories;

  const failureCodes = await Promise.all(
    [
      { code: "MEC-01", description: "Desgaste de rodamiento", category: "MECANICO" },
      { code: "MEC-02", description: "Desalineacion", category: "MECANICO" },
      { code: "LUB-01", description: "Lubricacion deficiente", category: "MECANICO" },
      { code: "ELE-01", description: "Falla en contactor o relevador", category: "ELECTRICO" },
      { code: "ELE-02", description: "Sobrecalentamiento de motor", category: "ELECTRICO" },
      { code: "HID-01", description: "Fuga hidraulica", category: "HIDRAULICO" },
      { code: "OPE-01", description: "Error de operacion", category: "OPERACION" },
    ].map((code) => prisma.failureCode.create({ data: { ...code, organizationId: org.id } })),
  );

  const rootCauses = await Promise.all(
    [
      { code: "LUB-NO-EJECUTADA", description: "Ruta de lubricacion no ejecutada", category: "MANTENIMIENTO" },
      { code: "LUB-INCORRECTO", description: "Lubricante incorrecto o contaminado", category: "MANTENIMIENTO" },
      { code: "DESALINEACION", description: "Desalineacion de acoplamiento", category: "INSTALACION" },
      { code: "MONTAJE", description: "Montaje o apriete incorrecto", category: "INSTALACION" },
      { code: "SOBRECARGA", description: "Operacion fuera de condiciones de diseño", category: "OPERACION" },
      { code: "FIN-VIDA-UTIL", description: "Fin de vida util del componente", category: "DESGASTE" },
      { code: "CORROSION", description: "Corrosion o ambiente agresivo", category: "AMBIENTE" },
      { code: "ENERGIA", description: "Variacion o falla de suministro electrico", category: "EXTERNO" },
      { code: "SIN-DETERMINAR", description: "Sin determinar", category: "OTRO" },
    ].map((c) => prisma.rootCause.create({ data: { ...c, organizationId: org.id } })),
  );

  const supplier = await prisma.supplier.create({
    data: {
      organizationId: org.id,
      name: "Refacciones Industriales del Norte",
      contactName: "Ing. Patricia Luna",
      email: "ventas@refaccionesnorte.mx",
      phone: "81 8100 2200",
      leadTimeDays: 5,
    },
  });

  console.log("Creando activos…");
  const assetSpecs = [
    { code: "TOR-101", name: "Torno CNC Haas ST-30", categoryId: maquinado.id, locationId: nave.id, criticality: "A", manufacturer: "Haas", model: "ST-30", cost: 1850000, replacement: 2400000 },
    { code: "TOR-102", name: "Torno CNC Mazak QTN-250", categoryId: maquinado.id, locationId: nave.id, criticality: "A", manufacturer: "Mazak", model: "QTN-250", cost: 2100000, replacement: 2750000 },
    { code: "CNC-201", name: "Centro de maquinado vertical VF-4", categoryId: maquinado.id, locationId: nave.id, criticality: "A", manufacturer: "Haas", model: "VF-4", cost: 2400000, replacement: 3100000 },
    { code: "CMP-301", name: "Compresor de tornillo Atlas Copco GA-75", categoryId: aire.id, locationId: compresores.id, criticality: "A", manufacturer: "Atlas Copco", model: "GA-75", cost: 780000, replacement: 950000 },
    { code: "CMP-302", name: "Compresor de respaldo Sullair 40 HP", categoryId: aire.id, locationId: compresores.id, criticality: "B", manufacturer: "Sullair", model: "LS-40", cost: 420000, replacement: 520000 },
    { code: "SEC-303", name: "Secador refrigerativo de aire", categoryId: aire.id, locationId: compresores.id, criticality: "B", manufacturer: "Atlas Copco", model: "FD-260", cost: 180000, replacement: 220000 },
    { code: "SUB-401", name: "Subestacion 500 kVA", categoryId: electricoCat.id, locationId: subestacion.id, criticality: "A", manufacturer: "Siemens", model: "SIVACON", cost: 1250000, replacement: 1600000 },
    { code: "GEN-402", name: "Generador de emergencia 350 kW", categoryId: electricoCat.id, locationId: subestacion.id, criticality: "A", manufacturer: "Cummins", model: "C350D6", cost: 1450000, replacement: 1900000 },
    { code: "GRU-501", name: "Grua viajera 10 ton", categoryId: materiales.id, locationId: nave.id, criticality: "A", manufacturer: "Demag", model: "EKKE-10", cost: 980000, replacement: 1300000 },
    { code: "MON-502", name: "Montacargas electrico 2.5 ton", categoryId: materiales.id, locationId: patio.id, criticality: "B", manufacturer: "Toyota", model: "8FBCU25", cost: 620000, replacement: 780000 },
    { code: "BOM-601", name: "Bomba centrifuga de refrigerante", categoryId: bombeo.id, locationId: nave.id, criticality: "B", manufacturer: "Grundfos", model: "CR-15", cost: 95000, replacement: 130000 },
    { code: "BOM-602", name: "Bomba de agua de enfriamiento", categoryId: bombeo.id, locationId: nave.id, criticality: "B", manufacturer: "Grundfos", model: "CR-32", cost: 145000, replacement: 190000 },
    { code: "TOR-701", name: "Torre de enfriamiento 120 TR", categoryId: bombeo.id, locationId: patio.id, criticality: "B", manufacturer: "Marley", model: "NC-120", cost: 540000, replacement: 700000 },
    { code: "EXT-801", name: "Sistema de extraccion de humos", categoryId: materiales.id, locationId: nave.id, criticality: "C", manufacturer: "Donaldson", model: "DFT-2-8", cost: 310000, replacement: 400000 },
  ];

  const assets = await Promise.all(
    assetSpecs.map((spec, index) =>
      prisma.asset.create({
        data: {
          organizationId: org.id,
          siteId: site.id,
          locationId: spec.locationId,
          categoryId: spec.categoryId,
          code: spec.code,
          name: spec.name,
          manufacturer: spec.manufacturer,
          model: spec.model,
          serialNumber: `SN-${2019 + (index % 5)}-${1000 + index * 37}`,
          criticality: spec.criticality,
          status: index === 4 ? "STANDBY" : "OPERATIONAL",
          purchaseDate: daysAgo(600 + index * 45),
          purchaseCost: spec.cost,
          replacementCost: spec.replacement,
          warrantyExpiry: index % 3 === 0 ? daysAhead(180) : daysAgo(120),
          commissionedAt: daysAgo(580 + index * 45),
          expectedLifeYears: 12,
        },
      }),
    ),
  );

  const byCode = new Map(assets.map((asset) => [asset.code, asset]));

  console.log("Creando medidores…");
  const meterSpecs = [
    { code: "CMP-301", name: "Horometro compresor principal", unit: "h", value: 18420, daily: 19 },
    { code: "CMP-302", name: "Horometro compresor respaldo", unit: "h", value: 4230, daily: 3 },
    { code: "GEN-402", name: "Horometro generador", unit: "h", value: 1180, daily: 1.2 },
    { code: "MON-502", name: "Horometro montacargas", unit: "h", value: 6890, daily: 7 },
    { code: "GRU-501", name: "Contador de ciclos", unit: "ciclos", value: 142500, daily: 180 },
    { code: "TOR-101", name: "Horas de husillo", unit: "h", value: 9840, daily: 14 },
    { code: "CNC-201", name: "Horas de husillo", unit: "h", value: 11250, daily: 15 },
  ];

  const meters = await Promise.all(
    meterSpecs.map((spec) =>
      prisma.meter.create({
        data: {
          organizationId: org.id,
          assetId: byCode.get(spec.code)!.id,
          name: spec.name,
          unit: spec.unit,
          currentValue: spec.value,
          dailyAverage: spec.daily,
          lastReadingAt: daysAgo(2),
        },
      }),
    ),
  );

  // Historial de lecturas de los ultimos 60 dias.
  for (const meter of meters) {
    const spec = meterSpecs.find((s) => s.name === meter.name && byCode.get(s.code)!.id === meter.assetId)!;
    const readings = [];
    for (let i = 60; i >= 0; i -= 5) {
      const value = spec.value - spec.daily * i;
      readings.push({
        organizationId: org.id,
        meterId: meter.id,
        userId: mecanico.id,
        value: Math.max(0, Math.round(value)),
        delta: Math.round(spec.daily * 5),
        readingAt: daysAgo(i),
      });
    }
    await prisma.meterReading.createMany({ data: readings });
  }

  console.log("Creando inventario…");
  const partSpecs = [
    { code: "ROD-6205", name: "Rodamiento SKF 6205-2RS", category: "Rodamientos", unit: "pza", cost: 320, qty: 24, min: 8, max: 40, bin: "A-01-1" },
    { code: "ROD-6308", name: "Rodamiento SKF 6308-2Z", category: "Rodamientos", unit: "pza", cost: 780, qty: 6, min: 6, max: 20, bin: "A-01-2" },
    { code: "FIL-AIR-75", name: "Filtro de aire compresor GA-75", category: "Filtros", unit: "pza", cost: 1450, qty: 4, min: 2, max: 10, bin: "B-02-1" },
    { code: "FIL-ACE-75", name: "Filtro de aceite compresor GA-75", category: "Filtros", unit: "pza", cost: 980, qty: 3, min: 4, max: 12, bin: "B-02-2" },
    { code: "ACE-ROT-20", name: "Aceite Roto-Xtend Duty 20 L", category: "Lubricantes", unit: "cubeta", cost: 3200, qty: 5, min: 2, max: 8, bin: "C-01-1" },
    { code: "GRA-EP2", name: "Grasa EP-2 multiproposito 1 kg", category: "Lubricantes", unit: "kg", cost: 210, qty: 32, min: 10, max: 50, bin: "C-01-2" },
    { code: "BAN-B72", name: "Banda en V B-72", category: "Transmision", unit: "pza", cost: 380, qty: 12, min: 6, max: 24, bin: "A-03-1" },
    { code: "CON-3TF", name: "Contactor Siemens 3TF48", category: "Electrico", unit: "pza", cost: 2650, qty: 3, min: 2, max: 8, bin: "D-01-1" },
    { code: "FUS-100A", name: "Fusible NH 100 A", category: "Electrico", unit: "pza", cost: 320, qty: 18, min: 8, max: 30, bin: "D-01-2" },
    { code: "SEL-HID-50", name: "Kit de sellos hidraulicos 50 mm", category: "Hidraulico", unit: "kit", cost: 1850, qty: 2, min: 2, max: 6, bin: "E-01-1" },
    { code: "MAN-HID-1", name: "Manguera hidraulica 1 pulg (metro)", category: "Hidraulico", unit: "m", cost: 420, qty: 25, min: 10, max: 50, bin: "E-01-2" },
    { code: "REF-GLI-20", name: "Refrigerante glicol 20 L", category: "Consumibles", unit: "cubeta", cost: 1650, qty: 6, min: 3, max: 12, bin: "C-02-1" },
    { code: "INS-CNC-01", name: "Inserto de corte CNMG 120408", category: "Herramental", unit: "pza", cost: 290, qty: 60, min: 20, max: 120, bin: "F-01-1" },
    { code: "EMP-GEN-01", name: "Empaque de culata generador", category: "Motores", unit: "pza", cost: 4200, qty: 1, min: 1, max: 4, bin: "E-02-1" },
  ];

  // Familia y unidad son catalogos desde que se estandarizaron: se crean a
  // partir de lo que usan las refacciones, para que la demo quede consistente
  // y el formulario del almacen tenga opciones desde el primer momento.
  const nombresFamilia: Record<string, string> = {
    Rodamientos: "Rodamientos y baleros", Filtros: "Filtros",
    Lubricantes: "Lubricantes y grasas", Transmision: "Bandas y transmision",
    Electrico: "Material electrico", Hidraulico: "Componentes hidraulicos",
    Consumibles: "Consumibles de taller", Herramental: "Herramental de corte",
    Motores: "Motores y reductores",
  };
  const nombresUnidad: Record<string, string> = {
    pza: "Pieza", kg: "Kilogramo", m: "Metro", kit: "Kit", cubeta: "Cubeta",
  };

  await Promise.all(
    [...new Set(partSpecs.map((s) => s.category))].map((code) =>
      prisma.partCategory.create({
        data: { organizationId: org.id, code, name: nombresFamilia[code] ?? code },
      }),
    ),
  );
  await Promise.all(
    [...new Set(partSpecs.map((s) => s.unit))].map((code) =>
      prisma.partUnit.create({
        data: { organizationId: org.id, code, name: nombresUnidad[code] ?? code },
      }),
    ),
  );

  // Especialidades y servicios externos: los dos catalogos con los que se
  // presupuesta una actividad de plan ademas de las refacciones.
  const especialidades = await Promise.all(
    ([
      ["MEC", "Mecanico", 180],
      ["ELE", "Electricista", 210],
      ["INST", "Instrumentista", 240],
      ["SOLD", "Soldador", 195],
      ["HID", "Hidraulico / neumatico", 190],
      ["PRED", "Analista predictivo", 320],
      ["GRAL", "Auxiliar de mantenimiento", 120],
    ] as Array<[string, string, number]>).map(([code, name, hourlyRate]) =>
      prisma.specialty.create({ data: { organizationId: org.id, code, name, hourlyRate } }),
    ),
  );
  const porEspecialidad = new Map(especialidades.map((e) => [e.code, e]));

  const serviciosExternos = await Promise.all(
    ([
      ["SRV-REB", "Rebobinado de motor electrico", "servicio", 14500],
      ["SRV-BAL", "Balanceo dinamico de rotor", "servicio", 6800],
      ["SRV-ALI", "Alineacion laser", "servicio", 4200],
      ["SRV-TERM", "Termografia infrarroja", "servicio", 3800],
      ["SRV-ACE", "Analisis de aceite de laboratorio", "muestra", 1250],
      ["SRV-CAL", "Calibracion certificada de instrumentos", "instrumento", 2400],
      ["SRV-GRUA", "Maniobra con grua", "jornada", 9500],
    ] as Array<[string, string, string, number]>).map(([code, name, unit, unitCost]) =>
      prisma.externalService.create({
        data: { organizationId: org.id, supplierId: supplier.id, code, name, unit, unitCost },
      }),
    ),
  );
  const porServicio = new Map(serviciosExternos.map((x) => [x.code, x]));

  const parts = await Promise.all(
    partSpecs.map((spec) =>
      prisma.part.create({
        data: {
          organizationId: org.id,
          supplierId: supplier.id,
          code: spec.code,
          name: spec.name,
          category: spec.category,
          unit: spec.unit,
          unitCost: spec.cost,
          quantityOnHand: spec.qty,
          minQuantity: spec.min,
          maxQuantity: spec.max,
          bin: spec.bin,
        },
      }),
    ),
  );

  await prisma.stockMovement.createMany({
    data: parts.map((part) => ({
      organizationId: org.id,
      partId: part.id,
      movementType: "IN",
      quantity: part.quantityOnHand,
      unitCost: part.unitCost,
      balanceAfter: part.quantityOnHand,
      reference: "Inventario inicial",
      createdAt: daysAgo(180),
    })),
  });

  console.log("Creando planes de mantenimiento…");
  const planSpecs: SeedPlan[] = [
    {
      assetCode: "CMP-301",
      name: "Servicio 2,000 h compresor GA-75",
      description: "Cambio de filtros, aceite y verificacion de separador.",
      trigger: "METER",
      meterName: "Horometro compresor principal",
      intervalMeter: 2000,
      priority: "HIGH",
      hours: 4,
      assignee: mecanico.id,
      shutdown: true,
      tasks: [
        { title: "Bloqueo y etiquetado del equipo (LOTO)", taskType: "CHECK" },
        { title: "Reemplazar filtro de aire", taskType: "REPLACE" },
        { title: "Reemplazar filtro de aceite", taskType: "REPLACE" },
        { title: "Cambiar aceite Roto-Xtend", taskType: "REPLACE" },
        { title: "Medir temperatura de descarga", taskType: "MEASURE", unit: "°C", maxValue: 95 },
        { title: "Medir presion de trabajo", taskType: "MEASURE", unit: "bar", minValue: 6.5, maxValue: 8.5 },
        { title: "Revisar fugas y estado de mangueras", taskType: "CHECK" },
      ],
      safety: "Despresurizar el sistema antes de intervenir. Requiere LOTO y EPP completo.",
    },
    {
      assetCode: "TOR-101",
      name: "Preventivo mensual torno CNC ST-30",
      description: "Lubricacion, limpieza y verificacion de precision.",
      trigger: "CALENDAR",
      intervalDays: 30,
      priority: "MEDIUM",
      hours: 3,
      assignee: mecanico.id,
      tasks: [
        { title: "Limpiar area de trabajo y viruta", taskType: "CHECK" },
        { title: "Verificar nivel de refrigerante", taskType: "CHECK" },
        { title: "Lubricar guias y husillos", taskType: "CHECK" },
        { title: "Medir vibracion del husillo", taskType: "MEASURE", unit: "mm/s", maxValue: 4.5 },
        { title: "Verificar concentricidad del chuck", taskType: "MEASURE", unit: "mm", maxValue: 0.02 },
        { title: "Observaciones del operador", taskType: "TEXT", required: false },
      ],
    },
    {
      assetCode: "CNC-201",
      name: "Preventivo mensual centro de maquinado VF-4",
      trigger: "CALENDAR",
      intervalDays: 30,
      priority: "MEDIUM",
      hours: 3,
      assignee: mecanico.id,
      tasks: [
        { title: "Limpieza general y retiro de viruta", taskType: "CHECK" },
        { title: "Revisar sistema de lubricacion automatica", taskType: "CHECK" },
        { title: "Medir vibracion del husillo", taskType: "MEASURE", unit: "mm/s", maxValue: 4.5 },
        { title: "Verificar cambiador de herramientas", taskType: "CHECK" },
      ],
    },
    {
      assetCode: "SUB-401",
      name: "Inspeccion termografica trimestral",
      description: "Termografia de tableros y apriete de conexiones.",
      trigger: "CALENDAR",
      intervalDays: 90,
      priority: "HIGH",
      hours: 4,
      assignee: electrico.id,
      type: "INSPECTION",
      shutdown: true,
      tasks: [
        { title: "Aplicar bloqueo y etiquetado", taskType: "CHECK" },
        { title: "Termografia de barras y conexiones", taskType: "CHECK" },
        { title: "Medir temperatura maxima detectada", taskType: "MEASURE", unit: "°C", maxValue: 70 },
        { title: "Verificar apriete con torquimetro", taskType: "CHECK" },
        { title: "Limpieza de gabinetes", taskType: "CHECK" },
        { title: "Medir resistencia de tierra fisica", taskType: "MEASURE", unit: "ohm", maxValue: 5 },
      ],
      safety: "Trabajo con riesgo electrico. Permiso de trabajo y EPP dielectrico obligatorio.",
    },
    {
      assetCode: "GEN-402",
      name: "Prueba semanal del generador",
      trigger: "CALENDAR",
      intervalDays: 7,
      priority: "MEDIUM",
      hours: 1,
      assignee: electrico.id,
      type: "INSPECTION",
      tasks: [
        { title: "Arranque en vacio y prueba de 15 minutos", taskType: "CHECK" },
        { title: "Verificar nivel de combustible", taskType: "MEASURE", unit: "%", minValue: 50 },
        { title: "Verificar nivel de refrigerante y aceite", taskType: "CHECK" },
        { title: "Registrar voltaje de baterias", taskType: "MEASURE", unit: "V", minValue: 12.4 },
      ],
    },
    {
      assetCode: "GRU-501",
      name: "Inspeccion de seguridad grua viajera",
      trigger: "CALENDAR",
      intervalDays: 60,
      priority: "CRITICAL",
      hours: 5,
      assignee: mecanico.id,
      type: "INSPECTION",
      shutdown: true,
      tasks: [
        { title: "Inspeccion visual de cable y ganchos", taskType: "CHECK" },
        { title: "Prueba de frenos y limites", taskType: "CHECK" },
        { title: "Verificar desgaste de ruedas", taskType: "MEASURE", unit: "mm", maxValue: 3 },
        { title: "Lubricar reductor y cables", taskType: "CHECK" },
        { title: "Prueba de carga nominal", taskType: "CHECK" },
      ],
      safety: "Area acordonada durante la prueba de carga. Arnes obligatorio en altura.",
    },
    {
      assetCode: "MON-502",
      name: "Servicio 500 h montacargas",
      trigger: "METER",
      meterName: "Horometro montacargas",
      intervalMeter: 500,
      priority: "MEDIUM",
      hours: 3,
      assignee: mecanico.id,
      tasks: [
        { title: "Revisar estado de baterias y electrolito", taskType: "CHECK" },
        { title: "Verificar sistema hidraulico y fugas", taskType: "CHECK" },
        { title: "Revisar frenos y direccion", taskType: "CHECK" },
        { title: "Medir presion hidraulica", taskType: "MEASURE", unit: "bar", minValue: 120, maxValue: 180 },
      ],
    },
    {
      assetCode: "TOR-701",
      name: "Limpieza y tratamiento torre de enfriamiento",
      trigger: "CALENDAR",
      intervalDays: 45,
      priority: "MEDIUM",
      hours: 4,
      assignee: mecanico.id,
      tasks: [
        { title: "Limpieza de charola y relleno", taskType: "CHECK" },
        { title: "Dosificar biocida y anticorrosivo", taskType: "CHECK" },
        { title: "Medir pH del agua", taskType: "MEASURE", unit: "pH", minValue: 6.5, maxValue: 8.5 },
        { title: "Verificar tension de bandas del ventilador", taskType: "CHECK" },
      ],
    },
    {
      assetCode: "BOM-601",
      name: "Lubricacion mensual bombas",
      trigger: "CALENDAR",
      intervalDays: 30,
      priority: "LOW",
      hours: 1,
      assignee: mecanico.id,
      tasks: [
        { title: "Engrasar chumaceras", taskType: "CHECK" },
        { title: "Medir temperatura de rodamiento", taskType: "MEASURE", unit: "°C", maxValue: 70 },
        { title: "Verificar sello mecanico", taskType: "CHECK" },
      ],
    },
    {
      assetCode: "CMP-302",
      name: "Preventivo semestral compresor de respaldo",
      trigger: "CALENDAR",
      intervalDays: 180,
      priority: "LOW",
      hours: 3,
      assignee: mecanico.id,
      tasks: [
        { title: "Cambio de filtros", taskType: "REPLACE" },
        { title: "Prueba de arranque automatico", taskType: "CHECK" },
        { title: "Medir presion de descarga", taskType: "MEASURE", unit: "bar", minValue: 6, maxValue: 8.5 },
      ],
    },
  ];

  const plans = [];
  for (const spec of planSpecs) {
    const asset = byCode.get(spec.assetCode)!;
    const meter = spec.meterName ? meters.find((m) => m.name === spec.meterName && m.assetId === asset.id) : null;
    const plan = await prisma.maintenancePlan.create({
      data: {
        organizationId: org.id,
        assetId: asset.id,
        meterId: meter?.id ?? null,
        assignedToId: spec.assignee,
        name: spec.name,
        description: spec.description,
        maintenanceType: spec.type ?? "PREVENTIVE",
        triggerType: spec.trigger,
        intervalDays: spec.trigger === "CALENDAR" ? spec.intervalDays : null,
        intervalMeter: spec.trigger === "METER" ? spec.intervalMeter : null,
        leadTimeDays: 3,
        priority: spec.priority,
        estimatedHours: spec.hours,
        requiresShutdown: spec.shutdown ?? false,
        safetyNotes: spec.safety,
        lastCompletedAt: daysAgo(Math.round(between(5, 40))),
        nextDueDate: spec.trigger === "CALENDAR"
          ? daysAhead(Math.round(between(-4, 25)))
          : daysAhead(Math.round(between(3, 30))),
        nextDueMeter: meter ? meter.currentValue + Math.round(between(50, 400)) : null,
        tasks: {
          create: spec.tasks.map((task, index) => ({
            position: index,
            title: task.title,
            taskType: task.taskType,
            unit: task.unit ?? null,
            minValue: task.minValue ?? null,
            maxValue: task.maxValue ?? null,
            required: task.required !== false,
          })),
        },
      },
      include: { tasks: true },
    });

    // La asignacion es donde vive el calendario del plan PARA ESE EQUIPO. Sin
    // ella el plan existe pero no genera nada: el programador recorre
    // asignaciones, no planes. Una demo sin esto se ve completa y no produce
    // una sola orden preventiva.
    await prisma.planAsset.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        assetId: asset.id,
        meterId: meter?.id ?? null,
        nextDueDate: plan.nextDueDate,
        nextDueMeter: plan.nextDueMeter,
        lastCompletedAt: plan.lastCompletedAt,
      },
    });

    plans.push(plan);
  }

  // Recursos requeridos por actividad. Es lo que convierte un plan en algo
  // presupuestable: quien lo hace, con que material y que se contrata afuera.
  for (const plan of plans) {
    if (!plan.tasks.length) continue;
    const electrico = /electric|tablero|subestacion|motor/i.test(plan.name);
    const especialidad = porEspecialidad.get(electrico ? "ELE" : "MEC")!;
    const horasPorTarea = Math.max(0.5, Number((plan.estimatedHours / plan.tasks.length).toFixed(1)));

    for (const tarea of plan.tasks) {
      await prisma.planTaskLabor.create({
        data: {
          planTaskId: tarea.id,
          specialtyId: especialidad.id,
          personas: plan.requiresShutdown ? 2 : 1,
          hours: horasPorTarea,
        },
      });

      if (tarea.taskType === "REPLACE") {
        const refaccion = pick(parts);
        await prisma.planTaskPart.create({
          data: { planTaskId: tarea.id, partId: refaccion.id, quantity: 1 },
        });
      }
    }

    // Los planes largos suelen apoyarse en un tercero: alineacion despues de
    // un desmontaje, termografia en el tablero, aceite a laboratorio.
    if ((plan.intervalDays ?? 0) >= 180) {
      const servicio = porServicio.get(electrico ? "SRV-TERM" : "SRV-ALI")!;
      await prisma.planTaskService.create({
        data: {
          planTaskId: plan.tasks[plan.tasks.length - 1].id,
          serviceId: servicio.id,
          quantity: 1,
          nota: "Contratar con anticipacion al paro programado",
        },
      });
    }
  }

  console.log("Creando puntos de monitoreo predictivo…");
  const sensorSpecs = [
    { code: "CMP-301", name: "Vibracion motor lado acople", type: "VIBRATION", unit: "mm/s", warn: 4.5, crit: 7.1, start: 2.1, slope: 0.055 },
    { code: "CMP-301", name: "Temperatura de descarga", type: "TEMPERATURE", unit: "°C", warn: 88, crit: 98, start: 78, slope: 0.12 },
    { code: "TOR-101", name: "Vibracion husillo", type: "VIBRATION", unit: "mm/s", warn: 4.5, crit: 7.1, start: 1.8, slope: 0.012 },
    { code: "CNC-201", name: "Vibracion husillo", type: "VIBRATION", unit: "mm/s", warn: 4.5, crit: 7.1, start: 2.4, slope: 0.09 },
    { code: "GRU-501", name: "Corriente motor de izaje", type: "CURRENT", unit: "A", warn: 62, crit: 72, start: 48, slope: 0.05 },
    { code: "SUB-401", name: "Temperatura barra principal", type: "TEMPERATURE", unit: "°C", warn: 65, crit: 80, start: 48, slope: 0.02 },
    { code: "BOM-602", name: "Vibracion chumacera", type: "VIBRATION", unit: "mm/s", warn: 4.5, crit: 7.1, start: 3.2, slope: 0.02 },
    { code: "GEN-402", name: "Particulas en aceite", type: "OIL", unit: "ppm", warn: 25, crit: 40, start: 12, slope: 0.08 },
  ];

  for (const spec of sensorSpecs) {
    const sensor = await prisma.sensor.create({
      data: {
        organizationId: org.id,
        assetId: byCode.get(spec.code)!.id,
        name: spec.name,
        sensorType: spec.type,
        unit: spec.unit,
        warningThreshold: spec.warn,
        criticalThreshold: spec.crit,
        direction: "ABOVE",
      },
    });

    // 90 dias de historial con tendencia + ruido.
    const readings = [];
    let last = spec.start;
    for (let i = 90; i >= 0; i -= 3) {
      const value = spec.start + spec.slope * (90 - i) + between(-0.25, 0.25) * spec.start * 0.08;
      last = Math.max(0, Number(value.toFixed(2)));
      readings.push({
        organizationId: org.id,
        sensorId: sensor.id,
        value: last,
        status: last >= spec.crit ? "CRITICAL" : last >= spec.warn ? "WARNING" : "NORMAL",
        readingAt: daysAgo(i),
      });
    }
    await prisma.sensorReading.createMany({ data: readings });

    const status = last >= spec.crit ? "CRITICAL" : last >= spec.warn ? "WARNING" : "NORMAL";
    await prisma.sensor.update({
      where: { id: sensor.id },
      data: { lastValue: last, lastStatus: status, lastReadingAt: daysAgo(0) },
    });

    if (status !== "NORMAL") {
      await prisma.predictiveAlert.create({
        data: {
          organizationId: org.id,
          sensorId: sensor.id,
          assetId: sensor.assetId,
          severity: status,
          title: `${spec.name} — ${byCode.get(spec.code)!.name}`,
          message: `Lectura ${last} ${spec.unit} por encima del umbral de ${status === "CRITICAL" ? spec.crit : spec.warn} ${spec.unit}. La tendencia se mantiene ascendente.`,
          value: last,
          threshold: status === "CRITICAL" ? spec.crit : spec.warn,
          trendSlope: spec.slope,
          projectedFailureAt: daysAhead(Math.round((spec.crit - last) / Math.max(spec.slope, 0.001))),
        },
      });
    }
  }

  console.log("Generando historial de ordenes de trabajo…");
  let woSeq = 0;
  const nextNumber = () => `OT-${String(++woSeq).padStart(6, "0")}`;

  const correctiveTitles = [
    { title: "Falla en contactor principal del compresor", asset: "CMP-301", code: "ELE-01", hours: 3.5, downtime: 210 },
    { title: "Fuga hidraulica en montacargas", asset: "MON-502", code: "HID-01", hours: 4, downtime: 320 },
    { title: "Ruido anormal en husillo del torno", asset: "TOR-101", code: "MEC-01", hours: 6, downtime: 480 },
    { title: "Sobrecalentamiento de motor de bomba", asset: "BOM-601", code: "ELE-02", hours: 2.5, downtime: 150 },
    { title: "Banda rota en torre de enfriamiento", asset: "TOR-701", code: "MEC-01", hours: 2, downtime: 120 },
    { title: "Freno de grua fuera de ajuste", asset: "GRU-501", code: "MEC-02", hours: 5, downtime: 360 },
    { title: "Falla de arranque del generador", asset: "GEN-402", code: "ELE-01", hours: 4.5, downtime: 0 },
    { title: "Vibracion excesiva en centro de maquinado", asset: "CNC-201", code: "MEC-02", hours: 7, downtime: 540 },
    { title: "Fuga de refrigerante en torno Mazak", asset: "TOR-102", code: "HID-01", hours: 3, downtime: 180 },
    { title: "Filtro saturado en secador de aire", asset: "SEC-303", code: "LUB-01", hours: 1.5, downtime: 60 },
    { title: "Sensor de proximidad danado en grua", asset: "GRU-501", code: "ELE-01", hours: 2, downtime: 90 },
    { title: "Desalineacion de acoplamiento en bomba", asset: "BOM-602", code: "MEC-02", hours: 4, downtime: 240 },
    { title: "Sobrecarga por operacion indebida", asset: "MON-502", code: "OPE-01", hours: 1.5, downtime: 45 },
    { title: "Cambio de rodamiento en extractor", asset: "EXT-801", code: "MEC-01", hours: 3, downtime: 120 },
  ];

  /**
   * Refacciones plausibles por equipo.
   *
   * Sin esto el costo de refacciones de la demo seria un numero al azar sin
   * respaldo en el almacen: la OT diria que gasto 4,000 pesos y el kardex no
   * mostraria una sola salida. Un cliente atento lo nota.
   */
  const refaccionesPorEquipo: Record<string, string[]> = {
    "CMP-301": ["FIL-AIR-75", "FIL-ACE-75", "ACE-ROT-20"],
    "CMP-302": ["FIL-AIR-75", "FIL-ACE-75"],
    "SEC-303": ["FIL-AIR-75"],
    "TOR-101": ["ROD-6205", "INS-CNC-01", "REF-GLI-20"],
    "TOR-102": ["REF-GLI-20", "SEL-HID-50"],
    "CNC-201": ["INS-CNC-01", "ROD-6205", "REF-GLI-20"],
    "MON-502": ["SEL-HID-50", "MAN-HID-1", "GRA-EP2"],
    "BOM-601": ["ROD-6205", "SEL-HID-50", "GRA-EP2"],
    "BOM-602": ["ROD-6205", "GRA-EP2"],
    "TOR-701": ["BAN-B72", "ROD-6308", "GRA-EP2"],
    "GRU-501": ["ROD-6308", "FUS-100A", "CON-3TF", "GRA-EP2"],
    "GEN-402": ["EMP-GEN-01", "FIL-ACE-75"],
    "SUB-401": ["CON-3TF", "FUS-100A"],
    "EXT-801": ["ROD-6205", "BAN-B72", "GRA-EP2"],
  };

  /**
   * Consumos pendientes de aplicar al kardex.
   *
   * Se acumulan mientras se generan las ordenes y se procesan al final, en
   * orden cronologico: solo asi el saldo despues de cada movimiento es
   * coherente y el almacen se resurte cuando toca, como en una planta real.
   */
  const consumos: Array<{ workOrderId: string; codigo: string; cantidad: number; fecha: Date }> = [];

  /** Elige que se consumio en un trabajo, segun el equipo y el tipo. */
  function consumirEn(assetCode: string, preventivo: boolean) {
    const disponibles = refaccionesPorEquipo[assetCode] ?? ["GRA-EP2"];
    const cuantas = preventivo ? (random() > 0.55 ? 1 : 0) : Math.max(1, Math.round(between(1, 2.4)));
    const elegidas: Array<{ codigo: string; cantidad: number }> = [];
    for (let i = 0; i < cuantas && i < disponibles.length; i++) {
      const codigo = disponibles[Math.floor(random() * disponibles.length)];
      if (elegidas.some((e) => e.codigo === codigo)) continue;
      const spec = partSpecs.find((x) => x.code === codigo)!;
      // Los consumibles se van de a varios; un rodamiento o un contactor, de uno.
      const granel = ["kg", "m", "cubeta"].includes(spec.unit);
      elegidas.push({ codigo, cantidad: granel ? Math.round(between(1, 4)) : 1 });
    }
    return elegidas;
  }

  const technicians = [mecanico, electrico];

  // Historial cerrado: 6 meses de trabajo preventivo y correctivo.
  for (let monthsAgo = 6; monthsAgo >= 1; monthsAgo--) {
    // Preventivos completados
    for (const plan of plans) {
      if (random() > 0.72) continue;
      const created = daysAgo(monthsAgo * 30 + Math.round(between(0, 12)));
      const due = new Date(created.getTime() + 5 * DAY);
      const started = new Date(created.getTime() + between(0.2, 2) * DAY);
      const onTime = random() > 0.12;
      const completed = new Date(due.getTime() + (onTime ? -between(0.2, 2) * DAY : between(1, 4) * DAY));
      const tech = pick(technicians);
      const hours = Number((plan.estimatedHours * between(0.75, 1.35)).toFixed(2));
      const laborCost = Math.round(hours * tech.hourlyRate);
      const asset = assets.find((a) => a.id === plan.assetId)!;
      const usadas = consumirEn(asset.code, true);
      const partsCost = usadas.reduce(
        (t, u) => t + u.cantidad * partSpecs.find((x) => x.code === u.codigo)!.cost,
        0,
      );

      const wo = await prisma.workOrder.create({
        data: {
          organizationId: org.id,
          number: nextNumber(),
          title: plan.name,
          description: plan.description,
          maintenanceType: plan.maintenanceType === "INSPECTION" ? "INSPECTION" : "PREVENTIVE",
          status: "CLOSED",
          priority: plan.priority,
          assetId: plan.assetId,
          siteId: site.id,
          locationId: asset.locationId,
          planId: plan.id,
          assignedToId: tech.id,
          createdById: supervisor.id,
          createdAt: created,
          dueDate: due,
          startedAt: started,
          completedAt: completed,
          closedAt: new Date(completed.getTime() + DAY),
          responseMinutes: Math.round((started.getTime() - created.getTime()) / 60000),
          estimatedHours: plan.estimatedHours,
          actualHours: hours,
          downtimeMinutes: plan.requiresShutdown ? Math.round(hours * 60) : 0,
          requiresShutdown: plan.requiresShutdown,
          resolution: "Rutina ejecutada conforme al procedimiento. Equipo entregado en operacion.",
          laborCost,
          partsCost,
          totalCost: laborCost + partsCost,
          tasks: {
            create: plan.tasks.map((task, index) => ({
              position: index,
              title: task.title,
              taskType: task.taskType,
              unit: task.unit,
              minValue: task.minValue,
              maxValue: task.maxValue,
              required: task.required,
              done: true,
              completedById: tech.id,
              completedAt: completed,
              resultNumber:
                task.taskType === "MEASURE"
                  ? Number(between(task.minValue ?? 0, task.maxValue ?? (task.minValue ?? 0) + 10).toFixed(2))
                  : null,
              passed: task.taskType === "MEASURE" ? true : null,
            })),
          },
          labor: {
            create: { userId: tech.id, hours, rate: tech.hourlyRate, cost: laborCost, workedAt: completed },
          },
        },
      });

      for (const u of usadas) {
        consumos.push({ workOrderId: wo.id, codigo: u.codigo, cantidad: u.cantidad, fecha: completed });
      }

      if (plan.requiresShutdown) {
        await prisma.downtimeEvent.create({
          data: {
            assetId: plan.assetId!,
            workOrderId: wo.id,
            startedAt: started,
            endedAt: completed,
            minutes: Math.round(hours * 60),
            planned: true,
            reason: plan.name,
          },
        });
      }
    }

    // Correctivos completados
    const monthCorrectives = correctiveTitles.filter(() => random() > 0.55);
    for (const item of monthCorrectives) {
      const asset = byCode.get(item.asset)!;
      const created = daysAgo(monthsAgo * 30 + Math.round(between(0, 25)));
      const started = new Date(created.getTime() + between(0.05, 0.8) * DAY);
      const hours = Number((item.hours * between(0.8, 1.3)).toFixed(2));
      const completed = new Date(started.getTime() + hours * 3_600_000);
      const tech = pick(technicians);
      const laborCost = Math.round(hours * tech.hourlyRate);
      const usadas = consumirEn(item.asset, false);
      const partsCost = usadas.reduce(
        (t, u) => t + u.cantidad * partSpecs.find((x) => x.code === u.codigo)!.cost,
        0,
      );
      // Uno de cada cuatro correctivos se apoya en un proveedor: hay fallas
      // que no se resuelven con la plantilla propia.
      const servicioExterno = random() > 0.75 ? pick(serviciosExternos) : null;
      const serviceCost = servicioExterno ? Math.round(servicioExterno.unitCost * between(0.85, 1.2)) : 0;
      const failureCode = failureCodes.find((code) => code.code === item.code)!;
      const downtime = Math.round(item.downtime * between(0.7, 1.3));

      const wo = await prisma.workOrder.create({
        data: {
          organizationId: org.id,
          number: nextNumber(),
          title: item.title,
          description: "Reporte de falla levantado por produccion.",
          maintenanceType: "CORRECTIVE",
          status: "CLOSED",
          priority: pick(["MEDIUM", "HIGH", "HIGH", "CRITICAL"]),
          assetId: asset.id,
          siteId: site.id,
          locationId: asset.locationId,
          assignedToId: tech.id,
          createdById: produccion.id,
          createdAt: created,
          dueDate: new Date(created.getTime() + 2 * DAY),
          startedAt: started,
          completedAt: completed,
          closedAt: new Date(completed.getTime() + DAY),
          responseMinutes: Math.round((started.getTime() - created.getTime()) / 60000),
          estimatedHours: item.hours,
          actualHours: hours,
          downtimeMinutes: downtime,
          failureCodeId: failureCode.id,
          rootCauseId: pick(rootCauses).id,
          resolution: "Se reemplazo el componente danado y se verifico operacion normal.",
          laborCost,
          partsCost,
          serviceCost,
          totalCost: laborCost + partsCost + serviceCost,
          labor: {
            create: { userId: tech.id, hours, rate: tech.hourlyRate, cost: laborCost, workedAt: completed },
          },
          servicesUsed: servicioExterno
            ? {
                create: {
                  serviceId: servicioExterno.id,
                  supplierId: servicioExterno.supplierId,
                  descripcion: `${servicioExterno.code} — ${servicioExterno.name}`,
                  quantity: 1,
                  unitCost: serviceCost,
                  cost: serviceCost,
                  folioProveedor: `F-${Math.round(between(1000, 9999))}`,
                },
              }
            : undefined,
        },
      });

      for (const u of usadas) {
        consumos.push({ workOrderId: wo.id, codigo: u.codigo, cantidad: u.cantidad, fecha: completed });
      }

      if (downtime > 0) {
        await prisma.downtimeEvent.create({
          data: {
            assetId: asset.id,
            workOrderId: wo.id,
            startedAt: started,
            endedAt: completed,
            minutes: downtime,
            planned: false,
            reason: item.title,
          },
        });
      }
    }
  }

  // ─────────────────────────────────────────────── Kardex del almacen
  //
  // Los consumos se aplican al final y ordenados por fecha: el saldo despues
  // de cada movimiento tiene que ser el real, y el almacen se resurte cuando
  // baja del minimo, como pasa en una planta. Asi el costo de refacciones de
  // cada orden queda respaldado por una salida que se puede rastrear.
  console.log("Aplicando movimientos de almacen…");
  consumos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  const saldo = new Map(parts.map((p) => [p.code, p.quantityOnHand]));
  const porCodigo = new Map(parts.map((p) => [p.code, p]));
  let resurtidos = 0;

  for (const c of consumos) {
    const parte = porCodigo.get(c.codigo)!;
    const spec = partSpecs.find((x) => x.code === c.codigo)!;
    let actual = saldo.get(c.codigo)!;

    // Si no alcanza, el comprador resurtio unos dias antes hasta el maximo.
    if (actual < c.cantidad) {
      const cantidad = Math.max(spec.max - actual, c.cantidad);
      const fechaCompra = new Date(c.fecha.getTime() - Math.round(between(2, 9)) * DAY);
      actual += cantidad;
      await prisma.stockMovement.create({
        data: {
          organizationId: org.id, partId: parte.id, movementType: "IN",
          quantity: cantidad, unitCost: spec.cost, balanceAfter: actual,
          reference: "Compra de reposicion", createdAt: fechaCompra,
        },
      });
      resurtidos += 1;
    }

    actual -= c.cantidad;
    saldo.set(c.codigo, actual);

    await prisma.workOrderPart.create({
      data: {
        workOrderId: c.workOrderId, partId: parte.id,
        quantity: c.cantidad, unitCost: spec.cost, cost: c.cantidad * spec.cost,
      },
    });
    await prisma.stockMovement.create({
      data: {
        organizationId: org.id, partId: parte.id, workOrderId: c.workOrderId,
        userId: mecanico.id, movementType: "OUT",
        quantity: c.cantidad, unitCost: spec.cost, balanceAfter: actual,
        reference: "Consumo en OT", createdAt: c.fecha,
      },
    });
  }

  await Promise.all(
    [...saldo.entries()].map(([codigo, cantidad]) =>
      prisma.part.update({ where: { id: porCodigo.get(codigo)!.id }, data: { quantityOnHand: cantidad } }),
    ),
  );
  console.log(`  ${consumos.length} salidas · ${resurtidos} compras de reposicion`);

  console.log("Generando backlog actual…");
  const backlog: SeedBacklog[] = [
    { title: "Preventivo mensual torno CNC ST-30", asset: "TOR-101", type: "PREVENTIVE", status: "ASSIGNED", priority: "MEDIUM", due: 2, tech: mecanico, hours: 3, planIndex: 1 },
    { title: "Inspeccion termografica trimestral", asset: "SUB-401", type: "INSPECTION", status: "OPEN", priority: "HIGH", due: 6, tech: electrico, hours: 4, planIndex: 3 },
    { title: "Vibracion elevada en centro de maquinado VF-4", asset: "CNC-201", type: "PREDICTIVE", status: "IN_PROGRESS", priority: "HIGH", due: 1, tech: mecanico, hours: 5 },
    { title: "Fuga de aire en linea de distribucion", asset: "CMP-301", type: "CORRECTIVE", status: "IN_PROGRESS", priority: "HIGH", due: 0, tech: mecanico, hours: 3 },
    { title: "Ajuste de freno en grua viajera", asset: "GRU-501", type: "CORRECTIVE", status: "ON_HOLD", priority: "CRITICAL", due: -2, tech: mecanico, hours: 4 },
    { title: "Prueba semanal del generador", asset: "GEN-402", type: "INSPECTION", status: "OPEN", priority: "MEDIUM", due: 3, tech: electrico, hours: 1, planIndex: 4 },
    { title: "Cambio de banda en torre de enfriamiento", asset: "TOR-701", type: "CORRECTIVE", status: "OPEN", priority: "MEDIUM", due: 5, tech: mecanico, hours: 2 },
    { title: "Reemplazo de sellos en bomba de refrigerante", asset: "BOM-601", type: "CORRECTIVE", status: "ASSIGNED", priority: "MEDIUM", due: 4, tech: mecanico, hours: 3 },
    { title: "Revision de nivel de aceite en generador", asset: "GEN-402", type: "PREDICTIVE", status: "OPEN", priority: "HIGH", due: 8, tech: electrico, hours: 2 },
    { title: "Servicio 500 h montacargas", asset: "MON-502", type: "PREVENTIVE", status: "OPEN", priority: "MEDIUM", due: 9, tech: mecanico, hours: 3, planIndex: 6 },
    { title: "Calibracion de manometros de proceso", asset: "CMP-302", type: "INSPECTION", status: "OPEN", priority: "LOW", due: 14, tech: electrico, hours: 2 },
    { title: "Mejora: instalar variador en bomba de enfriamiento", asset: "BOM-602", type: "IMPROVEMENT", status: "OPEN", priority: "LOW", due: 25, tech: confiabilidad, hours: 8 },
  ];

  for (const item of backlog) {
    const asset = byCode.get(item.asset)!;
    const plan = item.planIndex !== undefined ? plans[item.planIndex] : null;
    const created = daysAgo(Math.round(between(1, 18)));

    await prisma.workOrder.create({
      data: {
        organizationId: org.id,
        number: nextNumber(),
        title: item.title,
        description: plan?.description ?? "Trabajo registrado por el area de mantenimiento.",
        maintenanceType: item.type,
        status: item.status,
        priority: item.priority,
        assetId: asset.id,
        siteId: site.id,
        locationId: asset.locationId,
        planId: plan?.id ?? null,
        assignedToId: ["OPEN"].includes(item.status) ? null : item.tech.id,
        createdById: supervisor.id,
        createdAt: created,
        dueDate: daysAhead(item.due),
        startedAt: ["IN_PROGRESS", "ON_HOLD"].includes(item.status) ? daysAgo(1) : null,
        estimatedHours: item.hours,
        requiresShutdown: plan?.requiresShutdown ?? false,
        safetyNotes: plan?.safetyNotes ?? null,
        tasks: plan
          ? {
              create: plan.tasks.map((task, index) => ({
                position: index,
                title: task.title,
                taskType: task.taskType,
                unit: task.unit,
                minValue: task.minValue,
                maxValue: task.maxValue,
                required: task.required,
                done: item.status === "IN_PROGRESS" && index === 0,
              })),
            }
          : undefined,
      },
    });
  }

  await prisma.organization.update({ where: { id: org.id }, data: { woSequence: woSeq } });

  console.log("Creando solicitudes de servicio…");
  const requests = [
    { title: "El torno Mazak hace un ruido intermitente", asset: "TOR-102", priority: "HIGH", status: "PENDING" },
    { title: "Goteo de agua bajo la torre de enfriamiento", asset: "TOR-701", priority: "MEDIUM", status: "PENDING" },
    { title: "La luz de la nave 2 parpadea", asset: null, priority: "LOW", status: "PENDING" },
    { title: "Montacargas pierde fuerza al elevar", asset: "MON-502", priority: "HIGH", status: "CONVERTED" },
    { title: "Compresor arranca con mucha frecuencia", asset: "CMP-301", priority: "MEDIUM", status: "REJECTED" },
  ];

  let wrSeq = 0;
  for (const item of requests) {
    await prisma.workRequest.create({
      data: {
        organizationId: org.id,
        number: `SS-${String(++wrSeq).padStart(6, "0")}`,
        title: item.title,
        description: "Reportado por el personal de produccion durante el turno.",
        assetId: item.asset ? byCode.get(item.asset)!.id : null,
        siteId: site.id,
        priority: item.priority,
        status: item.status,
        requestedById: produccion.id,
        reviewedById: item.status === "PENDING" ? null : supervisor.id,
        reviewedAt: item.status === "PENDING" ? null : daysAgo(3),
        reviewNotes: item.status === "REJECTED" ? "Comportamiento normal por demanda variable; se ajusto el presostato." : null,
        createdAt: daysAgo(Math.round(between(1, 10))),
      },
    });
  }
  await prisma.organization.update({ where: { id: org.id }, data: { wrSequence: wrSeq } });

  console.log("Creando notificaciones y bitacora…");
  await prisma.notification.createMany({
    data: [
      { organizationId: org.id, userId: supervisor.id, title: "3 solicitudes pendientes de revision", body: "Produccion reporto nuevas fallas.", link: "/requests", kind: "INFO" },
      { organizationId: org.id, userId: supervisor.id, title: "Alerta critica de vibracion", body: "CMP-301 supero el umbral critico.", link: "/alerts", kind: "CRITICAL" },
      { organizationId: org.id, userId: mecanico.id, title: "OT asignada", body: "Preventivo mensual torno CNC ST-30", link: "/work-orders", kind: "INFO" },
      { organizationId: org.id, userId: director.id, title: "Refacciones bajo minimo", body: "3 articulos requieren reposicion.", link: "/inventory", kind: "WARNING" },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      { organizationId: org.id, userId: director.id, entity: "Organization", entityId: org.id, action: "CREATED", summary: "Alta del espacio de trabajo" },
      { organizationId: org.id, userId: supervisor.id, entity: "MaintenancePlan", entityId: plans[0].id, action: "CREATED", summary: plans[0].name },
      { organizationId: org.id, userId: confiabilidad.id, entity: "Sensor", entityId: org.id, action: "CREATED", summary: "Alta de puntos de monitoreo predictivo" },
    ],
  });

  const ordenes = await prisma.workOrder.count({ where: { organizationId: org.id } });
  return {
    organizationId: org.id,
    nombre: org.name,
    activos: assets.length,
    planes: plans.length,
    ordenes,
    acceso: `director@${opciones.dominio}`,
  };
}
