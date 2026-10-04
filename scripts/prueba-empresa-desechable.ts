/**
 * La empresa desechable de las pruebas *-real: que nazca sin contar como
 * cliente, que se borre completa (archivos incluidos), que diga si se quedo, y
 * que nunca se lleve una empresa que no es suya.
 *
 *   npx tsx scripts/prueba-empresa-desechable.ts
 *
 * Corre en la base de desarrollo, sin modelo: las pruebas que la usan llaman a
 * la IA contra produccion y no entran en la suite.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/db";
import { guardarArchivo, usaGCS } from "../lib/almacenamiento";
import { borrarEmpresaDesechable, crearEmpresaDesechable, desechablesSueltas } from "./empresa-desechable";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${!bien && d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

/** Lo mismo que arma prueba-rondin-real: la empresa que se quedo en produccion tenia esto. */
async function sembrarComoRondin(orgId: string, sello: string) {
  const sitio = await prisma.site.create({ data: { organizationId: orgId, name: "Planta", code: "P1" } });
  const area = await prisma.location.create({ data: { organizationId: orgId, siteId: sitio.id, name: "Nave 1", code: "N1" } });
  const equipo = await prisma.asset.create({ data: { organizationId: orgId, siteId: sitio.id, locationId: area.id, code: "BOM-9", name: "Bomba de proceso" } });
  const rondin = await prisma.rondin.create({ data: { organizationId: orgId, numero: `RD-${sello}`, siteId: sitio.id, locationId: area.id, estado: "TERMINADO" } });
  const parada = await prisma.rondinParada.create({
    data: { organizationId: orgId, rondinId: rondin.id, orden: 1, assetId: equipo.id, locationId: area.id, comoSeIdentifico: "ELEGIDO", observacion: "x" },
  });
  const ruta = `org-${orgId}/rondines/${sello}-gris.png`;
  await guardarArchivo(ruta, Buffer.from("no es una imagen, da igual"), "image/png");
  await prisma.attachment.create({
    data: { organizationId: orgId, rondinParadaId: parada.id, name: "gris.png", storagePath: ruta, mimeType: "image/png", kind: "PHOTO", size: 10 },
  });
  return ruta;
}

/** Donde guarda el almacenamiento local (lib/almacenamiento.ts). */
const DIR_LOCAL = join(process.cwd(), ".almacen");

async function main() {
  if (usaGCS) {
    console.log("\n  Esta prueba corre contra el almacenamiento local; hay un bucket configurado. No corre.\n");
    process.exit(1);
  }
  const ajena = await prisma.organization.create({ data: { name: `Cliente de verdad ${Date.now()}`, slug: `ajena-${Date.now()}` } });

  try {
    console.log("\nNace sin contar como cliente\n");
    const { org, sello } = await crearEmpresaDesechable("rreal-");
    revisar("nace como cuenta interna", org.cuentaInterna === true);
    revisar("con el prefijo que la identifica", org.name.startsWith("rreal-") && org.name === sello);

    console.log("\nSe borra completa, con lo que dejó la empresa suelta\n");
    const ruta = await sembrarComoRondin(org.id, sello);
    const rutaArchivo = existsSync(join(DIR_LOCAL, ruta)) ? join(DIR_LOCAL, ruta) : null;
    revisar("(el archivo de la foto existe antes)", rutaArchivo !== null, ruta);
    const borrada = await borrarEmpresaDesechable(org.id);
    revisar("dice que la borró", borrada === true);
    revisar("y de verdad ya no existe", (await prisma.organization.findUnique({ where: { id: org.id } })) === null);
    revisar("ni su equipo", (await prisma.asset.count({ where: { organizationId: org.id } })) === 0);
    revisar("y el archivo de la foto también se borró", rutaArchivo !== null && !existsSync(rutaArchivo));
    revisar("borrar una que ya no existe no es falla", (await borrarEmpresaDesechable(org.id)) === true);

    console.log("\nNunca se lleva una empresa que no es suya\n");
    const intento = await borrarEmpresaDesechable(ajena.id);
    revisar("con el id de un cliente, se niega", intento === false);
    revisar("y el cliente sigue ahí", (await prisma.organization.findUnique({ where: { id: ajena.id } })) !== null);

    console.log("\nLas que se quedaron de antes se limpian solas\n");
    const vieja = await prisma.organization.create({
      data: { name: `navr-${Date.now() - 3 * 3600_000}`, slug: `navr-vieja-${Date.now()}`, createdAt: new Date(Date.now() - 3 * 3600_000) },
    });
    revisar("una suelta de hace 3 horas se detecta", (await desechablesSueltas()).some((o) => o.id === vieja.id));
    const { org: nueva } = await crearEmpresaDesechable("navr-");
    revisar("y la siguiente corrida la borra al empezar", (await prisma.organization.findUnique({ where: { id: vieja.id } })) === null);
    revisar("una recién creada no cuenta como suelta", !(await desechablesSueltas()).some((o) => o.id === nueva.id));
    await borrarEmpresaDesechable(nueva.id);
  } finally {
    await prisma.organization.delete({ where: { id: ajena.id } }).catch(() => undefined);
  }

  console.log(fallas ? `\n${fallas} falla(s).\n` : "\nTodo en orden.\n");
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
