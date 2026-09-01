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

export function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(date);
}

export function formatDateTime(value?: Date | string | null) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
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

/** Etiqueta relativa de vencimiento usada en listados y tableros. */
export function dueLabel(due?: Date | string | null) {
  if (!due) return { text: "Sin fecha", tone: "muted" as const };
  const date = typeof due === "string" ? new Date(due) : due;
  const diff = daysBetween(startOfDay(date), startOfDay(new Date()));
  if (diff < 0) return { text: `Vencida ${Math.abs(diff)}d`, tone: "danger" as const };
  if (diff === 0) return { text: "Vence hoy", tone: "warning" as const };
  if (diff === 1) return { text: "Vence mañana", tone: "warning" as const };
  if (diff <= 7) return { text: `En ${diff} dias`, tone: "info" as const };
  return { text: formatDate(date), tone: "muted" as const };
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
