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
import { TOPE_PUNTOS, agruparEnCeldas, estadoMasGrave } from "../lib/mapa";
import { consultarMapa } from "../lib/mapa-consulta";

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

    console.log("\n4. Muchos activos: pasa a grupos y la cuenta cuadra");
    const N = TOPE_PUNTOS + 400;
    const lote = Array.from({ length: N }, (_, i) => base(a.id, sitioA.id, `M-${i}`, {
      latitud: 25.63 + (i % 90) * 0.001, longitud: -100.31 + Math.floor(i / 90) * 0.0008, status: i % 50 === 0 ? "DOWN" : "OPERATIONAL",
    }));
    await prisma.asset.createMany({ data: lote });
    const rMuchos = await consultarMapa(a.id, GUADALUPE);
    const suma = rMuchos.grupos.reduce((s, x) => s + x.cantidad, 0);
    revisar(`con más de ${TOPE_PUNTOS} cambia a grupos y no manda puntos sueltos`, rMuchos.modo === "grupos" && rMuchos.puntos.length === 0);
    revisar("la suma de los grupos es el total (nada se pierde ni se duplica)", suma === rMuchos.total && rMuchos.total === N + 3, { suma, total: rMuchos.total });
    const gruesa = await consultarMapa(a.id, GUADALUPE, {}, { columnas: 3, filas: 3 });
    revisar("una rejilla más gruesa da menos grupos y la cuenta sigue cuadrando",
      gruesa.grupos.length <= 9 && gruesa.grupos.length < rMuchos.grupos.length && gruesa.grupos.reduce((s, x) => s + x.cantidad, 0) === gruesa.total,
      { gruesa: gruesa.grupos.length, normal: rMuchos.grupos.length });
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
