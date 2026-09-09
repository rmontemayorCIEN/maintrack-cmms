/**
 * Arma las ocho lineas de MINERALES METALICOS Y PRECIOSOS.
 *
 *   ./scripts/con-produccion.sh scripts/lineas-minerales.ts              # ensayo
 *   ./scripts/con-produccion.sh scripts/lineas-minerales.ts -- --aplicar # escribe
 *
 * ── Por que estas agrupaciones ──
 *
 * Es un concentrador de flotacion y sus AREAS ya son el proceso, asi que
 * copiarlas como lineas no aportaria nada: el sistema ya sabe agrupar por
 * ubicacion. Lo que las areas esconden y las claves si dicen es que la planta
 * separa TRES METALES, y que celdas, espesadores y filtros estan divididos por
 * metal. Agrupar por circuito cruza flotacion, espesamiento y filtrado, que es
 * como piensa un jefe de planta cuando dice "se me cayo el circuito de zinc".
 *
 * ── Cuidados ──
 *
 * Las claves de esta cuenta tienen trampas reales y por eso se casan EXACTAS,
 * nunca por prefijo: `GRU 001` lleva espacio donde las demas usan guion,
 * `MOL-BBA--001` lleva doble guion, y `BBAPCS-01` lleva dos digitos donde las
 * otras llevan tres. Una clave que no case DETIENE el script en vez de
 * saltarsela: una linea a la que le falta un equipo en silencio es peor que no
 * tener la linea.
 *
 * El acomodo del lienzo sigue el flujo del proceso —de izquierda a derecha, de
 * arriba hacia abajo— para que al abrirlo se reconozca la planta sin tener que
 * acomodarla primero. No se guarda ninguna secuencia: el orden queda dibujado.
 */
import { prisma } from "../lib/db";
import { REJILLA } from "../lib/croquis";

const APLICAR = process.argv.includes("--aplicar");

/** [clave, x, y, ancho, alto] */
type Caja = [string, number, number, number, number];

