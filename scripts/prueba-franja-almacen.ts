/**
 * La franja del almacen (lib/almacen-vista.ts) y el criterio de «bajo minimo».
 *
 * Lo que se cuida aqui son dos cosas que no se anuncian:
 *
 * 1. Que la franja y el analisis del almacen den numeros distintos. Habia
 *    CUATRO formas de decir «bajo minimo» en el sistema —el analisis con
 *    `min > 0 && qty < min`, la pantalla con `qty <= min`, la consulta con
 *    `lte`, y la que iba a escribir yo—. Cada una se ve razonable sola.
 *
 * 2. Que una refaccion sin minimo capturado se pinte de verde. Nadie dijo
 *    cuanto deberia haber: no esta bien, es que no se sabe, y pintarla como
 *    sana esconde justo lo que falta capturar.
 *
 * Llama a las mismas funciones que la pantalla, no reproduce sus pasos.
 *
 *   npx tsx scripts/prueba-franja-almacen.ts
 */
import { prisma } from "../lib/db";
import { barraDeAlmacen, franjaDeAlmacen, MAX_FILAS, SEGMENTOS } from "../lib/almacen-vista";
import { estadoDeRefaccion, estaBajoMinimo, sinControl } from "../lib/almacen-estado";
import { analizarAlmacen } from "../lib/almacen-analisis";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

async function empresa(sello: string) {
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey", diasHabiles: "1,2,3,4,5" },
  });
  const alm = await prisma.warehouse.create({ data: { organizationId: org.id, code: "GEN", name: "General", esGeneral: true } });
  return { org, alm };
}

