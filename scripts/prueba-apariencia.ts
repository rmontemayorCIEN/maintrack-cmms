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
  ACENTOS, CLAVES_ACENTO, CLAVES_DISENO, CLAVES_DISENO_DISPONIBLES, CLAVES_ENCABEZADOS, CLAVES_TEMA, DISENOS, ENCABEZADOS, TEMAS,
  disenoDe, encabezadosDe, estiloDeApariencia, temaDe,
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

console.log("\nDiseño visual (Clásico, Mesa de control, Papel)");
revisar("disenoDe(undefined) es CLASICO", disenoDe(undefined) === "CLASICO");
revisar("disenoDe(null) y disenoDe('') son CLASICO", disenoDe(null) === "CLASICO" && disenoDe("") === "CLASICO");
revisar("disenoDe('basura') es CLASICO", disenoDe("basura") === "CLASICO");
revisar("un diseño aún no disponible cae en CLASICO (nunca una pantalla sin hoja de estilos)",
  CLAVES_DISENO.filter((k) => !DISENOS[k].disponible).every((k) => disenoDe(k) === "CLASICO"));
revisar("un diseño disponible se respeta", CLAVES_DISENO_DISPONIBLES.every((k) => disenoDe(k) === k));
revisar("CLASICO siempre está disponible", DISENOS.CLASICO.disponible);
revisar("todos los diseños traen nombre y descripción", CLAVES_DISENO.every((k) => DISENOS[k].nombre && DISENOS[k].descripcion));
revisar("cada atributo es único y en minúsculas",
  new Set(CLAVES_DISENO.map((k) => DISENOS[k].atributo)).size === CLAVES_DISENO.length
  && CLAVES_DISENO.every((k) => DISENOS[k].atributo === DISENOS[k].atributo.toLowerCase()));
