/**
 * Presupuesto contra gasto real, por centro de costo y por mes.
 *
 * Llama a las MISMAS funciones que la pantalla. Lo que mas vigila:
 *   · que «sin presupuestar» y «presupuesto de cero» NO se confundan,
 *   · que el gasto se cuente igual que en el costo por centro de costo,
 *   · que cada empresa vea solo lo suyo.
 *
 *   npx tsx scripts/prueba-presupuestos.ts
 */
import { prisma } from "../lib/db";
import {
  ErrorDePresupuesto, borrarPresupuesto, comparativoDePresupuesto,
  guardarPresupuesto, limitesDelMes,
} from "../lib/presupuestos";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 220)}` : ""}`);
}
async function intentar(fn: () => Promise<unknown>) {
  try { await fn(); return "pasó"; } catch (e) { return e instanceof ErrorDePresupuesto ? "rechazado" : `error: ${(e as Error).message}`; }
}

const ZONA = "America/Monterrey";
const ANIO = 2026;

async function main() {
  const sello = `prueba-pre-${Date.now()}`;
  const A = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE", timezone: ZONA } });
  const B = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" } });

  try {
    const quien = await prisma.user.create({
      data: { organizationId: A.id, email: `u${Date.now()}@x.com`, name: "Gerencia", passwordHash: "x", role: "ADMIN" },
    });
    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const crearCentro = (org: string, code: string, name: string) =>
      prisma.centroDeCosto.create({ data: { organizationId: org, code, name } });
    const produccion = await crearCentro(A.id, "PROD", "Producción");
    const servicios = await crearCentro(A.id, "SERV", "Servicios auxiliares");
    const almacen = await crearCentro(A.id, "ALM", "Almacén");
    const ajeno = await crearCentro(B.id, "PROD", "Producción de la otra");

    const equipo = await prisma.asset.create({
      data: { organizationId: A.id, siteId: sitio.id, code: "BOM-1", name: "Bomba", centroDeCostoId: produccion.id },
    });

    /** Una orden terminada en ese mes, con su costo. */
    let n = 0;
    const gastar = (centroId: string, mes: number, costo: number, estado = "CLOSED") =>
      prisma.workOrder.create({
        data: {
          organizationId: A.id, number: `OT-${String(++n).padStart(4, "0")}`, title: `Trabajo ${n}`,
          assetId: equipo.id, centroDeCostoId: centroId, status: estado,
          // A media mañana del dia 15: lejos de los bordes del mes.
          completedAt: new Date(limitesDelMes(ANIO, mes, ZONA).desde.getTime() + 14 * 86_400_000 + 10 * 3_600_000),
          totalCost: costo, laborCost: costo * 0.5, partsCost: costo * 0.3, serviceCost: costo * 0.2, otherCost: 0,
        },
      });

    console.log("\n1. Lo que se rechaza al capturar\n");
    const base = { organizationId: A.id, userId: quien.id, centroDeCostoId: produccion.id, anio: ANIO };
    revisar("un mes fuera de 1..12 se rechaza", await intentar(() => guardarPresupuesto({ ...base, mes: 13, monto: 100 })) === "rechazado");
    revisar("un monto negativo se rechaza", await intentar(() => guardarPresupuesto({ ...base, mes: 1, monto: -1 })) === "rechazado");
    revisar("el centro de OTRA empresa se rechaza",
      await intentar(() => guardarPresupuesto({ ...base, centroDeCostoId: ajeno.id, mes: 1, monto: 100 })) === "rechazado");

    console.log("\n2. Cero y «sin presupuestar» NO son lo mismo\n");
    await guardarPresupuesto({ ...base, mes: 1, monto: 10_000 });
    await guardarPresupuesto({ organizationId: A.id, userId: quien.id, centroDeCostoId: servicios.id, anio: ANIO, mes: 1, monto: 0 });
    // Almacén se queda sin capturar a propósito.
    const r1 = await comparativoDePresupuesto(A.id, { anio: ANIO, zona: ZONA, desdeMes: 1, hastaMes: 1 });
    const de = (code: string) => r1.renglones.find((x) => x.code === code)!;
    revisar("con presupuesto de cero, el presupuesto es 0 y no null", de("SERV").presupuesto === 0, de("SERV").presupuesto);
    revisar("sin capturar, el presupuesto es null", de("ALM").presupuesto === null, de("ALM").presupuesto);
    revisar("sin presupuesto no hay diferencia que mostrar", de("ALM").diferencia === null, de("ALM").diferencia);
    revisar("con presupuesto de cero tampoco hay porcentaje: no se divide entre cero",
      de("SERV").ejercido === null, de("SERV").ejercido);

    console.log("\n3. El gasto se cuenta como en el costo por centro\n");
    await gastar(produccion.id, 1, 4_000);
    await gastar(produccion.id, 1, 2_000);
    await gastar(produccion.id, 2, 9_000);
    // Una orden ABIERTA no se gastó todavía: no puede contar.
    await gastar(produccion.id, 1, 50_000, "IN_PROGRESS");
    const r2 = await comparativoDePresupuesto(A.id, { anio: ANIO, zona: ZONA, desdeMes: 1, hastaMes: 1 });
    const prod = r2.renglones.find((x) => x.code === "PROD")!;
    revisar("solo cuentan las terminadas del mes", prod.gastado === 6_000, { gastado: prod.gastado, ordenes: prod.ordenes });
    revisar("y el desglose suma lo mismo",
      Math.abs(prod.manoDeObra + prod.refacciones + prod.servicios + prod.otros - prod.gastado) < 0.01,
      { mo: prod.manoDeObra, ref: prod.refacciones, serv: prod.servicios });
    revisar("la diferencia es lo que sobra", prod.diferencia === 4_000, prod.diferencia);
    revisar("y el ejercido, el porcentaje", Math.round(prod.ejercido!) === 60, prod.ejercido);

    console.log("\n4. Cada mes cuenta lo suyo\n");
    const soloFebrero = await comparativoDePresupuesto(A.id, { anio: ANIO, zona: ZONA, desdeMes: 2, hastaMes: 2 });
    revisar("febrero trae lo de febrero, no lo de enero",
      soloFebrero.renglones.find((x) => x.code === "PROD")!.gastado === 9_000,
      soloFebrero.renglones.find((x) => x.code === "PROD")!.gastado);
    revisar("y febrero no tiene presupuesto capturado",
      soloFebrero.renglones.find((x) => x.code === "PROD")!.presupuesto === null);
    const anio = await comparativoDePresupuesto(A.id, { anio: ANIO, zona: ZONA });
    revisar("el año suma los meses del rango", anio.renglones.find((x) => x.code === "PROD")!.gastado === 15_000,
      anio.renglones.find((x) => x.code === "PROD")!.gastado);
    revisar("y trae la curva mes por mes", anio.renglones.find((x) => x.code === "PROD")!.porMes.length === 12);

    console.log("\n5. Lo que hay que ver aunque nadie lo presupuestó\n");
    await gastar(almacen.id, 1, 3_000);
    const r3 = await comparativoDePresupuesto(A.id, { anio: ANIO, zona: ZONA, desdeMes: 1, hastaMes: 1 });
    revisar("un centro con gasto y sin presupuesto SALE en la lista",
      Boolean(r3.renglones.find((x) => x.code === "ALM" && x.gastado === 3_000)));
    revisar("y se nombra aparte, para poder cerrarlo", r3.sinPresupuestar.includes("ALM"), r3.sinPresupuestar);

    console.log("\n6. Capturar dos veces deja UN presupuesto, no dos\n");
    await guardarPresupuesto({ ...base, mes: 1, monto: 12_000 });
    const cuantos = await prisma.presupuesto.count({ where: { centroDeCostoId: produccion.id, anio: ANIO, mes: 1 } });
    revisar("el mismo mes se actualiza, no se duplica", cuantos === 1, cuantos);
    const r4 = await comparativoDePresupuesto(A.id, { anio: ANIO, zona: ZONA, desdeMes: 1, hastaMes: 1 });
    revisar("y manda el valor nuevo", r4.renglones.find((x) => x.code === "PROD")!.presupuesto === 12_000);

    console.log("\n7. Borrar no es poner en cero\n");
    await borrarPresupuesto({ organizationId: A.id, centroDeCostoId: servicios.id, anio: ANIO, mes: 1 });
    const r5 = await comparativoDePresupuesto(A.id, { anio: ANIO, zona: ZONA, desdeMes: 1, hastaMes: 1 });
    revisar("borrado vuelve a «sin presupuestar»", r5.renglones.find((x) => x.code === "SERV")!.presupuesto === null);
    // Guardar al salir de la casilla puede pedir el borrado dos veces: quitar
    // lo que ya no esta no puede tronar.
    const otraVez = await borrarPresupuesto({ organizationId: A.id, centroDeCostoId: servicios.id, anio: ANIO, mes: 1 });
    revisar("quitar dos veces lo mismo no truena, solo no quita nada", otraVez.quitados === 0, otraVez);
    // Y desde OTRA empresa no alcanza el presupuesto de esta.
    await guardarPresupuesto({ organizationId: A.id, userId: quien.id, centroDeCostoId: servicios.id, anio: ANIO, mes: 1, monto: 500 });
    const ajena = await borrarPresupuesto({ organizationId: B.id, centroDeCostoId: servicios.id, anio: ANIO, mes: 1 });
    revisar("otra empresa no puede quitar el presupuesto de esta", ajena.quitados === 0, ajena);
    const r6 = await comparativoDePresupuesto(A.id, { anio: ANIO, zona: ZONA, desdeMes: 1, hastaMes: 1 });
    revisar("y el presupuesto sigue ahí", r6.renglones.find((x) => x.code === "SERV")!.presupuesto === 500);

    console.log("\n8. Cada empresa ve lo suyo\n");
    const otra = await comparativoDePresupuesto(B.id, { anio: ANIO, zona: ZONA });
    revisar("la otra empresa no ve centros ni gasto de esta",
      otra.renglones.every((x) => x.gastado === 0 && x.presupuesto === null) && otra.totales.gastado === 0,
      { centros: otra.renglones.length, gastado: otra.totales.gastado });
  } finally {
    for (const org of [A.id, B.id]) {
      await prisma.$transaction([
        prisma.presupuesto.deleteMany({ where: { organizationId: org } }),
        prisma.workOrder.deleteMany({ where: { organizationId: org } }),
        prisma.asset.deleteMany({ where: { organizationId: org } }),
        prisma.centroDeCosto.deleteMany({ where: { organizationId: org } }),
        prisma.site.deleteMany({ where: { organizationId: org } }),
        prisma.user.deleteMany({ where: { organizationId: org } }),
        prisma.organization.delete({ where: { id: org } }),
      ]);
    }
  }

  console.log(fallos ? `\n${fallos} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallos ? 1 : 0;
}

main().catch((e) => { console.error("\nERROR:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
