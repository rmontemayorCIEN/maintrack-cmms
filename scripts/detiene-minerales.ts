/**
 * Marca los cuatro equipos de MINERALES cuyo paro SI detiene la produccion.
 *
 *   ./scripts/con-produccion.sh scripts/detiene-minerales.ts            # ensayo
 *   ./scripts/con-produccion.sh scripts/detiene-minerales.ts --aplicar  # escribe
 *
 * ── Por que solo cuatro de setenta y cuatro ──
 *
 * `detieneLinea` es lo que enciende todo el calculo de costo de paro: solo se
 * cobra el paro de los equipos marcados en `true`. Definirlo mal no truena
 * nada, y por eso es peligroso.
 *
 * En esta cuenta no hay UN solo dato que permita distinguir un equipo de
 * respaldo de uno en operacion: cero descripciones, cero jerarquia, cero
 * especificaciones, y los 74 en criticidad B. `BBAESPCU-001` y `BBAESPCU-002`
 * se llaman palabra por palabra igual. Si son operacion y respaldo, las dos
 * van en "no"; si las dos operan, las dos van en "si". Es el dato OPUESTO
 * segun cual sea, y el patron -001/-002 se repite en once grupos.
 *
 * Estos cuatro se marcan porque son UNICOS en el catalogo y no existe ruta
 * alterna posible. Eso si lo dicen los datos:
 *
 *   - la unica tolva de recepcion
 *   - la unica quebradora primaria (las de cono no reciben mineral de mina)
 *   - el unico transformador de potencia
 *   - la unica bomba de vacio, sin la cual no filtra ningun filtro de discos
 *
 * ── Por que los otros setenta se quedan SIN DEFINIR ──
 *
 * El campo tiene tres estados a proposito. Sin definir no se cobra pero SE
 * CUENTA COMO PENDIENTE: la pantalla de paros dice cuantos faltan y presenta
 * el total como "al menos $X". La carencia se ve.
 *
 * Marcarlos en "no" por comodidad se ve resuelto: salen del costo para
 * siempre y nadie vuelve a revisarlos. Si la suposicion estuvo mal, la planta
 * subestima sus perdidas sin un solo indicio de por que.
 *
 * ── Nota de trazabilidad ──
 *
 * No se escribe bitacora de auditoria porque exigiria atribuirle el cambio a
 * una persona de esa empresa que no lo hizo. El cambio queda aqui, con su
 * razon, y se reporta a Rafael.
 */
import { prisma } from "../lib/db";

const APLICAR = process.argv.includes("--aplicar");

const DETIENEN: Array<{ code: string; porque: string }> = [
  { code: "TOL-001-TRI", porque: "Unica tolva de recepcion: sin ella no entra mineral." },
  { code: "TRI-QUEB-001", porque: "Unica quebradora primaria; las de cono no reciben mineral de mina." },
  { code: "SUBEL-001", porque: "Unico transformador de potencia: sin el no hay energia para nada." },
  { code: "FILBBAVAC-001", porque: "Unica bomba de vacio: sin vacio no filtra ningun filtro de discos." },
];

async function main() {
  const org = await prisma.organization.findFirst({
    where: { name: { contains: "MINERALES" } },
    select: { id: true, name: true },
  });
  if (!org) throw new Error("No se encontro la organizacion MINERALES.");

  console.log(`\n${org.name}`);
  console.log(APLICAR ? "MODO: aplicar (va a escribir)\n" : "MODO: ensayo (no escribe nada)\n");

  const equipos = await prisma.asset.findMany({
    where: { organizationId: org.id, active: true },
    select: { id: true, code: true, name: true, detieneLinea: true },
  });
  const porCodigo = new Map(equipos.map((e) => [e.code, e]));

  // Una clave que no case DETIENE el script. Marcar tres de cuatro y no
  // enterarse es justo la falla callada de la que se trata todo esto.
  const huerfanas = DETIENEN.filter((d) => !porCodigo.has(d.code)).map((d) => d.code);
  if (huerfanas.length) {
    console.log("ERROR: estas claves no existen. No se escribe nada:");
    for (const c of huerfanas) console.log(`   ${c}`);
    process.exitCode = 1;
    return;
  }

  // Si alguien ya lo definio, no se le pasa por encima.
  const yaDefinidos = DETIENEN
    .map((d) => porCodigo.get(d.code))
    .filter((e) => e && e.detieneLinea !== null);
  if (yaDefinidos.length) {
    console.log("Estos ya tenian el campo definido y NO se tocan:");
    for (const e of yaDefinidos) console.log(`   ${e!.code} → ${e!.detieneLinea}`);
    console.log("");
  }

  const porMarcar = DETIENEN.filter((d) => porCodigo.get(d.code)?.detieneLinea === null);
  console.log(`Se marcan como que SI detienen la produccion (${porMarcar.length}):`);
  for (const d of porMarcar) {
    console.log(`   ${d.code.padEnd(14)} ${porCodigo.get(d.code)!.name}`);
    console.log(`   ${"".padEnd(14)} ${d.porque}`);
  }

  const sinDefinir = equipos.filter((e) => e.detieneLinea === null).length;
  console.log(`\nQuedan sin definir: ${sinDefinir - porMarcar.length} de ${equipos.length}`);
  console.log("Sin definir NO se cobra, pero se cuenta como pendiente y se ve en la pantalla");
  console.log("de paros. Es a proposito: es honesto, y un \"no\" de mas se esconderia para siempre.");

  if (!APLICAR) {
    console.log("\nEnsayo. Para escribir, agregue --aplicar\n");
    return;
  }

  await prisma.asset.updateMany({
    where: { organizationId: org.id, code: { in: porMarcar.map((d) => d.code) }, detieneLinea: null },
    data: { detieneLinea: true },
  });

  // Verificacion contra la cuenta: no basta con que no truene.
  const despues = await prisma.asset.findMany({
    where: { organizationId: org.id, active: true },
    select: { code: true, detieneLinea: true },
  });
  const enSi = despues.filter((e) => e.detieneLinea === true);
  const enNo = despues.filter((e) => e.detieneLinea === false).length;
  const enNulo = despues.filter((e) => e.detieneLinea === null).length;

  console.log("\nVerificacion contra la cuenta:");
  console.log(`   Si detienen:  ${enSi.length} — ${enSi.map((e) => e.code).join(", ")}`);
  console.log(`   No detienen:  ${enNo}`);
  console.log(`   Sin definir:  ${enNulo}`);
  const esperado = DETIENEN.length;
  console.log(
    enSi.length === esperado && enSi.every((e) => DETIENEN.some((d) => d.code === e.code))
      ? "   Coincide con lo planeado.\n"
      : "   NO COINCIDE con lo planeado. Revise antes de seguir.\n",
  );
}

main().finally(() => prisma.$disconnect());