// Un diseño «disponible» sin su hoja se ofrecería en Ajustes y no cambiaría nada: peor que no tenerlo.
for (const k of CLAVES_DISENO_DISPONIBLES.filter((x) => x !== "CLASICO")) {
  const at = DISENOS[k].atributo;
  let hoja = "";
  try { hoja = readFileSync(join(RAIZ, "app", "disenos", `${at}.css`), "utf8"); } catch { /* se reporta abajo */ }
  revisar(`«${k}» tiene su hoja app/disenos/${at}.css`, hoja.length > 0);
  revisar(`«${k}» se importa desde globals.css`, new RegExp(`@import "\\./disenos/${at}\\.css"`).test(globales));
  revisar(`«${k}» solo se aplica bajo html[data-diseno="${at}"]`, hoja.includes(`html[data-diseno="${at}"]`) && !/^\s*:root\s*\{/m.test(hoja));
}
// Contraste mínimo 4.5:1 (WCAG AA) de cada diseño nuevo, leyendo los tokens del propio CSS: si alguien
// aclara un gris o cambia el fondo del menú, esto lo atrapa. El acento de la empresa entra con sus seis paletas.
const hexDe = (bloque: string, nombre: string) => bloque.match(new RegExp(`${nombre}:\\s*(#[0-9a-fA-F]{6})`))?.[1] ?? "";
const rgbDe = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const luminancia = (h: string) => {
  const [r, g, b] = rgbDe(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const razonDe = (a: string, b: string) => { const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const mezclaDe = (frente: string, alfa: number, fondo: string) =>
  "#" + rgbDe(frente).map((v, i) => Math.round(v * alfa + rgbDe(fondo)[i] * (1 - alfa)).toString(16).padStart(2, "0")).join("");
const parDe = (nombre: string, a: string, b: string) =>
  revisar(`contraste ≥ 4.5 — ${nombre} (${a} sobre ${b})`, !!a && !!b && razonDe(a, b) >= 4.5, a && b ? razonDe(a, b).toFixed(2) : "no se encontró el token");

for (const k of CLAVES_DISENO_DISPONIBLES.filter((x) => x !== "CLASICO")) {
  const at = DISENOS[k].atributo;
  let hoja = "";
  try { hoja = readFileSync(join(RAIZ, "app", "disenos", `${at}.css`), "utf8"); } catch { /* ya se reportó arriba */ }
  // Cada bloque va de su selector a la primera llave de cierre: no tienen bloques anidados.
  const bloque = (selector: string) => { const i = hoja.indexOf(selector); return i < 0 ? "" : hoja.slice(i, hoja.indexOf("}", i)); };
  const claro = bloque(`html[data-diseno="${at}"]:not([data-tema="oscuro"]) {`);
  const oscuro = bloque(`html[data-diseno="${at}"][data-tema="oscuro"]:root {`);
  const menu = bloque(`html[data-diseno="${at}"] .barra-lateral {`);
  revisar(`«${k}» define su versión clara, su versión oscura y los colores de su menú`, !!claro && !!oscuro && !!menu);
  for (const [tema, bl] of [["claro", claro], ["oscuro", oscuro]] as const) {
    for (const [txt, fondo] of [["--muted", "--panel"], ["--muted", "--surface"], ["--color-slate-500", "--panel"], ["--color-slate-500", "--surface"], ["--color-slate-600", "--panel"], ["--ink", "--panel"]] as const) {
      parDe(`${k} ${tema}: ${txt} sobre ${fondo}`, hexDe(bl, txt), hexDe(bl, fondo));
    }
    const fondoMenu = hexDe(bl, "--lat-fondo");
    parDe(`${k} menú ${tema}: texto de opciones`, hexDe(menu, "--color-slate-600"), fondoMenu);
    parDe(`${k} menú ${tema}: título de grupo`, hexDe(menu, "--color-slate-400"), fondoMenu);
    for (const c of CLAVES_ACENTO) {
      parDe(`${k} menú ${tema}, ${ACENTOS[c].nombre}: opción activa`, "#ffffff", fondoMenu ? mezclaDe(ACENTOS[c].escala[500], 0.26, fondoMenu) : "");
    }
  }
}
const comun = (() => { try { return readFileSync(join(RAIZ, "app", "disenos", "comun.css"), "utf8"); } catch { return ""; } })();
revisar("comun.css existe, se importa y todo va acotado a los diseños nuevos",
  comun.length > 0 && /@import "\.\/disenos\/comun\.css"/.test(globales)
  && !(comun.replace(/\/\*[\s\S]*?\*\//g, "").match(/^[^\s}@][^{]*\{/gm) ?? []).some((sel) => !sel.startsWith("html:is([data-diseno=")));
revisar("User.disenoUi existe y arranca en CLASICO", /disenoUi\s+String\s+@default\("CLASICO"\)/.test(esquema));
const migDiseno = readdirSync(join(RAIZ, "prisma", "migrations")).filter((n) => /diseno_visual/.test(n));
revisar("hay una migración del diseño", migDiseno.length === 1, migDiseno);
if (migDiseno.length === 1) {
  const sql = readFileSync(join(RAIZ, "prisma", "migrations", migDiseno[0], "migration.sql"), "utf8");
  revisar("la migración del diseño es aditiva y sin sintaxis de SQLite",
    /ADD COLUMN\s+"disenoUi" TEXT NOT NULL DEFAULT 'CLASICO'/.test(sql) && !/DROP|ALTER COLUMN|AUTOINCREMENT|PRAGMA/.test(sql));
}
revisar("la ruta acepta exactamente los diseños del catálogo",
  /disenoUi: z\.enum\(\[([^\]]*)\]\)/.test(ruta)
  && [...(ruta.match(/disenoUi: z\.enum\(\[([^\]]*)\]\)/)?.[1].matchAll(/"([A-Z]+)"/g) ?? [])].map((m) => m[1]).sort().join() === [...CLAVES_DISENO].sort().join());
revisar("el diseño es personal: no pide permiso de empresa", !/empresa = z\.object\(\{[^}]*disenoUi/s.test(ruta));
const layout = readFileSync(join(RAIZ, "app", "layout.tsx"), "utf8");
revisar("el layout pone data-diseno en la raíz desde disenoDe()", /data-diseno=\{DISENOS\[disenoDe\(user\?\.disenoUi\)\]\.atributo\}/.test(layout));
revisar("Ajustes pinta el diseño en vivo antes de guardar",
  /setAttribute\("data-diseno"/.test(readFileSync(join(RAIZ, "app", "(app)", "settings", "apariencia.tsx"), "utf8")));

console.log(fallos ? `\n${fallos} fallas.` : "\nTodo en orden.");
process.exit(fallos ? 1 : 0);