const LINEAS: Array<{
  code: string;
  name: string;
  descripcion: string;
  equipos: Caja[];
}> = [
  {
    code: "CABEZA",
    name: "Cabeza de planta",
    descripcion:
      "Del mineral crudo a la pulpa clasificada. Si esto para, paran los tres circuitos.",
    equipos: [
      ["TOL-001-TRI", 0, 0, 2, 2], ["TRI-QUEB-001", 2, 0, 2, 2], ["TRI-QUEB-002", 4, 0, 2, 2],
      ["TRI-QUEB-003", 6, 0, 2, 2], ["TRI-CRI-001", 8, 0, 2, 2], ["TRI-CRI-002", 10, 0, 2, 2],
      ["TRI-CRI-003", 0, 2, 2, 2], ["TRI-BAN-001", 2, 2, 2, 2], ["TRI-BAN-002", 4, 2, 2, 2],
      ["TRI-BAN-003", 6, 2, 2, 2], ["TRI-BAN-004", 8, 2, 2, 2], ["TRI-BAN-005", 10, 2, 2, 2],
      ["TRI-BAN-006", 0, 4, 2, 2], ["MOL-001", 2, 4, 2, 2], ["MOL-002", 4, 4, 2, 2],
      ["MOL-CIC-001", 6, 4, 2, 2], ["MOL-CIC-002", 8, 4, 2, 2], ["MOL-BBA--001", 10, 4, 2, 2],
      ["MOL-BBA--002", 0, 6, 2, 2], ["MOL-BBA--003", 2, 6, 2, 2], ["MOL-BBA--004", 4, 6, 2, 2],
    ],
  },
  {
    code: "CIRC-CU",
    name: "Circuito de cobre",
    descripcion: "Flotación, espesado y filtrado del concentrado de cobre.",
    equipos: [
      ["FLOCU-CEL-001", 0, 0, 3, 4], ["FLOCU-CEL-002", 3, 0, 3, 4],
      ["FLOCU-CEL-003", 6, 0, 3, 4], ["FLOCU-CEL-004", 9, 0, 3, 4],
      ["BBAESPCU-001", 0, 4, 3, 4], ["BBAESPCU-002", 3, 4, 3, 4],
      ["FILDSCCU-001", 6, 4, 3, 4], ["FILDSCCU-002", 9, 4, 3, 4],
    ],
  },
  {
    code: "CIRC-PB",
    name: "Circuito de plomo",
    descripcion: "El circuito más grande en celdas: seis contra cuatro de los otros dos.",
    equipos: [
      ["FLOPB-CEL-001", 0, 0, 2, 4], ["FLOPB-CEL-002", 2, 0, 2, 4], ["FLOPB-CEL-003", 4, 0, 2, 4],
      ["FLOPB-CEL-004", 6, 0, 2, 4], ["FLOPB-CEL-005", 8, 0, 2, 4], ["FLOPB-CEL-006", 10, 0, 2, 4],
      ["BBAESPPB-001", 0, 4, 3, 4], ["BBAESPPB-002", 3, 4, 3, 4],
      ["ESPPB-003", 6, 4, 3, 4], ["FILTAM-001", 9, 4, 3, 4],
    ],
  },
  {
    code: "CIRC-ZN",
    name: "Circuito de zinc",
    descripcion: "Único con dos espesadores propios. Comparte el filtro de tambor con plomo.",
    equipos: [
      ["FLOZN-CEL-001", 0, 0, 3, 3], ["FLOZN-CEL-002", 3, 0, 3, 3],
      ["FLOZN-CEL-003", 6, 0, 3, 3], ["FLOZN-CEL-004", 9, 0, 3, 3],
      ["BBAESPZN-001", 0, 3, 2, 3], ["BBAESPZN-002", 2, 3, 2, 3],
      ["ESPZN-001", 4, 3, 3, 3], ["ESPZN-002", 7, 3, 3, 3], ["FILDSCZN-001", 10, 3, 2, 3],
      ["FILDSCZN-002", 0, 6, 6, 2], ["FILTAM-001", 6, 6, 6, 2],
    ],
  },
  {
    code: "JALES",
    name: "Manejo de jales",
    descripcion:
      "Lo que sale de los tres circuitos, más el agua que se recupera de la presa y regresa al proceso.",
    equipos: [
      ["JALCIC-001", 0, 0, 2, 4], ["JALCIC-002", 2, 0, 2, 4], ["JALCIC-003", 4, 0, 2, 4],
      ["JALCIC-004", 6, 0, 2, 4], ["JALCIC-005", 8, 0, 2, 4], ["JALBBA-001", 10, 0, 2, 4],
      ["JALBBA-002", 0, 4, 4, 4], ["JALBBARE-001", 4, 4, 4, 4], ["JALBBARE-002", 8, 4, 4, 4],
    ],
  },
  {
    code: "AGUA",
    name: "Agua de proceso",
    descripcion: "Del pozo al tanque y de ahí al proceso. Sin agua no hay molienda ni flotación.",
    equipos: [
      ["BBAPOZO-001", 0, 0, 4, 4], ["TQ-001", 4, 0, 4, 4], ["BBAPCS-01", 8, 0, 4, 4],
      ["BBAPOZO-002", 0, 4, 4, 4], ["TQ-002", 4, 4, 4, 4], ["BBAPCS-02", 8, 4, 4, 4],
    ],
  },
  {
    code: "AIRE",
    name: "Aire y vacío",
    descripcion: "Los cuatro compresores y la bomba de vacío que hacen trabajar a los filtros.",
    equipos: [
      ["FILCOM-001", 0, 0, 3, 4], ["FILCOM-002", 3, 0, 3, 4],
      ["FILCOM-003", 6, 0, 3, 4], ["FILCOM-004", 9, 0, 3, 4],
      ["FILBBAVAC-001", 0, 4, 12, 4],
    ],
  },
  {
    code: "ENERGIA",
    name: "Energía",
    descripcion: "Acometida y control de motores. Alimenta absolutamente todo.",
    equipos: [
      ["SUBEL-001", 0, 0, 4, 8], ["CCM-001", 4, 0, 4, 8], ["CCM-002", 8, 0, 4, 8],
    ],
  },
];

/** Los que van solos a proposito, no los que nadie ha acomodado. */
const INDEPENDIENTES = ["GRU 001", "MONT-001"];

