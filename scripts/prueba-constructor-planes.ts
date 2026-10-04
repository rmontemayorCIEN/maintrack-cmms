/**
 * El constructor de planes: la meta, los grupos de equipos iguales y la rúbrica
 * de plan terminado.
 *
 * Llama a las MISMAS funciones que la pantalla y la ruta de API
 * (`constructorDePlanes`, `fijarMetaDePlanes`); no reproduce sus pasos. Al
 * final entra por HTTP para comprobar los permisos y que una empresa no vea la
 * meta de otra.
 *
 *   npx tsx scripts/prueba-constructor-planes.ts
 */
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { prisma } from "../lib/db";
import { constructorDePlanes, fijarMetaDePlanes, piezasDelPlan, estadoDelPlan } from "../lib/constructor-planes";
import { apagarServidor, colaDelLog, levantarServidor } from "./servidor-de-prueba";

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
    } catch { /* todavía no levanta */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

const PUERTO = 3213;

async function main() {
  process.env.AUTH_SECRET = llaveDeSesion();
  const sello = `cp-${Date.now()}`;
  const creadas: string[] = [];

  // Foto de las demás empresas: al final tienen que quedar idénticas.
  const foto = async () => {
    const where = { organizationId: { notIn: creadas } };
    return JSON.stringify(await Promise.all([
      prisma.maintenancePlan.count({ where }),
      prisma.asset.count({ where }),
      prisma.auditLog.count({ where }),
      prisma.organization.count({ where: { id: { notIn: creadas }, metaPlanes: { not: null } } }),
    ]));
  };
  const antes = await foto();

  const nuevaOrg = async (s: string) => {
    const o = await prisma.organization.create({
      data: { name: `${sello}-${s}`, slug: `${sello}-${s}`, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey" },
    });
    creadas.push(o.id);
    return o;
  };

  let servidor: ChildProcess | null = null;
  try {
    const A = await nuevaOrg("a");
    const B = await nuevaOrg("b");
    const dueno = await prisma.user.create({
      data: { organizationId: A.id, email: `dueno-${sello}@t.mx`, name: "Dueño", role: "OWNER", passwordHash: "x" },
    });
    const tecnico = await prisma.user.create({
      data: { organizationId: A.id, email: `tec-${sello}@t.mx`, name: "Técnico", role: "TECHNICIAN", passwordHash: "x" },
    });
    const duenoB = await prisma.user.create({
      data: { organizationId: B.id, email: `duenob-${sello}@t.mx`, name: "DueñoB", role: "OWNER", passwordHash: "x" },
    });
    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const sitioB = await prisma.site.create({ data: { organizationId: B.id, code: "S1", name: "Planta B" } });
    const compresores = await prisma.assetCategory.create({ data: { organizationId: A.id, code: "COMP", name: "Compresores" } });
    const bombas = await prisma.assetCategory.create({ data: { organizationId: A.id, code: "BOM", name: "Bombas" } });

    const equipo = (code: string, categoryId: string | null, extra: Record<string, unknown> = {}) =>
      prisma.asset.create({ data: { organizationId: A.id, siteId: sitio.id, code, name: code, categoryId, ...extra } });

    // ─────────────────────────────── 1-4 Los grupos de equipos iguales
    console.log("\n1-4. Grupos de equipos iguales");
    // Dos compresores Atlas GA-30, uno Atlas GA-75, y la misma marca escrita
    // de tres maneras: el grupo tiene que ser el mismo.
    const ga30a = await equipo("CR-1", compresores.id, { manufacturer: "Atlas Copco", model: "GA-30", criticality: "A" });
    const ga30b = await equipo("CR-2", compresores.id, { manufacturer: "ATLAS  COPCO", model: "ga 30", criticality: "B" });
    const ga75 = await equipo("CR-3", compresores.id, { manufacturer: "Atlas Copco", model: "GA-75", criticality: "B" });
    // Dos bombas sin modelo capturado: un solo grupo por familia, y se advierte.
    const bomba1 = await equipo("BO-1", bombas.id, { manufacturer: "Grundfos" });
    const bomba2 = await equipo("BO-2", bombas.id, {});
    // Un equipo sin familia: no se pierde, hace su propio grupo.
    const suelto = await equipo("XX-1", null, { manufacturer: "Marca", model: "X" });
    // Un retirado no cuenta: mismo criterio que la cobertura.
    await equipo("CR-9", compresores.id, { manufacturer: "Atlas Copco", model: "GA-30", status: "RETIRED" });

    const c1 = await constructorDePlanes(A.id);
    const grupo = (code: string) => c1.grupos.find((g) => g.equipos.some((e) => e.code === code));
    revisar("1. mismo modelo escrito distinto cae en un solo grupo", grupo("CR-1")?.clave === grupo("CR-2")?.clave &&
      grupo("CR-1")?.equipos.length === 2, { clave: grupo("CR-1")?.clave, equipos: grupo("CR-1")?.equipos.length });
    revisar("   otro modelo de la misma familia es otro grupo", grupo("CR-3")?.clave !== grupo("CR-1")?.clave);
    revisar("2. el equipo retirado no entra al grupo", grupo("CR-1")!.equipos.every((e) => e.code !== "CR-9"));
    revisar("3. equipos sin modelo: un grupo por familia, y se dice que puede ser más de un tipo",
      grupo("BO-1")?.clave === grupo("BO-2")?.clave && grupo("BO-1")?.modeloConocido === false && grupo("BO-1")?.equipos.length === 2,
      { mismoGrupo: grupo("BO-1")?.clave === grupo("BO-2")?.clave, modeloConocido: grupo("BO-1")?.modeloConocido });
    revisar("   el equipo sin familia no se pierde: hace su propio grupo", Boolean(grupo("XX-1")));
    revisar("4. el mínimo sugerido es el número de grupos", c1.sugeridos === c1.grupos.length && c1.sugeridos === 4,
      { sugeridos: c1.sugeridos, grupos: c1.grupos.length });
    revisar("   sin planes, nada está cubierto", c1.construidos === 0 && c1.equiposCubiertos === 0 &&
      c1.equiposTotal === 6 && c1.grupos.every((g) => g.estado === "SIN_PLAN"), { equipos: c1.equiposTotal });
    revisar("   el grupo con el equipo más crítico va primero", c1.grupos[0]?.criticidad === "A");

    // ─────────────────────────────── 5-9 La rúbrica: qué le falta a un plan
    console.log("\n5-9. Plan terminado, pieza por pieza");
    const especialidad = await prisma.specialty.create({ data: { organizationId: A.id, code: "MEC", name: "Mecánico", hourlyRate: 120 } });
    const refaccion = await prisma.part.create({ data: { organizationId: A.id, code: "FIL-1", name: "Filtro", unit: "pza" } });

    // Un plan vacío: existe y no sirve.
    const vacio = await prisma.maintenancePlan.create({ data: { organizationId: A.id, name: `Vacío ${sello}`, intervalDays: 30 } });
    const c2 = await constructorDePlanes(A.id);
    const pVacio = c2.planes.find((p) => p.id === vacio.id);
    revisar("5. un plan sin actividades ni equipos es esqueleto, y lo dice", pVacio?.estado === "ESQUELETO" &&
      pVacio.falta.includes("sin actividades") && pVacio.falta.includes("sin equipos asignados"), pVacio?.falta);
    revisar("   y aun así cuenta como construido: la meta sigue siendo el sugerido", c2.construidos === 1 && c2.meta === 4,
      { construidos: c2.construidos, meta: c2.meta });

    // El plan de los GA-30, completo salvo piezas que se van agregando.
    const plan = await prisma.maintenancePlan.create({
      data: {
        organizationId: A.id, name: `Preventivo GA-30 ${sello}`, intervalDays: 30,
        tasks: {
          create: [
            { title: "Cambiar filtro de aire", taskType: "REPLACE", cadaCuanto: 30, position: 0 },
            { title: "Medir presión de descarga", taskType: "MEASURE", cadaCuanto: 30, position: 1 },
            { title: "Revisar fugas", taskType: "CHECK", cadaCuanto: 30, position: 2 },
          ],
        },
      },
      include: { tasks: { orderBy: { position: "asc" } } },
    });
    for (const a of [ga30a.id, ga30b.id]) {
      await prisma.planAsset.create({ data: { organizationId: A.id, planId: plan.id, assetId: a } });
    }
    const [tReemplazo, tMedicion, tRevision] = plan.tasks;

    const falta = async () => (await constructorDePlanes(A.id)).planes.find((p) => p.id === plan.id)!;
    const f1 = await falta();
    revisar("6. sin mano de obra, sin refacción, sin rango y sin procedimiento: se nombra cada hueco",
      f1.falta.some((x) => /mano de obra en 3/.test(x)) &&
      f1.falta.some((x) => /refacciones en 1/.test(x)) &&
      f1.falta.some((x) => /unidad o rango en 1/.test(x)) &&
      f1.falta.some((x) => /herramientas/.test(x)) &&
      f1.falta.some((x) => /procedimiento/.test(x)), f1.falta);
    revisar("   con actividades y equipos ya no es esqueleto", f1.estado === "EN_FORMA", { estado: f1.estado, avance: f1.avance });

    // Se van tapando los huecos, y el avance sube.
    for (const t of plan.tasks) {
      await prisma.planTaskLabor.create({ data: { planTaskId: t.id, specialtyId: especialidad.id, personas: 1, hours: 1 } });
    }
    await prisma.planTaskPart.create({ data: { planTaskId: tReemplazo.id, partId: refaccion.id, quantity: 1 } });
    await prisma.planTask.update({ where: { id: tMedicion.id }, data: { unit: "bar", minValue: 6, maxValue: 8 } });
    const f2 = await falta();
    revisar("7. al tapar los huecos el avance sube y queda solo lo que falta", f2.avance > f1.avance &&
      f2.falta.every((x) => /herramientas|procedimiento/.test(x)), { antes: f1.avance, ahora: f2.avance, falta: f2.falta });

    await prisma.planTaskTool.create({ data: { planTaskId: tReemplazo.id, partId: refaccion.id, cantidad: 1 } });
    await prisma.maintenancePlan.update({ where: { id: plan.id }, data: { procedure: "Parar, bloquear, cambiar filtro." } });
    const f3 = await falta();
    revisar("8. completo: 100% y listo", f3.avance === 100 && f3.estado === "LISTO" && f3.falta.length === 0,
      { avance: f3.avance, estado: f3.estado, falta: f3.falta });

    // La cobertura del grupo: si entra un tercer GA-30 sin plan, el plan deja
    // de estar listo, porque queda un equipo igual descubierto.
    const ga30c = await equipo("CR-4", compresores.id, { manufacturer: "atlas copco", model: "GA30" });
    const f4 = await falta();
    revisar("9. entra un equipo igual sin plan: el plan deja de estar listo y lo nombra",
      f4.estado !== "LISTO" && f4.falta.some((x) => /1 equipo\(s\) igual\(es\) siguen sin ningun plan/.test(x)), f4.falta);
    await prisma.planAsset.create({ data: { organizationId: A.id, planId: plan.id, assetId: ga30c.id } });
    const f5 = await falta();
    revisar("   al asignarlo vuelve a listo", f5.estado === "LISTO" && f5.equipos === 3, { estado: f5.estado, equipos: f5.equipos });

    // Lo que no aplica no castiga: un plan de pura inspección visual.
    const inspeccion = await prisma.maintenancePlan.create({
      data: {
        organizationId: A.id, name: `Recorrido ${sello}`, intervalDays: 7,
        procedure: "Recorrido visual por la línea.",
        tasks: { create: [{ title: "Revisar goteos", taskType: "CHECK", cadaCuanto: 7, position: 0 }] },
      },
      include: { tasks: true },
    });
    await prisma.planTaskLabor.create({ data: { planTaskId: inspeccion.tasks[0].id, specialtyId: especialidad.id, personas: 1, hours: 0.5 } });
    await prisma.planAsset.create({ data: { organizationId: A.id, planId: inspeccion.id, assetId: suelto.id } });
    const pInsp = (await constructorDePlanes(A.id)).planes.find((p) => p.id === inspeccion.id);
    revisar("   un plan de pura inspección no necesita refacciones ni herramientas: llega a listo",
      pInsp?.estado === "LISTO" && pInsp.piezas.find((x) => x.clave === "refacciones")?.aplica === false &&
      pInsp.piezas.find((x) => x.clave === "herramientas")?.aplica === false, { estado: pInsp?.estado, avance: pInsp?.avance });

    // ─────────────────────────────── 10-13 La meta
    console.log("\n10-13. La meta y su trinquete");
    const c3 = await constructorDePlanes(A.id);
    revisar("10. sin meta fijada rige el mínimo sugerido", c3.metaFijada === null && c3.meta === c3.sugeridos,
      { meta: c3.meta, sugeridos: c3.sugeridos });

    const c4 = await fijarMetaDePlanes({ organizationId: A.id, userId: dueno.id, meta: 8 });
    revisar("11. la meta se fija y queda con nombre y fecha", c4.meta === 8 && c4.metaFijada === 8 &&
      c4.metaFijadaPor === "Dueño" && Boolean(c4.metaFijadaEl), { meta: c4.meta, por: c4.metaFijadaPor });

    revisar("   con la meta arriba del sugerido no hay nada que avisar", c4.sugeridoSuperaMeta === false);

    const c5 = await fijarMetaDePlanes({ organizationId: A.id, userId: dueno.id, meta: 2 });
    revisar("12. trinquete: una meta por debajo de lo construido no baja el tablero",
      c5.meta === c5.construidos && c5.construidos === 3, { meta: c5.meta, construidos: c5.construidos, fijada: c5.metaFijada });
    revisar("   pero se guarda su número tal cual, no el inflado", c5.metaFijada === 2);

    revisar("13. si el sugerido pasa su meta se avisa, y NO se le cambia el número",
      c5.sugeridoSuperaMeta && c5.sugeridos > c5.meta && c5.metaFijada === 2,
      { sugeridos: c5.sugeridos, meta: c5.meta, fijada: c5.metaFijada, aviso: c5.sugeridoSuperaMeta });

    await rechaza("   una meta de cero se rechaza", () => fijarMetaDePlanes({ organizationId: A.id, userId: dueno.id, meta: 0 }), /entero/);
    await rechaza("   y una absurda también", () => fijarMetaDePlanes({ organizationId: A.id, userId: dueno.id, meta: 99_999 }), /entero/);
    const c7 = await fijarMetaDePlanes({ organizationId: A.id, userId: dueno.id, meta: null });
    revisar("   volver al sugerido borra la meta y a su autor", c7.metaFijada === null && c7.metaFijadaPor === null &&
      c7.meta === Math.max(c7.sugeridos, c7.construidos), { meta: c7.meta });

    // ─────────────────────────────── 14 Ritmo
    console.log("\n14. Ritmo y proyección");
    revisar("14. con planes creados hoy hay ritmo, y la fecha de término es futura",
      (c7.ritmoSemanal ?? 0) > 0 && (c7.meta <= c7.construidos || (c7.fechaTermino?.getTime() ?? 0) > Date.now()),
      { ritmo: c7.ritmoSemanal, termino: c7.fechaTermino });
    revisar("   nada detenido cuando se acaba de crear un plan", c7.detenido === false && c7.diasSinPlanNuevo === 0);

    // ─────────────────────────────── 15-17 Aislamiento y permisos
    console.log("\n15-17. Aislamiento entre empresas y permisos");
    await prisma.asset.create({ data: { organizationId: B.id, siteId: sitioB.id, code: "B-1", name: "De B", manufacturer: "Otra", model: "Z" } });
    await fijarMetaDePlanes({ organizationId: B.id, userId: duenoB.id, meta: 30 });
    const cA = await constructorDePlanes(A.id);
    const cB = await constructorDePlanes(B.id);
    revisar("15. cada empresa ve solo lo suyo: grupos, planes y meta", cA.metaFijada === null && cB.metaFijada === 30 &&
      cB.grupos.length === 1 && cB.planes.length === 0 &&
      cA.grupos.every((g) => g.equipos.every((e) => e.code !== "B-1")), { metaA: cA.metaFijada, metaB: cB.metaFijada, gruposB: cB.grupos.length });

    servidor = levantarServidor({ puerto: PUERTO, nombre: "constructor-planes" });
    const base = `http://127.0.0.1:${PUERTO}`;
    await esperarServidor(base, 240_000);
    const secreto = new TextEncoder().encode(process.env.AUTH_SECRET!);
    const sesion = async (u: { id: string; organizationId: string; email: string; name: string; role: string }) =>
      `mt_session=${await new SignJWT({ userId: u.id, organizationId: u.organizationId, email: u.email, name: u.name, role: u.role })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secreto)}`;
    const pedir = async (metodo: string, ruta: string, cookie: string, cuerpo?: unknown) => {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: { "Content-Type": "application/json", Cookie: cookie },
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
        signal: AbortSignal.timeout(120_000),
      });
      return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
    };

    const cDueno = await sesion(dueno);
    const cTecnico = await sesion(tecnico);
    const cDuenoB = await sesion(duenoB);

    const lee = await pedir("GET", "/api/plans/constructor", cDueno);
    revisar("16. el dueño lee su tablero por API", lee.status === 200 && (lee.json.sugeridos as number) === cA.sugeridos,
      { status: lee.status, sugeridos: lee.json.sugeridos, log: lee.status >= 500 ? colaDelLog(PUERTO, 12, "constructor-planes") : undefined });

    const pone = await pedir("PUT", "/api/plans/constructor", cDueno, { meta: 9 });
    const tras = await constructorDePlanes(A.id);
    revisar("   y la fija desde la pantalla, con bitácora", pone.status === 200 && tras.metaFijada === 9 &&
      (await prisma.auditLog.count({ where: { organizationId: A.id, action: "PLAN_GOAL_CHANGED" } })) === 1, { status: pone.status });

    const tecIntenta = await pedir("PUT", "/api/plans/constructor", cTecnico, { meta: 1 });
    revisar("17. un técnico no fija la meta (403), y la meta no cambió", tecIntenta.status === 403 &&
      (await constructorDePlanes(A.id)).metaFijada === 9, { status: tecIntenta.status });

    const otraEmpresa = await pedir("GET", "/api/plans/constructor", cDuenoB);
    revisar("   el dueño de otra empresa recibe su propio tablero, no el de A",
      otraEmpresa.status === 200 && (otraEmpresa.json.metaFijada as number) === 30, { meta: otraEmpresa.json.metaFijada });

    const basura = await pedir("PUT", "/api/plans/constructor", cDueno, { meta: "muchos" });
    revisar("   una meta que no es número se rechaza sin tocar nada", basura.status >= 400 &&
      (await constructorDePlanes(A.id)).metaFijada === 9, { status: basura.status });
  } finally {
    await apagarServidor(servidor, PUERTO);
    for (const id of creadas) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    console.log("\nAislamiento de la prueba");
    revisar("las demás empresas quedaron exactamente como estaban", (await foto()) === antes);
    await prisma.$disconnect();
  }

  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
