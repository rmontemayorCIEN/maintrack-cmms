/**
 * Demo de alumbrado público: una empresa de EJEMPLO con catálogos, circuitos,
 * luminarias ubicadas en el mapa, planes y unas órdenes correctivas.
 *
 *   npx tsx scripts/sembrar-alumbrado-demo.ts                  # ensayo: solo dice qué haría
 *   npx tsx scripts/sembrar-alumbrado-demo.ts --aplicar        # la crea
 *   npx tsx scripts/sembrar-alumbrado-demo.ts --catalogos RUTA # carpeta con los CSV de catálogos
 *
 * Todo lo que crea es de EJEMPLO y se rotula así: la empresa se llama «(ejemplo)»,
 * cada luminaria dice «ejemplo» en su nombre y las coordenadas son sintéticas
 * (una rejilla de calles alrededor del centro de Guadalupe, N.L.). NO son las
 * luminarias del municipio.
 *
 * Los catálogos entran por el IMPORTADOR de MainTrack, el mismo que usará el
 * cliente: así el demo también prueba que los archivos que se le entregan sirven.
 * No lleva costos ni existencias a propósito: no se inventan precios.
 *
 * En producción, solo con el OK de Rafael y con ./scripts/con-produccion.sh.
 * Solo toca la empresa con slug «alumbrado-ejemplo»; nunca otra.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const aplicar = process.argv.includes("--aplicar");
const iCat = process.argv.indexOf("--catalogos");
const CARPETA = iCat >= 0 ? process.argv[iCat + 1] : join(homedir(), "Proyectos/alumbrado-guadalupe/importables");
const SLUG = "alumbrado-ejemplo";

// Centro de Guadalupe, N.L. Todo se genera alrededor de este punto.
const CENTRO = { lat: 25.6772, lon: -100.2594 };
const POR_CIRCUITO = 50;
const PASO = 0.00035; // ~38 m entre luminarias

const csv = (filas: string[][]) =>
  filas.map((f) => f.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
const leer = (archivo: string) => readFileSync(join(CARPETA, archivo), "utf8");

type Calle = { codigo: string; nombre: string; tablero: string; sector: string; dLat: number; dLon: number; origen: [number, number] };
// Seis calles, tres por tablero, cada una con su circuito. Direcciones distintas para que el mapa no sea una sola línea.
const TABLEROS = [
  { codigo: "TAB-01", nombre: "Tablero de control Centro (ejemplo)", sector: "SEC-1", punto: [CENTRO.lat, CENTRO.lon] as [number, number] },
  { codigo: "TAB-02", nombre: "Tablero de control Poniente (ejemplo)", sector: "SEC-2", punto: [CENTRO.lat + 0.006, CENTRO.lon - 0.012] as [number, number] },
];
const CALLES: Calle[] = [
  { codigo: "CIR-01", nombre: "Circuito 1 (ejemplo)", tablero: "TAB-01", sector: "SEC-1", dLat: 0, dLon: PASO, origen: [CENTRO.lat, CENTRO.lon] },
  { codigo: "CIR-02", nombre: "Circuito 2 (ejemplo)", tablero: "TAB-01", sector: "SEC-1", dLat: PASO, dLon: 0, origen: [CENTRO.lat, CENTRO.lon] },
  { codigo: "CIR-03", nombre: "Circuito 3 (ejemplo)", tablero: "TAB-01", sector: "SEC-1", dLat: -PASO * 0.6, dLon: PASO * 0.8, origen: [CENTRO.lat - 0.003, CENTRO.lon] },
  { codigo: "CIR-04", nombre: "Circuito 4 (ejemplo)", tablero: "TAB-02", sector: "SEC-2", dLat: 0, dLon: PASO, origen: [CENTRO.lat + 0.006, CENTRO.lon - 0.012] },
  { codigo: "CIR-05", nombre: "Circuito 5 (ejemplo)", tablero: "TAB-02", sector: "SEC-2", dLat: PASO, dLon: 0, origen: [CENTRO.lat + 0.006, CENTRO.lon - 0.012] },
  { codigo: "CIR-06", nombre: "Circuito 6 (ejemplo)", tablero: "TAB-02", sector: "SEC-2", dLat: PASO * 0.7, dLon: PASO * 0.7, origen: [CENTRO.lat + 0.009, CENTRO.lon - 0.012] },
];

const r6 = (n: number) => n.toFixed(6);

function construirActivos() {
  const filas: string[][] = [["codigo", "nombre", "sitio", "ubicacion", "categoria", "criticidad", "estado", "descripcion", "latitud", "longitud"]];
  const luminarias: string[] = [];
  const caidas: string[] = [];
  for (const t of TABLEROS) {
    filas.push([t.codigo, t.nombre, "GPE", t.sector, "TABL", "A", "OPERATIONAL", "Dato de ejemplo", r6(t.punto[0]), r6(t.punto[1])]);
  }
  let n = 0;
  for (const c of CALLES) {
    filas.push([c.codigo, c.nombre, "GPE", c.sector, "CIRC", "A", "OPERATIONAL", "Dato de ejemplo", r6(c.origen[0] + c.dLat * 25), r6(c.origen[1] + c.dLon * 25)]);
    for (let i = 1; i <= POR_CIRCUITO; i++) {
      n++;
      const codigo = `LUM-${String(n).padStart(4, "0")}`;
      // Cada 9.ª luminaria es de vapor de sodio (las que se van sustituyendo); el resto LED.
      const categoria = n % 9 === 0 ? "LUM-VSAP" : "LUM-LED";
      // Unas pocas fuera de servicio y degradadas, para que el mapa tenga qué mostrar.
      const estado = n % 29 === 0 ? "DOWN" : n % 17 === 0 ? "DEGRADED" : "OPERATIONAL";
      filas.push([
        codigo, `Luminaria ${categoria === "LUM-LED" ? "LED" : "vapor de sodio"} ${codigo} (ejemplo)`, "GPE", c.sector, categoria, "B", estado,
        "Dato de ejemplo: no es una luminaria real",
        r6(c.origen[0] + c.dLat * i), r6(c.origen[1] + c.dLon * i),
      ]);
      luminarias.push(codigo);
      if (estado === "DOWN") caidas.push(codigo);
    }
  }
  return { contenido: csv(filas), luminarias, caidas };
}

/**
 * UN plan por tipo, sobre un solo equipo: el importador de planes toma el mismo
 * nombre en otro equipo como posible duplicado y lo omite (la primera corrida de
 * este demo dejó 6 planes de 23 filas). Los demás equipos se suman después con
 * asignarPlan, que es como se trabaja un plan para muchos equipos.
 */
