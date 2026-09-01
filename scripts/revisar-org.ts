/**
 * Inspeccion de solo lectura de una organizacion.
 *
 * Sirve para revisar como quedo un levantamiento sin abrir la aplicacion ni
 * suplantar al usuario. No escribe absolutamente nada.
 *
 *   npx tsx scripts/revisar-org.ts "Casa Montemayor"
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const buscado = process.argv[2] ?? "Casa Montemayor";

function pct(parte: number, total: number) {
  if (!total) return "  n/a";
  return `${Math.round((parte / total) * 100)}%`.padStart(5);
}

async function main() {
  const org = await prisma.organization.findFirst({
    where: { name: { contains: buscado } },
  });
  if (!org) throw new Error(`No existe organizacion que contenga "${buscado}"`);

  console.log(`\n${"=".repeat(64)}`);
  console.log(`  ${org.name}`);
  console.log(`  tipo: ${org.tipoInstalacion ?? "(sin definir)"}   plan: ${org.plan}`);
  console.log("=".repeat(64));

  const donde = { organizationId: org.id };

  const [sitios, ubicaciones, activos, planes, categorias, refacciones, ordenes] =
    await Promise.all([
      prisma.site.findMany({ where: donde, orderBy: { code: "asc" } }),
      prisma.location.count({ where: donde }),
      prisma.asset.findMany({
        where: donde,
        orderBy: { code: "asc" },
        include: { category: true, location: true, site: true },
      }),
      prisma.maintenancePlan.findMany({ where: donde, include: { tasks: true } }),
      prisma.assetCategory.count({ where: donde }),
      prisma.part.count({ where: donde }),
      prisma.workOrder.count({ where: donde }),
    ]);

  console.log(`\nSITIOS (${sitios.length})`);
  for (const s of sitios) {
    const conteo = activos.filter((a) => a.siteId === s.id).length;
    const geo = s.latitud != null && s.longitud != null ? "con coordenadas" : "sin coordenadas";
    console.log(`  ${s.code.padEnd(10)} ${s.name.padEnd(28)} ${String(conteo).padStart(3)} activos  ${geo}`);
  }

  const ubis = await prisma.location.findMany({
    where: donde, orderBy: { code: "asc" },
    include: { _count: { select: { assets: true } } },
  });
  if (ubis.length) {
    console.log(`\nUBICACIONES (${ubis.length})`);
    for (const u of ubis) {
      console.log(`  ${u.code.padEnd(10)} ${u.name.slice(0, 46).padEnd(47)} ${String(u._count.assets).padStart(3)} activos`);
    }
  }

  console.log(`\nRESUMEN`);
  console.log(`  ubicaciones ......... ${ubicaciones}`);
  console.log(`  categorias .......... ${categorias}`);
  console.log(`  activos ............. ${activos.length}`);
  console.log(`  planes .............. ${planes.length}`);
  console.log(`  refacciones ......... ${refacciones}`);
  console.log(`  ordenes ............. ${ordenes}`);

  // Calidad del levantamiento: que tan completo quedo cada activo.
  const n = activos.length;
  if (n) {
    console.log(`\nCALIDAD DE LA CAPTURA (${n} activos)`);
    const campos: [string, (a: (typeof activos)[number]) => boolean][] = [
      ["fabricante", (a) => !!a.manufacturer],
      ["modelo", (a) => !!a.model],
      ["numero de serie", (a) => !!a.serialNumber],
      ["categoria", (a) => !!a.categoryId],
      ["ubicacion", (a) => !!a.locationId],
      ["descripcion", (a) => !!a.description],
      ["foto", (a) => !!a.imageUrl],
      ["criticidad A o C", (a) => a.criticality !== "B"],
      ["costo de reemplazo", (a) => a.replacementCost > 0],
    ];
    for (const [etiqueta, tiene] of campos) {
      const c = activos.filter(tiene).length;
      console.log(`  ${etiqueta.padEnd(20)} ${String(c).padStart(3)}/${n}  ${pct(c, n)}`);
    }

    const porCrit = { A: 0, B: 0, C: 0 } as Record<string, number>;
    for (const a of activos) porCrit[a.criticality] = (porCrit[a.criticality] ?? 0) + 1;
    console.log(`  criticidad: A=${porCrit.A ?? 0}  B=${porCrit.B ?? 0}  C=${porCrit.C ?? 0}`);

    const sinPlan = activos.filter((a) => !planes.some((p) => p.assetId === a.id));
    console.log(`\n  activos SIN plan de mantenimiento: ${sinPlan.length}/${n}`);
    for (const a of sinPlan.slice(0, 12)) console.log(`     - ${a.code} ${a.name}`);
    if (sinPlan.length > 12) console.log(`     ... y ${sinPlan.length - 12} mas`);

    console.log(`\nINVENTARIO LEVANTADO`);
    for (const a of activos) {
      const placa = [a.manufacturer, a.model].filter(Boolean).join(" ") || "sin placa";
      const cat = a.category?.name ?? "sin categoria";
      const ub = a.location?.name ?? a.site?.name ?? "-";
      console.log(`  ${a.code.padEnd(12)} ${a.name.slice(0, 30).padEnd(31)} [${a.criticality}] ${cat.slice(0, 18).padEnd(19)} ${ub.slice(0, 18).padEnd(19)} ${placa.slice(0, 26)}`);
    }
  }

  if (planes.length) {
    console.log(`\nPLANES`);
    for (const p of planes) {
      const act = p.tasks.length;
      const cada = p.intervalDays ? `cada ${p.intervalDays} d` : p.triggerType;
      console.log(`  ${p.name.slice(0, 44).padEnd(45)} ${cada.padEnd(14)} ${act} actividades`);
    }
  }

  // Consumo de IA atribuido a esta organizacion.
  const consumo = await prisma.aiUsage.groupBy({
    by: ["funcion"],
    where: donde,
    _count: { _all: true },
    _sum: { costoUsd: true, operaciones: true },
  }).catch(() => null);

  if (consumo?.length) {
    console.log(`\nCONSUMO DE IA`);
    let total = 0;
    for (const c of consumo) {
      const usd = c._sum.costoUsd ?? 0;
      total += usd;
      console.log(`  ${c.funcion.padEnd(18)} ${String(c._count._all).padStart(3)} llamadas   $${usd.toFixed(4)} USD`);
    }
    console.log(`  ${"TOTAL".padEnd(18)}     ${" ".repeat(9)} $${total.toFixed(4)} USD`);
  }

  console.log("");
}

main()
  .catch((e) => { console.error("\nERROR:", e.message, "\n"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
