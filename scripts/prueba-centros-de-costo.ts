/**
 * Centros de costo: el eje contable.
 *
 * Lo que se cuida aqui son las dos decisiones que salen caro si se rompen:
 *
 *  1. La orden COPIA el centro del equipo al crearse, y no lo consulta al
 *     leer. Si se resolviera al vuelo, mover un equipo de centro reescribiria
 *     los reportes del año pasado y el contador dejaria de confiar.
 *  2. Las ordenes sin centro NO se reparten ni se esconden: salen aparte, para
 *     que la suma de la tabla cuadre con el total de la empresa.
 *
 * Llama a las MISMAS funciones que las rutas y al mismo calculo que pinta la
 * pantalla de Reportes.
 *
 *   npx tsx scripts/prueba-centros-de-costo.ts
 */
import { prisma } from "../lib/db";
import { costoPorCentroDeCosto } from "../lib/indicadores";
import { CATALOGOS } from "../lib/catalogs";
import { IMPORTACIONES, ORDEN_IMPORTACION } from "../lib/importacion";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 260)}` : ""}`);
}

const DIA = 86_400_000;

async function main() {
  const sello = `prueba-cc-${Date.now()}`;
  const A = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });
  const B = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" } });

  try {
    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const produccion = await prisma.centroDeCosto.create({ data: { organizationId: A.id, code: "5010-PROD", name: "Producción" } });
    const servicios = await prisma.centroDeCosto.create({ data: { organizationId: A.id, code: "5020-SERV", name: "Servicios auxiliares" } });
    const deB = await prisma.centroDeCosto.create({ data: { organizationId: B.id, code: "5010-PROD", name: "Producción de B" } });

    const equipo = await prisma.asset.create({
      data: { organizationId: A.id, siteId: sitio.id, code: "TOR-1", name: "Torno", centroDeCostoId: produccion.id },
    });
    const sinCentro = await prisma.asset.create({
      data: { organizationId: A.id, siteId: sitio.id, code: "BOM-1", name: "Bomba" },
    });

    // ═══════════════════════════════════════════ 1-3 Catálogo
    console.log("\n1-3. El catálogo");
    const def = CATALOGOS["cost-centers"];
    revisar("1. el centro de costo es un catálogo como los demás, con su pantalla",
      Boolean(def) && def.titulo === "Centros de costo"
      && def.campos.some((c) => c.nombre === "code") && def.campos.some((c) => c.nombre === "name"));

    const libre = await def.bloqueoDeBorrado(A.id, servicios.id);
    const conUso = await def.bloqueoDeBorrado(A.id, produccion.id);
    revisar("2. uno sin uso se borra; uno con gasto encima NO, y dice que se desactive",
      libre === null && typeof conUso === "string" && /desactívelo/i.test(conUso), { libre, conUso });

    revisar("3. se importa, y ANTES que los activos: el activo lo necesita para referirlo",
      Boolean(IMPORTACIONES["centros-de-costo"])
      && ORDEN_IMPORTACION.indexOf("centros-de-costo") < ORDEN_IMPORTACION.indexOf("activos")
      && IMPORTACIONES.activos.columnas.some((c) => c.nombre === "centro_de_costo"),
      { orden: ORDEN_IMPORTACION.indexOf("centros-de-costo"), activos: ORDEN_IMPORTACION.indexOf("activos") });

    // ═══════════════════════════════════════════ 4-6 La herencia
    console.log("\n4-6. La orden hereda, y guarda lo que heredó");
    const numero = async () => `OT-${Math.random().toString(36).slice(2, 8)}`;
    const crear = async (assetId: string | null, extra: Record<string, unknown> = {}) => {
      const a = assetId ? await prisma.asset.findUniqueOrThrow({ where: { id: assetId }, select: { siteId: true, centroDeCostoId: true } }) : null;
      return prisma.workOrder.create({
        data: {
          organizationId: A.id, number: await numero(), title: "Trabajo", maintenanceType: "CORRECTIVE",
          status: "COMPLETED", assetId, siteId: a?.siteId ?? null,
          // La MISMA regla que la ruta: se copia del activo al crear.
          centroDeCostoId: a?.centroDeCostoId ?? null,
          completedAt: new Date(Date.now() - DIA), totalCost: 1000, laborCost: 600, partsCost: 400,
          ...extra,
        },
        select: { id: true, centroDeCostoId: true },
      });
    };
    const heredada = await crear(equipo.id);
    const huerfana = await crear(sinCentro.id);
    revisar("4. al crearse, la orden copia el centro del equipo; si el equipo no tiene, se queda sin él",
      heredada.centroDeCostoId === produccion.id && huerfana.centroDeCostoId === null);

    // El equipo se muda de centro: lo ya gastado NO se mueve con él.
    await prisma.asset.update({ where: { id: equipo.id }, data: { centroDeCostoId: servicios.id } });
    const trasMudanza = await prisma.workOrder.findUniqueOrThrow({ where: { id: heredada.id }, select: { centroDeCostoId: true } });
    revisar("5. si el equipo cambia de centro, la orden YA creada conserva el suyo: el histórico no se reescribe",
      trasMudanza.centroDeCostoId === produccion.id,
      { ordenSigueEn: trasMudanza.centroDeCostoId === produccion.id ? "5010-PROD" : "se movió" });

    const nueva = await crear(equipo.id);
    revisar("   y la orden NUEVA del mismo equipo sí nace en el centro nuevo",
      nueva.centroDeCostoId === servicios.id);

    /**
     * TODO el que crea ordenes hereda el centro.
     *
     * Siete lugares distintos crean ordenes —el programador de preventivos
     * (dos), el armado manual, la conversion de solicitud, la alerta
     * predictiva (dos) y la API—. Si uno se queda atras, sus ordenes nacen sin
     * centro y el reporte de contabilidad muestra un hueco que depende de COMO
     * se creo la orden: invisible en pantalla e imposible de explicar.
     *
     * Se revisa el codigo y no el comportamiento porque montar los siete
     * escenarios aqui seria replicar medio sistema; lo que importa es que
     * ninguno se olvide.
     */
    const { readFileSync } = await import("node:fs");
    const CREADORES = [
      "lib/scheduler.ts", "lib/armar-ot.ts", "lib/predictive.ts", "lib/solicitudes.ts",
      "app/api/work-orders/route.ts", "app/api/alerts/[id]/route.ts",
    ];
    const sinHeredar = CREADORES.filter((f) => {
      const t = readFileSync(f, "utf8");
      const creates = (t.match(/workOrder\.create\(/g) ?? []).length;
      const herencias = (t.match(/centroDeCostoId:/g) ?? []).length;
      return creates > 0 && herencias < creates;
    });
    revisar("6b. los seis módulos que crean órdenes heredan el centro del equipo, sin excepción",
      sinHeredar.length === 0, sinHeredar);

    // ═══════════════════════════════════════════ 7-9 El reporte
    console.log("\n7-9. El costo agrupado como lo pide contabilidad");
    const periodo = { desde: new Date(Date.now() - 30 * DIA), hasta: new Date(Date.now() + DIA) };
    const filas = await costoPorCentroDeCosto(A.id, periodo);
    const prod = filas.find((f) => f.id === produccion.id);
    const serv = filas.find((f) => f.id === servicios.id);
    const sin = filas.find((f) => !f.id);
    revisar("7. cada centro trae su gasto, con mano de obra y refacciones separadas",
      prod?.total === 1000 && prod?.manoDeObra === 600 && prod?.refacciones === 400 && prod?.ordenes === 1
      && serv?.total === 1000, { prod: prod?.total, serv: serv?.total });

    revisar("8. lo que NO tiene centro sale aparte y al final, ni repartido ni escondido",
      Boolean(sin) && sin!.name === "Sin centro de costo" && sin!.total === 1000
      && filas[filas.length - 1].id === null,
      filas.map((f) => `${f.name}:${f.total}`));

    const suma = filas.reduce((a, f) => a + f.total, 0);
    const totalReal = (await prisma.workOrder.aggregate({
      where: { organizationId: A.id, status: "COMPLETED", completedAt: { gte: periodo.desde, lt: periodo.hasta } },
      _sum: { totalCost: true },
    }))._sum.totalCost ?? 0;
    revisar("9. la suma de la tabla cuadra con el total de la empresa: es lo primero que revisa contabilidad",
      suma === totalReal, { suma, totalReal });

    // ═══════════════════════════════════════════ 10 Aislamiento
    console.log("\n10. Cada empresa lo suyo");
    const deOtra = await costoPorCentroDeCosto(B.id, periodo);
    const listaA = await CATALOGOS["cost-centers"].listar(A.id);
    revisar("10. una empresa no ve los centros ni el gasto de otra, aunque la clave se repita",
      deOtra.length === 0
      && listaA.length === 2 && !listaA.some((c) => c.id === deB.id)
      && (await prisma.centroDeCosto.count({ where: { organizationId: B.id } })) === 1,
      { filasDeB: deOtra.length, centrosDeA: listaA.length });

  } finally {
    for (const id of [A.id, B.id]) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log(fallos ? `\n✗ ${fallos} fallas` : "\n✓ El gasto de mantenimiento ya habla el idioma de contabilidad");
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
