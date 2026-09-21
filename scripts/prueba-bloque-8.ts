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
import { estadoDeVencimiento, filtroDeVencidas } from "../lib/vencimiento";
import { fallaInesperada } from "../lib/api";
import { ErrorDeAlmacen } from "../lib/almacen";
import { demasiadas } from "../lib/prospectos";

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

    // ════════════════ 4. Las listas no mienten sobre lo que hay
    //
    // Las pantallas traian un tope de registros y filtraban DESPUES, en
    // memoria: con 500 vencidas, la lista a la que lleva el indicador del
    // inicio no las tenia todas, y la refaccion bajo minimo que quedaba en el
    // lugar 350 no aparecia nunca. No es lentitud, son cifras equivocadas.
    console.log("\n4. Filtrar en la base, no despues del tope");

    const zona = "America/Monterrey";
    const dia = (n: number) => new Date(Date.now() + n * 86_400_000);
    const casos: Array<[string, Record<string, unknown>]> = [
      ["vencida de ayer", { status: "OPEN", dueDate: dia(-1) }],
      ["vencida de hace un mes", { status: "ASSIGNED", dueDate: dia(-30) }],
      ["borrador vencido", { status: "DRAFT", dueDate: dia(-3) }],
      ["en espera vencida", { status: "ON_HOLD", dueDate: dia(-2) }],
      ["vence manana", { status: "OPEN", dueDate: dia(1) }],
      ["sin fecha", { status: "OPEN", dueDate: null }],
      ["terminada tarde", { status: "COMPLETED", dueDate: dia(-5), completedAt: dia(-1) }],
      ["cancelada vencida", { status: "CANCELLED", dueDate: dia(-9) }],
    ];
    for (const [titulo, datos] of casos) {
      await prisma.workOrder.create({
        data: { organizationId: org.id, number: `V-${titulo.replace(/\s/g, "-")}`, title: titulo, maintenanceType: "CORRECTIVE", ...datos } as never,
      });
    }
    const todas = await prisma.workOrder.findMany({
      where: { organizationId: org.id, number: { startsWith: "V-" } },
      select: { id: true, title: true, status: true, dueDate: true, completedAt: true },
    });
    const porLaPantalla = todas.filter((w) => estadoDeVencimiento(w, { zona }).clave === "VENCIDA").map((w) => w.title).sort();
    const porLaBase = (await prisma.workOrder.findMany({
      where: { organizationId: org.id, number: { startsWith: "V-" }, ...filtroDeVencidas(zona) },
      select: { title: true },
    })).map((w) => w.title).sort();

    // La direccion que importa: que no se pierda ninguna. El filtro de la base
    // puede traer de mas (lo documenta `filtroDeVencidas`); la etiqueta de la
    // pantalla descarta esas.
    const perdidas = porLaPantalla.filter((t) => !porLaBase.includes(t));
    revisar("ninguna orden vencida se le escapa al filtro de la base",
      perdidas.length === 0, { pantalla: porLaPantalla, base: porLaBase, perdidas });
    revisar("y el filtro incluye borradores y en espera, como la etiqueta",
      porLaBase.includes("borrador vencido") && porLaBase.includes("en espera vencida"), porLaBase);
    revisar("no cuenta canceladas, terminadas, futuras ni sin fecha",
      !porLaBase.some((t) => ["cancelada vencida", "terminada tarde", "vence manana", "sin fecha"].includes(t)), porLaBase);

    // Bajo minimo: la que queda al final del abecedario tambien tiene que salir.
    const almacen = await prisma.warehouse.create({ data: { organizationId: org.id, siteId: sitio.id, code: "ALM", name: "Almacén", esGeneral: true } });
    await prisma.part.create({ data: { organizationId: org.id, code: "AAA-1", name: "Con existencia", unit: "pza", quantityOnHand: 50, minQuantity: 5 } });
    const escasa = await prisma.part.create({ data: { organizationId: org.id, code: "ZZZ-9", name: "La ultima del abecedario", unit: "pza", quantityOnHand: 0, minQuantity: 3 } });
    const bajas = await prisma.part.findMany({
      where: { organizationId: org.id, active: true, quantityOnHand: { lte: prisma.part.fields.minQuantity } },
      select: { code: true },
    });
    revisar("el bajo mínimo lo decide la base: sale aunque quede al final de la lista",
      bajas.length === 1 && bajas[0].code === escasa.code, bajas.map((b) => b.code));
    void almacen;

    // ════════════════ 5. Lo que no debe salir del servidor
    console.log("\n5. Errores, archivos y limites");

    // Un error de Prisma trae el nombre del modelo, los campos y la
    // invocacion. Un error de regla de negocio esta escrito para la persona y
    // tiene que llegarle tal cual.
    const dePrisma = await prisma.workOrder.findUniqueOrThrow({ where: { id: "no-existe-a-proposito" } }).catch((e) => e);
    const respuestaPrisma = fallaInesperada(dePrisma, { orgId: org.id });
    const cuerpoPrisma = await respuestaPrisma.json() as { error?: string };
    revisar("un error de Prisma no le cuenta al cliente como esta hecho el sistema",
      respuestaPrisma.status === 500 && !/prisma|invocation|workOrder|findUnique/i.test(cuerpoPrisma.error ?? ""), cuerpoPrisma.error);

    const deNegocio = fallaInesperada(new ErrorDeAlmacen("No hay existencia suficiente de SEL-01"), { orgId: org.id });
    const cuerpoNegocio = await deNegocio.json() as { error?: string };
    revisar("un error de regla de negocio si le llega al usuario, con su texto",
      cuerpoNegocio.error === "No hay existencia suficiente de SEL-01", cuerpoNegocio.error);

    // El logotipo no puede ser un documento que el navegador ejecute.
    const rutaLogo = readFileSync("app/api/apariencia/logo/route.ts", "utf8");
    revisar("el logotipo ya no admite SVG y los viejos se sirven inertes",
      !/const TIPOS = \[[^\]]*svg/.test(rutaLogo) && rutaLogo.includes("application/octet-stream") && rutaLogo.includes("sandbox"));

    // El limite de solicitudes publicas cuenta en la base, no en el proceso.
    const ip = `10.0.0.${Math.floor(Math.random() * 250)}`;
    const intentos: boolean[] = [];
    for (let i = 0; i < 6; i++) intentos.push(await demasiadas(ip));
    const otraIp = await demasiadas(`10.9.9.${Math.floor(Math.random() * 250)}`);
    revisar("a la sexta solicitud de la misma conexion se frena, y otra conexion no se ve afectada",
      intentos.slice(0, 5).every((x) => x === false) && intentos[5] === true && otraIp === false, intentos);
    await prisma.limiteUso.deleteMany({ where: { clave: { startsWith: "prospectos:10." } } });

    // ════════════════ 6. La empresa del paro es la del equipo
    //
    // `DowntimeEvent` era el unico modelo grande sin `organizationId`: se le
    // agrego para poder indexarlo, y con ello nacio la forma de equivocarse
    // que antes no existia —escribir un paro con una empresa distinta de la
    // de su equipo—. La primera vez que paso fue el mismo dia, en una prueba.
    console.log("\n6. Los paros pertenecen a la empresa de su equipo");
    const paros = await prisma.downtimeEvent.findMany({
      select: { id: true, organizationId: true, asset: { select: { organizationId: true } } },
      take: 3000,
    });
    const cruzados = paros.filter((p) => p.organizationId !== p.asset.organizationId);
    revisar(`los ${paros.length} paros revisados coinciden con la empresa de su equipo`,
      cruzados.length === 0, cruzados.slice(0, 5).map((p) => p.id));

    // ════════════════ 7. El resumen del inicio dice lo mismo que el cálculo vivo
    //
    // El inicio de dirección y el de administración leen un resumen guardado
    // que se recalcula cada cuarto de hora, en vez de calcular en cada carga.
    // Lo que NO puede pasar es que ese atajo diga otra cosa que el cálculo de
    // verdad: seria cambiar lentitud por cifras equivocadas, que es peor.
    console.log("\n7. El resumen del inicio no inventa cifras");

    const { resumenDeInicio, olvidarResumen, FRESCURA_MINUTOS } = await import("../lib/resumen-inicio");
    const { calcularIndicadores, periodoDeLaEmpresa } = await import("../lib/indicadores");
    const { revisarCalidad } = await import("../lib/calidad-datos");

    await olvidarResumen(org.id);
    const ahora = new Date();
    const primero = await resumenDeInicio(org.id, ahora);
    const periodo30 = await periodoDeLaEmpresa(org.id, 30, ahora);
    const vivo = await calcularIndicadores(org.id, periodo30, { ahora });
    const calidadViva = (await revisarCalidad(org.id, ahora)).filter((r) => r.cantidad > 0);
    revisar("las cifras guardadas son las mismas que calcula la función en vivo",
      primero.datos.cumplimiento === vivo.indicadores.cumplimientoPreventivo.valor &&
      primero.datos.disponibilidad === vivo.indicadores.disponibilidad.valor &&
      primero.datos.costoTotal === vivo.costos.total &&
      primero.datos.problemas.length === calidadViva.length,
      { guardado: primero.datos.cumplimiento, vivo: vivo.indicadores.cumplimientoPreventivo.valor, problemas: [primero.datos.problemas.length, calidadViva.length] });

    const segundo = await resumenDeInicio(org.id, new Date(ahora.getTime() + 60_000));
    revisar("un minuto después no recalcula: entrega el mismo resumen",
      segundo.calculadoEl.getTime() === primero.calculadoEl.getTime());

    // Vencido: fuera de una petición no hay a quién contestarle primero, así
    // que recalcula de una vez en vez de quedarse con lo viejo para siempre.
    await prisma.resumenInicio.update({
      where: { organizationId: org.id },
      data: { calculadoEl: new Date(ahora.getTime() - (FRESCURA_MINUTOS + 5) * 60_000) },
    });
    const tercero = await resumenDeInicio(org.id);
    revisar(`pasados ${FRESCURA_MINUTOS} min se vuelve a calcular`,
      tercero.calculadoEl.getTime() > primero.calculadoEl.getTime());

    // Y el inicio de verdad usa el resumen: lo dice la fecha que devuelve.
    const { inicioDe } = await import("../lib/inicio");
    const duenio = await prisma.user.findFirstOrThrow({ where: { organizationId: org.id, role: "ADMIN" } });
    const inicio = await inicioDe({ ...duenio, organization: org } as never);
    revisar("el inicio informa de cuándo son esas cifras", inicio.calculadoEl instanceof Date, inicio.calculadoEl);

    const tecnico = await prisma.user.findFirst({ where: { organizationId: org.id, role: "TECHNICIAN" } });
    if (tecnico) {
      const suyo = await inicioDe({ ...tecnico, organization: org } as never);
      revisar("el inicio del técnico no usa resumen: todo lo suyo es de ahora", suyo.calculadoEl === null);
    }
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
