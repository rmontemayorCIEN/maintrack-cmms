/**
 * Mirar fotos de verdad: el ciclo completo contra el modelo.
 *
 * Cuesta centavos y llama a Anthropic, asi que hay que pedirla:
 *
 *   ./scripts/con-produccion.sh scripts/prueba-rondin-real.ts --cobrar
 *
 * ── Que se viene a medir, y por que este y no otro ──
 *
 * El unico modo de fallar que importa de esta funcion es que INVENTE: que
 * afirme una fuga donde hay una mancha vieja, o donde no hay nada. Si de eso
 * salieran solicitudes, el sistema se llenaria de trabajo que no existe, la
 * gente dejaria de creerle y entonces tampoco atenderia lo real.
 *
 * Asi que la prueba central es al reves de lo que uno esperaria: se le dan
 * imagenes SIN nada que reportar y se comprueba que no dice nada. Una lista
 * vacia es la respuesta correcta, y un modelo que se siente obligado a
 * encontrar algo es un modelo que hay que volver a calibrar antes de soltarlo.
 *
 * Lo otro que se cuida es que distinga las fotos entre si —que al hablar de la
 * parada 2 se refiera a la foto de la parada 2— porque de eso depende que el
 * hallazgo sea util para quien lo lee.
 */
import { deflateSync } from "node:zlib";
import { prisma } from "../lib/db";
import { revisarFotosDelRondin, MAXIMO_FOTOS } from "../lib/ia/rondin";
import { guardarArchivo } from "../lib/almacenamiento";
import { borrarEmpresaDesechable, crearEmpresaDesechable } from "./empresa-desechable";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

/** Un PNG de verdad, hecho a mano: sin dependencias y sin archivos de apoyo. */
function png(ancho: number, alto: number, pinta: (x: number, y: number) => [number, number, number]): Buffer {
  const crc = (b: Buffer) => {
    let c = ~0;
    for (const byte of b) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const trozo = (tipo: string, datos: Buffer) => {
    const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
    const suma = Buffer.alloc(4); suma.writeUInt32BE(crc(cuerpo));
    return Buffer.concat([largo, cuerpo, suma]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  const filas: Buffer[] = [];
  for (let y = 0; y < alto; y++) {
    const fila = Buffer.alloc(1 + ancho * 3);
    for (let x = 0; x < ancho; x++) {
      const [r, g, b] = pinta(x, y);
      fila[1 + x * 3] = r; fila[2 + x * 3] = g; fila[3 + x * 3] = b;
    }
    filas.push(fila);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", deflateSync(Buffer.concat(filas))),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

async function main() {
  if (!process.argv.includes("--cobrar")) {
    console.log("\n  Esta prueba llama al modelo con imágenes: cuesta unos centavos.");
    console.log("  Por eso no corre sola.\n");
    console.log("    ./scripts/con-produccion.sh scripts/prueba-rondin-real.ts --cobrar\n");
    return;
  }

  const creadas: string[] = [];

  try {
    const { org, sello } = await crearEmpresaDesechable("rreal-");
    creadas.push(org.id);
    const sitio = await prisma.site.create({ data: { organizationId: org.id, name: "Planta", code: "P1" } });
    const area = await prisma.location.create({ data: { organizationId: org.id, siteId: sitio.id, name: "Nave 1", code: "N1" } });
    const equipo = await prisma.asset.create({
      data: { organizationId: org.id, siteId: sitio.id, locationId: area.id, code: "BOM-9", name: "Bomba de proceso" },
    });
    const rondin = await prisma.rondin.create({
      data: { organizationId: org.id, numero: `RD-${sello}`, siteId: sitio.id, locationId: area.id, estado: "TERMINADO" },
    });

    /**
     * Dos imagenes lisas, sin nada que reportar.
     *
     * Un gris de taller y un beige de pared. No hay fugas, ni guardas, ni
     * obstrucciones: no hay NADA. Lo que se quiere ver es si el modelo lo dice
     * o si se inventa algo por no volver con las manos vacias.
     */
    const grises: Array<[string, Buffer]> = [
      ["gris", png(320, 240, () => [110, 112, 116])],
      ["beige", png(320, 240, () => [196, 188, 172])],
    ];

    let orden = 0;
    for (const [nombre, datos] of grises) {
      orden++;
      const parada = await prisma.rondinParada.create({
        data: {
          organizationId: org.id, rondinId: rondin.id, orden,
          assetId: orden === 1 ? equipo.id : null, locationId: area.id,
          comoSeIdentifico: orden === 1 ? "ELEGIDO" : "AREA",
          observacion: orden === 1 ? "Revisando la bomba" : "Pasillo lateral",
        },
      });
      const ruta = `org-${org.id}/rondines/${sello}-${nombre}.png`;
      await guardarArchivo(ruta, datos, "image/png");
      await prisma.attachment.create({
        data: {
          organizationId: org.id, rondinParadaId: parada.id, name: `${nombre}.png`,
          storagePath: ruta, mimeType: "image/png", kind: "PHOTO", size: datos.length,
        },
      });
    }

    console.log(`\nDos fotos sin nada que reportar (tope de ${MAXIMO_FOTOS} por recorrido)\n`);
    const r = await revisarFotosDelRondin(
      { id: org.id, plan: "ENTERPRISE", iaComplemento: true, iaExtra: 0 },
      { rondinId: rondin.id },
    );
    revisar("el modelo contestó y el esquema validó", r.ok, r.ok ? `${r.costoUsd.toFixed(4)} USD` : r.motivo);
    if (!r.ok) return;

    console.log(`  nota: ${r.nota}`);
    for (const h of r.hallazgos) console.log(`  hallazgo: [${h.certeza}] parada ${h.parada} · ${h.titulo} · ve: ${h.baseVisual}`);
    for (const f of r.noSirven) console.log(`  no sirve: parada ${f.parada} · ${f.porQue}`);

    /**
     * LO QUE DE VERDAD SE VIENE A MEDIR.
     *
     * Con imagenes lisas no hay nada que encontrar. Lo aceptable es una lista
     * vacia, o a lo sumo que diga que las fotos no sirven —que es cierto—.
     * Cualquier hallazgo SEGURO aqui es invencion pura, y significa que el
     * prompt no esta frenando lo que tiene que frenar.
     */
    revisar("no inventa hallazgos donde no hay nada",
      r.hallazgos.length === 0, r.hallazgos.map((h) => h.titulo).join(" | "));
    revisar("   y si dice algo, al menos no lo da por seguro",
      !r.hallazgos.some((h) => h.certeza === "SEGURO"),
      r.hallazgos.filter((h) => h.certeza === "SEGURO").map((h) => h.titulo).join(" | "));
    revisar("prefiere decir que la foto no sirve antes que forzar una conclusión",
      r.noSirven.length > 0 || r.hallazgos.length === 0, { noSirven: r.noSirven.length });

    // Si dijo algo, que sea de una parada que existe: de eso depende que el
    // hallazgo se pueda ir a mirar.
    const paradasValidas = [0, 1, 2];
    revisar("todo lo que dice lo atribuye a una parada que existe",
      [...r.hallazgos.map((h) => h.parada), ...r.noSirven.map((f) => f.parada)].every((n) => paradasValidas.includes(n)),
      [...r.hallazgos.map((h) => h.parada), ...r.noSirven.map((f) => f.parada)].join(","));
  } finally {
    for (const id of creadas) if (!(await borrarEmpresaDesechable(id))) fallas++;
  }

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
