/**
 * Apariencia: escala, densidad y color de la marca.
 *
 * Dos ejes que se confunden y no deben:
 *
 *   Escala y densidad son de la PERSONA. El tamaño de letra que le acomoda al
 *   director de 55 años no es el que quiere el tecnico de 25, y hacerlo un
 *   ajuste de la empresa seria imponer la vista de uno a todos.
 *
 *   Logo y color son de la EMPRESA. Es identidad, no comodidad.
 *
 * La escala se aplica al tamaño de fuente de la raiz, asi que arrastra todo lo
 * que esta en unidades relativas: texto, espaciados, alturas. La interfaz
 * completa crece de forma proporcional en vez de quedar con letras grandes en
 * cajas chicas.
 */

export type ClaveEscala = "NORMAL" | "GRANDE" | "MAYOR";
export type ClaveDensidad = "COMPACTA" | "COMODA" | "AMPLIA";

export const ESCALAS: Record<ClaveEscala, { nombre: string; descripcion: string; raiz: string }> = {
  NORMAL: { nombre: "Normal", descripcion: "El tamaño estandar del sistema.", raiz: "100%" },
  GRANDE: { nombre: "Grande", descripcion: "Un 12% mas. Se agradece en jornadas largas frente a la pantalla.", raiz: "112.5%" },
  MAYOR: { nombre: "Mayor", descripcion: "Un 25% mas. Para leer de lejos o sin forzar la vista.", raiz: "125%" },
};

export const DENSIDADES: Record<ClaveDensidad, { nombre: string; descripcion: string; celda: string; tarjeta: string }> = {
  COMPACTA: {
    nombre: "Compacta",
    descripcion: "Mas renglones a la vista. Util en tablas largas de refacciones u ordenes.",
    celda: "0.45rem 0.7rem",
    tarjeta: "0.85rem",
  },
  COMODA: {
    nombre: "Comoda",
    descripcion: "El equilibrio del sistema entre cuanto se ve y que tan facil se lee.",
    celda: "0.7rem 0.9rem",
    tarjeta: "1.25rem",
  },
  AMPLIA: {
    nombre: "Amplia",
    descripcion: "Mas aire entre renglones. La mas legible cuando se consulta en tableta o de pie.",
    celda: "1rem 1.1rem",
    tarjeta: "1.6rem",
  },
};

/**
 * Paletas predefinidas y no un selector de color libre.
 *
 * De un solo tono elegido a mano salen escalas feas y, peor, con contraste
 * insuficiente sobre texto blanco. Estas seis estan hechas para que el boton
 * primario siempre se lea.
 */
export type ClaveAcento = "AZUL" | "INDIGO" | "TEAL" | "VERDE" | "AMBAR" | "GRAFITO";

type Escala = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>;

export const ACENTOS: Record<ClaveAcento, { nombre: string; muestra: string; escala: Escala }> = {
  AZUL: {
    nombre: "Azul", muestra: "#1f3eee",
    escala: { 50: "#eef4ff", 100: "#dae4ff", 200: "#bcd0ff", 300: "#8eb0ff", 400: "#5985fd", 500: "#345df9", 600: "#1f3eee", 700: "#1a2fd8", 800: "#1c2aae", 900: "#1c2a89" },
  },
  INDIGO: {
    nombre: "Indigo", muestra: "#4f46e5",
    escala: { 50: "#eef2ff", 100: "#e0e7ff", 200: "#c7d2fe", 300: "#a5b4fc", 400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca", 800: "#3730a3", 900: "#312e81" },
  },
  TEAL: {
    nombre: "Turquesa", muestra: "#0d9488",
    escala: { 50: "#f0fdfa", 100: "#ccfbf1", 200: "#99f6e4", 300: "#5eead4", 400: "#2dd4bf", 500: "#14b8a6", 600: "#0d9488", 700: "#0f766e", 800: "#115e59", 900: "#134e4a" },
  },
  VERDE: {
    nombre: "Verde", muestra: "#059669",
    escala: { 50: "#ecfdf5", 100: "#d1fae5", 200: "#a7f3d0", 300: "#6ee7b7", 400: "#34d399", 500: "#10b981", 600: "#059669", 700: "#047857", 800: "#065f46", 900: "#064e3b" },
  },
  AMBAR: {
    nombre: "Ambar", muestra: "#b45309",
    escala: { 50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d", 400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309", 800: "#92400e", 900: "#78350f" },
  },
  GRAFITO: {
    nombre: "Grafito", muestra: "#334155",
    escala: { 50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#cbd5e1", 400: "#94a3b8", 500: "#64748b", 600: "#475569", 700: "#334155", 800: "#1e293b", 900: "#0f172a" },
  },
};

export const CLAVES_ESCALA = Object.keys(ESCALAS) as ClaveEscala[];
export const CLAVES_DENSIDAD = Object.keys(DENSIDADES) as ClaveDensidad[];
export const CLAVES_ACENTO = Object.keys(ACENTOS) as ClaveAcento[];

export function escalaDe(v: string | null | undefined) {
  return ESCALAS[(v ?? "NORMAL") as ClaveEscala] ?? ESCALAS.NORMAL;
}
export function densidadDe(v: string | null | undefined) {
  return DENSIDADES[(v ?? "COMODA") as ClaveDensidad] ?? DENSIDADES.COMODA;
}
export function acentoDe(v: string | null | undefined) {
  return ACENTOS[(v ?? "AZUL") as ClaveAcento] ?? ACENTOS.AZUL;
}

/**
 * Variables que se inyectan en la pagina. Sale una sola cadena porque va en un
 * atributo `style` del elemento raiz: se aplica antes del primer pintado y no
 * hay parpadeo al cargar.
 */
export function estiloDeApariencia(prefs: {
  escalaUi?: string | null;
  densidadUi?: string | null;
  colorAcento?: string | null;
}): Record<string, string> {
  const e = escalaDe(prefs.escalaUi);
  const d = densidadDe(prefs.densidadUi);
  const a = acentoDe(prefs.colorAcento);

  const vars: Record<string, string> = {
    fontSize: e.raiz,
    "--celda": d.celda,
    "--tarjeta": d.tarjeta,
  };
  for (const [tono, hex] of Object.entries(a.escala)) {
    vars[`--color-brand-${tono}`] = hex;
  }
  return vars;
}
