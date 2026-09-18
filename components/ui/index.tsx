import { Pencil } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Glosa } from "@/components/glosario";

export function Card({
  children,
  className,
  padded = true,
  id,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  id?: string;
}) {
  // El relleno sale de la densidad que eligio el usuario, no de una clase fija.
  return <div id={id} className={cn("card", padded && "card-padded", className)}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500"><Glosa>{subtitle}</Glosa></p> : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  children,
  className,
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: "info" | "success" | "warning" | "danger" | "muted";
}) {
  const tones = {
    info: "bg-blue-100 text-blue-700 border-blue-200",
    success: "bg-emerald-100 text-emerald-700 border-emerald-200",
    warning: "bg-amber-100 text-amber-800 border-amber-200",
    danger: "bg-red-100 text-red-700 border-red-200",
    muted: "bg-slate-100 text-slate-600 border-slate-200",
  };
  // El gris por omision solo cuando no llega ningun color. `cn` concatena y no
  // resuelve conflictos de Tailwind, asi que emitir las dos series de clases
  // dejaba que ganara la que el CSS generado pusiera al final —resultado
  // impredecible, y por eso la leyenda del calendario salia sin color.
  const propio = tone ? tones[tone] : className ? "" : tones.muted;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium",
        propio,
        className,
      )}
    >
      {children}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 border-brand-600",
  secondary: "bg-white text-slate-700 hover:bg-slate-50 border-slate-200",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 border-transparent",
  danger: "bg-red-600 text-white hover:bg-red-700 border-red-600",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600",
};

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" = "md") {
  return cn(
    "boton inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
    buttonStyles[variant],
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}) {
  return (
    <button className={cn(buttonClass(variant, size), className)} {...rest}>
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <Link href={href} className={cn(buttonClass(variant, size), className)}>
      {children}
    </Link>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white/60 px-6 py-12 text-center">
      {icon ? <div className="text-slate-300">{icon}</div> : null}
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description ? (
        <p className="max-w-md text-xs text-slate-500"><Glosa>{description}</Glosa></p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
      <div>
        {breadcrumb ? <div className="mb-1 text-xs text-slate-500">{breadcrumb}</div> : null}
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-slate-500"><Glosa>{description}</Glosa></p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  icon,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  icon?: ReactNode;
  /** Si la tarjeta abre su detalle (p. ej. la formula y los registros de un indicador). */
  href?: string;
}) {
  const tones = {
    default: "text-slate-900",
    good: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-red-600",
  };
  const contenido = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">
          <Glosa>{label}</Glosa>
        </p>
        {icon ? <span className="text-slate-300">{icon}</span> : null}
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums", tones[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500"><Glosa>{hint}</Glosa></p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="card block p-4 transition-colors hover:border-brand-300 focus-visible:border-brand-400">
      {contenido}
    </Link>
  ) : (
    <div className="card p-4">{contenido}</div>
  );
}

export function Progress({ value, tone = "brand" }: { value: number; tone?: "brand" | "good" | "warn" | "bad" }) {
  const colors = {
    brand: "bg-brand-500",
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={cn("h-full rounded-full transition-all", colors[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Avatar({ name, color }: { name: string; color?: string }) {
  const letters = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold text-white"
      style={{ background: color || "#475569" }}
      title={name}
    >
      {letters}
    </span>
  );
}

/**
 * El boton de editar de un renglon de tabla.
 *
 * Existe porque el anterior no se veia. Era un lapiz de 14 px en gris claro,
 * sin borde ni fondo, que solo se distinguia al pasar el raton —y en un
 * telefono no hay raton—. Rafael no lo encontro en el almacen, y lo estaba
 * buscando a proposito; el mismo boton invisible estaba en proveedores, planes
 * y catalogos.
 *
 * Lleva borde para que se lea como control, 36 px de alto para que el pulgar
 * no falle, y la palabra "Editar" donde hay espacio: un lapiz solo obliga a
 * adivinar. En pantalla angosta se queda el icono, pero ya con la medida y el
 * borde que lo delatan como boton.
 *
 * OJO: en las tablas ya NO se usa. El patron vigente es que la columna que
 * identifica el renglon —la clave de la refaccion, el nombre del proveedor o
 * del plan— sea el enlace que abre la ficha: se entiende sola y le quita un
 * control a un renglon que suele ir apretado. Los dialogos lo aceptan con la
 * prop `disparador`.
 *
 * Esto queda como opcion por omision de esos dialogos, para que funcionen sin
 * que haya que pasarles un disparador. Hoy ningun caso lo alcanza.
 */
export function BotonEditar({
  que,
  onClick,
}: {
  /** Que se edita, para el rotulo de accesibilidad: "refacción", "plan". */
  que: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Editar ${que}`}
      aria-label={`Editar ${que}`}
      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 text-xs text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
    >
      <Pencil className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Editar</span>
    </button>
  );
}
