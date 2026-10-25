/**
 * Apariencia: tema claro/oscuro y estilo de los títulos.
 *
 * Lo que se cuida aquí es lo que no se ve en una captura:
 *
 *  - Sin sesión (acceso, registro) no hay usuario: los valores por omisión
 *    tienen que salir completos. Una versión de `encabezadosDe` devolvía
 *    `undefined` ahí y la pantalla de acceso daba 500 —sin sesión, el único
 *    camino que nadie prueba logueado—.
 *  - Cada familia de color que el código usa tiene su versión oscura. Una que
 *    falte no truena: se queda clara sobre fondo oscuro (le pasó a «teal», el
 *    color de «Cerrada»).
 *  - Los títulos salen de UNA clase; nadie vuelve a escribir el estilo a mano.
 *  - El esquema, la migración y la ruta están de acuerdo en los valores.
 *
 *   npx tsx scripts/prueba-apariencia.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CLAVES_ENCABEZADOS, CLAVES_TEMA, ENCABEZADOS, TEMAS,
  encabezadosDe, estiloDeApariencia, temaDe,
} from "../lib/apariencia";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined && !ok ? `  → ${JSON.stringify(detalle).slice(0, 300)}` : ""}`);
}

const RAIZ = join(__dirname, "..");
function archivos(dir: string, ext: RegExp, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === ".next") continue;
    const ruta = join(dir, n);
    if (statSync(ruta).isDirectory()) archivos(ruta, ext, salida);
    else if (ext.test(n)) salida.push(ruta);
  }
  return salida;
}

console.log("\nValores por omisión (sin sesión)");
revisar("encabezadosDe(undefined) es MARCADO", encabezadosDe(undefined) === "MARCADO", encabezadosDe(undefined));
revisar("encabezadosDe(null) es MARCADO", encabezadosDe(null) === "MARCADO");
revisar("encabezadosDe('') es MARCADO", encabezadosDe("") === "MARCADO");
revisar("encabezadosDe('basura') es MARCADO", encabezadosDe("basura") === "MARCADO");
revisar("encabezadosDe('SOBRIO') respeta lo guardado", encabezadosDe("SOBRIO") === "SOBRIO");
revisar("temaDe(undefined) es claro", temaDe(undefined).atributo === "claro");
revisar("temaDe('basura') es claro", temaDe("basura").atributo === "claro");
revisar("temaDe('OSCURO') es oscuro", temaDe("OSCURO").atributo === "oscuro");
revisar("temaDe('SISTEMA') es sistema", temaDe("SISTEMA").atributo === "sistema");
revisar("todos los temas y estilos traen nombre y descripción",
  [...CLAVES_TEMA.map((k) => TEMAS[k]), ...CLAVES_ENCABEZADOS.map((k) => ENCABEZADOS[k])].every((o) => o.nombre && o.descripcion));

console.log("\nEl color de la marca viaja como --acento-*, no como --color-brand-*");
const estilo = estiloDeApariencia({});
revisar("salen los diez tonos de --acento", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].every((t) => estilo[`--acento-${t}`]));
revisar("no hay ningún --color-brand-* en línea (le ganaría a la hoja de estilos)",
  !Object.keys(estilo).some((k) => k.startsWith("--color-brand")), Object.keys(estilo));

console.log("\nCada familia de color en uso tiene versión oscura");
const css = readFileSync(join(RAIZ, "app", "tema-oscuro.css"), "utf8");
const usadas = new Set<string>();
for (const dir of ["app", "components", "lib"]) {
  for (const f of archivos(join(RAIZ, dir), /\.(tsx?|css)$/)) {
    if (f.endsWith("tema-oscuro.css")) continue;
    const t = readFileSync(f, "utf8");
    for (const m of t.matchAll(/\b(?:bg|text|border|ring|from|to|via|divide|fill|stroke|outline|decoration|accent|caret|placeholder|shadow)-(slate|gray|zinc|neutral|stone|red|rose|pink|fuchsia|purple|violet|indigo|blue|sky|cyan|teal|emerald|green|lime|yellow|amber|orange)-\d{2,3}\b/g)) {
      usadas.add(m[1]);
    }
  }
}
for (const fam of [...usadas].sort()) {
  revisar(`«${fam}» está en tema-oscuro.css`, css.includes(`--color-${fam}-500:`) || css.includes(`--color-${fam}-600:`),
    "falta en scripts/generar-tema-oscuro.ts: agréguela y corra el generador");
}
revisar("el modo oscuro solo aplica en pantalla (el papel sale claro)", /@media screen\s*\{\s*html\[data-tema="oscuro"\]/.test(css));

console.log("\nLos títulos salen de una sola clase");
const base = readFileSync(join(RAIZ, "components", "ui", "index.tsx"), "utf8");
revisar("PageHeader usa .titulo-pagina", /<h1 className="titulo-pagina">/.test(base));
revisar("CardHeader usa .titulo-seccion y .cabecera-tarjeta", /titulo-seccion/.test(base) && /cabecera-tarjeta/.test(base));
const sueltos: string[] = [];
for (const f of archivos(join(RAIZ, "app", "(app)"), /\.tsx$/)) {
  const t = readFileSync(f, "utf8");
  for (const m of t.matchAll(/<h[23][^>]*className="[^"]*text-(?:sm|base)\s+font-semibold\s+text-slate-(?:700|800|900)[^"]*"/g)) {
    sueltos.push(`${f.replace(RAIZ + "/", "")}: ${m[0].slice(0, 90)}`);
  }
}
revisar("ningún título de sección vuelve a escribirse a mano", sueltos.length === 0, sueltos.slice(0, 5));
const globales = readFileSync(join(RAIZ, "app", "globals.css"), "utf8");
revisar("existe el estilo SOBRIO para los dos tipos de título",
  /data-encabezados="sobrio"\] \.titulo-pagina/.test(globales) && /data-encabezados="sobrio"\] \.titulo-seccion/.test(globales));

console.log("\nLas gráficas y mapas usan variables, no grises en hex");
// Un hex fijo en una gráfica no sabe si la persona eligió el modo oscuro: la
// rejilla de #eef1f6 salía casi blanca sobre fondo oscuro y las barras
// «Creadas» brillaban más que las de interés.
const GRISES_FIJOS = ["#eef1f6", "#c7d5fe", "#dfe4ea", "#e6e8ef", "#94a3b8", "#bae6fd", "#ddd6fe", "#fed7aa"];
const conGris: string[] = [];
for (const f of ["components/charts/dashboard-charts.tsx", "app/(app)/conjuntos/panel.tsx", "app/(app)/conjuntos/[id]/lienzo.tsx"]) {
  const t = readFileSync(join(RAIZ, f), "utf8");
  for (const g of GRISES_FIJOS) if (t.includes(g)) conGris.push(`${f}: ${g}`);
}
revisar("ninguna gráfica ni mapa trae un gris fijo en hex", conGris.length === 0, conGris);
revisar("las variables --g-* existen en claro y en oscuro",
  ["rejilla", "eje", "creadas", "apagado", "linea-suave", "area-preventivo", "area-predictivo", "area-correctivo"]
    .every((v) => (globales.match(new RegExp(`--g-${v}:`, "g")) ?? []).length === 2));

console.log("\nEsquema, migración y ruta están de acuerdo");
const esquema = readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8");
revisar("User.temaUi existe y arranca en CLARO", /temaUi\s+String\s+@default\("CLARO"\)/.test(esquema));
revisar("User.encabezadosUi existe y arranca en MARCADO", /encabezadosUi\s+String\s+@default\("MARCADO"\)/.test(esquema));
const migraciones = readdirSync(join(RAIZ, "prisma", "migrations")).filter((n) => /tema_y_encabezados/.test(n));
revisar("hay una migración", migraciones.length === 1, migraciones);
if (migraciones.length === 1) {
  const sql = readFileSync(join(RAIZ, "prisma", "migrations", migraciones[0], "migration.sql"), "utf8");
  revisar("la migración es aditiva (solo ADD COLUMN con valor por omisión)",
    /ADD COLUMN\s+"encabezadosUi" TEXT NOT NULL DEFAULT 'MARCADO'/.test(sql) && /"temaUi" TEXT NOT NULL DEFAULT 'CLARO'/.test(sql) && !/DROP|ALTER COLUMN/.test(sql));
  revisar("la migración no trae sintaxis de SQLite", !/AUTOINCREMENT|PRAGMA/.test(sql));
}
const ruta = readFileSync(join(RAIZ, "app", "api", "apariencia", "route.ts"), "utf8");
revisar("la ruta acepta exactamente los temas del catálogo",
  CLAVES_TEMA.every((k) => ruta.includes(`"${k}"`)) && /temaUi: z\.enum\(\["CLARO", "OSCURO", "SISTEMA"\]\)/.test(ruta));
revisar("la ruta acepta exactamente los estilos del catálogo",
  /encabezadosUi: z\.enum\(\["SOBRIO", "MARCADO"\]\)/.test(ruta) && CLAVES_ENCABEZADOS.every((k) => ruta.includes(`"${k}"`)));
revisar("tema y títulos son personales: no piden permiso de empresa", !/empresa = z\.object\(\{[^}]*(temaUi|encabezadosUi)/s.test(ruta));

console.log(fallos ? `\n${fallos} fallas.` : "\nTodo en orden.");
process.exit(fallos ? 1 : 0);
