/**
 * Lectura de un documento de norma: CICLO REAL contra el modelo.
 *
 *   ./scripts/con-produccion.sh scripts/prueba-norma-documento-real.ts
 *
 * Cuesta centavos y no va en el despliegue. Existe porque lo unico que
 * importa de esta funcion no se puede probar en seco: que CITE lo que propone
 * y que se niegue cuando el documento no es la norma.
 *
 * Se le dan dos PDF armados aqui mismo:
 *
 *  1. Uno que parece una norma, con tres exigencias escritas. Se revisa que
 *     proponga obligaciones y que cada cita este LITERALMENTE en el texto que
 *     se le dio. Una cita que no aparece en el documento es una cita
 *     inventada, que es justo lo que esta funcion existe para no hacer.
 *  2. Uno que NO es una norma —una nota de remision—. Se revisa que lo diga y
 *     que no proponga nada. Forzar una lista ahi seria peor que no contestar.
 */
import { prisma } from "../lib/db";
import { leerDocumentoDeNorma } from "../lib/ia/norma-documento";
import { construirRuta, guardarArchivo } from "../lib/almacenamiento";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 240)}` : ""}`);
}

/** Un PDF de una pagina con esos renglones. Valido, con su xref. */
function pdfConTexto(lineas: string[]): Buffer {
  const escapar = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const cuerpo = lineas.map((l, i) => `BT /F1 11 Tf 40 ${740 - i * 18} Td (${escapar(l)}) Tj ET`).join("\n");
  const objetos = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>",
    `<</Length ${cuerpo.length}>>\nstream\n${cuerpo}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let pdf = "%PDF-1.4\n";
  const posiciones: number[] = [];
  objetos.forEach((o, i) => {
    posiciones.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const p of posiciones) pdf += `${String(p).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objetos.length + 1}/Root 1 0 R>>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const NORMA = [
  "NOM-PRUEBA-001-XYZ-2024",
  "Condiciones de seguridad de los recipientes sujetos a presion.",
  "",
  "5. Obligaciones del patron",
  "",
  "5.1 Realizar la prueba hidrostatica de cada recipiente cada cinco anos y",
  "conservar el dictamen correspondiente.",
  "",
  "5.2 Contar con el dictamen vigente emitido por una unidad de verificacion",
  "acreditada.",
  "",
  "5.3 Registrar diariamente la presion de operacion en la bitacora del equipo.",
];

const NO_ES_NORMA = [
  "FERRETERIA EL TORNILLO SA DE CV",
  "Nota de remision 4471",
  "",
  "2 piezas  Valvula de globo 2 pulgadas    $1,240.00",
  "1 pieza   Manometro 0-10 bar             $  380.00",
  "",
  "Total: $1,620.00. Gracias por su compra.",
];

async function main() {
  console.log("\nLectura de documentos de norma, contra el modelo de verdad\n");

  const sello = `norma-doc-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", iaComplemento: true, cumplimientoNormas: true },
  });
  const norma = await prisma.normaAdoptada.create({
    data: { organizationId: org.id, clave: "NOM-PRUEBA-001-XYZ", titulo: "Recipientes sujetos a presión", origen: "PROPIA" },
  });

  async function colgar(nombre: string, lineas: string[]) {
    const pdf = pdfConTexto(lineas);
    const ruta = construirRuta(org.id, "normas", nombre);
    await guardarArchivo(ruta, pdf, "application/pdf");
    return prisma.attachment.create({
      data: {
        organizationId: org.id, normaId: norma.id, name: nombre, storagePath: ruta,
        mimeType: "application/pdf", kind: "DOCUMENT", size: pdf.length,
      },
      select: { id: true },
    });
  }

  const ctx = { id: org.id, plan: "ENTERPRISE", iaComplemento: true, iaExtra: 0 };

  try {
    console.log("1. Un documento que SI es la norma\n");
    const a = await colgar("norma.pdf", NORMA);
    const r = await leerDocumentoDeNorma(ctx, { adjuntoId: a.id });
    if (!r.ok) {
      revisar("la lectura responde", false, r.motivo);
    } else {
      const l = r.lectura;
      revisar("lo reconoce como norma", l.esLaNorma, l.queEs);
      revisar("propone al menos dos obligaciones", l.obligaciones.length >= 2, l.obligaciones.map((o) => o.titulo));

      // LA revision que importa: cada cita tiene que estar en el documento.
      const texto = NORMA.join(" ").replace(/\s+/g, " ").toLowerCase();
      const normalizar = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
      const inventadas = l.obligaciones.filter((o) => {
        const c = normalizar(o.cita);
        // Se compara por un fragmento largo: el modelo puede recortar o unir
        // renglones, y eso no es inventar. Veinticinco caracteres seguidos que
        // no aparecen en el documento, si.
        return !texto.includes(c.slice(0, 25));
      });
      revisar("NINGUNA cita esta inventada: todas aparecen en el documento",
        inventadas.length === 0, inventadas.map((o) => o.cita));

      const conFrecuencia = l.obligaciones.filter((o) => o.cadaMeses !== null);
      revisar("si pone frecuencia, es de las que el documento SI fija",
        conFrecuencia.every((o) => /cinco anos|cada cinco|diariamente|diaria/.test(normalizar(o.cita)) || o.cadaMeses === 60 || o.cadaMeses === 1),
        conFrecuencia.map((o) => ({ titulo: o.titulo, cadaMeses: o.cadaMeses })));

      console.log(`\n       (costo de esta lectura: ${r.costoUsd.toFixed(4)} USD)\n`);
    }

    console.log("2. Un documento que NO es la norma\n");
    const b = await colgar("remision.pdf", NO_ES_NORMA);
    const r2 = await leerDocumentoDeNorma(ctx, { adjuntoId: b.id });
    if (!r2.ok) {
      revisar("la lectura responde", false, r2.motivo);
    } else {
      revisar("dice que NO es la norma", r2.lectura.esLaNorma === false, r2.lectura.queEs);
      revisar("y no propone ninguna obligacion", r2.lectura.obligaciones.length === 0,
        r2.lectura.obligaciones.map((o) => o.titulo));
    }
  } finally {
    await prisma.attachment.deleteMany({ where: { organizationId: org.id } });
    await prisma.obligacionAdoptada.deleteMany({ where: { normaId: norma.id } });
    await prisma.normaAdoptada.deleteMany({ where: { organizationId: org.id } });
    await prisma.aiUsage.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
  }
}

main()
  .catch((e) => { console.error(e); fallos++; })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(fallos ? `\n  ${fallos} revision(es) fallaron\n` : "\n  ✓ Todo bien\n");
    process.exit(fallos ? 1 : 0);
  });
