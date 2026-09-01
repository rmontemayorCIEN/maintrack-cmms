/**
 * Lector de CSV tolerante con lo que produce Excel en la practica.
 *
 * Contempla tres cosas que rompen a los lectores ingenuos y que aparecen
 * siempre en archivos reales de planta:
 *  - El separador puede ser coma o punto y coma. Excel en español exporta
 *    con punto y coma, y es el caso mas comun aqui.
 *  - El archivo puede empezar con BOM (marca de orden de bytes) invisible,
 *    que de otro modo se pega al nombre de la primera columna.
 *  - Los valores pueden traer comillas, comas dentro y saltos de linea.
 */

export type FilaCsv = Record<string, string>;

function detectarSeparador(primeraLinea: string): "," | ";" | "\t" {
  const fuera = (sep: string) => {
    let dentro = false, cuenta = 0;
    for (const ch of primeraLinea) {
      if (ch === '"') dentro = !dentro;
      else if (ch === sep && !dentro) cuenta++;
    }
    return cuenta;
  };
  const candidatos: Array<[",", number] | [";", number] | ["\t", number]> = [
    [",", fuera(",")],
    [";", fuera(";")],
    ["\t", fuera("\t")],
  ];
  candidatos.sort((a, b) => b[1] - a[1]);
  return candidatos[0][1] > 0 ? candidatos[0][0] : ",";
}

/** Divide respetando comillas dobles y comillas escapadas ("") */
function partirLinea(linea: string, sep: string): string[] {
  const campos: string[] = [];
  let actual = "";
  let dentro = false;

  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === '"') {
      if (dentro && linea[i + 1] === '"') { actual += '"'; i++; }
      else dentro = !dentro;
    } else if (ch === sep && !dentro) {
      campos.push(actual);
      actual = "";
    } else {
      actual += ch;
    }
  }
  campos.push(actual);
  return campos.map((c) => c.trim());
}

/** Une las lineas fisicas que pertenecen a un mismo registro (saltos entre comillas). */
function agruparLineas(texto: string): string[] {
  const salida: string[] = [];
  let buffer = "";
  let comillas = 0;

  for (const linea of texto.split(/\r?\n/)) {
    buffer = buffer ? `${buffer}\n${linea}` : linea;
    comillas += (linea.match(/"/g) ?? []).length;
    if (comillas % 2 === 0) {
      salida.push(buffer);
      buffer = "";
      comillas = 0;
    }
  }
  if (buffer) salida.push(buffer);
  return salida;
}

export function leerCsv(contenido: string): { encabezados: string[]; filas: FilaCsv[] } {
  const limpio = contenido.replace(/^﻿/, "").trim();
  if (!limpio) return { encabezados: [], filas: [] };

  const lineas = agruparLineas(limpio).filter((l) => l.trim() !== "");
  if (!lineas.length) return { encabezados: [], filas: [] };

  const sep = detectarSeparador(lineas[0]);
  const encabezados = partirLinea(lineas[0], sep).map((h) => h.replace(/^"|"$/g, "").trim());

  const filas: FilaCsv[] = [];
  for (const linea of lineas.slice(1)) {
    const valores = partirLinea(linea, sep);
    const fila: FilaCsv = {};
    encabezados.forEach((h, i) => { fila[h] = (valores[i] ?? "").replace(/^"|"$/g, "").trim(); });
    // Se descartan los renglones completamente vacios que Excel suele dejar al final.
    if (Object.values(fila).some((v) => v !== "")) filas.push(fila);
  }
  return { encabezados, filas };
}

/** Genera un CSV de plantilla, con BOM para que Excel respete los acentos. */
export function plantillaCsv(columnas: string[], ejemplos: string[][]) {
  const escapar = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lineas = [columnas.map(escapar).join(",")];
  for (const fila of ejemplos) lineas.push(fila.map(escapar).join(","));
  return "﻿" + lineas.join("\r\n") + "\r\n";
}
