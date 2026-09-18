"use client";

import dynamic from "next/dynamic";

/**
 * Las gráficas del panel de resultados, cargadas solo cuando se muestran.
 *
 * La librería de gráficas pesa más que todo lo demás del inicio. Solo el dueño
 * ve los resultados; sin esto, el técnico la bajaba por datos móviles en cada
 * entrada al inicio sin usarla nunca.
 */
const Cargando = () => <div className="h-56 animate-pulse rounded-lg bg-slate-100" role="status" aria-label="Cargando gráfica" />;

export const TrendChart = dynamic(() => import("./dashboard-charts").then((m) => m.TrendChart), { ssr: false, loading: Cargando });
export const MixChart = dynamic(() => import("./dashboard-charts").then((m) => m.MixChart), { ssr: false, loading: Cargando });
export const DonutChart = dynamic(() => import("./dashboard-charts").then((m) => m.DonutChart), { ssr: false, loading: Cargando });
export const CostRankingChart = dynamic(() => import("./dashboard-charts").then((m) => m.CostRankingChart), { ssr: false, loading: Cargando });
