/**
 * Genera `app/tema-oscuro.css`: las escalas de color del modo oscuro.
 *
 * Por que se genera y no se escribe a mano: el sistema usa unas 3,300 clases de
 * color fijas (`bg-slate-50`, `text-red-700`, ...). Tailwind v4 lee cada una de
 * una variable CSS, asi que basta con redefinir la ESCALA bajo
 * `html[data-tema="oscuro"]` para que todas las pantallas cambien juntas, sin
 * tocar ninguna. Hacerlo a mano son diez familias por diez tonos; un tono mal
 * escrito deja un texto ilegible en una sola pantalla y nadie lo ve.
 *
 *   npx tsx scripts/generar-tema-oscuro.ts
 *
 * Regla de la escala invertida:
 *   50 / 100 / 200 / 300  → fondos y bordes: el tono de la familia muy diluido
 *                           sobre el fondo oscuro, para que un aviso rojo siga
 *                           siendo rojo pero no encandile.
 *   400 / 500             → se quedan: son los de botones y relleno de barras.
 *   600 / 700 / 800 / 900 → textos: se aclaran, porque un `text-red-700` oscuro
 *                           sobre fondo oscuro no se lee.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

type Tonos = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
const TONOS: Tonos[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

/** Las escalas de Tailwind que el sistema usa de verdad (se contaron con grep). */
const FAMILIAS: Record<string, Record<Tonos, string>> = {
  red: { 50: "#fef2f2", 100: "#fee2e2", 200: "#fecaca", 300: "#fca5a5", 400: "#f87171", 500: "#ef4444", 600: "#dc2626", 700: "#b91c1c", 800: "#991b1b", 900: "#7f1d1d" },
  rose: { 50: "#fff1f2", 100: "#ffe4e6", 200: "#fecdd3", 300: "#fda4af", 400: "#fb7185", 500: "#f43f5e", 600: "#e11d48", 700: "#be123c", 800: "#9f1239", 900: "#881337" },
  amber: { 50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d", 400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309", 800: "#92400e", 900: "#78350f" },
  orange: { 50: "#fff7ed", 100: "#ffedd5", 200: "#fed7aa", 300: "#fdba74", 400: "#fb923c", 500: "#f97316", 600: "#ea580c", 700: "#c2410c", 800: "#9a3412", 900: "#7c2d12" },
  emerald: { 50: "#ecfdf5", 100: "#d1fae5", 200: "#a7f3d0", 300: "#6ee7b7", 400: "#34d399", 500: "#10b981", 600: "#059669", 700: "#047857", 800: "#065f46", 900: "#064e3b" },
  teal: { 50: "#f0fdfa", 100: "#ccfbf1", 200: "#99f6e4", 300: "#5eead4", 400: "#2dd4bf", 500: "#14b8a6", 600: "#0d9488", 700: "#0f766e", 800: "#115e59", 900: "#134e4a" },
  sky: { 50: "#f0f9ff", 100: "#e0f2fe", 200: "#bae6fd", 300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9", 600: "#0284c7", 700: "#0369a1", 800: "#075985", 900: "#0c4a6e" },
  blue: { 50: "#eff6ff", 100: "#dbeafe", 200: "#bfdbfe", 300: "#93c5fd", 400: "#60a5fa", 500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8", 800: "#1e40af", 900: "#1e3a8a" },
  indigo: { 50: "#eef2ff", 100: "#e0e7ff", 200: "#c7d2fe", 300: "#a5b4fc", 400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca", 800: "#3730a3", 900: "#312e81" },
  violet: { 50: "#f5f3ff", 100: "#ede9fe", 200: "#ddd6fe", 300: "#c4b5fd", 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9", 800: "#5b21b6", 900: "#4c1d95" },
};

/**
 * Gris-azulado, a mano: es la familia que mas se ve y la que define si el
 * modo oscuro se siente comodo o se siente un negativo de foto.
 */
const SLATE_OSCURO: Record<Tonos | 950, string> = {
  50: "#171f33", 100: "#1e2840", 200: "#2b3652", 300: "#3a4766", 400: "#7b88a6",
  500: "#94a0bb", 600: "#aeb8cf", 700: "#c8d0e2", 800: "#dde3f0", 900: "#f1f4fa", 950: "#f8fafc",
};

/** Fondo contra el que se diluyen los tonos de color: el de las tarjetas. */
const BASE = "#131a2b";

const aRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function mezclar(color: string, base: string, parte: number): string {
  const c = aRgb(color), b = aRgb(base);
  return "#" + c.map((v, i) => Math.round(v * parte + b[i] * (1 - parte)).toString(16).padStart(2, "0")).join("");
}

function escalaOscura(s: Record<Tonos, string>): Record<Tonos, string> {
  return {
    50: mezclar(s[500], BASE, 0.12),
    100: mezclar(s[500], BASE, 0.2),
    200: mezclar(s[500], BASE, 0.32),
    300: mezclar(s[500], BASE, 0.5),
    400: s[400],
    500: s[500],
    // 600 baja a 500 y no a 400: `bg-red-600` con texto blanco tiene que
    // seguir leyendose, y `text-red-600` sobre fondo oscuro tambien.
    600: s[500],
    700: s[300],
    800: s[200],
    900: s[100],
  };
}

const lineas: string[] = [];
for (const t of TONOS) lineas.push(`  --color-slate-${t}: ${SLATE_OSCURO[t]};`);
lineas.push(`  --color-slate-950: ${SLATE_OSCURO[950]};`);
for (const [nombre, escala] of Object.entries(FAMILIAS)) {
  const o = escalaOscura(escala);
  for (const t of TONOS) lineas.push(`  --color-${nombre}-${t}: ${o[t]};`);
}

const css = `/*
 * GENERADO por scripts/generar-tema-oscuro.ts — no se edita a mano.
 * Si hace falta otro tono, se cambia el generador y se vuelve a correr.
 *
 * Solo en pantalla: al imprimir, una orden de trabajo sale en blanco aunque la
 * persona use el modo oscuro. Gastar tinta en un fondo negro no le sirve a nadie.
 */
@media screen {
  html[data-tema="oscuro"] {
    color-scheme: dark;
${lineas.join("\n")}
  }
}
`;

writeFileSync(join(process.cwd(), "app", "tema-oscuro.css"), css);
console.log(`✓ app/tema-oscuro.css (${lineas.length} variables)`);
