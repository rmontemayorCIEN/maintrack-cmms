/**
 * El parte del dia (lib/brief.ts y lib/ia/brief.ts), sin llamar al modelo.
 *
 * Lo que se cuida aqui es lo que nadie podria cachar oyendo el brief en el
 * coche: que una cifra inventada se cuele, que se mezcle otra empresa, que a
 * quien no ve costos le digan importes, o que se le pida a alguien autorizar
 * lo que el mismo pidio.
 *
 *   npx tsx scripts/prueba-brief.ts
 */
import { prisma } from "../lib/db";
import { guionDelDia, MAX_PUNTOS } from "../lib/brief";
import { cifrasInventadas, guionPlano } from "../lib/ia/brief";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle = "") {
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${detalle ? ` · ${detalle}` : ""}`);
  if (!bien) fallas++;
}

const DIA = 86_400_000;
const ZONA = "America/Monterrey";

async function main() {
  const sello = `brief-${Date.now()}`;
  const creadas: string[] = [];

  try {
    const A = await prisma.organization.create({
      data: { name: sello, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", timezone: ZONA, diasHabiles: "1,2,3,4,5", currency: "MXN" },
    });
    creadas.push(A.id);
    const site = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const nave = await prisma.location.create({ data: { organizationId: A.id, siteId: site.id, code: "NAVE", name: "Nave" } });
    const almacen = await prisma.warehouse.create({ data: { organizationId: A.id, siteId: site.id, code: "ALM", name: "Almacén", esGeneral: true } });

    const director = await prisma.user.create({
      data: { organizationId: A.id, email: `dir-${sello}@prueba.mx`, name: "Ana Robles", role: "OWNER", passwordHash: "x" },
    });
    const tecnico = await prisma.user.create({
      data: { organizationId: A.id, email: `tec-${sello}@prueba.mx`, name: "Luis Peña", role: "TECHNICIAN", passwordHash: "x" },
    });

    const caido = await prisma.asset.create({
      data: { organizationId: A.id, siteId: site.id, locationId: nave.id, code: "BOM-9", name: "Bomba principal", status: "DOWN", criticality: "A" },
    });
    await prisma.asset.create({
      data: { organizationId: A.id, siteId: site.id, locationId: nave.id, code: "BOM-8", name: "Bomba de respaldo", status: "OPERATIONAL", criticality: "B" },
    });

    const ahora = new Date();
    await prisma.workOrder.create({
      data: { organizationId: A.id, number: `${sello}-1`, title: "Cambiar sello", maintenanceType: "CORRECTIVE", status: "OPEN", assetId: caido.id, dueDate: new Date(ahora.getTime() - 7 * DIA) },
    });
    await prisma.workOrder.create({
      data: { organizationId: A.id, number: `${sello}-2`, title: "Revisar cople", maintenanceType: "CORRECTIVE", status: "OPEN", assetId: caido.id, dueDate: new Date(ahora.getTime() - 2 * DIA) },
    });
    await prisma.predictiveAlert.create({
      data: { organizationId: A.id, assetId: caido.id, severity: "CRITICAL", title: "Vibración alta", message: "x", status: "OPEN", createdAt: new Date(ahora.getTime() - 5 * DIA) },
    });

    // Una compra pedida POR EL DIRECTOR: no debe aparecerle a el para firmar.
    await prisma.purchaseRequest.create({
      data: { organizationId: A.id, folio: `RC-${sello}-propia`, estado: "SOLICITADA", solicitanteId: director.id, warehouseId: almacen.id, montoEstimado: 50_000 },
    });
    // Otra pedida por el tecnico: esa si.
    await prisma.purchaseRequest.create({
      data: { organizationId: A.id, folio: `RC-${sello}-ajena`, estado: "SOLICITADA", solicitanteId: tecnico.id, warehouseId: almacen.id, montoEstimado: 128_400, createdAt: new Date(ahora.getTime() - 3 * DIA) },
    });

    // Otra empresa con datos ruidosos, para comprobar que no se cruzan.
    const B = await prisma.organization.create({
      data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE", status: "ACTIVE", timezone: ZONA, diasHabiles: "1,2,3,4,5" },
    });
    creadas.push(B.id);
    const siteB = await prisma.site.create({ data: { organizationId: B.id, code: "S1", name: "Planta B" } });
    const caidoB = await prisma.asset.create({
      data: { organizationId: B.id, siteId: siteB.id, code: "EQ-B", name: "Equipo de la otra empresa", status: "DOWN", criticality: "A" },
    });
    for (let i = 0; i < 9; i++) {
      await prisma.workOrder.create({
        data: { organizationId: B.id, number: `${sello}-b${i}`, title: "De la otra", maintenanceType: "CORRECTIVE", status: "OPEN", assetId: caidoB.id, dueDate: new Date(ahora.getTime() - 30 * DIA) },
      });
    }

    const conUsuario = (id: string) => prisma.user.findUniqueOrThrow({ where: { id }, include: { organization: true } });

    console.log("\nEl guion del director\n");
    const g = await guionDelDia((await conUsuario(director.id)) as never, ahora);

    revisar("lo primero que dice es lo que está parado", g.puntos[0]?.clave === "detenidos", g.puntos[0]?.clave ?? "");
    revisar("nombra el equipo caído y su criticidad",
      Boolean(g.puntos[0]?.texto.includes("Bomba principal") && g.puntos[0].texto.includes("criticidad A")), g.puntos[0]?.texto ?? "");
    revisar("no cuenta el equipo que sí opera", !g.puntos[0]?.texto.includes("Bomba de respaldo"));

    const venc = g.puntos.find((p) => p.clave === "vencidas");
    revisar("cuenta las dos vencidas", Boolean(venc?.texto.includes("2 órdenes vencidas")), venc?.texto ?? "");
    revisar("dice cuántos días lleva la más atrasada", Boolean(venc?.texto.includes("7 días")), venc?.texto ?? "");

    const compras = g.puntos.find((p) => p.clave === "compras");
    revisar("le pide firmar SOLO lo que no pidió él", Boolean(compras?.texto.includes("una compra")), compras?.texto ?? "");
    revisar("dice el monto en palabras, no con signos",
      Boolean(compras?.texto.includes("128 mil pesos")) && !compras!.texto.includes("$"), compras?.texto ?? "");

    revisar("nunca dice más de los puntos que caben", g.puntos.length <= MAX_PUNTOS, `${g.puntos.length}`);
    revisar("no se cuela nada de la otra empresa",
      !g.puntos.some((p) => p.texto.includes("otra empresa") || p.texto.includes("De la otra")));
    revisar("no cuenta las vencidas de la otra empresa", !venc?.texto.includes("11 órdenes"), venc?.texto ?? "");
    revisar("no dice «2 de ellas» cuando son todas", !venc?.texto.includes("2 de ellas"), venc?.texto ?? "");

    console.log("\nQuien no ve costos\n");
    const gt = await guionDelDia((await conUsuario(tecnico.id)) as never, ahora);
    const comprasTec = gt.puntos.find((p) => p.clave === "compras");
    revisar("al técnico NO se le pide autorizar: su rol no puede", !comprasTec, comprasTec?.texto ?? "sin punto de compras");
    revisar("al técnico no se le dice ningún importe",
      !gt.puntos.some((p) => p.texto.includes("pesos")), gt.puntos.map((p) => p.texto).join(" | ").slice(0, 120));

    console.log("\nEl texto plano, cuando no hay IA\n");
    const plano = guionPlano(g);
    revisar("el plano empieza con el saludo", plano.startsWith(g.saludo), plano.slice(0, 40));
    revisar("el plano trae todos los puntos", g.puntos.every((p) => plano.includes(p.texto)));
    revisar("el plano se lee en menos de cuarenta segundos", plano.length < 700, `${plano.length} caracteres`);
    revisar("el plano dice el nombre de pila", plano.includes("Ana"), plano.slice(0, 30));

    console.log("\nLa red que atrapa una cifra inventada\n");
    revisar("una redacción fiel no marca nada", cifrasInventadas(plano, g.cifras).length === 0, cifrasInventadas(plano, g.cifras).join(","));
    const mentira = plano.replace("2 órdenes vencidas", "20 órdenes vencidas");
    revisar("cambiar 2 por 20 se detecta", cifrasInventadas(mentira, g.cifras).includes("20"), cifrasInventadas(mentira, g.cifras).join(","));
    revisar("agregar un dato inventado se detecta",
      cifrasInventadas(`${plano} El costo subió 35 por ciento.`, g.cifras).includes("35"));
    revisar("«1,200» y «1200» son el mismo número", cifrasInventadas("son 1,200 pesos", ["1200"]).length === 0);
    revisar("un número que sí estaba no se marca", cifrasInventadas("hay 7 días", ["7"]).length === 0);

    console.log("\nUna cuenta sin nada que reportar\n");
    const C = await prisma.organization.create({
      data: { name: `${sello}-c`, slug: `${sello}-c`, plan: "ENTERPRISE", status: "ACTIVE", timezone: ZONA, diasHabiles: "1,2,3,4,5" },
    });
    creadas.push(C.id);
    const solo = await prisma.user.create({
      data: { organizationId: C.id, email: `solo-${sello}@prueba.mx`, name: "Pedro Lara", role: "OWNER", passwordHash: "x" },
    });
    const gc = await guionDelDia((await conUsuario(solo.id)) as never, ahora);
    revisar("se dice que no hay pendientes, no se calla", gc.tranquilo && gc.puntos.length === 0);
    // Se revisa el SENTIDO, no la frase exacta: el texto del brief se ajusta
    // para que suene hablado, y anclar una prueba a las palabras literales la
    // vuelve una alarma que suena cada vez que alguien mejora la redaccion.
    const tranquilo = guionPlano(gc);
    revisar("el plano dice que no hay nada, en vez de quedarse callado",
      tranquilo.includes("Pedro") && /nada|ningun|tranquil/i.test(tranquilo) && tranquilo.length > 40, tranquilo);

    console.log("\nEl saludo según la hora de la EMPRESA\n");
    const manana = new Date("2026-09-21T15:00:00Z"); // 9 de la mañana en Monterrey
    const noche = new Date("2026-09-22T03:00:00Z");  // 9 de la noche en Monterrey
    const gm = await guionDelDia((await conUsuario(director.id)) as never, manana);
    const gn = await guionDelDia((await conUsuario(director.id)) as never, noche);
    revisar("a las 9 de la mañana saluda con «buenos días»", gm.saludo.startsWith("Buenos días"), gm.saludo);
    revisar("a las 9 de la noche saluda con «buenas noches»", gn.saludo.startsWith("Buenas noches"), gn.saludo);
  } finally {
    for (const id of creadas) {
      await prisma.workOrder.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
  }

  console.log(`\n${fallas ? `${fallas} FALLARON` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
