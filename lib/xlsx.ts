/**
 * Leer y escribir archivos de Excel (.xlsx) sin dependencias.
 *
 * Un .xlsx es un ZIP con XML adentro. Node ya trae lo necesario —descomprimir
 * (`inflateRawSync`) y el CRC del ZIP (`crc32`)—, así que no hace falta sumar
 * una biblioteca al proyecto para algo que se usa en la importación.
 *
 * Lo que devuelve la lectura es EXACTAMENTE lo mismo que devuelve `leerCsv`:
 * encabezados y renglones de texto. De ahí en adelante un Excel y un CSV
 * pasan por las mismas validaciones, la misma vista previa, la misma
 * detección de duplicados y el mismo lote. No hay un segundo camino.
 *
 * Tres cuidados:
 *
 *  - **Fechas.** Excel guarda una fecha como número de días desde 1900. Si la
 *    celda tiene formato de fecha, se convierte a «dd/mm/aaaa», que es lo que
 *    la validación ya sabe leer; sin formato, se queda como número.
 *  - **Sin analizador XML.** Se leen las celdas con expresiones sencillas, no
 *    con un analizador que resuelva entidades externas: un archivo malicioso
 *    no puede pedirle al servidor que lea otros archivos.
 *  - **Tope de tamaño descomprimido.** Un ZIP de 1 MB puede inflarse a varios
 *    GB. Cada parte se descomprime con un límite.
 */
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import type { FilaCsv } from "./csv";

export class ErrorDeXlsx extends Error {}

const MAXIMO_DESCOMPRIMIDO = 60 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────── ZIP ───

function leerZip(buf: Buffer): Map<string, Buffer> {
  // El directorio central se encuentra desde el final del archivo.
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new ErrorDeXlsx("El archivo no es un Excel válido (.xlsx). Si lo guardó como .xls antiguo, ábralo y guárdelo como «Libro de Excel (.xlsx)» o como CSV.");

  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const archivos = new Map<string, Buffer>();
  let usado = 0;

  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ErrorDeXlsx("El archivo de Excel está dañado.");
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const largoNombre = buf.readUInt16LE(p + 28);
    const largoExtra = buf.readUInt16LE(p + 30);
    const largoComentario = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + largoNombre).toString("utf8");
    p += 46 + largoNombre + largoExtra + largoComentario;

    // Solo interesan las partes de datos; se ignora todo lo demás (imágenes, macros).
    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(nombre)) continue;

    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const datos = buf.subarray(inicio, inicio + comprimido);
    let contenido: Buffer;
    if (metodo === 0) contenido = Buffer.from(datos);
    else if (metodo === 8) contenido = inflateRawSync(datos, { maxOutputLength: MAXIMO_DESCOMPRIMIDO - usado });
    else throw new ErrorDeXlsx("El archivo de Excel usa una compresión que no se reconoce.");
    usado += contenido.length;
    if (usado > MAXIMO_DESCOMPRIMIDO) throw new ErrorDeXlsx("El archivo de Excel es demasiado grande. Divídalo en partes.");
    archivos.set(nombre, contenido);
  }
  return archivos;
}

function escribirZip(archivos: Array<[string, string]>): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let desplazamiento = 0;
  for (const [nombre, texto] of archivos) {
    const datos = Buffer.from(texto, "utf8");
    const comprimido = deflateRawSync(datos);
    const nombreBuf = Buffer.from(nombre, "utf8");
    const crc = crc32(datos) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    locales.push(local, nombreBuf, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombreBuf.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    centrales.push(central, nombreBuf);

    desplazamiento += 30 + nombreBuf.length + comprimido.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(dir.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, dir, fin]);
}

// ─────────────────────────────────────────────────────────────── XML ───

const desescapar = (s: string) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    const mapa: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
    if (mapa[e.toLowerCase()]) return mapa[e.toLowerCase()];
    const codigo = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : "";
  });

const escapar = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Todo el texto de los <t> de un fragmento: una celda puede venir en tramos con formato. */
const textoDe = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => desescapar(m[1])).join("");

/** «AB12» → 27 (columna, desde 0). */
function columnaDe(ref: string) {
  const letras = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const l of letras) n = n * 26 + (l.charCodeAt(0) - 64);
  return n - 1;
}

/** Los formatos de fecha que trae Excel de fábrica. */
const FORMATOS_FECHA = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function estilosDeFecha(styles: string | undefined): Set<number> {
  if (!styles) return new Set();
  const propios = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    propios.set(Number(m[1]), desescapar(m[2]));
  }
  const esFecha = (id: number) => {
    if (FORMATOS_FECHA.has(id)) return true;
    const codigo = propios.get(id);
    // Un formato propio es de fecha si trae día/mes/año fuera de textos entre comillas.
    return Boolean(codigo && /[dmy]/i.test(codigo.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "")) && !/0\.0|#/.test(codigo));
  };
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  const salida = new Set<number>();
  [...xfs.matchAll(/<xf\s[^>]*?(?:\/>|>)/g)].forEach((m, i) => {
    const id = Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] ?? 0);
    if (esFecha(id)) salida.add(i);
  });
  return salida;
}

