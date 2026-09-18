/**
 * Cómo se limpia y se compara lo que captura o importa una empresa.
 *
 * Una sola vez, en un solo lugar: la importación, la detección de duplicados y
 * la puesta en marcha preguntan aquí. Si cada una limpiara a su manera, «Bomba
 * Centrífuga» y «bomba centrifuga» serían el mismo equipo para una y dos
 * distintos para otra.
 *
 * Dos reglas que no se rompen:
 *
 *  1. **Limpiar no es cambiar.** Se quitan espacios de más e invisibles, pero un
 *     nombre legítimo —con sus acentos y mayúsculas— se guarda como vino. Lo
 *     que se normaliza agresivamente es la CLAVE DE COMPARACIÓN, que nunca se
 *     guarda: solo sirve para darse cuenta de que dos cosas son la misma.
 *  2. **Lo dudoso se rechaza con explicación, no se adivina.** «03/04/2026» ¿es
 *     3 de abril o 4 de marzo? Se lee como en México —día/mes— y se dice. Un
 *     «30/02/2026» no se convierte en 2 de marzo: se rechaza.
 *
 * No toca la base: lo usan el servidor, las pruebas y, si hace falta, la
 * pantalla.
 */
import { textoDeFuera } from "./texto-publico";

/**
 * Lo que dice cada normalizador: el valor limpio, o por qué no sirve y CÓMO
 * corregirlo. La solución no es adorno: quien corrige el archivo necesita saber
 * qué escribir, no solo que está mal.
 */
export type Veredicto<T> = { ok: true; valor: T } | { ok: false; motivo: string; solucion?: string };

const bien = <T>(valor: T): Veredicto<T> => ({ ok: true, valor });
const mal = <T>(motivo: string, solucion?: string): Veredicto<T> => ({ ok: false, motivo, ...(solucion ? { solucion } : {}) });

/** Texto como se guarda: sin invisibles ni espacios de más. Conserva acentos y mayúsculas. */
export function texto(v: string | null | undefined, limite = 500): string {
  return textoDeFuera(v, limite).replace(/\s+/g, " ");
}

/**
 * Clave para COMPARAR, nunca para guardar.
 *
 * Sin acentos, sin mayúsculas, sin signos y con un solo espacio: «Bomba
 * Centrífuga #2» y «bomba centrifuga 2» dan lo mismo.
 */