const PLANES_DE_CIRCUITO = [
  ["Ronda nocturna de verificación de encendido", "15", "INSPECTION", "MEDIUM", "1.5", "2", "Recorrido de noche: contar luminarias apagadas, parpadeo y encendido de día", "NO"],
  ["Revisión de fotoceldas y control de encendido", "180", "INSPECTION", "MEDIUM", "1", "7", "Probar fotoceldas y relojes del circuito", "NO"],
  ["Poda de vegetación que obstruye la luz", "365", "PREVENTIVE", "LOW", "2", "14", "Liberar el haz de luz de ramas y follaje", "NO"],
];
const PLANES_DE_TABLERO = [
  ["Revisión de tablero (contactor, selector, reloj, conexiones, térmico)", "90", "PREVENTIVE", "HIGH", "2", "7", "Revisión eléctrica con el tablero fuera de servicio", "SI"],
  ["Termografía de tablero y acometida", "180", "PREDICTIVE", "MEDIUM", "1", "7", "Puntos calientes con el tablero en operación", "NO"],
];
const PLAN_DE_LUMINARIA = ["Limpieza de difusor y revisión de óptica", "365", "PREVENTIVE", "LOW", "0.5", "14", "Limpiar el difusor y revisar la óptica y los herrajes", "SI"];

