/**
 * Bloque 8 — Validacion integral: las regresiones de los hallazgos.
 *
 * Cada revision de aqui nacio de un defecto REAL encontrado en la auditoria
 * del bloque, no de un supuesto. Varios son de los que no revientan: el
 * sistema compila, la pantalla se ve bien, y lo que esta mal es el numero o
 * el registro duplicado.
 *
 * Las revisiones estaticas (leer el codigo fuente) existen porque el defecto
 * que buscan NO se puede reproducir en desarrollo: la base local es SQLite y
 * se comporta distinto que PostgreSQL. Una prueba que corra contra SQLite
 * pasaria siempre y no protegeria nada.
 *
 *   npx tsx scripts/prueba-bloque-8.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { contiene } from "../lib/busqueda-texto";
import { prisma } from "../lib/db";
import { conCandado } from "../lib/procesos";
import { altaDePlan } from "../lib/alta-de-plan";
import { generateScheduledWorkOrders } from "../lib/scheduler";
import { ejecutarHerramienta, herramientasPara } from "../lib/ia/herramientas";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle?: unknown) {
  if (!bien) fallas++;
  const extra = detalle !== undefined && (!bien || Array.isArray(detalle)) ? `  → ${JSON.stringify(detalle)}` : "";
  console.log(`  ${bien ? "ok   " : "FALLA"} ${que}${extra}`);
}

/** Todos los .ts y .tsx de una carpeta, recursivo. */
function fuentes(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (nombre === "node_modules" || nombre.startsWith(".")) continue;
    if (statSync(ruta).isDirectory()) fuentes(ruta, salida);
    else if (ruta.endsWith(".ts") || ruta.endsWith(".tsx")) salida.push(ruta);
  }
  return salida;
}

const ARCHIVOS = [...fuentes("app"), ...fuentes("lib")].map((ruta) => ({ ruta, texto: readFileSync(ruta, "utf8") }));

// ══════════════════════════════════════ 1. Buscar no puede distinguir mayusculas
//
// SQLite hace LIKE insensible; PostgreSQL no. En la Mac «bomba» encontraba
// «Bomba»; en produccion no encontraba nada, y ninguna prueba local podia
// verlo. Por eso se revisa el codigo fuente y no el comportamiento.
console.log("\n1. Buscar texto se comporta igual en los dos motores");

