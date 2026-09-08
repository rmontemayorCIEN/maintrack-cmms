/**
 * Las reglas del croquis de la planta.
 *
 * Se prueba aqui porque estas reglas ya fallaron dos veces viendose bien: el
 * acomodo de arranque dejaba siete octavos del lienzo vacio —parecia una
 * pantalla rota— y soltar un area sobre otra la regresaba al mismo lugar sin
 * ningun cambio visible, como si arrastrar no sirviera. Ninguna de las dos
 * truena; las dos se ven correctas hasta que alguien las usa.
 *
 * Al final se prueba contra la base que lo guardado de verdad llegue al
 * dibujo: si la columna no viaja de Location a costoDeParar, el croquis se
 * reacomoda solo cada vez que se abre la pantalla y nadie entiende por que.
 *
 *   npx tsx scripts/prueba-croquis.ts
 */
import { prisma } from "../lib/db";
import { costoDeParar } from "../lib/costo-de-parar";
import {
  REJILLA, acomodoInicial, croquisCompleto, primerHueco, resolverSoltada, seEncima, tamanoQueCabe,
  type AreaParaCroquis, type CajaCroquis,
} from "../lib/croquis";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

const area = (id: string): AreaParaCroquis => ({
  locationId: id, area: id, planoX: null, planoY: null, planoAncho: 3, planoAlto: 2,
});
const caja = (id: string, x: number, y: number, ancho = 6, alto = 4): CajaCroquis =>
  ({ locationId: id, x, y, ancho, alto });

