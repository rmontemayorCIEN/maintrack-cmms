/**
 * Lo que va a pedir el preventivo: el cruce entre el calendario y el consumo.
 *
 * Da de alta el plan con `altaDePlan` —la MISMA funcion que usa la pantalla—
 * en vez de sembrar los relojes a mano. Una prueba que arma el calendario por
 * su cuenta probaria su propia aritmetica, no la del sistema; ya paso en este
 * proyecto con el alta de planes y costo caro.
 *
 *   npx tsx scripts/prueba-consumo-proyectado.ts
 */
import { prisma } from "../lib/db";
import { altaDePlan } from "../lib/alta-de-plan";
import { consumoProyectado, faltantePara, PERIODOS_CONSUMO } from "../lib/consumo-proyectado";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 280)}` : ""}`);
}

async function main() {
  const sello = `prueba-cp-${Date.now()}`;
  const A = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });
  const B = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" } });

  try {
    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const equipo = await prisma.asset.create({ data: { organizationId: A.id, siteId: sitio.id, code: "CMP-1", name: "Compresor" } });
    const otro = await prisma.asset.create({ data: { organizationId: A.id, siteId: sitio.id, code: "CMP-2", name: "Compresor 2" } });

    // Dos refacciones: una cara y poca, otra barata y mucha. El orden del
    // reporte es por dinero, no por cantidad, y eso hay que comprobarlo.
    const filtro = await prisma.part.create({
      data: { organizationId: A.id, code: "FIL-AIR", name: "Filtro de aire", unit: "pza", unitCost: 450, quantityOnHand: 2, minQuantity: 1 },
    });
    const orings = await prisma.part.create({
      data: { organizationId: A.id, code: "ORG-20", name: "O-ring 20mm", unit: "pza", unitCost: 5, quantityOnHand: 100, minQuantity: 10 },
    });

    // ── El plan, por la misma puerta que la pantalla.
    const alta = await altaDePlan(A.id, null, {
      name: "Mantenimiento del compresor",
      maintenanceType: "PREVENTIVE", triggerType: "CALENDAR", intervalDays: 30,
      leadTimeDays: 0, toleranceDays: 3, priority: "MEDIUM", estimatedHours: 2,
      requiresShutdown: false, active: true,
      assetIds: [equipo.id, otro.id],
      tasks: [
        // Cada mes, con filtro: en 90 días deben salir 3 por equipo.
        { title: "Cambio de filtro de aire", taskType: "REPLACE", required: true, cadaCuanto: 1, unidadFrecuencia: "MESES",
          labor: [], parts: [{ partId: filtro.id, quantity: 1 }], services: [] },
        // Cada tres meses: una sola vez en el horizonte.
        { title: "Cambio de empaques", taskType: "REPLACE", required: true, cadaCuanto: 3, unidadFrecuencia: "MESES",
          labor: [], parts: [{ partId: orings.id, quantity: 8 }], services: [] },
        // SIN refacciones: es la que baja la cobertura, y tiene que contarse.
        { title: "Revisión visual de fugas", taskType: "CHECK", required: true, cadaCuanto: 1, unidadFrecuencia: "MESES",
          labor: [], parts: [], services: [] },
      ],
    } as never);
    if ("error" in alta) throw new Error(`No se pudo dar de alta el plan: ${alta.error}`);

    // ═══════════════════════════════════════════ 1-3 El cruce
    console.log("\n1-3. El calendario por el consumo");
    const r = await consumoProyectado(A.id, { dias: 90, periodo: "mes" });
    const fil = r.renglones.find((x) => x.partId === filtro.id);
    const org = r.renglones.find((x) => x.partId === orings.id);
    revisar("1. sale lo que las actividades consumen, con su equipo detrás",
      Boolean(fil) && Boolean(org) && fil!.equipos.length === 2 && fil!.equipos.includes("CMP-1"),
      { filtro: fil?.total, orings: org?.total, equipos: fil?.equipos });

    revisar("2. la frecuencia manda: mensual entra tres veces en el trimestre, trimestral una",
      fil!.total === 6 && org!.total === 16,
      { filtroDosEquiposTresVeces: fil!.total, oringsDosEquiposUnaVez: org!.total });

    revisar("3. el orden es por lo que pesa en DINERO, no por cantidad",
      r.renglones[0].partId === filtro.id && fil!.costoTotal === 2700 && org!.costoTotal === 80,
      r.renglones.map((x) => `${x.code}:${x.costoTotal}`));

    // ═══════════════════════════════════════════ 4-5 La cobertura
    console.log("\n4-5. La cobertura, que es parte de la respuesta");
    revisar("4. cuenta las actividades con consumo, y también los PLANES: es la señal que sirve",
      r.cobertura.actividades === 3 && r.cobertura.actividadesConRefacciones === 2
      && r.cobertura.planes === 1 && r.cobertura.planesConRefacciones === 1
      && r.cobertura.planesSinRefacciones.length === 0
      && r.cobertura.equipos === 2,
      r.cobertura);
    revisar("   un plan con actividades que no consumen NO se reporta como hueco: revisar no gasta material",
      r.cobertura.planesSinRefacciones.length === 0 && r.cobertura.actividades > r.cobertura.actividadesConRefacciones);

    const sinNada = await consumoProyectado(B.id, { dias: 90 });
    revisar("5. una empresa sin planes da cobertura en cero y tabla vacía, no un error",
      sinNada.cobertura.actividades === 0 && sinNada.cobertura.planes === 0
      && sinNada.renglones.length === 0 && sinNada.total === 0);

    // ═══════════════════════════════════════════ 6-7 Los periodos
    console.log("\n6-7. El mismo total, repartido distinto");
    const porSemana = await consumoProyectado(A.id, { dias: 90, periodo: "semana" });
    const porTrimestre = await consumoProyectado(A.id, { dias: 90, periodo: "trimestre" });
    revisar("6. cambiar el periodo cambia las columnas pero NO el total",
      porSemana.total === r.total && porTrimestre.total === r.total
      && porSemana.columnas.length > r.columnas.length && porTrimestre.columnas.length === 1,
      { semana: porSemana.columnas.length, mes: r.columnas.length, trimestre: porTrimestre.columnas.length, total: r.total });

    const sumaColumnas = fil!.porPeriodo.reduce((a, x) => a + x, 0);
    revisar("7. lo repartido por columna suma el total de la refacción",
      sumaColumnas === fil!.total, { columnas: fil!.porPeriodo, total: fil!.total });

    // ═══════════════════════════════════════════ 8 Lo que falta comprar
    console.log("\n8. Lo que NO alcanza");
    const faltaFiltro = faltantePara(fil!, r.columnas.length - 1);
    const faltaOring = faltantePara(org!, r.columnas.length - 1);
    revisar("8. «falta» es consumo más mínimo menos existencia, y nunca negativo",
      // Filtro: 6 que va a pedir + 1 de mínimo − 2 que hay = 5.
      faltaFiltro === 5
      // O-rings: 16 + 10 − 100 da negativo, así que no falta nada.
      && faltaOring === 0,
      { faltaFiltro, faltaOring, hayOrings: org!.existencia });

    revisar("   y los tres periodos están declarados con su tamaño",
      Object.keys(PERIODOS_CONSUMO).length === 3 && PERIODOS_CONSUMO.trimestre.dias === 90);

  } finally {
    for (const id of [A.id, B.id]) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log(fallos ? `\n✗ ${fallos} fallas` : "\n✓ El plan ya dice qué va a pedir y cuándo");
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