/** Número de serie de Excel → «dd/mm/aaaa». Excel cuenta desde el 30/12/1899. */
function fechaDeSerie(serie: number) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serie * 86_400_000));
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

// ────────────────────────────────────────────────────────── Lectura ───

/**
 * La primera hoja del libro, como encabezados y renglones de texto.
 *
 * Se toma la primera hoja porque es la que llena quien usa la plantilla; si el
 * libro tiene más, se ignoran.
 */
export function leerXlsx(buf: Buffer): { encabezados: string[]; filas: FilaCsv[] } {
  const zip = leerZip(buf);
  const libro = zip.get("xl/workbook.xml")?.toString("utf8");
  const rels = zip.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  if (!libro || !rels) throw new ErrorDeXlsx("El archivo de Excel no trae hojas que leer.");

  const primeraHoja = /<sheet\s[^>]*r:id="([^"]+)"/.exec(libro)?.[1];
  const destino = primeraHoja
    ? new RegExp(`<Relationship\\s[^>]*Id="${primeraHoja}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
      ?? new RegExp(`<Relationship\\s[^>]*Target="([^"]+)"[^>]*Id="${primeraHoja}"`).exec(rels)?.[1]
    : undefined;
  const ruta = destino ? `xl/${destino.replace(/^\/?xl\//, "").replace(/^\//, "")}` : "xl/worksheets/sheet1.xml";
  const hoja = zip.get(ruta)?.toString("utf8");
  if (!hoja) throw new ErrorDeXlsx("No se encontró la primera hoja del libro.");

  const compartidos = [...(zip.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => textoDe(m[1]));
  const deFecha = estilosDeFecha(zip.get("xl/styles.xml")?.toString("utf8"));

  const renglones: string[][] = [];
  for (const r of hoja.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const valores: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = c[1];
      const interior = c[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(atributos)?.[1];
      const tipo = /\bt="([^"]+)"/.exec(atributos)?.[1];
      const estilo = Number(/\bs="(\d+)"/.exec(atributos)?.[1] ?? -1);
      const v = /<v>([\s\S]*?)<\/v>/.exec(interior)?.[1];
      let valor = "";
      if (tipo === "s" && v !== undefined) valor = compartidos[Number(v)] ?? "";
      else if (tipo === "inlineStr") valor = textoDe(interior);
      else if (tipo === "b") valor = v === "1" ? "SI" : "NO";
      else if (tipo === "str" || tipo === "e") valor = v !== undefined ? desescapar(v) : "";
      else if (v !== undefined) {
        const n = Number(v);
        valor = Number.isFinite(n) && deFecha.has(estilo) ? fechaDeSerie(n) : v;
      }
      const col = ref ? columnaDe(ref) : valores.length;
      while (valores.length < col) valores.push("");
      valores[col] = valor.trim();
    }
    renglones.push(valores);
  }

  const noVacios = renglones.filter((r) => r.some((v) => v !== ""));
  if (!noVacios.length) return { encabezados: [], filas: [] };
  const encabezados = noVacios[0].map((h) => h.trim());
  const filas: FilaCsv[] = noVacios.slice(1).map((r) =>
    Object.fromEntries(encabezados.map((h, i) => [h, r[i] ?? ""])),
  );
  return { encabezados, filas };
}

// ───────────────────────────────────────────────────────── Escritura ───

/**
 * Una plantilla .xlsx: encabezados en negritas y un renglón de ejemplo, todo
 * como texto para que Excel no convierta «15/09/2026» ni «0012» por su cuenta.
 */
export function escribirXlsx(columnas: string[], filas: string[][]): Buffer {
  const letra = (i: number) => {
    let s = "";
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const celda = (valor: string, fila: number, col: number, estilo: number) =>
    `<c r="${letra(col)}${fila}" t="inlineStr" s="${estilo}"><is><t xml:space="preserve">${escapar(valor)}</t></is></c>`;
  const renglon = (valores: string[], fila: number, estilo: number) =>
    `<row r="${fila}">${valores.map((v, i) => celda(v, fila, i, estilo)).join("")}</row>`;

  const hoja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(12, c.length + 4)}" customWidth="1"/>`).join("")}</cols><sheetData>${renglon(columnas, 1, 1)}${filas.map((f, i) => renglon(f, i + 2, 2)).join("")}</sheetData></worksheet>`;

  return escribirZip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`],
    ["xl/worksheets/sheet1.xml", hoja],
  ]);
}