async function main() {
  console.log("\nAcomodo de arranque");
  for (const n of [1, 2, 3, 4, 5, 6, 9, 12]) {
    const cajas = acomodoInicial(Array.from({ length: n }, (_, i) => area(`a${i}`)));
    revisar(`${n} áreas: ninguna se sale de la rejilla`,
      cajas.every((c) => c.x + c.ancho <= REJILLA.columnas && c.y + c.alto <= REJILLA.filas));
    revisar(`${n} áreas: ninguna encimada`,
      !cajas.some((a) => cajas.some((b) => seEncima(a, b))));
    // Lo que se rompio antes: cuatro cajas de 3x2 en un renglon usaban 1/8 del
    // lienzo y la pantalla parecia a medio cargar.
    const cubierto = cajas.reduce((s, c) => s + c.ancho * c.alto, 0) / (REJILLA.columnas * REJILLA.filas);
    revisar(`${n} áreas: llenan al menos la mitad del lienzo`, cubierto >= 0.5,
      `${Math.round(cubierto * 100)}%`);
  }
  revisar("sin áreas con ubicación, no inventa cajas", acomodoInicial([]).length === 0);
  revisar("un área sin locationId se ignora",
    acomodoInicial([{ ...area("x"), locationId: null }]).length === 0);

  console.log("\nSoltar un área encima de otra");
  const rejillaLlena = [caja("A", 0, 0), caja("B", 6, 0), caja("C", 0, 4), caja("D", 6, 4)];

  // D se arrastro de (6,4) y cayo corrida un renglon, encima de B.
  const cayoCorrida = rejillaLlena.map((c) => (c.locationId === "D" ? { ...c, y: 1 } : c));
  const tras = resolverSoltada(cayoCorrida, "D", { x: 6, y: 4 });
  const d = tras.find((c) => c.locationId === "D")!;
  const b = tras.find((c) => c.locationId === "B")!;
  revisar("se intercambian aunque el aterrizaje quede corrido",
    d.x === 6 && d.y === 0 && b.x === 6 && b.y === 4, `D@${d.x},${d.y} B@${b.x},${b.y}`);
  revisar("tras el intercambio ninguna queda encimada",
    !tras.some((a) => tras.some((z) => seEncima(a, z))));

  // Lo que motivo todo esto: con la rejilla llena tiene que MOVERSE algo.
  revisar("con la rejilla llena, soltar encima sí cambia el croquis",
    JSON.stringify(tras) !== JSON.stringify(cayoCorrida));

  // Soltar sobre dos a la vez no es un intercambio: se va al primer hueco.
  const sueltas = [caja("A", 0, 0, 3, 2), caja("B", 3, 0, 3, 2), caja("C", 1, 0, 3, 2)];
  const tras2 = resolverSoltada(sueltas, "C", { x: 0, y: 6 });
  revisar("encima de dos áreas, se va a un hueco y no encima",
    !tras2.some((a) => tras2.some((z) => seEncima(a, z))));

  // Sin encimarse, no se toca nada: mover un área a un lugar libre la deja ahí.
  const libre = [caja("A", 0, 0, 3, 2), caja("B", 6, 4, 3, 2)];
  revisar("si no se encima con nadie, se queda donde se soltó",
    JSON.stringify(resolverSoltada(libre, "B", { x: 0, y: 4 })) === JSON.stringify(libre));

  console.log("\nEstirar un área se topa con la vecina");
  // Sin tope, la caja crecia encima y al soltar brincaba sola a otro lado de
  // la planta: un movimiento que nadie pidio.
  const vecinas = [caja("A", 0, 0), caja("B", 6, 0), caja("C", 0, 4), caja("D", 6, 4)];
  const aTodoLoAncho = tamanoQueCabe(vecinas, { ...caja("A", 0, 0), ancho: 12, alto: 4 });
  revisar("no cruza a la vecina de la derecha", aTodoLoAncho.ancho === 6, `ancho ${aTodoLoAncho.ancho}`);
  const aTodoLoAlto = tamanoQueCabe(vecinas, { ...caja("A", 0, 0), ancho: 6, alto: 8 });
  revisar("no cruza a la vecina de abajo", aTodoLoAlto.alto === 4, `alto ${aTodoLoAlto.alto}`);
  const solita = tamanoQueCabe([caja("A", 0, 0)], { ...caja("A", 0, 0), ancho: 12, alto: 8 });
  revisar("sin vecinas, crece hasta la orilla", solita.ancho === 12 && solita.alto === 8);
  const fuera = tamanoQueCabe([caja("A", 6, 4)], { ...caja("A", 6, 4), ancho: 99, alto: 99 });
  revisar("nunca se sale de la rejilla", fuera.ancho === 6 && fuera.alto === 4);
  const minima = tamanoQueCabe(vecinas, { ...caja("A", 0, 0), ancho: 0, alto: 0 });
  revisar("nunca queda en cero", minima.ancho >= 1 && minima.alto >= 1);

  console.log("\nHuecos y croquis completo");
  revisar("primerHueco respeta la orilla derecha",
    primerHueco([caja("A", 0, 0)], caja("Z", 9, 0, 6, 4)).x + 6 <= REJILLA.columnas);
  revisar("croquis incompleto mientras falte un área por colocar",
    !croquisCompleto([{ ...area("a"), planoX: 0, planoY: 0 }, area("b")]));
  revisar("croquis completo cuando todas tienen lugar",
    croquisCompleto([{ ...area("a"), planoX: 0, planoY: 0 }, { ...area("b"), planoX: 3, planoY: 0 }]));
  revisar("sin áreas, el croquis no se da por completo", !croquisCompleto([]));

  console.log("\nLo guardado llega al dibujo");
  const sello = `prueba-croquis-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE" },
  });
  const sitio = await prisma.site.create({
    data: { organizationId: org.id, code: "PL", name: "Planta" },
  });
  const nave = await prisma.location.create({
    data: {
      organizationId: org.id, siteId: sitio.id, code: "NAVE", name: "Nave",
      margenPorHora: 1000, planoX: 4, planoY: 2, planoAncho: 5, planoAlto: 3,
    },
  });
  const patio = await prisma.location.create({
    data: { organizationId: org.id, siteId: sitio.id, code: "PAT", name: "Patio", margenPorHora: 500 },
  });
  for (const [code, loc] of [["TOR-1", nave.id], ["MON-1", patio.id]] as const) {
    const activo = await prisma.asset.create({
      data: {
        organizationId: org.id, siteId: sitio.id, locationId: loc,
        code, name: code, status: "OPERATIONAL", detieneLinea: true,
      },
    });
    await prisma.downtimeEvent.create({
      data: {
        assetId: activo.id, minutes: 120, planned: false,
        startedAt: new Date(Date.now() - 86_400_000),
      },
    });
  }

  const costo = await costoDeParar(org.id, {
    desde: new Date(Date.now() - 7 * 86_400_000),
    hasta: new Date(),
  });
  const conPlano = costo.areas.find((a) => a.locationId === nave.id);
  const sinPlano = costo.areas.find((a) => a.locationId === patio.id);
  revisar("las coordenadas guardadas llegan tal cual",
    conPlano?.planoX === 4 && conPlano?.planoY === 2 && conPlano?.planoAncho === 5 && conPlano?.planoAlto === 3,
    `${conPlano?.planoX},${conPlano?.planoY} ${conPlano?.planoAncho}x${conPlano?.planoAlto}`);
  revisar("un área nunca colocada llega sin lugar, no en el origen",
    sinPlano?.planoX === null && sinPlano?.planoY === null);
  revisar("con un área sin colocar, el croquis no se da por completo",
    !croquisCompleto(costo.areas));

  await prisma.downtimeEvent.deleteMany({ where: { asset: { organizationId: org.id } } });
  await prisma.asset.deleteMany({ where: { organizationId: org.id } });
  await prisma.location.deleteMany({ where: { organizationId: org.id } });
  await prisma.site.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });

  console.log(fallos ? `\n${fallos} fallas\n` : "\nTodo bien\n");
  process.exit(fallos ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