export function claveComparable(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

/** Código interno: mayúsculas, sin espacios alrededor de guiones. «bom - 101 » → «BOM-101». */
export function codigo(v: string | null | undefined): string {
  return texto(v, 60).toUpperCase().replace(/\s*([-_/.])\s*/g, "$1").replace(/\s+/g, " ");
}

/** Número de serie: mayúsculas y sin espacios, que es como viene en la placa. */
export function serie(v: string | null | undefined): string {
  return texto(v, 80).toUpperCase().replace(/\s+/g, "");
}

/**
 * Número de serie para COMPARAR: solo letras y dígitos. «SN-777», «sn 777» y
 * «SN.777» son la misma placa escrita por tres personas.
 */
export function serieComparable(v: string | null | undefined): string {
  return (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function correo(v: string | null | undefined): Veredicto<string | null> {
  const c = texto(v, 160).toLowerCase();
  if (!c) return bien(null);
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(c)
    ? bien(c)
    : mal(`El correo «${c}» no tiene un formato válido`, "Escriba un correo completo, como nombre@empresa.mx");
}

/** Teléfono: solo dígitos. En México son 10; se aceptan de 7 a 15 por extranjeros y extensiones. */
export function telefono(v: string | null | undefined): Veredicto<string | null> {
  const bruto = texto(v, 40);
  if (!bruto) return bien(null);
  const mas = bruto.startsWith("+") ? "+" : "";
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length < 7 || digitos.length > 15) {
    return mal(`El teléfono «${bruto}» debe tener entre 7 y 15 dígitos`, "Escriba solo el número, con lada: 10 dígitos en México");
  }
  return bien(mas + digitos);
}

/**
 * RFC: 12 caracteres para persona moral, 13 para física.
 *
 * Se aceptan con espacios o guiones —así se copian de una factura— y se guardan
 * sin ellos. La estructura se valida; el dígito verificador, no: ese lo revisa
 * el SAT, y rechazar por él dejaría fuera RFC reales mal calculados en origen.
 */
export function rfc(v: string | null | undefined): Veredicto<string | null> {
  const r = texto(v, 20).toUpperCase().replace(/[\s-]/g, "");
  if (!r) return bien(null);
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(r)
    ? bien(r)
    : mal(`El RFC «${r}» no tiene la estructura de un RFC`, "12 caracteres para empresa o 13 para persona: 3 o 4 letras, 6 dígitos de fecha y 3 de homoclave. Déjelo vacío si no lo tiene");
}

/**
 * Número de una hoja de cálculo.
 *
 * «$1,250.50» y «1250.5» se leen igual. La coma solo se acepta como separador
 * de miles —grupos de tres—: «1,5» es ambiguo (¿uno y medio, o quince?) y se
 * rechaza pidiendo punto decimal, en vez de adivinar.
 */
export function numero(
  v: string | null | undefined,
  opciones: { minimo?: number; entero?: boolean; campo?: string } = {},
): Veredicto<number | null> {
  const campo = opciones.campo ?? "El valor";
  const s = texto(v, 40).replace(/[$\s]/g, "");
  if (!s) return bien(null);
  let limpio = s;
  if (s.includes(",")) {
    if (!/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
      return mal(`${campo} «${s}» usa coma como decimal`, "Escriba el decimal con punto: 1.5, no 1,5. La coma solo separa miles: 1,250.50");
    }
    limpio = s.replace(/,/g, "");
  }
  const n = Number(limpio);
  if (!Number.isFinite(n)) return mal(`${campo} «${s}» no es un número`, "Escriba solo cifras, sin letras ni unidades: 1250.50");
  if (opciones.entero && !Number.isInteger(n)) return mal(`${campo} «${s}» debe ser un número entero`, "Escriba un número sin decimales");
  if (opciones.minimo !== undefined && n < opciones.minimo) {
    return mal(`${campo} «${s}» no puede ser menor a ${opciones.minimo}`, `Escriba un valor de ${opciones.minimo} o más`);
  }
  return bien(n);
}

export type DiaCalendario = { anio: number; mes: number; dia: number };

/**
 * Fecha de un archivo, estricta.
 *
 * Se aceptan dd/mm/aaaa —lo que produce Excel en español— y aaaa-mm-dd. El día
 * tiene que existir: «30/02/2026» se rechaza en vez de convertirse en el 2 de
 * marzo, que es lo que hace JavaScript si se le deja.
 *
 * Devuelve el día de calendario, no un instante: a qué hora empieza ese día lo
 * decide la zona de la empresa, no la del servidor.
 */
export function fecha(v: string | null | undefined, campo = "La fecha"): Veredicto<DiaCalendario | null> {
  const s = texto(v, 20);
  if (!s) return bien(null);
  let partes: [number, number, number] | null = null;
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dmy) partes = [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])];
  else if (ymd) partes = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
  if (!partes) return mal(`${campo} «${s}» no se entiende`, "Escriba la fecha como dd/mm/aaaa, por ejemplo 15/09/2026");
  const [anio, mes, dia] = partes;
  const prueba = new Date(Date.UTC(anio, mes - 1, dia));
  if (prueba.getUTCFullYear() !== anio || prueba.getUTCMonth() !== mes - 1 || prueba.getUTCDate() !== dia) {
    return mal(`${campo} «${s}» no existe en el calendario`, "Revise el día y el mes: se lee como dd/mm/aaaa");
  }
  if (anio < 1950 || anio > 2100) return mal(`${campo} «${s}» está fuera de un rango razonable`, "Revise el año: se esperan cuatro dígitos, como 2026");
  return bien({ anio, mes, dia });
}

/**
 * Unidad de medida, en su forma corta.
 *
 * «Pieza», «pz», «PZAS» son la misma unidad. Si no se reconoce, se regresa tal
 * cual —minúsculas y sin espacios— para que la empresa pueda tener las suyas.
 */
const SINONIMOS_UNIDAD: Record<string, string> = {
  pieza: "pza", piezas: "pza", pz: "pza", pzs: "pza", pzas: "pza", pza: "pza", unidad: "pza", und: "pza",
  juego: "jgo", juegos: "jgo", jgo: "jgo",
  par: "par", pares: "par", kit: "kit", kits: "kit",
  metro: "m", metros: "m", mts: "m", mt: "m", m: "m",
  kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg", kgs: "kg", kg: "kg",
  gramo: "g", gramos: "g", gr: "g", g: "g",
  litro: "lt", litros: "lt", l: "lt", lts: "lt", lt: "lt",
  mililitro: "ml", mililitros: "ml", ml: "ml",
  galon: "gal", galones: "gal", gal: "gal",
  caja: "caja", cajas: "caja", rollo: "rollo", rollos: "rollo",
};

export function unidad(v: string | null | undefined): string {
  const u = claveComparable(v).replace(/\s+/g, "");
  return SINONIMOS_UNIDAD[u] ?? u;
}

export const MONEDAS = ["MXN", "USD", "EUR"] as const;

export function moneda(v: string | null | undefined): Veredicto<string | null> {
  const m = texto(v, 10).toUpperCase().replace(/[^A-Z]/g, "");
  if (!m) return bien(null);
  const equivalencias: Record<string, string> = { PESOS: "MXN", MN: "MXN", DOLARES: "USD", DLLS: "USD", USD: "USD", MXN: "MXN", EUR: "EUR" };
  const r = equivalencias[m];
  return r ? bien(r) : mal(`La moneda «${m}» no se reconoce`, "Use MXN, USD o EUR");
}

/** SI/NO de una hoja: «sí», «si», «1», «x», «verdadero» cuentan como sí. */
export function siNo(v: string | null | undefined): boolean {
  return ["si", "s", "yes", "y", "true", "verdadero", "1", "x"].includes(claveComparable(v));
}
