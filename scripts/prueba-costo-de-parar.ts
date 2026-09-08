/**
 * Cuanto costo que la planta se detuviera.
 *
 * Lo que se prueba es lo que hace HONESTO al numero, porque un total inflado
 * que alguien tumba en una junta desacredita el tablero entero —incluidas las
 * partes que si estaban bien—:
 *
 *   - solo se cobra el paro de equipos que de verdad detienen la linea
 *   - el que nadie ha definido NO se cobra, pero se cuenta como pendiente
 *   - el paro planeado se reporta y no se suma a la perdida
 *   - con datos incompletos el total se presenta como piso, no como dato
 *
 *   npx tsx scripts/prueba-costo-de-parar.ts
 */
import { prisma } from "../lib/db";
import { costoDeParar, comoDecirlo, ventanas, costoComparado, serieMensual, PERIODOS } from "../lib/costo-de-parar";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  const sello = `prueba-costo-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE" },
  });
  const sitio = await prisma.site.create({
    data: { organization: { connect: { id: org.id } }, code: "PL", name: "Planta" },
  });
  // La nave tiene tarifa; el cuarto de máquinas no la tiene capturada.
  const nave = await prisma.location.create({
    data: { organizationId: org.id, siteId: sitio.id, code: "NAVE", name: "Nave", margenPorHora: 5000 },
  });
  const cuarto = await prisma.location.create({
    data: { organizationId: org.id, siteId: sitio.id, code: "CM", name: "Cuarto de máquinas", margenPorHora: 0 },
  });

  const crear = (code: string, name: string, locationId: string, detieneLinea: boolean | null) =>
    prisma.asset.create({
      data: {
        organization: { connect: { id: org.id } }, site: { connect: { id: sitio.id } },
        location: { connect: { id: locationId } },
        code, name, status: "OPERATIONAL", detieneLinea,
      },
    });

  const torno = await crear("TOR-101", "Torno CNC", nave.id, true);
  const extractor = await crear("EXT-801", "Extracción de humos", nave.id, false);
  const sinDefinir = await crear("BOM-601", "Bomba de refrigerante", nave.id, null);
  const compresor = await crear("COM-701", "Compresor", cuarto.id, true);

  const paro = (assetId: string, horas: number, planned = false) =>
    prisma.downtimeEvent.create({
      data: { assetId, startedAt: new Date(), minutes: Math.round(horas * 60), planned },
    });

  try {
    // 10 h del torno (detiene) · 6 h del extractor (no detiene)
    // 4 h de una bomba que nadie definió · 3 h planeadas del torno
    // 8 h del compresor, en un área sin tarifa
    await paro(torno.id, 10);
    await paro(extractor.id, 6);
    await paro(sinDefinir.id, 4);
    await paro(torno.id, 3, true);
    await paro(compresor.id, 8);

    const r = await costoDeParar(org.id);

    console.log("\nSolo se cobra lo que de verdad detiene la línea");
    const naveR = r.areas.find((a) => a.area === "Nave")!;
    revisar("cuenta las 10 h del torno", naveR.horasQueDetienen === 10, `${naveR.horasQueDetienen} h`);
    // Cargarle la tarifa de la nave al extractor de humos seria una mentira
    // con apariencia de precision, y el dueno la cacha a la primera.
    revisar("NO cobra las 6 h del extractor ni las 4 sin definir",
      naveR.horasQueNoDetienen === 10, `${naveR.horasQueNoDetienen} h a un lado`);
    revisar("la pérdida es 10 h × $5,000", naveR.perdida === 50000, `$${naveR.perdida}`);

    console.log("\nEl paro planeado se reporta pero no se cobra");
    // Contarlo como perdida haria ver caro justo lo que se quiere fomentar.
    revisar("aparta las 3 h planeadas", naveR.horasPlaneadas === 3, `${naveR.horasPlaneadas} h`);
    revisar("y no las suma a la pérdida", naveR.perdida === 50000);

    console.log("\nUn área sin tarifa no inventa un costo");
    const cuartoR = r.areas.find((a) => a.area === "Cuarto de máquinas")!;
    revisar("cuenta las horas", cuartoR.horasQueDetienen === 8);
    revisar("pero no las convierte en pesos", cuartoR.perdida === 0);

    console.log("\nEl total viene con su propia confianza");
    revisar("suma solo lo que sí sabe", r.perdida === 50000, `$${r.perdida}`);
    revisar("sabe que le falta información", !r.cobertura.completa);
    revisar("cuenta cuántos equipos faltan por definir",
      r.cobertura.equiposConParo - r.cobertura.equiposDefinidos === 1,
      `${r.cobertura.equiposDefinidos} de ${r.cobertura.equiposConParo} definidos`);
    revisar("y cuántas áreas no tienen tarifa",
      r.cobertura.areasConParo - r.cobertura.areasConTarifa === 1);

    const dicho = comoDecirlo(r);
    // Decir "$50,000" a secas cuando falta la mitad por capturar es lo que
    // hace que despues nadie le crea al tablero.
    revisar("se presenta como piso, no como dato", dicho.prefijo === "al menos ");
    revisar("y dice exactamente qué falta",
      (dicho.falta ?? "").includes("1 equipo") && (dicho.falta ?? "").includes("1 área"), dicho.falta ?? "");

    console.log("\nAl completar la captura, el total deja de ser un piso");
    await prisma.asset.update({ where: { id: sinDefinir.id }, data: { detieneLinea: false } });
    await prisma.location.update({ where: { id: cuarto.id }, data: { margenPorHora: 2000 } });
    const r2 = await costoDeParar(org.id);
    revisar("ya no falta nada", r2.cobertura.completa);
    revisar("se dice sin reservas", comoDecirlo(r2).prefijo === "");
    // 10 h × 5,000 en la nave + 8 h × 2,000 en el cuarto
    revisar("y el total incorpora el área que faltaba", r2.perdida === 66000, `$${r2.perdida}`);

    console.log("\nLa bomba definida como que NO detiene sigue sin costar");
    const nave2 = r2.areas.find((a) => a.area === "Nave")!;
    revisar("la nave no subió al definirla en «no»", nave2.perdida === 50000, `$${nave2.perdida}`);

    console.log("\nCada equipo trae su parte");
    const tornoR = nave2.equipos.find((e) => e.code === "TOR-101")!;
    revisar("el torno carga su pérdida", tornoR.perdida === 50000, `$${tornoR.perdida}`);
    const extR = nave2.equipos.find((e) => e.code === "EXT-801")!;
    revisar("el extractor aparece con horas pero sin pérdida",
      extR.horas === 6 && extR.perdida === 0, `${extR.horas} h · $${extR.perdida}`);

    console.log("\nLas ventanas son móviles, no trimestres de calendario");
    // "Este trimestre" a cinco dias de empezado compararia cinco dias contra
    // noventa, y el tablero mostraria un desplome que no ocurrio.
    const ahora = new Date("2026-09-08T12:00:00Z");
    const v = ventanas("TRIMESTRE", ahora);
    const largoActual = v.actual.hasta.getTime() - v.actual.desde.getTime();
    const largoAnterior = v.anterior.hasta.getTime() - v.anterior.desde.getTime();
    revisar("ambas ventanas miden lo mismo", largoActual === largoAnterior,
      `${Math.round(largoActual / 86400000)} días cada una`);
    revisar("la anterior termina donde empieza la actual",
      v.anterior.hasta.getTime() === v.actual.desde.getTime());
    revisar("y son los días del periodo", v.dias === PERIODOS.TRIMESTRE.dias);

    console.log("\nLa comparación contra el periodo anterior");
    const comp = await costoComparado(org.id, "ANO");
    revisar("trae el resultado actual", comp.perdida === 66000, `$${comp.perdida}`);
    // De cero a algo no es "infinito por ciento": es que empezo a medirse.
    revisar("sin periodo anterior no inventa un porcentaje", comp.cambio === null,
      String(comp.cambio));

    console.log("\nLa serie mensual no se salta los meses buenos");
    // Saltarselos deformaria la franja: tres meses sin paro se verian como si
    // fueran consecutivos y la tendencia mentiria.
    const serie = await serieMensual(org.id, 12);
    revisar("devuelve los doce meses", serie.length === 12, `${serie.length}`);
    revisar("incluye meses en cero", serie.some((m) => m.horas === 0));
    revisar("van en orden", serie[0].clave < serie[11].clave, `${serie[0].clave} → ${serie[11].clave}`);
    revisar("el mes con paro trae sus horas", serie.some((m) => m.horas > 0));

    console.log("\nCada organización ve solo lo suyo");
    const otra = await prisma.organization.create({
      data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" },
    });
    const rAjeno = await costoDeParar(otra.id);
    revisar("el vecino no ve mis paros", rAjeno.areas.length === 0 && rAjeno.perdida === 0);
    await prisma.organization.delete({ where: { id: otra.id } });
  } finally {
    await prisma.downtimeEvent.deleteMany({ where: { asset: { organizationId: org.id } } });
    await prisma.organization.delete({ where: { id: org.id } });
  }

  console.log(fallos === 0 ? "\nTodo correcto.\n" : `\n${fallos} revision(es) fallaron.\n`);
  await prisma.$disconnect();
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
