/**
 * Los centros de costo que se proponen segun el giro.
 *
 * Lo que mas vigila: que NO pise lo que alguien ya capturo, y que cada giro
 * proponga algo coherente con lo que ahi se mantiene. Las claves son un punto
 * de partida —son la llave con la contabilidad del cliente— y eso lo dice la
 * pantalla; aqui se cuida que aplicarlas sea inofensivo.
 *
 *   npx tsx scripts/prueba-centros-sugeridos.ts
 */
import { prisma } from "../lib/db";
import { aplicarCentrosSugeridos, centrosSugeridos } from "../lib/centros-sugeridos";
import { INSTALACIONES, type ClaveInstalacion } from "../lib/instalaciones";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 200)}` : ""}`);
}

async function main() {
  const sello = `prueba-cs-${Date.now()}`;
  const A = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", tipoInstalacion: "PLANTA" },
  });
  const B = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" } });

  try {
    console.log("\n1. Todos los giros proponen algo\n");
    const claves = Object.keys(INSTALACIONES) as ClaveInstalacion[];
    revisar("los doce giros tienen propuesta", claves.every((c) => centrosSugeridos(c).length >= 3),
      claves.map((c) => `${c}:${centrosSugeridos(c).length}`).join(" "));
    revisar("ninguno repite clave dentro de su propuesta",
      claves.every((c) => new Set(centrosSugeridos(c).map((x) => x.code)).size === centrosSugeridos(c).length));
    revisar("todos traen nombre y para qué sirve",
      claves.every((c) => centrosSugeridos(c).every((x) => x.name.trim() && x.descripcion.trim())));
    // Un giro que no existe no puede dejar la cuenta sin nada que proponer.
    revisar("un giro desconocido cae en la propuesta general", centrosSugeridos("INVENTADO").length >= 3,
      centrosSugeridos("INVENTADO").map((c) => c.name));
    revisar("sin giro declarado, también propone", centrosSugeridos(null).length >= 3);

    console.log("\n2. Cada giro propone lo suyo\n");
    const nombres = (c: ClaveInstalacion) => centrosSugeridos(c).map((x) => x.name).join(" | ");
    revisar("una planta separa producción de sus servicios auxiliares",
      /Producción/.test(nombres("PLANTA")) && /auxiliares/i.test(nombres("PLANTA")), nombres("PLANTA"));
    revisar("un edificio separa elevadores y clima",
      /vertical/i.test(nombres("EDIFICIO")) && /Climatización/.test(nombres("EDIFICIO")), nombres("EDIFICIO"));
    revisar("un hospital separa el equipo médico y los gases",
      /médico/i.test(nombres("HOSPITAL")) && /[Gg]ases/.test(nombres("HOSPITAL")), nombres("HOSPITAL"));
    revisar("una flotilla separa ligeras de pesadas",
      /ligeras/i.test(nombres("FLOTILLA")) && /pesadas/i.test(nombres("FLOTILLA")), nombres("FLOTILLA"));
    revisar("y una planta NO propone habitaciones ni albercas",
      !/habitacion|alberca/i.test(nombres("PLANTA")), nombres("PLANTA"));

    console.log("\n3. Aplicarlos da de alta lo que falta\n");
    const r1 = await aplicarCentrosSugeridos({ organizationId: A.id, tipoInstalacion: "PLANTA" });
    revisar("se crean todos los propuestos", r1.creados.length === centrosSugeridos("PLANTA").length, r1.creados.length);
    revisar("y quedan en la base con su clave y su nombre",
      (await prisma.centroDeCosto.count({ where: { organizationId: A.id } })) === r1.creados.length);

    console.log("\n4. LO QUE IMPORTA: no pisa lo ya capturado\n");
    // Alguien ya tenía su propio «100» con OTRO nombre: es su clave contable.
    await prisma.centroDeCosto.deleteMany({ where: { organizationId: A.id } });
    await prisma.centroDeCosto.create({
      data: { organizationId: A.id, code: "100", name: "Mi centro de siempre", descripcion: "Capturado por el cliente" },
    });
    const r2 = await aplicarCentrosSugeridos({ organizationId: A.id, tipoInstalacion: "PLANTA" });
    const suyo = await prisma.centroDeCosto.findFirstOrThrow({ where: { organizationId: A.id, code: "100" } });
    revisar("el que ya existía conserva SU nombre, no se reescribe",
      suyo.name === "Mi centro de siempre", suyo.name);
    revisar("y se reporta como ya existente", r2.yaExistian.includes("100"), r2.yaExistian);
    revisar("los demás sí se crean", r2.creados.length === centrosSugeridos("PLANTA").length - 1, r2.creados.length);

    console.log("\n5. Aplicarlos dos veces no duplica\n");
    const antes = await prisma.centroDeCosto.count({ where: { organizationId: A.id } });
    const r3 = await aplicarCentrosSugeridos({ organizationId: A.id, tipoInstalacion: "PLANTA" });
    const despues = await prisma.centroDeCosto.count({ where: { organizationId: A.id } });
    revisar("no se crea nada la segunda vez", r3.creados.length === 0 && antes === despues, { antes, despues });

    console.log("\n6. Cada empresa lo suyo\n");
    revisar("aplicarlos en una NO toca a la otra",
      (await prisma.centroDeCosto.count({ where: { organizationId: B.id } })) === 0);
  } finally {
    for (const org of [A.id, B.id]) {
      await prisma.centroDeCosto.deleteMany({ where: { organizationId: org } });
      await prisma.organization.delete({ where: { id: org } }).catch(() => undefined);
    }
  }

  console.log(fallos ? `\n${fallos} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallos ? 1 : 0;
}

main().catch((e) => { console.error("\nERROR:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