async function main() {
  const sello = `fal-${Date.now()}`;
  const creadas: string[] = [];

  try {
    const { org } = await empresa(sello);
    creadas.push(org.id);

    const parte = (code: string, category: string | null, qty: number, min: number, max: number, costo = 100) =>
      prisma.part.create({
        data: {
          organizationId: org.id, code, name: code, category, unit: "pza",
          quantityOnHand: qty, minQuantity: min, maxQuantity: max, unitCost: costo,
        },
      });

    // Una de cada estado, y a proposito repartidas en dos familias.
    await parte("ROD-1", "Rodamientos", 0, 5, 20);    // agotada
    await parte("ROD-2", "Rodamientos", 2, 5, 20);    // bajo minimo
    await parte("ROD-3", "Rodamientos", 10, 5, 20);   // sana
    await parte("FIL-1", "Filtros", 40, 5, 20);       // excedida
    await parte("FIL-2", "Filtros", 0, 0, 0);         // SIN minimo: no se sabe

    console.log("\nCada refacción en su estado\n");
    revisar("sin existencia y con mínimo es «agotada»", estadoDeRefaccion({ quantityOnHand: 0, minQuantity: 5, maxQuantity: 20 }) === "agotada");
    revisar("por debajo del mínimo es «bajo mínimo»", estadoDeRefaccion({ quantityOnHand: 2, minQuantity: 5, maxQuantity: 20 }) === "bajoMinimo");
    revisar("por encima del máximo es «excedida»", estadoDeRefaccion({ quantityOnHand: 40, minQuantity: 5, maxQuantity: 20 }) === "excedida");
    revisar("dentro de rango es «en nivel»", estadoDeRefaccion({ quantityOnHand: 10, minQuantity: 5, maxQuantity: 20 }) === "sana");
    revisar("SIN mínimo capturado NO se dice que está sana: se dice que no se sabe",
      estadoDeRefaccion({ quantityOnHand: 0, minQuantity: 0, maxQuantity: 0 }) === "sinControl");
    revisar("y sin máximo capturado nunca sale «excedida»",
      estadoDeRefaccion({ quantityOnHand: 9999, minQuantity: 5 }) === "sana");

    console.log("\nLa franja y el análisis cuentan lo mismo\n");
    const franja = await franjaDeAlmacen(org.id);
    revisar("la franja existe y agrupa por familia", franja?.agrupadoPor === "familia", { agrupadoPor: franja?.agrupadoPor });

    const enFranja = (franja?.filas ?? []).reduce((s, f) => s + f.agotadas + f.bajoMinimo, 0);
    const analisis = await analizarAlmacen(org.id);
    revisar("«bajo mínimo» de la franja (agotadas incluidas) es el mismo del análisis",
      enFranja === analisis.bajoMinimo.length, { franja: enFranja, analisis: analisis.bajoMinimo.length });

    revisar("la que no tiene mínimo no entra en «bajo mínimo» de ninguno de los dos",
      !analisis.bajoMinimo.some((b) => b.codigo === "FIL-2") && (franja?.filas ?? []).reduce((s, f) => s + f.sinControl, 0) === 1);

    const totalFilas = (franja?.filas ?? []).reduce((s, f) => s + f.refacciones, 0);
    revisar("no se pierde ni se duplica ninguna refacción", totalFilas === 5, { enFilas: totalFilas, total: franja?.refacciones });

    const rod = (franja?.filas ?? []).find((f) => f.nombre === "Rodamientos");
    revisar("los renglones se pueden sumar: cada estado por separado",
      rod?.agotadas === 1 && rod?.bajoMinimo === 1 && rod?.sanas === 1, rod);
    revisar("y el renglón dice en palabras lo que tiene, no solo en color",
      rod?.comoEstan === "1 agotada · 1 bajo mínimo", rod?.comoEstan);

    console.log("\nEl dinero\n");
    // ROD-3: 10 x 100 = 1000 ; ROD-1 y ROD-2: 0 y 2 x 100 = 200 → 1200
    revisar("el valor del renglón es lo que hay por lo que cuesta", rod?.valor === 1200, { valor: rod?.valor });
    revisar("el total es la suma de los renglones",
      franja?.valorTotal === (franja?.filas ?? []).reduce((s, f) => s + f.valor, 0), { total: franja?.valorTotal });

    console.log("\nLa barra\n");
    const barra = barraDeAlmacen({ refacciones: 3, agotadas: 1, bajoMinimo: 1, sinControl: 0, excedidas: 0, sanas: 1 });
    revisar("con pocas refacciones hay un cuadro por refacción", barra.length === 3, barra.join(","));

    // Lo que costo encontrar en la franja de planta: con muchas, lo malo se
    // redondeaba a cero y desaparecia justo lo unico que habia que mirar.
    const grande = barraDeAlmacen({ refacciones: 400, agotadas: 1, bajoMinimo: 0, sinControl: 0, excedidas: 0, sanas: 399 });
    revisar("con cuatrocientas refacciones y UNA agotada, la agotada no desaparece",
      grande.includes("agotada"), `${grande.filter((x) => x === "agotada").length} de ${grande.length} cuadros`);
    revisar("y la barra no se pasa de lo que cabe", grande.length <= SEGMENTOS, `${grande.length} ≤ ${SEGMENTOS}`);

    console.log("\nCuando no hay familias capturadas\n");
    const { org: b } = await empresa(`${sello}-b`);
    creadas.push(b.id);
    await prisma.part.create({
      data: { organizationId: b.id, code: "X-1", name: "X-1", unit: "pza", quantityOnHand: 1, minQuantity: 0, maxQuantity: 0, unitCost: 10 },
    });
    const sinFam = await franjaDeAlmacen(b.id);
    revisar("con un solo almacén y sin familias queda un renglón, y se dice",
      sinFam?.agrupadoPor === "todo" && sinFam?.filas.length === 1, { agrupadoPor: sinFam?.agrupadoPor, filas: sinFam?.filas.length });

    console.log("\nLo que NO debe pasar\n");
    const { org: c } = await empresa(`${sello}-c`);
    creadas.push(c.id);
    revisar("una cuenta sin refacciones no enseña una franja vacía", (await franjaDeAlmacen(c.id)) === null);
    revisar("la empresa de al lado no aparece en la franja",
      !(franja?.filas ?? []).some((f) => f.nombre === "X-1"));
    revisar("el tope de renglones existe, para que no crezca sin control", MAX_FILAS <= 12, `${MAX_FILAS}`);
    revisar("el criterio de «bajo mínimo» no cambia por el máximo",
      estaBajoMinimo({ quantityOnHand: 2, minQuantity: 5 }) && !estaBajoMinimo({ quantityOnHand: 2, minQuantity: 0 }));
    revisar("«sin control» es exactamente no tener mínimo",
      sinControl({ quantityOnHand: 9, minQuantity: 0 }) && !sinControl({ quantityOnHand: 9, minQuantity: 1 }));
  } finally {
    for (const id of creadas) {
      await prisma.stockMovement.deleteMany({ where: { organizationId: id } });
      await prisma.partStock.deleteMany({ where: { organizationId: id } });
      await prisma.part.deleteMany({ where: { organizationId: id } });
      await prisma.warehouse.deleteMany({ where: { organizationId: id } });
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
  }

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
