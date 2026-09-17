import { diaEnZona } from "./periodos";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function formatCurrency(value: number, currency = "MXN", locale = "es-MX") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function formatNumber(value: number, digits = 1) {
  return new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value || 0);
}

/**
 * Un momento como fecha. En una pantalla que se dibuja en el SERVIDOR hay que
 * pasar la zona de la empresa: produccion corre en UTC y, sin zona, una orden
 * terminada a las 11 pm de Monterrey sale con la fecha del dia siguiente. En
 * el navegador se puede omitir: usa la zona de quien mira.
 */
export function formatDate(value?: Date | string | null, zona?: string) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", ...(zona ? { timeZone: zona } : {}) }).format(date);
}

export function formatDateTime(value?: Date | string | null, zona?: string) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(zona ? { timeZone: zona } : {}),
  }).format(date);
}

export function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

export function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * El dia de calendario que representa una fecha de DIA COMPLETO, como medianoche
 * local de quien la lee. Es la misma regla de `formatDia`: la medianoche UTC
 * exacta es un dia calculado en el servidor y se lee en UTC; cualquier otra hora
 * es un momento real y se lee en la hora local.
 *
 * Sirve para `getDate()`, `getDay()` y para comparar dias en el navegador, donde
 * `new Date("...T00:00:00.000Z").getDate()` en Mexico da el dia ANTERIOR.
 */
export function diaDeCalendario(value: Date | string, zona?: string): Date {
  const d = typeof value === "string" ? new Date(value) : value;
  const esMedianocheUtc =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (esMedianocheUtc) return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  // Con zona, el dia es el de la EMPRESA: igual en el servidor (UTC) que en el
  // navegador. Sin zona se usa la local, y un componente que se dibuja en los
  // dos lados da dias distintos (error de hidratacion #418).
  if (zona) {
    const z = diaEnZona(d, zona);
    return new Date(z.anio, z.mes - 1, z.dia);
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** "aaaa-mm-dd" del dia que representa la fecha (ver `diaDeCalendario`), para un `<input type="date">`. */
export function claveDia(value: Date | string, zona?: string): string {
  const d = diaDeCalendario(value, zona);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Etiqueta relativa de vencimiento usada en listados y tableros. */
export function dueLabel(due?: Date | string | null) {
  if (!due) return { text: "Sin fecha", tone: "muted" as const };
  const date = typeof due === "string" ? new Date(due) : due;
  // Un vencimiento es un dia completo: contarlo contra el dia que representa, no
  // contra la medianoche UTC que en Mexico cae la tarde anterior.
  const diff = daysBetween(diaDeCalendario(date), startOfDay(new Date()));
  if (diff < 0) return { text: `Vencida ${Math.abs(diff)}d`, tone: "danger" as const };
  if (diff === 0) return { text: "Vence hoy", tone: "warning" as const };
  if (diff === 1) return { text: "Vence mañana", tone: "warning" as const };
  if (diff <= 7) return { text: `En ${diff} dias`, tone: "info" as const };
  return { text: formatDia(date), tone: "muted" as const };
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const str = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\n");
}

/**
 * Un dia de calendario capturado como "aaaa-mm-dd", a la medianoche LOCAL.
 *
 * `new Date("2026-09-21")` lo lee como medianoche UTC, que en Mexico es el 20 a
 * las 6 de la tarde: al pasarlo por `startOfDay` se convierte en el dia 20. Una
 * fecha que el usuario escribio como 21 no puede guardarse como 20.
 *
 * Cualquier otro texto se interpreta tal cual.
 */
export function diaLocal(valor?: string | null): Date | null {
  if (!valor) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(valor) ? new Date(`${valor}T00:00:00`) : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Muestra una fecha de DIA COMPLETO —vencimientos, ultima vez que se hizo—
 * sin que la zona horaria del navegador la recorra.
 *
 * En la base conviven dos clases de valor, y cada una se lee distinto:
 *
 *  - **Medianoche UTC exacta** (`...T00:00:00.000Z`): un dia calculado en el
 *    servidor, que en produccion corre en UTC. Un navegador en Mexico lo
 *    pintaria como el dia ANTERIOR a las 6 de la tarde, asi que se lee en UTC.
 *  - **Cualquier otra hora**: un momento real —la medianoche de Mexico que
 *    manda el navegador (06:00 UTC), o un vencimiento contado desde la hora de
 *    un cierre (05:33 UTC = 11:33 pm en Monterrey)—. Ese se lee en la hora de
 *    quien mira. Leerlo en UTC mostraba el dia SIGUIENTE, que fue justo lo que
 *    delato la regla anterior: una asignacion decia 22 y sus actividades 21.
 *
 * No sirve para fechas CON hora —un cierre, un comentario—; para esas esta
 * `formatDateTime`.
 */
export function formatDia(value?: Date | string | null, opciones: { anio?: boolean; zona?: string } = {}) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const esMedianocheUtc =
    date.getUTCHours() === 0 && date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    ...(opciones.anio === false ? {} : { year: "numeric" }),
    ...(esMedianocheUtc ? { timeZone: "UTC" } : opciones.zona ? { timeZone: opciones.zona } : {}),
  }).format(date);
}