function construirPlanes(primeraLuminaria: string) {
  const f: string[][] = [["nombre", "activo", "cada_dias", "tipo", "prioridad", "horas_estimadas", "anticipacion_dias", "descripcion", "requiere_paro"]];
  const fila = (activo: string, p: string[]) => [p[0], activo, ...p.slice(1)];
  for (const p of PLANES_DE_CIRCUITO) f.push(fila(CALLES[0].codigo, p));
  for (const p of PLANES_DE_TABLERO) f.push(fila(TABLEROS[0].codigo, p));
  f.push(fila(primeraLuminaria, PLAN_DE_LUMINARIA));
  return csv(f);
}

async function main() {
  const { prisma } = await import("../lib/db");
  const url = process.env.DATABASE_URL ?? "";
  const esLocal = url.startsWith("file:");
  const { luminarias, caidas, contenido: activosCsv } = construirActivos();

  const existente = await prisma.organization.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  console.log(`Base: ${esLocal ? "SQLite local" : "REMOTA (¿es producción? solo con el OK de Rafael)"}`);
  console.log(`Catálogos desde: ${CARPETA}`);
  if (existente) { console.log(`Ya existe «${existente.name}»: no se vuelve a crear. Bórrela primero si quiere empezar de cero.`); return; }
  console.log(`Se crearía «Alumbrado Público (ejemplo)» con: 7 catálogos importados, 1 sitio, 2 sectores, ${TABLEROS.length} tableros, ${CALLES.length} circuitos, ${luminarias.length} luminarias ubicadas (${caidas.length} fuera de servicio), planes por circuito y tablero, y ${Math.min(4, caidas.length)} órdenes correctivas.`);
  if (!aplicar) { console.log("\nEnsayo: no se creó nada. Agregue --aplicar para crearla."); return; }

  const { hashPassword } = await import("../lib/auth");
  const { ejecutarImportacion, validarImportacion } = await import("../lib/importacion-motor");
  const { asignarPlan } = await import("../lib/asignaciones");
  const { nextWorkOrderNumber } = await import("../lib/numbering");

  const contrasena = process.env.DEMO_CONTRASENA || `Demo-${randomBytes(4).toString("hex")}`;
  const org = await prisma.organization.create({
    data: { name: "Alumbrado Público (ejemplo)", slug: SLUG, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey" },
  });
  const correo = `director@${SLUG}.mx`;
  const usuario = await prisma.user.create({
    data: { organizationId: org.id, email: correo, name: "Director de Alumbrado (ejemplo)", role: "OWNER", passwordHash: await hashPassword(contrasena) },
  });
  const ctx = { organizationId: org.id, userId: usuario.id, plan: "ENTERPRISE" };

  async function importar(tipo: Parameters<typeof ejecutarImportacion>[0]["tipo"], contenido: string, archivoNombre: string) {
    const v = await validarImportacion({ tipo, contenido, archivoNombre, ...ctx });
    const malas = v.filas.filter((x) => x.estado === "error");
    if (!v.puedeImportar) {
      for (const m of malas.slice(0, 5)) console.error(`  ${archivoNombre} fila ${m.fila}:`, JSON.stringify(m.fallas));
      throw new Error(`${archivoNombre}: ${malas.length} fila(s) con error; no se importa.`);
    }
    const r = await ejecutarImportacion({ tipo, contenido, archivoNombre, ...ctx });
    console.log(`  ✓ ${archivoNombre.padEnd(30)} ${r.creados} creados${v.totales.advertencias ? `, ${v.totales.advertencias} advertencia(s)` : ""}`);
    return r;
  }

  console.log("\nImportando…");
  await importar("sitios", csv([["codigo", "nombre", "ciudad"], ["GPE", "Guadalupe, N.L. (ejemplo)", "Guadalupe"]]), "sitios.csv");
  await importar("ubicaciones", csv([["sitio", "codigo", "nombre"], ["GPE", "SEC-1", "Sector 1 (ejemplo)"], ["GPE", "SEC-2", "Sector 2 (ejemplo)"]]), "ubicaciones.csv");
  await importar("unidades", leer("03-unidades.csv"), "03-unidades.csv");
  await importar("categorias-activo", leer("01-categorias-activo.csv"), "01-categorias-activo.csv");
  await importar("familias-refaccion", leer("02-familias-refaccion.csv"), "02-familias-refaccion.csv");
  await importar("refacciones", leer("07-refacciones.csv"), "07-refacciones.csv");
  await importar("especialidades", leer("04-especialidades.csv"), "04-especialidades.csv");
  await importar("codigos-falla", leer("05-codigos-falla.csv"), "05-codigos-falla.csv");
  await importar("causas-raiz", leer("06-causas-raiz.csv"), "06-causas-raiz.csv");
  await importar("activos", activosCsv, "activos-ejemplo.csv");

  // La jerarquía: luminaria → circuito → tablero. El importador de activos no trae padre; se liga aquí.
  const porCodigo = new Map((await prisma.asset.findMany({ where: { organizationId: org.id }, select: { id: true, code: true } })).map((a) => [a.code, a.id]));
  for (const c of CALLES) await prisma.asset.update({ where: { id: porCodigo.get(c.codigo)! }, data: { parentId: porCodigo.get(c.tablero)! } });
  let k = 0;
  for (const c of CALLES) {
    const ids = luminarias.slice(k, k + POR_CIRCUITO).map((l) => porCodigo.get(l)!);
    await prisma.asset.updateMany({ where: { id: { in: ids } }, data: { parentId: porCodigo.get(c.codigo)! } });
    k += POR_CIRCUITO;
  }
  console.log(`  ✓ jerarquía                      ${CALLES.length} circuitos bajo ${TABLEROS.length} tableros; ${luminarias.length} luminarias bajo sus circuitos`);

  await importar("planes", construirPlanes(luminarias[0]), "planes-ejemplo.csv");
  // Cada plan se suma al resto de sus equipos, escalonado: un plan, no uno por equipo.
  const asignar = async (nombre: string, codigos: string[]) => {
    const plan = await prisma.maintenancePlan.findFirstOrThrow({ where: { organizationId: org.id, name: nombre } });
    await asignarPlan({ organizationId: org.id, planId: plan.id, equipos: codigos.map((c) => ({ assetId: porCodigo.get(c)! })), escalonarAuto: true, userId: usuario.id });
    console.log(`  ✓ ${nombre.slice(0, 40).padEnd(40)} +${codigos.length} equipos`);
  };
  for (const p of PLANES_DE_CIRCUITO) await asignar(p[0], CALLES.slice(1).map((c) => c.codigo));
  for (const p of PLANES_DE_TABLERO) await asignar(p[0], TABLEROS.slice(1).map((t) => t.codigo));
  await asignar(PLAN_DE_LUMINARIA[0], luminarias.slice(1));

  // Correctivas: de las luminarias fuera de servicio, para que haya algo que atender en la demo.
  for (const codigo of caidas.slice(0, 4)) {
    const activo = await prisma.asset.findFirstOrThrow({ where: { organizationId: org.id, code: codigo } });
    await prisma.workOrder.create({
      data: {
        organizationId: org.id, number: await nextWorkOrderNumber(org.id),
        title: `Luminaria apagada: ${codigo}`, description: "Reporte de ejemplo: la luminaria no enciende.",
        maintenanceType: "CORRECTIVE", status: "OPEN", priority: "HIGH",
        assetId: activo.id, siteId: activo.siteId, locationId: activo.locationId, createdById: usuario.id,
      },
    });
  }
  console.log(`  ✓ órdenes correctivas            ${Math.min(4, caidas.length)}`);

  console.log(`\nListo. Entrar con ${correo}`);
  if (!process.env.DEMO_CONTRASENA) console.log(`Contraseña (solo se muestra ahora): ${contrasena}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