async function main() {
  const org = await prisma.organization.findFirst({
    where: { name: { contains: "MINERALES" } },
    select: { id: true, name: true },
  });
  if (!org) throw new Error("No se encontro la organizacion MINERALES.");

  console.log(`\n${org.name}`);
  console.log(APLICAR ? "MODO: aplicar (va a escribir)\n" : "MODO: ensayo (no escribe nada)\n");

  const yaHay = await prisma.conjunto.count({ where: { organizationId: org.id } });
  if (yaHay) {
    console.log(`Ya hay ${yaHay} lineas en esta cuenta. No se toca nada.`);
    console.log("Un acomodo hecho por alguien es suyo; si hay que rehacerlo, se decide antes.\n");
    return;
  }

  const equipos = await prisma.asset.findMany({
    where: { organizationId: org.id, active: true },
    select: { id: true, code: true, name: true },
  });
  const porCodigo = new Map(equipos.map((e) => [e.code, e]));

  // Que ninguna clave se pierda en silencio. Una linea a la que le falta un
  // equipo sin que nadie se entere es peor que no tener la linea.
  const pedidas = [...LINEAS.flatMap((l) => l.equipos.map(([c]) => c)), ...INDEPENDIENTES];
  const huerfanas = [...new Set(pedidas)].filter((c) => !porCodigo.has(c));
  if (huerfanas.length) {
    console.log("ERROR: estas claves no existen en la cuenta. No se escribe nada:");
    for (const c of huerfanas) console.log(`   ${c}`);
    process.exitCode = 1;
    return;
  }

  // Que ninguna caja se salga de la rejilla ni se encime con otra.
  for (const l of LINEAS) {
    for (const [code, x, y, ancho, alto] of l.equipos) {
      if (x + ancho > REJILLA.columnas || y + alto > REJILLA.filas) {
        throw new Error(`${l.code}: ${code} se sale de la rejilla (${x},${y} ${ancho}x${alto})`);
      }
    }
    for (let i = 0; i < l.equipos.length; i += 1) {
      for (let j = i + 1; j < l.equipos.length; j += 1) {
        const [ca, xa, ya, wa, ha] = l.equipos[i];
        const [cb, xb, yb, wb, hb] = l.equipos[j];
        if (xa < xb + wb && xb < xa + wa && ya < yb + hb && yb < ya + ha) {
          throw new Error(`${l.code}: ${ca} y ${cb} se enciman en el lienzo`);
        }
      }
    }
  }

  const usados = new Set<string>();
  let membresias = 0;
  for (const l of LINEAS) {
    console.log(`  ${l.code.padEnd(9)} ${l.name.padEnd(20)} ${String(l.equipos.length).padStart(2)} equipos`);
    for (const [code] of l.equipos) { usados.add(code); membresias += 1; }
    if (APLICAR) {
      await prisma.conjunto.create({
        data: {
          organizationId: org.id, code: l.code, name: l.name,
          descripcion: l.descripcion, origen: "MANUAL",
          equipos: {
            create: l.equipos.map(([code, x, y, ancho, alto]) => ({
              organizationId: org.id,
              assetId: (porCodigo.get(code) as { id: string }).id,
              planoX: x, planoY: y, planoAncho: ancho, planoAlto: alto,
            })),
          },
        },
      });
    }
  }

  console.log(`\n  ${membresias} membresias · ${usados.size} equipos distintos`);
  const repetidos = [...usados].filter(
    (c) => LINEAS.filter((l) => l.equipos.some(([x]) => x === c)).length > 1,
  );
  for (const c of repetidos) {
    const dondeEsta = LINEAS.filter((l) => l.equipos.some(([x]) => x === c)).map((l) => l.code);
    console.log(`  ${c} va en ${dondeEsta.length} lineas (${dondeEsta.join(", ")}), con lugar propio en cada lienzo`);
  }

  console.log(`\n  Independientes (van solos a proposito): ${INDEPENDIENTES.join(", ")}`);
  if (APLICAR) {
    await prisma.asset.updateMany({
      where: { organizationId: org.id, code: { in: INDEPENDIENTES } },
      data: { independiente: true },
    });
  }

  const sueltos = equipos.filter((e) => !usados.has(e.code) && !INDEPENDIENTES.includes(e.code));
  console.log(`  Sin acomodar tras esto: ${sueltos.length}${sueltos.length ? ` — ${sueltos.map((e) => e.code).join(", ")}` : ""}`);
  console.log(`  Total de equipos en la cuenta: ${equipos.length}`);

  if (!APLICAR) {
    console.log("\nEnsayo. Para escribir, agregue -- --aplicar\n");
    return;
  }

  // Verificacion despues de escribir: no basta con que no truene.
  const creadas = await prisma.conjunto.findMany({
    where: { organizationId: org.id },
    select: { code: true, name: true, _count: { select: { equipos: true } } },
    orderBy: { code: "asc" },
  });
  const enAlguna = await prisma.conjuntoAsset.count({ where: { organizationId: org.id } });
  const independientes = await prisma.asset.count({
    where: { organizationId: org.id, independiente: true },
  });
  console.log("\nVerificacion contra la cuenta:");
  for (const c of creadas) console.log(`  ${c.code.padEnd(9)} ${c.name.padEnd(20)} ${c._count.equipos} equipos`);
  console.log(`  ${enAlguna} membresias · ${independientes} independientes`);
  console.log(
    enAlguna === membresias && independientes === INDEPENDIENTES.length
      ? "  Coincide con lo planeado.\n"
      : "  NO COINCIDE con lo planeado. Revise antes de seguir.\n",
  );
}

main().finally(() => prisma.$disconnect());
