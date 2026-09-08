/**
 * Tarifas por hora y marcas de "detiene la linea" en la cuenta de demostracion.
 *
 * Las tarifas son plausibles para una metalmecanica mediana en Mexico, y las
 * marcas se pusieron de acuerdo con lo que el propio cliente declaro en su
 * contexto: la grua y el compresor detienen todo; el extractor de humos y las
 * bombas de respaldo no.
 *
 *   ./scripts/con-produccion.sh scripts/sembrar-costo-demo.ts
 */
import { prisma } from "../lib/db";
import { costoDeParar, comoDecirlo } from "../lib/costo-de-parar";

/**
 * Margen por hora de cada area. Cero donde parar no cuesta produccion.
 *
 * $2,800 la hora en la nave: unos $22,400 por turno y cerca de $450 mil al mes
 * de margen, que es plausible para un taller de cuatro centros de maquinado.
 * Se resistio la tentacion de poner un numero grande: en la primera version
 * iban $8,500 la hora —mas de millon y medio al mes— y un numero inverosimil
 * desacredita el ejemplo entero.
 *
 * Las otras tres areas van en cero porque no producen por si mismas. Lo que
 * cuesta que pare el cuarto de compresores es que se detiene la nave, y eso ya
 * se cobra a traves del compresor, que vive ahi pero para la produccion de
 * alla. Cobrarlo dos veces inflaria el total.
 */
const TARIFAS: Record<string, number> = {
  "Nave de produccion": 2800,
  // El cuarto de compresores y la subestacion no producen NADA por si mismos,
  // pero cuando algo de ahi se detiene, para la nave. La tarifa responde
  // "cuanto deja de ganar la empresa", no "cuanto produce el area": por eso
  // llevan la misma cifra que la nave.
  "Cuarto de compresores": 2800,
  "Subestacion electrica": 2800,
  // El almacen tambien lleva tarifa, y por la misma razon: ahi vive la torre
  // de enfriamiento, y sin refrigerante los centros de maquinado se detienen
  // solos. El montacargas, en cambio, solo retrasa el despacho — por eso esta
  // marcado como que NO detiene y sus horas no cuestan.
  "Almacen y patio": 2800,
};

/**
 * Que equipos detienen de verdad la produccion.
 *
 * Lo declarado por la empresa manda: "sin la grua no se mueve material y se
 * detiene toda la nave", "cuando cae el aire se paran los cuatro centros".
 *
 * Se clasifica UNO POR UNO y no por prefijo. La primera version uso "COM-"
 * para los compresores, que aqui son "CMP-", y el compresor principal quedo
 * sin definir justo cuando el dueno lo declaro como su segunda restriccion.
 * Un prefijo que no empata no falla: simplemente deja el dato en blanco.
 */
const DETIENEN = [
  "TOR-101",  // Torno Haas: produce
  "TOR-102",  // Torno Mazak: produce
  "CNC-201",  // Centro de maquinado: produce
  "GRU-501",  // Grua viajera: sin ella no se mueve material, para toda la nave
  "CMP-301",  // Compresor principal: de el dependen los sujetadores neumaticos
  "SUB-401",  // Subestacion: sin energia no trabaja nada
  "TOR-701",  // Torre de enfriamiento: sin refrigerante los centros paran solos
];
const NO_DETIENEN = [
  "EXT-801",  // Extraccion de humos: critico por seguridad, no detiene la linea
  "BOM-601",  // Bomba de refrigerante: hay respaldo
  "BOM-602",  // Bomba de agua: hay respaldo
  "MON-502",  // Montacargas: retrasa el despacho, no detiene el maquinado
  "CMP-302",  // Compresor de respaldo: para eso esta
  "CMP-501",  // Compresor chico de taller
  "CMP-502",  // Compresor chico de taller
  "SEC-303",  // Secador de aire: el aire sale humedo, la maquina no se para
  "GEN-402",  // Generador de emergencia: su falla quita respaldo, no produccion
];

async function main() {
  const org = await prisma.organization.findFirstOrThrow({
    where: { name: "Acero Industrial del Norte (Demo)" },
    select: { id: true, name: true },
  });
  console.log(`\n  ${org.name}\n`);

  console.log("  TARIFAS POR HORA");
  const ubicaciones = await prisma.location.findMany({
    where: { organizationId: org.id }, select: { id: true, name: true },
  });
  for (const u of ubicaciones) {
    const tarifa = TARIFAS[u.name] ?? 0;
    await prisma.location.update({ where: { id: u.id }, data: { margenPorHora: tarifa } });
    console.log(`    ${u.name.padEnd(26)} ${tarifa ? "$" + tarifa.toLocaleString("es-MX") + " / h" : "sin tarifa (no produce)"}`);
  }

  console.log("\n  ¿DETIENE LA PRODUCCIÓN?");
  const activos = await prisma.asset.findMany({
    where: { organizationId: org.id }, select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  for (const a of activos) {
    // Coincidencia exacta: un prefijo suelto ya dejo un equipo mal clasificado.
    const detiene = DETIENEN.includes(a.code)
      ? true
      : NO_DETIENEN.includes(a.code) ? false : null;
    await prisma.asset.update({ where: { id: a.id }, data: { detieneLinea: detiene } });
    const etiqueta = detiene === true ? "SÍ detiene" : detiene === false ? "no detiene" : "sin definir";
    console.log(`    ${a.code.padEnd(12)} ${etiqueta.padEnd(12)} ${a.name}`);
  }

  const r = await costoDeParar(org.id);
  const d = comoDecirlo(r);
  console.log("\n  ── LO QUE SALE ──");
  console.log(`  Pérdida: ${d.prefijo}$${r.perdida.toLocaleString("es-MX")}`);
  if (d.falta) console.log(`  Falta:   ${d.falta}`);
  console.log(`  Horas que detuvieron producción: ${r.horasQueDetienen}`);
  console.log(`  Horas planeadas (no se cobran):  ${r.horasPlaneadas}\n`);
  for (const a of r.areas) {
    console.log(`    ${a.area.padEnd(26)} ${String(a.horasQueDetienen).padStart(6)} h  →  $${a.perdida.toLocaleString("es-MX")}`);
  }
  console.log("");
}
main().finally(() => prisma.$disconnect());
