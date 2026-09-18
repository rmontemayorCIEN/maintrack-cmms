/**
 * Bloque 4 — La puesta en marcha mide preparación real, no registros contados.
 *
 * Llama a las mismas funciones que las pantallas (`puestaEnMarcha`,
 * `iniciarEmpresa`, `quitarDemo`, `comenzarAOperar`) y al final entra por HTTP
 * para comprobar que el panel, la pantalla de puesta en marcha y la consola del
 * operador muestran el MISMO porcentaje.
 *
 *   npx tsx scripts/prueba-puesta-en-marcha.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { prisma } from "../lib/db";
import { puestaEnMarcha, avancePuestaEnMarcha } from "../lib/puesta-en-marcha";
import { catalogosPara, sembrarCatalogosEstandar } from "../lib/catalogos-estandar";
import { hayDemo, iniciarEmpresa, quitarDemo, vistaPreviaQuitarDemo, MARCA_DEMO } from "../lib/demo";
import { comenzarAOperar, declararModulo } from "../lib/puesta-en-marcha-acciones";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 220)}` : ""}`);
}
async function rechaza(afirmacion: string, fn: () => Promise<unknown>, contiene?: RegExp) {
  try {
    await fn();
    revisar(afirmacion, false, "no se rechazó");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    revisar(afirmacion, !contiene || contiene.test(m), m.slice(0, 160));
  }
}

function llaveDeSesion(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const linea = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("AUTH_SECRET="));
  const valor = linea?.slice("AUTH_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  if (!valor) throw new Error("No hay AUTH_SECRET en el entorno ni en .env");
  return valor;
}
async function esperarServidor(base: string, limiteMs: number) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10_000) });
      if (r.status < 500) return;
    } catch { /* todavia no levanta */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

const paso = async (orgId: string, clave: string) => (await puestaEnMarcha(orgId)).pasos.find((p) => p.clave === clave)!;

