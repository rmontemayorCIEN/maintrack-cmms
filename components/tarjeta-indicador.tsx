/**
 * La tarjeta de un indicador central (`lib/indicadores`). Toda pantalla que
 * muestra un indicador lo pinta con esta tarjeta, asi la cifra, el texto cuando
 * no hay dato y el enlace a su formula y detalle son iguales en todos lados.
 */
import type { ReactNode } from "react";
import { Stat } from "@/components/ui";
import type { Indicador } from "@/lib/indicadores";
import { formatCurrency, formatNumber } from "@/lib/utils";

export function valorDeIndicador(ind: Indicador, moneda = "MXN", decimales?: number): string {
  if (ind.valor === null) return "—";
  switch (ind.unidad) {
    case "h": return `${formatNumber(ind.valor, decimales ?? 1)} h`;
    case "%": return `${formatNumber(ind.valor, decimales ?? 1)}%`;
    case "MXN": return formatCurrency(ind.valor, moneda);
    default: return formatNumber(ind.valor, 0);
  }
}

export function enlaceDeIndicador(ind: Indicador, dias: number) {
  return `/indicadores/${ind.clave}?dias=${dias}`;
}

export function TarjetaIndicador({
  indicador,
  dias,
  moneda,
  etiqueta,
  pista,
  tono,
  icono,
  decimales,
}: {
  indicador: Indicador;
  dias: number;
  moneda?: string;
  etiqueta?: string;
  pista?: ReactNode;
  tono?: "default" | "good" | "warn" | "bad";
  icono?: ReactNode;
  decimales?: number;
}) {
  return (
    <Stat
      label={etiqueta ?? indicador.nombre}
      value={valorDeIndicador(indicador, moneda, decimales)}
      hint={indicador.valor === null ? indicador.sinValor : pista}
      tone={indicador.valor === null ? "default" : tono}
      icon={icono}
      href={enlaceDeIndicador(indicador, dias)}
    />
  );
}
