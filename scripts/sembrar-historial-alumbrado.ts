/**
 * Historial de EJEMPLO para probar el Mapa de Activos de «Alumbrado Público (ejemplo)».
 *
 *   npx tsx scripts/sembrar-historial-alumbrado.ts                    # ensayo: solo dice qué haría
 *   npx tsx scripts/sembrar-historial-alumbrado.ts --aplicar          # lo escribe
 *   npx tsx scripts/sembrar-historial-alumbrado.ts --hoy 2026-11-07   # fija «hoy» (ensayo y aplicación dan lo mismo)
 *   ./scripts/con-produccion.sh scripts/sembrar-historial-alumbrado.ts [--aplicar]
 *
 * Qué deja, para que CADA capa del mapa (estado, fallas, costo, paros) tenga algo distinto que mostrar:
 *  - Reincidentes: 6 luminarias con 4–6 fallas en el año, repartidas para que se vean en 30, 90 y 365 días.
 *  - Fallas sueltas en ~30 luminarias, y fallas de tablero (más caras y con paros largos).
 *  - Órdenes abiertas (abierta, asignada, en proceso, en espera), unas con paro abierto: el mapa las pinta
 *    como «degradada» o «fuera de servicio» aunque el campo del activo diga otra cosa.
 *  - Lo que NO debe contar como falla: preventivos y rondas con costo, órdenes canceladas y paros planeados.
 *  - Reportes de falla (solicitudes) convertidos en orden, pendientes, aprobados y rechazados.
 *  - Mano de obra de 4 personas con tarifa, refacciones que SALEN del almacén por `aplicarMovimiento`
 *    (kardex y costo promedio coherentes) y servicios externos (canastilla, grúa).
 *
 * TODO es de ejemplo y se rotula: cada orden y solicitud empieza con «[Historial de ejemplo]», las personas
 * dicen «(ejemplo)» y los precios son SINTÉTICOS (los de la primera siembra no llevaban costo a propósito:
 * sin precio no hay capa de costo que probar). No son precios del municipio ni de ningún proveedor.
 *
 * Solo toca la empresa con slug «alumbrado-ejemplo»; nunca otra. No borra nada: si ya hay historial
 * sembrado, se detiene. Datos personales: ninguno real (nombres y celulares sintéticos).
 * En producción, solo con el OK de Rafael y con ./scripts/con-produccion.sh.
 */
import { randomBytes } from "node:crypto";

const aplicar = process.argv.includes("--aplicar");
const iHoy = process.argv.indexOf("--hoy");
const AHORA = iHoy >= 0 ? new Date(`${process.argv[iHoy + 1]}T18:00:00Z`) : new Date();
const SLUG = "alumbrado-ejemplo";
const MARCA = "[Historial de ejemplo]";
const DIA = 86_400_000;