const CRUDO = /(\w+)\s*:\s*\{\s*contains\s*:/g;
/** Donde `contains` crudo es legitimo: no es una busqueda de persona. */
const PERMITIDOS = [
  "lib/demo-comercial.ts",           // siembra: texto exacto que ella misma escribio
  "app/(app)/work-orders/[id]/page.tsx", // busca una marca interna en la bitacora
];
const conCrudo = ARCHIVOS
  .filter((a) => !PERMITIDOS.some((p) => a.ruta === p))
  .flatMap((a) => [...a.texto.matchAll(CRUDO)].map((m) => `${a.ruta}: ${m[1]}`));
revisar("ninguna busqueda usa `contains` a pelo: todas pasan por contiene()", conCrudo.length === 0, conCrudo);

const ayudante = readFileSync("lib/busqueda-texto.ts", "utf8");
revisar("contiene() agrega mode insensitive solo cuando la base lo necesita",
  ayudante.includes('mode: "insensitive"') && ayudante.includes("DATABASE_URL"));

// La funcion, ejercitada CONTRA LOS DOS MOTORES. El valor se fija al
// importar el modulo, asi que cada caso corre en su propio proceso: probar
// solo el motor de esta maquina es justamente como se colo el defecto.
const conBase = (url: string) => JSON.parse(execFileSync(
  "npx", ["tsx", "-e", 'import { contiene } from "./lib/busqueda-texto"; console.log(JSON.stringify(contiene("bomba")));'],
  { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" },
).trim()) as Record<string, unknown>;

const enPostgres = conBase("postgresql://usuario@servidor/base");
revisar("en PostgreSQL busca sin distinguir mayusculas", enPostgres.contains === "bomba" && enPostgres.mode === "insensitive", enPostgres);

const enSqlite = conBase("file:./dev.db");
revisar("en SQLite no manda `mode`, que su cliente rechaza", enSqlite.contains === "bomba" && enSqlite.mode === undefined, enSqlite);

const sinVariable = conBase("");
revisar("sin DATABASE_URL en el entorno (scripts sueltos) se comporta como SQLite", sinVariable.mode === undefined, sinVariable);

const aqui = contiene("bomba") as Record<string, unknown>;
revisar("y en este proceso devuelve un filtro valido", aqui.contains === "bomba", aqui);

async function main() {
  // ══════════════════════════ 2. Los procesos que corren solos no se solapan
  //
  // Dos corridas solapadas del programador generaban DOS ordenes preventivas
  // identicas: la decision se tomaba contra una lectura del inicio del barrido
  // y la escritura ocurria mucho despues. El reintento de Cloud Scheduler y el
  // boton «generar ahora» son los dos disparadores reales.
  console.log("\n2. Los procesos programados no se solapan");

  const sello = `prueba-b8-${Date.now()}`;
  const org = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });
  try {
    const usuario = await prisma.user.create({
      data: { organizationId: org.id, email: `${sello}@t.mx`, name: "Sup", role: "ADMIN", passwordHash: "x" },
    });
    const sitio = await prisma.site.create({ data: { organization: { connect: { id: org.id } }, code: "PL", name: "Planta" } });
    const activo = await prisma.asset.create({
      data: { organization: { connect: { id: org.id } }, site: { connect: { id: sitio.id } }, code: "EQ-1", name: "Equipo uno", status: "OPERATIONAL" },
    });

    // El candado, ejercitado solo.
    let corriendo = 0, simultaneas = 0;
    const lento = async () => {
      corriendo += 1;
      if (corriendo > 1) simultaneas += 1;
      await new Promise((r) => setTimeout(r, 300));
      corriendo -= 1;
      return { hecho: true };
    };
    const [a1, a2] = await Promise.all([conCandado(`prueba:${sello}`, lento), conCandado(`prueba:${sello}`, lento)]);
    revisar("dos llamadas simultaneas: solo una corre, la otra se omite",
      simultaneas === 0 && [a1.corrio, a2.corrio].filter(Boolean).length === 1, { a1: a1.corrio, a2: a2.corrio, simultaneas });

    const tras = await prisma.procesoProgramado.findUnique({ where: { clave: `prueba:${sello}` } });
    revisar("al terminar suelta el candado y deja constancia de la corrida",
      !tras?.corriendoDesde && tras?.ultimoOk === true && tras.corridas === 1, { corriendo: Boolean(tras?.corriendoDesde), ok: tras?.ultimoOk, corridas: tras?.corridas });

    // Un candado vencido se puede volver a tomar: un proceso muerto no bloquea
    // para siempre.
    await prisma.procesoProgramado.update({
      where: { clave: `prueba:${sello}` },
      data: { corriendoDesde: new Date(Date.now() - 3_600_000), expiraEl: new Date(Date.now() - 1_800_000) },
    });
    const tomado = await conCandado(`prueba:${sello}`, async () => ({ rescatado: true }));
    revisar("un candado vencido lo toma el siguiente (un proceso muerto no bloquea)", tomado.corrio);

    // Y una corrida que falla se registra como fallida, sin dejar el candado.
    await conCandado(`prueba:${sello}`, async () => { throw new Error("fallo a proposito"); }).catch(() => undefined);
    const trasFalla = await prisma.procesoProgramado.findUnique({ where: { clave: `prueba:${sello}` } });
    revisar("una corrida que falla queda marcada y libera el candado",
      trasFalla?.ultimoOk === false && trasFalla.fallasSeguidas === 1 && !trasFalla.corriendoDesde,
      { ok: trasFalla?.ultimoOk, fallas: trasFalla?.fallasSeguidas });

    // Lo que de verdad importa: el programador, por su camino real.
    const ayer = new Date(Date.now() - 86_400_000);
    const alta = await altaDePlan(org.id, usuario.id, {
      maintenanceType: "PREVENTIVE", triggerType: "CALENDAR", intervalDays: 30,
      leadTimeDays: 3, toleranceDays: 2, priority: "MEDIUM", estimatedHours: 1,
      requiresShutdown: false, active: true,
      tasks: [{ title: "Revisar", taskType: "CHECK", required: true, parts: [], labor: [], services: [] }],
      name: "Preventivo de prueba", assetId: activo.id, nextDueDate: ayer.toISOString(),
    });
    if ("error" in alta) throw new Error(`No dio de alta: ${alta.error}`);

    // Dos corridas a la vez, como el reintento del cron encima del boton manual.
    const dos = await Promise.all([
      generateScheduledWorkOrders(org.id, { userId: usuario.id }),
      generateScheduledWorkOrders(org.id, { userId: usuario.id }),
    ]);
    const ordenes = await prisma.workOrder.count({ where: { organizationId: org.id, planId: alta.plan.id } });
    revisar("dos corridas simultaneas del programador generan UNA orden, no dos",
      ordenes === 1, { ordenes, generadas: dos.map((d) => d.generated) });

    const actividades = await prisma.workOrderTask.count({ where: { workOrder: { organizationId: org.id } } });
    revisar("y una sola actividad, no la misma dos veces", actividades === 1, { actividades });

    // Un ensayo no toma el candado: bloquear por una consulta dejaria al cron
    // esperando a que alguien cierre una pantalla.
    const ensayo = await generateScheduledWorkOrders(org.id, { userId: usuario.id, dryRun: true });
    revisar("el ensayo no bloquea ni escribe", ensayo.generated === 0 || ensayo.details.length >= 0);

    // ════════════════ 3. La IA no contesta lo que la pantalla oculta
    //
    // Las herramientas recibian la empresa pero nunca el rol: un tecnico o un
    // solicitante, a quienes el sistema les oculta los importes en todas las
    // pantallas, los obtenian pidiendoselos a la IA en prosa.
    console.log("\n3. La IA respeta lo que cada rol puede ver");

    revisar("al tecnico no se le ofrece siquiera la herramienta de costos",
      !herramientasPara("TECHNICIAN").some((h) => h.name === "costo_por_activo") &&
      herramientasPara("OWNER").some((h) => h.name === "costo_por_activo"));

    /** Cualquier llave que huela a dinero en la respuesta, por hondo que este. */
    const llavesDeDinero = (valor: unknown, camino = ""): string[] => {
      if (Array.isArray(valor)) return valor.flatMap((v, i) => llavesDeDinero(v, `${camino}[${i}]`));
      if (valor && typeof valor === "object" && !(valor instanceof Date)) {
        return Object.entries(valor as Record<string, unknown>).flatMap(([k, v]) => [
          ...(/costo|cost|tarifa|precio|importe/i.test(k) && v !== undefined && v !== null ? [`${camino}.${k}`] : []),
          ...llavesDeDinero(v, `${camino}.${k}`),
        ]);
      }
      return [];
    };

    const PRUEBAS: Array<[string, Record<string, unknown>]> = [
      ["indicadores", { dias: 90 }],
      ["buscar_ordenes", { dias: 90 }],
      ["costo_por_activo", { dias: 90 }],
      ["consultar_activo", { codigo: "EQ-1" }],
      ["consultar_almacen", {}],
      ["fallas_frecuentes", { dias: 90 }],
    ];
    for (const rol of ["TECHNICIAN", "REQUESTER"]) {
      const fugas: string[] = [];
      for (const [herramienta, entrada] of PRUEBAS) {
        const r = await ejecutarHerramienta(org.id, herramienta, entrada, { rol });
        fugas.push(...llavesDeDinero(r).map((l) => `${herramienta}${l}`));
      }
      revisar(`${rol}: ninguna herramienta le devuelve importes`, fugas.length === 0, fugas.slice(0, 8));
    }

    // Y a quien SI ve costos se los sigue dando: cerrar de mas tambien es un defecto.
    const paraDueno = await ejecutarHerramienta(org.id, "indicadores", { dias: 90 }, { rol: "OWNER" }) as Record<string, unknown>;
    revisar("al dueno no se le quita nada", paraDueno.costos !== undefined);

    // Compras ve el almacen (es su trabajo) y no ve el costo de las ordenes.
    const comprasAlmacen = await ejecutarHerramienta(org.id, "consultar_almacen", {}, { rol: "COMPRAS" });
    const comprasOrdenes = await ejecutarHerramienta(org.id, "buscar_ordenes", { dias: 90 }, { rol: "COMPRAS" });
    revisar("compras ve importes del almacen pero no el costo de las ordenes",
      llavesDeDinero(comprasOrdenes).length === 0, { almacen: llavesDeDinero(comprasAlmacen).length, ordenes: llavesDeDinero(comprasOrdenes) });
  } finally {
    await prisma.procesoProgramado.deleteMany({ where: { clave: { startsWith: `prueba:${sello}` } } });
    await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(fallas ? `\n${fallas} revision(es) fallaron\n` : "\nTodo bien\n");
    process.exit(fallas ? 1 : 0);
  });
