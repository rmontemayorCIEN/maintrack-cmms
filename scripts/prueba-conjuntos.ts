/**
 * Conjuntos de equipos: lo que sirve o no sirve como un todo.
 *
 * Se prueba lo que el modelo esta disenado para impedir, que es donde
 * fallaria callado:
 *
 *   - un equipo en dos conjuntos tiene DOS posiciones, y acomodar una no
 *     mueve la otra. Si las coordenadas vivieran en Asset, acomodar un lienzo
 *     desacomodaria los demas sin que nadie lo relacione
 *   - un equipo recien dado de alta cae SOLO en el residual. Es la razon de
 *     calcularlo en vez de crear un conjunto "Equipos varios" a mano
 *   - marcar independiente lo saca de pendientes pero no lo esconde
 *   - el termino sale de la instalacion, y el de la organizacion le gana
 *   - el vecino no ve mis conjuntos
 *
 *   npx tsx scripts/prueba-conjuntos.ts
 */
import { prisma } from "../lib/db";
import { conjuntosDe, residualDe, estadoDe, claveSugerida, loQueImpideBorrar } from "../lib/conjuntos";
import { terminoConjunto } from "../lib/instalaciones";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  console.log("\nEl término lo pone la instalación");
  revisar("planta dice Línea", terminoConjunto({ tipoInstalacion: "PLANTA" }).singular === "Línea");
  revisar("club dice Servicio", terminoConjunto({ tipoInstalacion: "DEPORTIVO" }).singular === "Servicio");
  revisar("edificio dice Sistema", terminoConjunto({ tipoInstalacion: "EDIFICIO" }).singular === "Sistema");
  revisar("flotilla dice Ruta", terminoConjunto({ tipoInstalacion: "FLOTILLA" }).plural === "Rutas");
  revisar("sin tipo, no truena", terminoConjunto({}).singular.length > 0);
  const propio = terminoConjunto({ tipoInstalacion: "PLANTA", terminoConjunto: "Celda" });
  revisar("el término de la organización le gana al del tipo",
    propio.singular === "Celda" && propio.plural === "Celdas", `${propio.singular}/${propio.plural}`);

  console.log("\nEl dictamen");
  revisar("sin equipos es VACIO", estadoDe({ equipos: 0, abajo: 0, aMedias: 0 }) === "VACIO");
  revisar("uno abajo es DETENIDO", estadoDe({ equipos: 4, abajo: 1, aMedias: 0 }) === "DETENIDO");
  revisar("degradado sin caídos es DEGRADADO", estadoDe({ equipos: 4, abajo: 0, aMedias: 1 }) === "DEGRADADO");
  revisar("todos bien es COMPLETO", estadoDe({ equipos: 4, abajo: 0, aMedias: 0 }) === "COMPLETO");

  console.log("\nClave sugerida");
  revisar("quita acentos y espacios", claveSugerida("Línea 4") === "LINEA-4", claveSugerida("Línea 4"));
  revisar("un nombre vacío no genera basura", claveSugerida("   ") === "");

  console.log("\nContra la base");
  const sello = `prueba-conj-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", tipoInstalacion: "PLANTA" },
  });
  const vecino = await prisma.organization.create({
    data: { name: `${sello}-vecino`, slug: `${sello}-vecino`, plan: "ENTERPRISE" },
  });
  const sitio = await prisma.site.create({ data: { organizationId: org.id, code: "PL", name: "Planta" } });
  const area = await prisma.location.create({
    data: { organizationId: org.id, siteId: sitio.id, code: "NAVE", name: "Nave" },
  });

  const crear = (code: string, status = "OPERATIONAL", detieneLinea: boolean | null = true) =>
    prisma.asset.create({
      data: {
        organizationId: org.id, siteId: sitio.id, locationId: area.id,
        code, name: code, status, detieneLinea,
      },
    });

  const subestacion = await crear("SUB-001");
  const torno = await crear("TOR-001");
  const elevador = await crear("ELE-001");
  const calentador = await crear("CAL-001", "OPERATIONAL", false);

  // La subestacion alimenta a los dos: es el caso que el modelo debe soportar.
  const linea = await prisma.conjunto.create({
    data: {
      organizationId: org.id, code: "L4", name: "Línea 4",
      equipos: {
        create: [
          { organizationId: org.id, assetId: torno.id, planoX: 0, planoY: 0 },
          { organizationId: org.id, assetId: subestacion.id, planoX: 6, planoY: 4 },
        ],
      },
    },
  });
  const elevadores = await prisma.conjunto.create({
    data: {
      organizationId: org.id, code: "ELEV", name: "Elevadores",
      equipos: {
        create: [
          { organizationId: org.id, assetId: elevador.id, planoX: 0, planoY: 0 },
          { organizationId: org.id, assetId: subestacion.id, planoX: 3, planoY: 2 },
        ],
      },
    },
  });

  const enDos = await prisma.conjuntoAsset.findMany({
    where: { assetId: subestacion.id },
    select: { conjuntoId: true, planoX: true, planoY: true },
    orderBy: { planoX: "asc" },
  });
  revisar("un equipo puede estar en dos conjuntos", enDos.length === 2);
  revisar("y tiene una posición distinta en cada lienzo",
    enDos[0].planoX === 3 && enDos[1].planoX === 6,
    enDos.map((e) => `${e.planoX},${e.planoY}`).join(" / "));

  // Acomodar un lienzo no puede tocar el otro. Es el error que el modelo evita.
  await prisma.conjuntoAsset.updateMany({
    where: { conjuntoId: linea.id, assetId: subestacion.id },
    data: { planoX: 9, planoY: 1 },
  });
  const enElevadores = await prisma.conjuntoAsset.findFirst({
    where: { conjuntoId: elevadores.id, assetId: subestacion.id },
    select: { planoX: true, planoY: true },
  });
  revisar("acomodar un lienzo NO mueve al mismo equipo en el otro",
    enElevadores?.planoX === 3 && enElevadores?.planoY === 2,
    `quedó en ${enElevadores?.planoX},${enElevadores?.planoY}`);

  const lista = await conjuntosDe(org.id);
  revisar("los dos conjuntos salen en la lista", lista.length === 2);
  revisar("todos operando es COMPLETO", lista.every((c) => c.estado === "COMPLETO"));

  // El calentador nunca se metio a nada: tiene que aparecer solo.
  let residual = await residualDe(org.id);
  revisar("un equipo que nadie acomodó aparece SOLO en el residual",
    residual.sinAcomodar.some((a) => a.code === "CAL-001"), `${residual.sinAcomodar.length} sin acomodar`);
  revisar("el total cuenta todos los equipos vivos", residual.total === 4, String(residual.total));

  await prisma.asset.update({ where: { id: calentador.id }, data: { independiente: true } });
  residual = await residualDe(org.id);
  revisar("marcado independiente sale de pendientes",
    !residual.sinAcomodar.some((a) => a.code === "CAL-001"));
  revisar("pero NO se esconde: sigue en el residual, en el otro grupo",
    residual.independientes.some((a) => a.code === "CAL-001"));

  // Un conjunto apagado no cuenta como hogar.
  await prisma.conjunto.update({ where: { id: elevadores.id }, data: { active: false } });
  residual = await residualDe(org.id);
  revisar("con su conjunto desactivado, el equipo vuelve al residual",
    residual.sinAcomodar.some((a) => a.code === "ELE-001"));
  revisar("la subestación NO vuelve, porque su otro conjunto sigue vivo",
    !residual.sinAcomodar.some((a) => a.code === "SUB-001"));

  // El estado vivo manda en el dictamen.
  await prisma.asset.update({ where: { id: torno.id }, data: { status: "DOWN" } });
  const conParo = (await conjuntosDe(org.id)).find((c) => c.code === "L4")!;
  revisar("un equipo abajo pone el conjunto en DETENIDO", conParo.estado === "DETENIDO");
  revisar("y dice cuántos de los caídos detienen la producción",
    conParo.abajoQueDetienen === 1, String(conParo.abajoQueDetienen));

  // Un equipo retirado no pesa en el dictamen de hoy.
  await prisma.asset.update({ where: { id: torno.id }, data: { active: false } });
  const sinRetirado = (await conjuntosDe(org.id)).find((c) => c.code === "L4")!;
  revisar("un equipo retirado deja de pesar en el dictamen",
    sinRetirado.estado === "COMPLETO" && sinRetirado.equipos === 1,
    `${sinRetirado.estado}, ${sinRetirado.equipos} equipos`);

  revisar("no deja borrar un conjunto con equipos, y dice cuántos",
    (await loQueImpideBorrar(org.id, linea.id))?.includes("1 equipo") === true);

  revisar("el vecino no ve mis conjuntos", (await conjuntosDe(vecino.id)).length === 0);
  revisar("ni mis equipos sueltos", (await residualDe(vecino.id)).total === 0);

  for (const o of [org.id, vecino.id]) {
    await prisma.conjuntoAsset.deleteMany({ where: { organizationId: o } });
    await prisma.conjunto.deleteMany({ where: { organizationId: o } });
    await prisma.asset.deleteMany({ where: { organizationId: o } });
    await prisma.location.deleteMany({ where: { organizationId: o } });
    await prisma.site.deleteMany({ where: { organizationId: o } });
    await prisma.organization.delete({ where: { id: o } });
  }

  console.log(fallos ? `\n${fallos} fallas\n` : "\nTodo bien\n");
  process.exit(fallos ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
