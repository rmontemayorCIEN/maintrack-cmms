/**
 * Mapa de activos: la consulta que usa la ruta /api/assets/mapa.
 *
 * Llama a `consultarMapa`, la misma función de la ruta. Cubre: lo que cae
 * dentro y fuera de la zona, que los filtros acotan, que NUNCA se ven los
 * activos de otra empresa, que sin coordenadas o dado de baja no aparece, y el
 * cambio a grupos cuando hay demasiados (con la cuenta cuadrando).
 *
 *   npx tsx scripts/prueba-mapa-activos.ts
 */
import { prisma } from "../lib/db";
import { TOPE_PUNTOS, agruparEnCeldas, estadoMasGrave, tonoDe } from "../lib/mapa";
import { CapaNoPermitida, consultarMapa } from "../lib/mapa-consulta";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 200)}` : ""}`);
}

const GUADALUPE = { norte: 25.72, sur: 25.62, este: -100.18, oeste: -100.32 };

async function main() {
  const sello = `map-${Date.now()}`;
  const crear = (n: string) => prisma.organization.create({ data: { name: `${sello}-${n}`, slug: `${sello}-${n}`, plan: "ENTERPRISE", status: "ACTIVE" } });
  const [a, b] = [await crear("a"), await crear("b")];
  try {
    const sitioA = await prisma.site.create({ data: { organizationId: a.id, code: "GPE", name: "Guadalupe" } });
    const sitioA2 = await prisma.site.create({ data: { organizationId: a.id, code: "OTRO", name: "Otro" } });
    const sitioB = await prisma.site.create({ data: { organizationId: b.id, code: "GPE", name: "Guadalupe B" } });
    const cat = await prisma.assetCategory.create({ data: { organizationId: a.id, code: "LUM", name: "Luminaria" } });
    const base = (org: string, site: string, code: string, extra: object) =>
      ({ organizationId: org, siteId: site, code, name: `Luminaria ${code}`, ...extra });

    await prisma.asset.createMany({ data: [
      base(a.id, sitioA.id, "L-1", { latitud: 25.67, longitud: -100.25, status: "OPERATIONAL", categoryId: cat.id }),
      base(a.id, sitioA.id, "L-2", { latitud: 25.68, longitud: -100.26, status: "DOWN" }),
      base(a.id, sitioA2.id, "L-3", { latitud: 25.69, longitud: -100.27, status: "OPERATIONAL" }),
      base(a.id, sitioA.id, "L-FUERA", { latitud: 19.43, longitud: -99.13, status: "OPERATIONAL" }),          // CDMX: fuera de la zona
      base(a.id, sitioA.id, "L-SIN", { status: "OPERATIONAL" }),                                                // sin coordenadas
      base(a.id, sitioA.id, "L-BAJA", { latitud: 25.67, longitud: -100.25, active: false, status: "RETIRED" }), // dado de baja
      base(b.id, sitioB.id, "AJENA", { latitud: 25.67, longitud: -100.25, status: "OPERATIONAL" }),             // de otra empresa
    ] });

    console.log("\n1. Zona, baja, sin coordenadas y otra empresa");
    const r = await consultarMapa(a.id, GUADALUPE);
    const codigos = r.puntos.map((p) => p.code).sort();
    revisar("trae solo lo de la zona, activo y ubicado: L-1, L-2, L-3", r.modo === "puntos" && codigos.join() === "L-1,L-2,L-3", codigos);
    revisar("el total coincide con lo mostrado", r.total === 3 && r.puntos.length === 3);
    revisar("NO trae el activo de otra empresa, aunque esté en el mismo punto", !codigos.includes("AJENA"));
    const rB = await consultarMapa(b.id, GUADALUPE);
    revisar("la otra empresa ve solo lo suyo", rB.puntos.length === 1 && rB.puntos[0].code === "AJENA");
    console.log("\n1b. Circuito (equipo padre) para la vista «Por circuito»");
    const circuito = await prisma.asset.create({ data: base(a.id, sitioA.id, "CIR-X", { name: "Circuito X", status: "OPERATIONAL" }) });
    const ajena = await prisma.asset.findFirstOrThrow({ where: { organizationId: b.id, code: "AJENA" } });
    await prisma.asset.updateMany({ where: { organizationId: a.id, code: { in: ["L-1", "L-2"] } }, data: { parentId: circuito.id } });
    await prisma.asset.updateMany({ where: { organizationId: a.id, code: "L-3" }, data: { parentId: ajena.id } }); // padre de OTRA empresa
    const rP = await consultarMapa(a.id, GUADALUPE);
    const padre = (c: string) => rP.puntos.find((p) => p.code === c);
    revisar("los hijos traen el id y el nombre de su circuito", padre("L-1")?.padreId === circuito.id && padre("L-2")?.padreNombre === "Circuito X");
    revisar("un equipo sin padre trae nulos", padre("L-2") !== undefined && rP.puntos.every((p) => p.padreId === null || p.padreNombre !== null));
    revisar("un padre de otra empresa NO se cree ni se nombra", padre("L-3")?.padreId === null && padre("L-3")?.padreNombre === null, padre("L-3"));
    revisar("el circuito mismo no aparece (no tiene coordenadas)", !rP.puntos.some((p) => p.code === "CIR-X"));
    const rCdmx = await consultarMapa(a.id, { norte: 19.6, sur: 19.3, este: -99.0, oeste: -99.3 });
    revisar("otra zona trae lo que hay en ella", rCdmx.puntos.map((p) => p.code).join() === "L-FUERA");
    const rVacio = await consultarMapa(a.id, { norte: 10, sur: 9, este: -90, oeste: -91 });
    revisar("una zona vacía responde vacía, no error", rVacio.total === 0 && rVacio.puntos.length === 0);

    console.log("\n2. Filtros");
    revisar("por sitio", (await consultarMapa(a.id, GUADALUPE, { siteId: sitioA2.id })).puntos.map((p) => p.code).join() === "L-3");
    revisar("por categoría", (await consultarMapa(a.id, GUADALUPE, { categoryId: cat.id })).puntos.map((p) => p.code).join() === "L-1");
    revisar("por estado", (await consultarMapa(a.id, GUADALUPE, { status: "DOWN" })).puntos.map((p) => p.code).join() === "L-2");
    revisar("un sitio de OTRA empresa como filtro no abre nada", (await consultarMapa(a.id, GUADALUPE, { siteId: sitioB.id })).total === 0);

    console.log("\n3. Agrupación (función pura)");
    const g = agruparEnCeldas(
      [{ latitud: 1, longitud: 1, status: "OPERATIONAL" }, { latitud: 1.01, longitud: 1.01, status: "DOWN" }, { latitud: 9, longitud: 9, status: "OPERATIONAL" }],
      { norte: 10, sur: 0, este: 10, oeste: 0 },
    );
    revisar("dos puntos cercanos son un grupo y el lejano otro", g.length === 2 && g.map((x) => x.cantidad).sort().join() === "1,2", g);
    revisar("el grupo toma el estado más grave de lo que contiene", g.find((x) => x.cantidad === 2)?.peor === "DOWN");
    revisar("un punto sobre el borde exacto cae en una celda válida", agruparEnCeldas([{ latitud: 10, longitud: 10, status: "OPERATIONAL" }], { norte: 10, sur: 0, este: 10, oeste: 0 }).length === 1);
    revisar("estadoMasGrave ordena fuera > degradado > operativo", estadoMasGrave("OPERATIONAL", "DEGRADED") === "DEGRADED" && estadoMasGrave("DOWN", "DEGRADED") === "DOWN");

    console.log("\n3b. Estado de este momento: lo registrado y lo que pasa ahora");
    const HOY = new Date("2026-11-06T12:00:00Z");
    const hace = (dias: number) => new Date(HOY.getTime() - dias * 86_400_000);
    const usuario = await prisma.user.create({ data: { organizationId: a.id, email: `u-${sello}@t.mx`, name: "U", role: "ADMIN", passwordHash: "x" } });
    const id = async (code: string) => (await prisma.asset.findFirstOrThrow({ where: { organizationId: a.id, code } })).id;
    const [l1, l2, l3] = [await id("L-1"), await id("L-2"), await id("L-3")];
    const enEspera = await prisma.asset.create({ data: base(a.id, sitioA.id, "L-RESERVA", { latitud: 25.665, longitud: -100.26, status: "STANDBY" }) });
    let n = 0;
    const orden = (assetId: string, extra: object) => prisma.workOrder.create({ data: {
      organizationId: a.id, number: `OT-${sello}-${++n}`, title: "t", maintenanceType: "CORRECTIVE", status: "OPEN", priority: "MEDIUM",
      assetId, siteId: sitioA.id, createdById: usuario.id, ...extra,
    } });
    // L-1 operativa con una orden de falla abierta; L-3 operativa con un paro abierto; L-RESERVA en reserva con paro abierto.
    await orden(l1, { createdAt: hace(5) });
    await prisma.downtimeEvent.create({ data: { organizationId: a.id, assetId: l3, startedAt: hace(1), planned: false } });
    await prisma.downtimeEvent.create({ data: { organizationId: a.id, assetId: enEspera.id, startedAt: hace(1), planned: false } });
    await prisma.downtimeEvent.create({ data: { organizationId: a.id, assetId: l1, startedAt: hace(1), planned: true } }); // un paro PLANEADO no baja el estado
    const hoy = { hoy: HOY };
    const vivo = await consultarMapa(a.id, GUADALUPE, {}, undefined, hoy);
    const de = (r: typeof vivo, code: string) => r.puntos.find((p) => p.code === code)!;
    revisar("una orden de falla abierta lo vuelve degradado, y el globo dice cuál", de(vivo, "L-1").status === "DEGRADED" && /Orden de falla abierta/.test(de(vivo, "L-1").motivo ?? ""), de(vivo, "L-1"));
    revisar("un paro abierto lo vuelve fuera de servicio, aunque esté registrado operativo", de(vivo, "L-3").status === "DOWN" && /Paro abierto/.test(de(vivo, "L-3").motivo ?? ""), de(vivo, "L-3"));
    revisar("lo registrado fuera de servicio sigue igual, sin motivo inventado", de(vivo, "L-2").status === "DOWN" && de(vivo, "L-2").motivo === null);
    revisar("un paro PLANEADO abierto no baja el estado (L-1 sigue degradado, no fuera)", de(vivo, "L-1").status === "DEGRADED");
    revisar("lo que está en reserva sigue en reserva, aunque tenga un paro abierto", vivo.puntos.find((p) => p.code === "L-RESERVA")?.status === "STANDBY");
    const soloFuera = await consultarMapa(a.id, GUADALUPE, { status: "DOWN" }, undefined, hoy);
    revisar("el filtro «fuera de servicio» incluye lo parado ahora: L-2 (registrado) y L-3 (paro abierto)", soloFuera.puntos.map((p) => p.code).sort().join() === "L-2,L-3", soloFuera.puntos.map((p) => p.code));
    const deB = await prisma.asset.findFirstOrThrow({ where: { organizationId: b.id, code: "AJENA" } });
    await prisma.downtimeEvent.create({ data: { organizationId: b.id, assetId: deB.id, startedAt: hace(1), planned: false } });
    revisar("un paro abierto de otra empresa no mueve nada de esta", (await consultarMapa(a.id, GUADALUPE, {}, undefined, hoy)).puntos.length === vivo.puntos.length && de(await consultarMapa(a.id, GUADALUPE, {}, undefined, hoy), "L-1").status === "DEGRADED");

    console.log("\n3c. Capas numéricas: fallas, costo y paros");
    await orden(l1, { createdAt: hace(20), status: "COMPLETED" });                       // 2.ª falla de L-1, dentro de 30 días
    await orden(l1, { createdAt: hace(100), status: "COMPLETED" });                      // 3.ª, solo cuenta en 365
    await orden(l1, { createdAt: hace(3), status: "CANCELLED" });                        // cancelada: no es falla
    await orden(l2, { createdAt: hace(10), status: "COMPLETED" });                       // 1 falla de L-2
    await orden(l2, { createdAt: hace(8), maintenanceType: "PREVENTIVE", status: "COMPLETED" }); // preventiva: no es falla
    const f30 = await consultarMapa(a.id, GUADALUPE, {}, undefined, { ...hoy, capa: "FALLAS", dias: 30 });
    const f365 = await consultarMapa(a.id, GUADALUPE, {}, undefined, { ...hoy, capa: "FALLAS", dias: 365 });
    revisar("fallas en 30 días: L-1 tiene 2 (la abierta y la de hace 20 días) y L-2 tiene 1", de(f30, "L-1").valor === 2 && de(f30, "L-2").valor === 1, { l1: de(f30, "L-1").valor, l2: de(f30, "L-2").valor });
    revisar("en 365 días entra la de hace 100: L-1 tiene 3", de(f365, "L-1").valor === 3);
    revisar("la cancelada y la preventiva no cuentan como falla (mismo criterio que los indicadores)", de(f365, "L-2").valor === 1);
    revisar("el máximo es de toda la empresa y la suma es la de la zona", f30.maximo === 2 && f30.suma === 3 && f365.maximo === 3 && f365.suma === 4, { f30: [f30.maximo, f30.suma], f365: [f365.maximo, f365.suma] });
    revisar("los activos sin fallas valen 0", de(f30, "L-3").valor === 0);

    await prisma.workOrder.updateMany({ where: { organizationId: a.id, assetId: l1, status: "OPEN" }, data: { totalCost: 100 } });
    await prisma.workOrder.updateMany({ where: { organizationId: a.id, assetId: l1, status: "COMPLETED", createdAt: { gte: hace(30) } }, data: { totalCost: 250 } });
    await prisma.workOrder.updateMany({ where: { organizationId: a.id, assetId: l1, status: "CANCELLED" }, data: { totalCost: 999 } });
    await prisma.workOrder.updateMany({ where: { organizationId: a.id, assetId: l1, createdAt: { lt: hace(90) } }, data: { totalCost: 5000 } });
    await prisma.workOrder.updateMany({ where: { organizationId: a.id, assetId: l2, maintenanceType: "PREVENTIVE" }, data: { totalCost: 40 } });
    await rechazaCosto();
    async function rechazaCosto() {
      let denegado = false;
      try { await consultarMapa(a.id, GUADALUPE, {}, undefined, { ...hoy, capa: "COSTO", puedeVerCostos: false }); } catch (e) { denegado = e instanceof CapaNoPermitida; }
      revisar("quien no ve costos NO puede pedir la capa de costo (se exige en el servidor)", denegado);
    }
    const c30 = await consultarMapa(a.id, GUADALUPE, {}, undefined, { ...hoy, capa: "COSTO", dias: 30, puedeVerCostos: true });
    const c365 = await consultarMapa(a.id, GUADALUPE, {}, undefined, { ...hoy, capa: "COSTO", dias: 365, puedeVerCostos: true });
    revisar("costo en 30 días: L-1 = 100 + 250 (sin la cancelada de 999) y L-2 = 40 (el costo es de TODAS las órdenes, no solo fallas)", de(c30, "L-1").valor === 350 && de(c30, "L-2").valor === 40, { l1: de(c30, "L-1").valor, l2: de(c30, "L-2").valor });
    revisar("en 365 días entra la de hace 100 días (5,000): L-1 = 5,350", de(c365, "L-1").valor === 5350);
    revisar("el máximo y la suma salen del mismo cálculo", c30.maximo === 350 && c30.suma === 390 && c365.maximo === 5350, { c30: [c30.maximo, c30.suma] });

    await prisma.downtimeEvent.createMany({ data: [
      { organizationId: a.id, assetId: l3, startedAt: hace(10), endedAt: hace(10), minutes: 90, planned: false },
      { organizationId: a.id, assetId: l3, startedAt: hace(20), endedAt: hace(20), minutes: 30, planned: false },
      { organizationId: a.id, assetId: l3, startedAt: hace(15), endedAt: hace(15), minutes: 600, planned: true },   // planeado: no cuenta
      { organizationId: a.id, assetId: l3, startedAt: hace(200), endedAt: hace(200), minutes: 60, planned: false }, // fuera de 30 y de 90 días
    ] });
    const p30 = await consultarMapa(a.id, GUADALUPE, {}, undefined, { ...hoy, capa: "PAROS", dias: 30 });
    const p365 = await consultarMapa(a.id, GUADALUPE, {}, undefined, { ...hoy, capa: "PAROS", dias: 365 });
    revisar("horas de paro en 30 días: 90 + 30 min = 2.0 h (sin el paro planeado)", de(p30, "L-3").valor === 2 && p30.maximo === 2, { valor: de(p30, "L-3").valor });
    revisar("en 365 días entra el de hace 200 días: 3.0 h", de(p365, "L-3").valor === 3);
    revisar("la capa de otra empresa no se mezcla: el paro de B no sube el máximo de A", p365.maximo === 3);

    console.log("\n3d. La escala de tonos");
    revisar("0 es «sin nada»; el máximo es el tono más alto; los cuartos reparten parejo",
      tonoDe(0, 10) === 0 && tonoDe(10, 10) === 4 && tonoDe(2.5, 10) === 1 && tonoDe(2.6, 10) === 2 && tonoDe(5, 10) === 2 && tonoDe(7.5, 10) === 3 && tonoDe(7.6, 10) === 4);
    revisar("sin máximo no hay tono (evita dividir entre 0)", tonoDe(5, 0) === 0);

    console.log("\n4. Muchos activos: pasa a grupos y la cuenta cuadra");
    const N = TOPE_PUNTOS + 400;
    const lote = Array.from({ length: N }, (_, i) => base(a.id, sitioA.id, `M-${i}`, {
      latitud: 25.63 + (i % 90) * 0.001, longitud: -100.31 + Math.floor(i / 90) * 0.0008, status: i % 50 === 0 ? "DOWN" : "OPERATIONAL",
    }));
    await prisma.asset.createMany({ data: lote });
    const rMuchos = await consultarMapa(a.id, GUADALUPE);
    const suma = rMuchos.grupos.reduce((s, x) => s + x.cantidad, 0);
    revisar(`con más de ${TOPE_PUNTOS} cambia a grupos y no manda puntos sueltos`, rMuchos.modo === "grupos" && rMuchos.puntos.length === 0);
    revisar("la suma de los grupos es el total (nada se pierde ni se duplica)", suma === rMuchos.total && rMuchos.total === N + 4 /* L-1, L-2, L-3 y L-RESERVA */, { suma, total: rMuchos.total });
    const gruesa = await consultarMapa(a.id, GUADALUPE, {}, { columnas: 3, filas: 3 });
    revisar("una rejilla más gruesa da menos grupos y la cuenta sigue cuadrando",
      gruesa.grupos.length <= 9 && gruesa.grupos.length < rMuchos.grupos.length && gruesa.grupos.reduce((s, x) => s + x.cantidad, 0) === gruesa.total,
      { gruesa: gruesa.grupos.length, normal: rMuchos.grupos.length });
    const fMuchos = await consultarMapa(a.id, GUADALUPE, {}, undefined, { hoy: HOY, capa: "FALLAS", dias: 365 });
    revisar("en grupos, la suma de la capa por grupo es la suma total y el valor más alto del grupo se conserva",
      fMuchos.modo === "grupos" && fMuchos.grupos.reduce((s, g) => s + g.sumaValor, 0) === fMuchos.suma && Math.max(...fMuchos.grupos.map((g) => g.maxValor)) === 3, { suma: fMuchos.suma });
    revisar("no dice «incompleto» si leyó todo", rMuchos.incompleto === false);
    revisar("un grupo con una luminaria fuera de servicio lo muestra", rMuchos.grupos.some((x) => x.peor === "DOWN"));
    const acercado = await consultarMapa(a.id, { norte: 25.6335, sur: 25.6295, este: -100.3085, oeste: -100.3115 });
    revisar("al acercar, vuelve a puntos sueltos", acercado.modo === "puntos" && acercado.puntos.length > 0 && acercado.total <= TOPE_PUNTOS, { modo: acercado.modo, total: acercado.total });
  } finally {
    for (const o of [a, b]) await prisma.organization.delete({ where: { id: o.id } }).catch(() => undefined);
  }
  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