// ─── Azar determinista: ensayo y aplicación generan exactamente lo mismo ───
function mulberry32(semilla: number) {
  let a = semilla;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const azar = mulberry32(20261107);
const entre = (a: number, b: number) => a + azar() * (b - a);
const entero = (a: number, b: number) => Math.round(entre(a, b));
const elige = <T,>(xs: readonly T[]) => xs[Math.floor(azar() * xs.length)];
const redondea = (n: number) => Math.round(n * 100) / 100;

// ─── Precios SINTÉTICOS (MXN) ───
const PRECIO: Record<string, number> = {
  "LUM-LED-50": 1950, "LUM-LED-100": 3200, "DRV-50": 640, "DRV-100": 880, "MOD-LED": 720,
  "LAM-VSAP-100": 185, "LAM-VSAP-250": 260, "BAL-100": 540, "ARR-VSAP": 120,
  "FOTO-UNIV": 160, "FOTO-BASE": 55, "CABLE-DUP": 38, "CABLE-12": 14, "CONECT-PERF": 22,
  "EMPALME-GEL": 85, "BRAZO-2.5": 780, "ABRAZ": 95, "TORN-GALV": 62, "POSTE-9": 4900,
  "CONTACTOR": 1450, "INT-TERM-30": 310, "SUPRESOR": 420, "FUS-PORTA": 70, "LIMP-OPT": 90, "CINTA-AUTO": 45,
};

type Caso = {
  clave: string; titulo: string; falla: string; causa: string;
  partes: ReadonlyArray<readonly [string, number]>; horas: [number, number];
  servicio?: { descripcion: string; costo: [number, number] }; prioridad: string;
};
const CASOS_LUMINARIA: ReadonlyArray<Caso & { peso: number }> = [
  { peso: 5, clave: "driver", titulo: "Luminaria apagada: driver dañado", falla: "ELE-02", causa: "SOBRETENSION", partes: [["DRV-50", 1], ["CONECT-PERF", 2]], horas: [0.8, 1.5], prioridad: "HIGH" },
  { peso: 5, clave: "lampara", titulo: "Luminaria apagada: lámpara agotada", falla: "ELE-03", causa: "VIDA-UTIL", partes: [["LAM-VSAP-100", 1]], horas: [0.4, 0.9], prioridad: "MEDIUM" },
  { peso: 3, clave: "foto", titulo: "Enciende de día: fotocelda dañada", falla: "ELE-05", causa: "VIDA-UTIL", partes: [["FOTO-UNIV", 1]], horas: [0.4, 0.8], prioridad: "MEDIUM" },
  { peso: 2, clave: "cable", titulo: "Sin energía: cable robado", falla: "ELE-06", causa: "ROBO", partes: [["CABLE-DUP", 25], ["CONECT-PERF", 3], ["CINTA-AUTO", 1]], horas: [2, 3.5], servicio: { descripcion: "Canastilla para tendido de cable (ejemplo)", costo: [1200, 1800] }, prioridad: "HIGH" },
  { peso: 2, clave: "parpadeo", titulo: "Parpadeo en luminaria", falla: "OPT-01", causa: "CONEXION", partes: [["EMPALME-GEL", 1], ["CINTA-AUTO", 1]], horas: [0.6, 1.2], prioridad: "LOW" },
  { peso: 1, clave: "poste", titulo: "Poste chocado: reposición de brazo y luminaria", falla: "EST-01", causa: "IMPACTO", partes: [["BRAZO-2.5", 1], ["ABRAZ", 2], ["LUM-LED-100", 1]], horas: [3.5, 5], servicio: { descripcion: "Grúa para poste (ejemplo)", costo: [3000, 4200] }, prioridad: "CRITICAL" },
];
const CASOS_TABLERO: ReadonlyArray<Caso> = [
  { clave: "contactor", titulo: "Circuito sin encender: contactor del tablero", falla: "ELE-01", causa: "VIDA-UTIL", partes: [["CONTACTOR", 1], ["CONECT-PERF", 4]], horas: [2.5, 4], servicio: { descripcion: "Maniobra con CFE para desenergizar (ejemplo)", costo: [900, 1400] }, prioridad: "CRITICAL" },
  { clave: "termico", titulo: "Disparo del interruptor termomagnético del tablero", falla: "ELE-04", causa: "SOBRETENSION", partes: [["INT-TERM-30", 1], ["SUPRESOR", 1]], horas: [1.5, 2.5], prioridad: "HIGH" },
];

// ─── El plan: una lista de hechos, sin tocar la base ───
type Hecho = {
  tipo: "CORRECTIVA_CERRADA" | "CORRECTIVA_ABIERTA" | "PREVENTIVA" | "RONDA" | "CANCELADA";
  activo: string; titulo: string; caso?: Caso; diasAtras: number; tecnico: number;
  estado?: "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "ON_HOLD";
  paroAbierto?: boolean; paroPlaneadoMin?: number; conSolicitud?: boolean; horasTrabajadas?: [number, number];
  partes?: ReadonlyArray<readonly [string, number]>;
};

function planear(luminarias: string[], tableros: string[], circuitos: string[]): Hecho[] {
  const hechos: Hecho[] = [];
  const caso = () => {
    const total = CASOS_LUMINARIA.reduce((s, c) => s + c.peso, 0);
    let r = azar() * total;
    for (const c of CASOS_LUMINARIA) { r -= c.peso; if (r <= 0) return c; }
    return CASOS_LUMINARIA[0];
  };
  const L = (n: number) => luminarias[n - 1];

  // Reincidentes: fechas escalonadas para que cada período (30/90/365) vea un mapa distinto.
  const REINCIDENTES: Array<[number, number[]]> = [
    [12, [3, 21, 58, 140, 230, 330]], [47, [9, 44, 120, 210, 300]], [88, [14, 70, 160, 250, 340]],
    [133, [26, 85, 190, 310]], [171, [5, 100, 200, 290]], [230, [38, 130, 220, 350]],
  ];
  const usadas = new Set<string>(REINCIDENTES.map(([n]) => L(n)));
  for (const [n, fechas] of REINCIDENTES) for (const d of fechas) {
    const c = caso();
    hechos.push({ tipo: "CORRECTIVA_CERRADA", activo: L(n), titulo: c.titulo, caso: c, diasAtras: d, tecnico: entero(0, 2), conSolicitud: azar() < 0.8 });
  }
  // Fallas sueltas: ~30 luminarias con 1–3 fallas.
  let colocadas = 0;
  while (colocadas < 30) {
    const codigo = elige(luminarias);
    if (usadas.has(codigo)) continue;
    usadas.add(codigo); colocadas++;
    const veces = azar() < 0.55 ? 1 : azar() < 0.7 ? 2 : 3;
    for (let i = 0; i < veces; i++) {
      const c = caso();
      hechos.push({ tipo: "CORRECTIVA_CERRADA", activo: codigo, titulo: c.titulo, caso: c, diasAtras: Math.round(5 + 355 * Math.pow(azar(), 1.4)), tecnico: entero(0, 2), conSolicitud: azar() < 0.7 });
    }
  }
  // Tableros: pocas fallas, más caras y con paros largos.
  [[tableros[0], CASOS_TABLERO[0], 18], [tableros[0], CASOS_TABLERO[1], 95], [tableros[0], CASOS_TABLERO[0], 260],
   [tableros[1], CASOS_TABLERO[1], 41], [tableros[1], CASOS_TABLERO[0], 175]].forEach(([a, c, d]) => {
    hechos.push({ tipo: "CORRECTIVA_CERRADA", activo: a as string, titulo: (c as Caso).titulo, caso: c as Caso, diasAtras: d as number, tecnico: 0, conSolicitud: true });
  });

  // Abiertas: cada estado, unas con paro abierto (→ «fuera de servicio» en el mapa), sobre luminarias SIN historial.
  const libres = luminarias.filter((l) => !usadas.has(l) && !["LUM-0029", "LUM-0058", "LUM-0087", "LUM-0116"].includes(l));
  const ABIERTAS: Array<Pick<Hecho, "estado" | "paroAbierto" | "diasAtras" | "horasTrabajadas">> = [
    { estado: "OPEN", paroAbierto: true, diasAtras: 1 }, { estado: "OPEN", diasAtras: 2 }, { estado: "OPEN", diasAtras: 6 },
    { estado: "ASSIGNED", paroAbierto: true, diasAtras: 3 }, { estado: "ASSIGNED", diasAtras: 5 },
    { estado: "IN_PROGRESS", paroAbierto: true, diasAtras: 1, horasTrabajadas: [0.5, 1] }, { estado: "IN_PROGRESS", diasAtras: 4, horasTrabajadas: [0.3, 0.8] },
    { estado: "ON_HOLD", diasAtras: 11, horasTrabajadas: [0.5, 1] },
  ];
  ABIERTAS.forEach((o, i) => {
    const c = i === 7 ? CASOS_LUMINARIA[5] : caso();
    hechos.push({ tipo: "CORRECTIVA_ABIERTA", activo: libres[i * 7], titulo: c.titulo, caso: c, tecnico: entero(0, 2), conSolicitud: true, ...o });
  });

  // Lo que NO es falla pero cuesta o para: preventivos, rondas, paros planeados, canceladas.
  for (let i = 0; i < 18; i++) {
    hechos.push({ tipo: "PREVENTIVA", activo: libres[40 + i * 5], titulo: "Limpieza de difusor y revisión de óptica", diasAtras: Math.round(10 + i * 19), tecnico: entero(0, 2), partes: [["LIMP-OPT", 0.25]] });
  }
  tableros.forEach((t, i) => hechos.push({ tipo: "PREVENTIVA", activo: t, titulo: "Revisión de tablero (contactor, selector, reloj, conexiones, térmico)", diasAtras: 30 + i * 40, tecnico: 0, paroPlaneadoMin: 90 + i * 30, partes: [["CINTA-AUTO", 1]] }));
  circuitos.slice(0, 4).forEach((c, i) => hechos.push({ tipo: "RONDA", activo: c, titulo: "Ronda nocturna de verificación de encendido", diasAtras: 4 + i * 25, tecnico: 2 }));
  [libres[200], libres[210]].forEach((a, i) => hechos.push({ tipo: "CANCELADA", activo: a, titulo: "Luminaria apagada: reporte duplicado", diasAtras: 15 + i * 60, tecnico: 0, caso: CASOS_LUMINARIA[1] }));
  return hechos;
}

async function main() {
  const { prisma } = await import("../lib/db");
  const esLocal = (process.env.DATABASE_URL ?? "").startsWith("file:");
  console.log(`Base: ${esLocal ? "SQLite local" : "REMOTA (solo con el OK de Rafael)"}  ·  «hoy»: ${AHORA.toISOString().slice(0, 10)}`);

  const org = await prisma.organization.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!org) throw new Error(`No existe la empresa «${SLUG}». Primero: scripts/sembrar-alumbrado-demo.ts`);
  const previo = await prisma.workOrder.count({ where: { organizationId: org.id, description: { startsWith: MARCA } } });
  if (previo) { console.log(`«${org.name}» ya tiene ${previo} órdenes de este historial. No se vuelve a sembrar.`); return; }

  const director = await prisma.user.findFirstOrThrow({ where: { organizationId: org.id, role: "OWNER" }, select: { id: true } });
  const activos = await prisma.asset.findMany({ where: { organizationId: org.id }, select: { id: true, code: true, siteId: true, locationId: true } });
  const activo = new Map(activos.map((a) => [a.code, a]));
  const luminarias = activos.map((a) => a.code).filter((c) => c.startsWith("LUM-")).sort();
  const tableros = activos.map((a) => a.code).filter((c) => c.startsWith("TAB-")).sort();
  const circuitos = activos.map((a) => a.code).filter((c) => c.startsWith("CIR-")).sort();
  if (luminarias.length < 250 || tableros.length < 2 || circuitos.length < 4) throw new Error(`Faltan activos del demo (luminarias ${luminarias.length}, tableros ${tableros.length}, circuitos ${circuitos.length}).`);

  const partes = new Map((await prisma.part.findMany({ where: { organizationId: org.id }, select: { id: true, code: true } })).map((p) => [p.code, p.id]));
  const fallas = new Map((await prisma.failureCode.findMany({ where: { organizationId: org.id }, select: { id: true, code: true } })).map((f) => [f.code, f.id]));
  const causas = new Map((await prisma.rootCause.findMany({ where: { organizationId: org.id }, select: { id: true, code: true } })).map((c) => [c.code, c.id]));

  const hechos = planear(luminarias, tableros, circuitos);

  // Todo lo que el plan nombra tiene que existir ANTES de escribir algo.
  const faltan = new Set<string>();
  for (const h of hechos) {
    if (!activo.has(h.activo)) faltan.add(`activo ${h.activo}`);
    for (const [c] of [...(h.caso?.partes ?? []), ...(h.partes ?? [])]) if (!partes.has(c)) faltan.add(`refacción ${c}`);
    if (h.caso && !fallas.has(h.caso.falla)) faltan.add(`falla ${h.caso.falla}`);
    if (h.caso && !causas.has(h.caso.causa)) faltan.add(`causa ${h.caso.causa}`);
  }
  if (faltan.size) throw new Error(`Faltan en la base: ${[...faltan].join(", ")}. No se escribe nada.`);

  // Demanda por refacción → entradas de almacén que la cubren (con holgura).
  const demanda = new Map<string, number>();
  for (const h of hechos) for (const [c, q] of [...(h.caso?.partes ?? []), ...(h.partes ?? [])]) if (h.tipo !== "CANCELADA") demanda.set(c, (demanda.get(c) ?? 0) + q);

  const cuenta = (t: Hecho["tipo"]) => hechos.filter((h) => h.tipo === t).length;
  const solicitudesExtra = { PENDING: 4, APPROVED: 2, REJECTED: 2 };
  const reincidentes = new Set(hechos.filter((h) => h.tipo === "CORRECTIVA_CERRADA").map((h) => h.activo)).size;
  console.log(`\nSe crearía en «${org.name}»:`);
  console.log(`  ${cuenta("CORRECTIVA_CERRADA")} correctivas cerradas (en ${reincidentes} equipos), ${cuenta("CORRECTIVA_ABIERTA")} abiertas, ${cuenta("PREVENTIVA")} preventivas, ${cuenta("RONDA")} rondas, ${cuenta("CANCELADA")} canceladas`);
  console.log(`  ${hechos.filter((h) => h.conSolicitud).length} reportes de falla convertidos en orden + ${Object.values(solicitudesExtra).reduce((a, b) => a + b, 0)} sueltos (pendientes, aprobados, rechazados)`);
  console.log(`  entradas de almacén para ${demanda.size} refacciones (precios SINTÉTICOS), 4 personas de ejemplo con tarifa`);
  if (!aplicar) { console.log("\nEnsayo: no se escribió nada. Agregue --aplicar."); return; }

  const { hashPassword } = await import("../lib/auth");
  const { aplicarMovimiento } = await import("../lib/almacen");
  const { siguienteFolio } = await import("../lib/numbering");
  const { recalcWorkOrder } = await import("../lib/workorders");
  const { centroDeCostoDelActivo } = await import("../lib/centro-de-costo");

  // Personas de ejemplo: sin contraseña utilizable (nadie entra con ellas).
  const hashInutil = await hashPassword(randomBytes(24).toString("hex"));
  const PERSONAS = [
    { clave: "electricista1", nombre: "Electricista de alumbrado 1 (ejemplo)", puesto: "Electricista", rol: "TECHNICIAN", tarifa: 185 },
    { clave: "liniero1", nombre: "Liniero 1 (ejemplo)", puesto: "Liniero", rol: "TECHNICIAN", tarifa: 230 },
    { clave: "electricista2", nombre: "Electricista de alumbrado 2 (ejemplo)", puesto: "Electricista", rol: "TECHNICIAN", tarifa: 185 },
    { clave: "supervision", nombre: "Supervisor de alumbrado (ejemplo)", puesto: "Supervisor", rol: "SUPERVISOR", tarifa: 260 },
  ] as const;
  const personas: Array<{ id: string; rate: number }> = [];
  for (const p of PERSONAS) {
    const email = `${p.clave}@${SLUG}.mx`;
    const u = (await prisma.user.findUnique({ where: { email } })) ??
      (await prisma.user.create({ data: { organizationId: org.id, email, name: p.nombre, role: p.rol, jobTitle: p.puesto, hourlyRate: p.tarifa, passwordHash: hashInutil } }));
    personas.push({ id: u.id, rate: p.tarifa });
  }
  const supervisor = personas[3];

  const almacen = (await prisma.warehouse.findFirst({ where: { organizationId: org.id, active: true }, orderBy: [{ esGeneral: "desc" }, { code: "asc" }], select: { id: true } }))
    ?? (await prisma.warehouse.create({ data: { organizationId: org.id, code: "ALM-01", name: "Almacén general (ejemplo)", esGeneral: true }, select: { id: true } }));

  // Mueve el almacén por el camino único y fecha el movimiento cuando ocurrió.
  async function mover(cuando: Date, m: { code: string; tipo: "IN" | "OUT"; cantidad: number; costo?: number; referencia: string; workOrderId?: string; userId: string }) {
    await aplicarMovimiento({
      organizationId: org!.id, partId: partes.get(m.code)!, warehouseId: almacen.id, tipo: m.tipo, cantidad: m.cantidad,
      costoUnitario: m.costo, referencia: m.referencia, workOrderId: m.workOrderId ?? null, userId: m.userId,
      ...(m.tipo === "IN" ? { motivo: "COMPRA_SIN_ORDEN" } : {}),
    });
    const ultimo = await prisma.stockMovement.findFirst({ where: { organizationId: org!.id, partId: partes.get(m.code)! }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (ultimo) await prisma.stockMovement.update({ where: { id: ultimo.id }, data: { createdAt: cuando } });
  }

  console.log("\nEntradas de almacén…");
  const apertura = new Date(AHORA.getTime() - 400 * DIA);
  for (const [code, q] of demanda) {
    await mover(apertura, { code, tipo: "IN", cantidad: Math.ceil(q * 1.4) + 3, costo: PRECIO[code], referencia: "Existencia de ejemplo (precio sintético)", userId: supervisor.id });
  }
  console.log(`  ✓ ${demanda.size} refacciones`);

  console.log("Órdenes…");
  const hace = (dias: number, horas = 0) => new Date(AHORA.getTime() - dias * DIA + horas * 3_600_000);
  let nOrdenes = 0, nSolicitudes = 0, nParos = 0;
  const costo = { mano: 0, refacciones: 0, servicios: 0 };

  for (const h of hechos) {
    const a = activo.get(h.activo)!;
    const tec = personas[h.tecnico];
    const abierta = h.tipo === "CORRECTIVA_ABIERTA";
    const cancelada = h.tipo === "CANCELADA";
    const esCorrectiva = h.tipo === "CORRECTIVA_CERRADA" || abierta || cancelada;
    const tipoOt = esCorrectiva ? "CORRECTIVE" : h.tipo === "PREVENTIVA" ? "PREVENTIVE" : "INSPECTION";
    const horas = h.caso ? redondea(entre(h.caso.horas[0], h.caso.horas[1])) : h.tipo === "PREVENTIVA" ? 0.5 : 1.5;
    const creada = hace(h.diasAtras, -entero(0, 6));
    const respuestaMin = esCorrectiva ? entero(180, 1800) : 0;
    const inicio = new Date(creada.getTime() + respuestaMin * 60_000);
    const fin = new Date(inicio.getTime() + horas * 3_600_000);
    const cierre = new Date(fin.getTime() + 20 * 3_600_000);
    const paroMin = h.tipo === "CORRECTIVA_CERRADA" ? Math.round(respuestaMin + horas * 60) : 0;
    const estado = cancelada ? "CANCELLED" : abierta ? h.estado! : "CLOSED";
    const folio = await siguienteFolio(org.id, "ordenTrabajo");
    const falla = h.caso && !cancelada && !abierta;

    const wo = await prisma.workOrder.create({
      data: {
        organizationId: org.id, number: folio, title: h.titulo, maintenanceType: tipoOt, status: estado,
        priority: h.caso?.prioridad ?? "LOW", description: `${MARCA} ${h.caso ? "Reporte de ejemplo." : "Trabajo programado de ejemplo."}`,
        assetId: a.id, siteId: a.siteId, locationId: a.locationId, createdById: supervisor.id,
        assignedToId: abierta && h.estado === "OPEN" ? null : tec.id,
        centroDeCostoId: await centroDeCostoDelActivo(org.id, a.id),
        createdAt: creada, dueDate: new Date(creada.getTime() + 3 * DIA),
        ...(estado === "CLOSED" ? {
          startedAt: inicio, completedAt: fin, closedAt: cierre, responseMinutes: respuestaMin || null,
          estimatedHours: horas, actualHours: horas, downtimeMinutes: paroMin, requiresShutdown: paroMin > 0 || !!h.paroPlaneadoMin,
          sinParoConfirmado: paroMin === 0 && !h.paroPlaneadoMin, resolution: `Atendida (ejemplo): ${h.titulo.toLowerCase()}`,
          failureCodeId: falla ? fallas.get(h.caso!.falla)! : null, rootCauseId: falla ? causas.get(h.caso!.causa)! : null,
        } : {}),
        ...(estado === "IN_PROGRESS" || estado === "ON_HOLD" ? { startedAt: inicio, responseMinutes: respuestaMin } : {}),
        ...(estado === "ON_HOLD" ? { motivoEspera: "Esperando refacción (ejemplo)" } : {}),
        ...(cancelada ? { motivoCancelacion: "Reporte duplicado (ejemplo)" } : {}),
      },
    });
    nOrdenes++;
    if (cancelada) continue; // una cancelada no gasta nada ni para a nadie

    const tarea = await prisma.workOrderTask.create({
      data: {
        workOrderId: wo.id, position: 0, title: h.titulo, taskType: "CHECK", maintenanceType: tipoOt,
        done: estado === "CLOSED", completedById: estado === "CLOSED" ? tec.id : null, completedAt: estado === "CLOSED" ? fin : null,
        ...(falla ? { failureCodeId: fallas.get(h.caso!.falla)!, rootCauseId: causas.get(h.caso!.causa)!, downtimeMinutes: paroMin } : {}),
      },
    });

    // Mano de obra: en las abiertas con avance, solo lo trabajado hasta hoy.
    const horasMo = abierta ? (h.horasTrabajadas ? redondea(entre(h.horasTrabajadas[0], h.horasTrabajadas[1])) : 0) : horas;
    if (horasMo > 0) {
      const costoMo = redondea(horasMo * tec.rate);
      await prisma.workOrderLabor.create({ data: { workOrderId: wo.id, taskId: tarea.id, userId: tec.id, hours: horasMo, rate: tec.rate, cost: costoMo, workedAt: abierta ? hace(Math.max(0, h.diasAtras - 1)) : fin, notes: "Mano de obra de ejemplo" } });
      costo.mano += costoMo;
    }

    // Refacciones: SALEN del almacén por el camino único y se cargan a la orden.
    const lista = abierta && !h.horasTrabajadas ? [] : [...(h.caso?.partes ?? []), ...(h.partes ?? [])];
    for (const [code, cantidad] of lista) {
      await mover(abierta ? hace(Math.max(0, h.diasAtras - 1)) : fin, { code, tipo: "OUT", cantidad, referencia: folio, workOrderId: wo.id, userId: tec.id });
      const unit = (await prisma.part.findUniqueOrThrow({ where: { id: partes.get(code)! }, select: { unitCost: true } })).unitCost;
      await prisma.workOrderPart.create({ data: { workOrderId: wo.id, taskId: tarea.id, partId: partes.get(code)!, quantity: cantidad, unitCost: unit, cost: redondea(unit * cantidad) } });
      costo.refacciones += redondea(unit * cantidad);
    }

    // Servicios externos (canastilla, grúa, CFE): solo en las correctivas cerradas.
    if (h.caso?.servicio && estado === "CLOSED") {
      const s = h.caso.servicio;
      const importe = Math.round(entre(s.costo[0], s.costo[1]) / 50) * 50;
      await prisma.workOrderService.create({ data: { workOrderId: wo.id, taskId: tarea.id, descripcion: s.descripcion, quantity: 1, unitCost: importe, cost: importe, folioProveedor: `F-${folio.slice(-4)}`, createdAt: fin } });
      costo.servicios += importe;
    }

    // Paros: real (falla cerrada), abierto (sin fin), o planeado (preventivo; no cuenta como paro de falla).
    if (paroMin > 0) { await prisma.downtimeEvent.create({ data: { organizationId: org.id, assetId: a.id, workOrderId: wo.id, startedAt: creada, endedAt: new Date(creada.getTime() + paroMin * 60_000), minutes: paroMin, planned: false, reason: h.titulo } }); nParos++; }
    if (h.paroPlaneadoMin) { await prisma.downtimeEvent.create({ data: { organizationId: org.id, assetId: a.id, workOrderId: wo.id, startedAt: inicio, endedAt: new Date(inicio.getTime() + h.paroPlaneadoMin * 60_000), minutes: h.paroPlaneadoMin, planned: true, reason: "Paro planeado: " + h.titulo } }); nParos++; }
    if (abierta && h.paroAbierto) { await prisma.downtimeEvent.create({ data: { organizationId: org.id, assetId: a.id, workOrderId: wo.id, startedAt: creada, endedAt: null, minutes: 0, planned: false, reason: h.titulo } }); nParos++; }

    // El reporte de falla que originó la orden (lo hizo un vecino por el código QR/enlace público).
    if (h.conSolicitud && h.caso) {
      await prisma.workRequest.create({
        data: {
          organizationId: org.id, number: await siguienteFolio(org.id, "solicitud"), title: h.titulo, description: `${MARCA} Reporte ciudadano de ejemplo.`,
          assetId: a.id, siteId: a.siteId, locationId: a.locationId, priority: h.caso.prioridad, status: "CONVERTED", tipo: "FALLA",
          reporterNombre: "Vecino (ejemplo)", reporterCelular: null, workOrderId: wo.id, reviewedById: supervisor.id,
          reviewedAt: new Date(creada.getTime() + 20 * 60_000), createdAt: new Date(creada.getTime() - 15 * 60_000),
        },
      });
      nSolicitudes++;
    }
    await recalcWorkOrder(wo.id);
  }

  // Reportes sueltos: pendientes y aprobados sin orden todavía, y rechazados (duplicado / no es falla).
  const sueltas = hechos.length; void sueltas;
  const usadasPorOrden = new Set(hechos.map((h) => h.activo));
  const disponibles = luminarias.filter((l) => !usadasPorOrden.has(l));
  const SUELTAS: Array<[keyof typeof solicitudesExtra, string, number, string | null]> = [];
  (Object.keys(solicitudesExtra) as Array<keyof typeof solicitudesExtra>).forEach((estado) => {
    for (let i = 0; i < solicitudesExtra[estado]; i++) SUELTAS.push([estado, estado === "REJECTED" ? "Luminaria apagada (duplicado)" : "Luminaria apagada en la calle", entero(0, 9), estado === "REJECTED" ? "Ya existe un reporte abierto para esa luminaria (ejemplo)." : null]);
  });
  for (const [estado, titulo, dias, nota] of SUELTAS) {
    const a = activo.get(elige(disponibles))!;
    const creada = hace(dias, -entero(0, 8));
    await prisma.workRequest.create({
      data: {
        organizationId: org.id, number: await siguienteFolio(org.id, "solicitud"), title: titulo, description: `${MARCA} Reporte ciudadano de ejemplo.`,
        assetId: a.id, siteId: a.siteId, locationId: a.locationId, priority: "MEDIUM", status: estado, tipo: "FALLA", reporterNombre: "Vecino (ejemplo)",
        createdAt: creada, ...(estado !== "PENDING" ? { reviewedById: supervisor.id, reviewedAt: new Date(creada.getTime() + 3_600_000), reviewNotes: nota } : {}),
      },
    });
    nSolicitudes++;
  }

  console.log(`  ✓ ${nOrdenes} órdenes · ${nSolicitudes} reportes de falla · ${nParos} paros`);
  console.log(`  ✓ mano de obra $${costo.mano.toFixed(0)} · refacciones $${costo.refacciones.toFixed(0)} · servicios $${costo.servicios.toFixed(0)} (sintéticos)`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