async function main() {
  let servidor: ChildProcess | null = null;
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3203";
  if (!process.env.BASE_URL) {
    servidor = spawn("npx", ["next", "dev", "-p", "3203", "-H", "127.0.0.1"], { stdio: "ignore", detached: true });
  }
  const sello = `pem-${Date.now()}`;
  const orgs: string[] = [];
  const nuevaEmpresa = async (sufijo: string, tipo: string | null) => {
    const o = await prisma.organization.create({
      data: { name: `${sello}-${sufijo}`, slug: `${sello}-${sufijo}`.toLowerCase(), plan: "ENTERPRISE", status: "ACTIVE", tipoInstalacion: tipo },
    });
    orgs.push(o.id);
    // Lo mismo que hace el alta de empresa: solo los catálogos base de su tipo.
    await sembrarCatalogosEstandar(o.id, tipo);
    return o;
  };

  try {
    console.log("\n17. Catálogos adecuados a cada tipo de instalación");
    const rest = catalogosPara("RESTAURANTE");
    const flot = catalogosPara("FLOTILLA");
    const hosp = catalogosPara("HOSPITAL");
    const cod = (l: Array<[string, ...string[]]>) => l.map((x) => x[0]);
    revisar("un restaurante recibe refrigeración y gas, no «equipo de producción»",
      cod(rest.categorias).includes("REFR") && cod(rest.categorias).includes("GAS") && !cod(rest.categorias).includes("PROD"), cod(rest.categorias));
    revisar("una flotilla recibe vehículos y frenos, no climatización",
      cod(flot.categorias).includes("VEH") && cod(flot.codigosFalla).includes("FRE-01") && !cod(flot.categorias).includes("CLIMA"), cod(flot.categorias));
    revisar("un hospital recibe equipo biomédico y calibración", cod(hosp.categorias).includes("BIOM") && cod(hosp.codigosFalla).includes("CAL-01"));
    revisar("las listas son cortas: ningún tipo recibe más de 10 categorías",
      ["PLANTA", "EDIFICIO", "PLAZA", "HOSPITAL", "ESCUELA", "DEPORTIVO", "HOTEL", "RESTAURANTE", "BODEGA", "FLOTILLA", "RESIDENCIAL", "OTRO"]
        .every((t) => catalogosPara(t).categorias.length <= 10));
    revisar("sin repetir códigos al unir lo común con lo propio",
      new Set(cod(catalogosPara("PLANTA").codigosFalla)).size === catalogosPara("PLANTA").codigosFalla.length);

    console.log("\n1. Empresa nueva, completamente vacía");
    const vacia = await nuevaEmpresa("vacia", "RESTAURANTE");
    const m0 = await puestaEnMarcha(vacia.id);
    revisar("arranca con avance bajo: tener catálogos no es estar listo", m0.porcentaje <= 25, m0.porcentaje);
    revisar("recibió sus catálogos, y SOLO catálogos: ningún sitio, activo ni almacén inventado",
      (await prisma.assetCategory.count({ where: { organizationId: vacia.id } })) > 0 &&
      (await prisma.site.count({ where: { organizationId: vacia.id } })) === 0 &&
      (await prisma.asset.count({ where: { organizationId: vacia.id } })) === 0 &&
      (await prisma.warehouse.count({ where: { organizationId: vacia.id } })) === 0);
    revisar("el primer pendiente es lo que impide crear órdenes: no hay técnicos",
      m0.pendientes[0]?.problema.includes("técnicos"), m0.pendientes.map((p) => p.problema));
    revisar("los pasos que faltan dicen qué y por qué", m0.pasos.every((p) => p.que && p.porQue && p.enlace));
    revisar("no se puede declarar en operación", m0.impideOperar.length > 0);

    console.log("\n2-3. Configuración parcial: el avance mide calidad, no conteo");
    const parcial = await nuevaEmpresa("parcial", "PLANTA");
    const sitio = await prisma.site.create({ data: { organizationId: parcial.id, code: "P01", name: "Planta Norte" } });
    const nave = await prisma.location.create({ data: { organizationId: parcial.id, siteId: sitio.id, code: "N1", name: "Nave 1" } });
    await prisma.location.create({ data: { organizationId: parcial.id, siteId: sitio.id, code: "N1B", name: "NAVE 1" } }); // repetida

    const antes = (await puestaEnMarcha(parcial.id)).porcentaje;
    // Cinco activos, pero tres sin ubicación: antes esto daba el paso por hecho.
    for (let i = 1; i <= 5; i++) {
      await prisma.asset.create({
        data: { organizationId: parcial.id, siteId: sitio.id, locationId: i <= 2 ? nave.id : null, code: `A-${i}`, name: `Equipo ${i}`, criticality: i === 1 ? "A" : "B" },
      });
    }
    const pActivos = await paso(parcial.id, "activos");
    revisar("5 activos con 3 sin ubicación: el paso queda por corregir, no completo",
      pActivos.estado === "CORREGIR" && pActivos.progreso?.hecho === 2 && pActivos.progreso?.meta === 5, pActivos);
    const pUbic = await paso(parcial.id, "ubicaciones");
    revisar("una ubicación repetida (sin importar mayúsculas) no cuenta y se marca por corregir",
      pUbic.estado === "CORREGIR" && pUbic.progreso?.hecho === 1, pUbic);

    // Técnico desactivado: no cuenta. Solicitante activo: tampoco, no ejecuta.
    await prisma.user.create({ data: { organizationId: parcial.id, email: `t0-${sello}@t.mx`, name: "Técnico dado de baja", role: "TECHNICIAN", active: false, passwordHash: "x" } });
    await prisma.user.create({ data: { organizationId: parcial.id, email: `s0-${sello}@t.mx`, name: "Solicitante", role: "REQUESTER", passwordHash: "x" } });
    const pEquipo = await paso(parcial.id, "equipo");
    revisar("un técnico desactivado y un solicitante no cuentan como responsables operativos", pEquipo.estado === "EN_PROCESO", pEquipo);
    await prisma.user.create({ data: { organizationId: parcial.id, email: `t1-${sello}@t.mx`, name: "Técnico sin tarifa", role: "TECHNICIAN", passwordHash: "x" } });
    const pEquipo2 = await paso(parcial.id, "equipo");
    revisar("un técnico activo sin tarifa: hay a quién asignar, pero la mano de obra no cuesta → corregir", pEquipo2.estado === "CORREGIR", pEquipo2);

    // Un plan sin actividades ni asignación no cuenta.
    await prisma.maintenancePlan.create({ data: { organizationId: parcial.id, name: "Plan hueco", intervalDays: 30 } });
    const pPlanes = await paso(parcial.id, "planes");
    revisar("un plan sin equipo ni actividades no cuenta: nunca generaría órdenes",
      pPlanes.estado === "CORREGIR" && pPlanes.progreso?.hecho === 0 && pPlanes.problemas.some((p) => /sin equipo/.test(p)), pPlanes);

    const m2 = await puestaEnMarcha(parcial.id);
    revisar("el avance sube con lo que sí está bien, pero no llega a completo", m2.porcentaje > antes && m2.porcentaje < 80, { antes, ahora: m2.porcentaje });

    console.log("\n18. Pendientes concretos: activos sin ubicación, planes sin frecuencia, sin rol operativo");
    await prisma.maintenancePlan.create({ data: { organizationId: parcial.id, name: "Plan sin frecuencia" } });
    const m3 = await puestaEnMarcha(parcial.id);
    const pend = (t: RegExp) => m3.pendientes.find((p) => t.test(p.problema));
    const sinUbic = pend(/sin ubicación/);
    revisar("«activos sin ubicación» nombra los 3 equipos, con enlace a cada uno",
      sinUbic?.cantidad === 3 && sinUbic.registros.length === 3 && sinUbic.registros.every((r) => r.enlace?.startsWith("/assets/")), sinUbic);
    revisar("«planes sin frecuencia» nombra el plan", Boolean(pend(/sin frecuencia/)?.registros.some((r) => r.nombre === "Plan sin frecuencia")), pend(/sin frecuencia/));
    revisar("«equipos críticos sin plan» nombra el A-1", Boolean(pend(/críticos/)?.registros.some((r) => r.nombre.startsWith("A-1"))), pend(/críticos/));
    revisar("cada pendiente dice módulo, consecuencia y acción", m3.pendientes.every((p) => p.modulo && p.consecuencia && p.accion.enlace));
    revisar("vienen ordenados: primero lo que impide programar, al final la identificación",
      m3.pendientes.every((p, i, a) => i === 0 || a[i - 1].prioridad <= p.prioridad), m3.pendientes.map((p) => p.prioridad));

    console.log("\n   Módulos opcionales: no se exige lo que no se usará");
    const conAlmacen = await paso(parcial.id, "almacen");
    await declararModulo({ organizationId: parcial.id, userId: (await prisma.user.findFirstOrThrow({ where: { organizationId: parcial.id } })).id, modulo: "almacen", usa: false });
    const sinAlmacen = await paso(parcial.id, "almacen");
    revisar("declarar que no se usará el almacén lo marca «no aplica»", conAlmacen.estado !== "NO_APLICA" && sinAlmacen.estado === "NO_APLICA", { antes: conAlmacen.estado, despues: sinAlmacen.estado });
    revisar("y el pendiente «no hay almacén» desaparece", !(await puestaEnMarcha(parcial.id)).pendientes.some((p) => /almacén activo/.test(p.problema)));

    console.log("\n15-16. Datos de demostración, separados y removibles");
    const demoOrg = await nuevaEmpresa("demo", "PLANTA");
    const dueño = await prisma.user.create({ data: { organizationId: demoOrg.id, email: `d-${sello}@t.mx`, name: "Dueña", role: "OWNER", passwordHash: "x" } });
    await iniciarEmpresa({ organizationId: demoOrg.id, userId: dueño.id, modo: "DEMO" });
    const activosDemo = await prisma.asset.findMany({ where: { organizationId: demoOrg.id } });
    revisar("la demo crea equipos marcados como demostración", activosDemo.length === 3 && activosDemo.every((a) => a.name.startsWith(MARCA_DEMO)), activosDemo.map((a) => a.name));
    revisar("queda registrada como un lote DEMO", await hayDemo(demoOrg.id));
    revisar("el plan de ejemplo queda asignado y con actividades: es un ejemplo que funciona",
      (await prisma.planAsset.count({ where: { organizationId: demoOrg.id } })) === 1 &&
      (await prisma.planTask.count({ where: { plan: { organizationId: demoOrg.id } } })) === 2);
    revisar("la estructura real (almacén general) no es demostración", (await prisma.warehouse.count({ where: { organizationId: demoOrg.id, name: "Almacén general" } })) === 1);
    // La demo no cuenta como preparación. Se compara contra una empresa igual
    // que solo cargó la estructura (el mismo sitio y almacén reales, sin
    // ejemplos): el avance tiene que ser idéntico. Esto se encontró en el
    // navegador: la demo subía el avance de 20% a 88%.
    const soloEstructura = await nuevaEmpresa("estructura", "PLANTA");
    const otraDueña = await prisma.user.create({ data: { organizationId: soloEstructura.id, email: `e-${sello}@t.mx`, name: "Dueña", role: "OWNER", passwordHash: "x" } });
    await iniciarEmpresa({ organizationId: soloEstructura.id, userId: otraDueña.id, modo: "RECOMENDADA" });
    const conDemo = (await puestaEnMarcha(demoOrg.id)).porcentaje;
    const sinDemo = (await puestaEnMarcha(soloEstructura.id)).porcentaje;
    revisar("los datos de demostración no suben el avance: igual que sin ellos", conDemo === sinDemo, { conDemo, sinDemo });

    const mDemo = await puestaEnMarcha(demoOrg.id);
    revisar("con demo cargada no se puede declarar en operación", mDemo.hayDemo && mDemo.impideOperar.some((x) => /demostración/.test(x)), mDemo.impideOperar);
    await rechaza("y el servidor lo rechaza aunque se intente", () => comenzarAOperar({ organizationId: demoOrg.id, userId: dueño.id }), /demostración/);

    // Un registro demo usado en una orden real no se borra.
    const bomba = activosDemo[1];
    await prisma.workOrder.create({ data: { organizationId: demoOrg.id, number: "OT-1", title: "Orden real sobre un equipo demo", assetId: bomba.id } });
    const vista = await vistaPreviaQuitarDemo(demoOrg.id);
    revisar("antes de quitarla se ve qué se borra y qué no", vista.aBorrar.length > 0 && vista.bloqueados.some((b) => b.id === bomba.id), { aBorrar: vista.aBorrar.length, bloqueados: vista.bloqueados.map((b) => b.nombre) });
    const quitado = await quitarDemo({ organizationId: demoOrg.id, userId: dueño.id, confirmado: true });
    revisar("al quitarla se borra lo que nadie usó", quitado.borrados > 0 && (await prisma.asset.count({ where: { organizationId: demoOrg.id, id: { not: bomba.id } } })) === 0, quitado.borrados);
    revisar("el equipo demo con una orden real se queda, y se dice por qué",
      Boolean(await prisma.asset.findUnique({ where: { id: bomba.id } })) && quitado.bloqueados.some((b) => b.id === bomba.id && b.motivos.some((m) => /órdenes/.test(m))));
    revisar("sus refacciones se fueron con sus movimientos: el kardex no queda con huérfanos",
      (await prisma.stockMovement.count({ where: { organizationId: demoOrg.id } })) === 0);
    revisar("quitar la demo queda en la bitácora",
      (await prisma.auditLog.count({ where: { organizationId: demoOrg.id, action: { in: ["DEMO_CREATED", "DEMO_REMOVED"] } } })) === 2);

    console.log("\n   Comenzar a operar: solo cuando todo lo obligatorio está en regla");
    const lista = await nuevaEmpresa("lista", "EDIFICIO");
    const jefa = await prisma.user.create({ data: { organizationId: lista.id, email: `j-${sello}@t.mx`, name: "Jefa", role: "OWNER", passwordHash: "x" } });
    await iniciarEmpresa({ organizationId: lista.id, userId: jefa.id, modo: "RECOMENDADA" });
    const s = await prisma.site.findFirstOrThrow({ where: { organizationId: lista.id } });
    revisar("la estructura recomendada nombra el sitio como se usa en el giro", s.name === "Edificio principal", s.name);
    const piso = await prisma.location.create({ data: { organizationId: lista.id, siteId: s.id, code: "PB", name: "Planta baja" } });
    await prisma.user.create({ data: { organizationId: lista.id, email: `tec-${sello}@t.mx`, name: "Técnico", role: "TECHNICIAN", hourlyRate: 150, passwordHash: "x" } });
    const equipo = await prisma.asset.create({ data: { organizationId: lista.id, siteId: s.id, locationId: piso.id, code: "CH-1", name: "Chiller", criticality: "A" } });
    const plan = await prisma.maintenancePlan.create({
      data: { organizationId: lista.id, name: "Mantenimiento chiller", intervalDays: 30, assetId: equipo.id, tasks: { create: [{ position: 0, title: "Revisar presiones" }] } },
    });
    await prisma.planAsset.create({ data: { organizationId: lista.id, planId: plan.id, assetId: equipo.id, nextDueDate: new Date(Date.now() + 86_400_000) } });
    for (const m of ["almacen", "compras", "medidores"] as const) {
      await declararModulo({ organizationId: lista.id, userId: jefa.id, modulo: m, usa: false });
    }
    const mLista = await puestaEnMarcha(lista.id);
    revisar("con todo en regla: 100% y sin nada que impida operar", mLista.porcentaje === 100 && mLista.impideOperar.length === 0, { pct: mLista.porcentaje, impide: mLista.impideOperar });
    await comenzarAOperar({ organizationId: lista.id, userId: jefa.id });
    revisar("se declara en operación y queda en la bitácora",
      Boolean((await prisma.organization.findUniqueOrThrow({ where: { id: lista.id } })).operandoDesde) &&
      (await prisma.auditLog.count({ where: { organizationId: lista.id, action: "OPERATION_STARTED" } })) === 1);
    await rechaza("ya en operación, no se pueden cargar datos de demostración",
      () => iniciarEmpresa({ organizationId: lista.id, userId: jefa.id, modo: "DEMO" }), /operación/);

    console.log("\n4. El mismo porcentaje en el panel, la puesta en marcha y la consola del operador");
    await esperarServidor(base, 240_000);
    const secreto = new TextEncoder().encode(llaveDeSesion());
    const operador = await prisma.user.create({
      data: { organizationId: parcial.id, email: `op-${sello}@t.mx`, name: "Operador", role: "OWNER", isSuperAdmin: true, passwordHash: "x" },
    });
    const cookie = `mt_session=${await new SignJWT({ userId: operador.id, organizationId: parcial.id, email: operador.email, name: operador.name, role: "OWNER" })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secreto)}`;
    const html = async (ruta: string) => (await fetch(`${base}${ruta}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(120_000) })).text();
    const esperado = (await avancePuestaEnMarcha(parcial.id)).porcentaje;
    const enPanel = /data-porcentaje="(\d+)"/.exec(await html("/dashboard"))?.[1];
    const enPantalla = /data-porcentaje="(\d+)"/.exec(await html("/puesta-en-marcha"))?.[1];
    const enConsola = new RegExp(`${parcial.name}[\\s\\S]{0,4000}?data-porcentaje="(\\d+)"`).exec(await html("/clients"))?.[1];
    revisar("panel, puesta en marcha y consola dicen lo mismo",
      Number(enPanel) === esperado && Number(enPantalla) === esperado && Number(enConsola) === esperado,
      { esperado, enPanel, enPantalla, enConsola });
  } finally {
    for (const id of orgs) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    if (servidor?.pid) {
      try { process.kill(-servidor.pid, "SIGTERM"); } catch { /* ya termino */ }
    }
  }

  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
