"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS = { fontSize: 11, fill: "#94a3b8" };
const GRID = "#eef1f6";

const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: "1px solid #e6e8ef",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
};

export function TrendChart({
  data,
}: {
  data: Array<{ month: string; creadas: number; completadas: number; costo: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tick={AXIS} axisLine={false} tickLine={false} />
        {/* Eje izquierdo: conteo de ordenes. Eje derecho: costo, en otra escala. */}
        <YAxis yAxisId="left" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={AXIS}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar isAnimationActive={false} yAxisId="left" dataKey="creadas" name="Creadas" fill="#c7d5fe" radius={[4, 4, 0, 0]} barSize={18} />
        <Bar isAnimationActive={false} yAxisId="left" dataKey="completadas" name="Completadas" fill="#345df9" radius={[4, 4, 0, 0]} barSize={18} />
        <Line isAnimationActive={false} yAxisId="right" type="monotone" dataKey="costo" name="Costo" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MixChart({ data }: { data: Array<{ month: string; preventivo: number; correctivo: number; predictivo: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} stackOffset="expand">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area isAnimationActive={false} type="monotone" dataKey="preventivo" name="Preventivo" stackId="1" stroke="#0ea5e9" fill="#bae6fd" />
        <Area isAnimationActive={false} type="monotone" dataKey="predictivo" name="Predictivo" stackId="1" stroke="#8b5cf6" fill="#ddd6fe" />
        <Area isAnimationActive={false} type="monotone" dataKey="correctivo" name="Correctivo" stackId="1" stroke="#f97316" fill="#fed7aa" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const PIE_COLORS = ["#345df9", "#0ea5e9", "#8b5cf6", "#f97316", "#ef4444", "#64748b"];

export function DonutChart({ data }: { data: Array<{ name: string; value: number }> }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (!total) {
    return <p className="py-16 text-center text-xs text-slate-400">Sin datos en el periodo</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie isAnimationActive={false} data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function CostRankingChart({ data }: { data: Array<{ code: string; costo: number; paroHoras: number }> }) {
  if (!data.length) {
    return <p className="py-16 text-center text-xs text-slate-400">Sin costos registrados</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="code" tick={AXIS} width={70} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [`${Number(value ?? 0).toLocaleString("es-MX")}`, "Costo"]} />
        <Bar isAnimationActive={false} dataKey="costo" fill="#345df9" radius={[0, 4, 4, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SensorSparkline({
  data,
  warning,
  critical,
}: {
  data: Array<{ t: string; value: number }>;
  warning?: number | null;
  critical?: number | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="sensorFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" tick={AXIS} axisLine={false} tickLine={false} minTickGap={30} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        {warning != null ? (
          <Line isAnimationActive={false} dataKey={() => warning} stroke="#f59e0b" strokeDasharray="4 4" dot={false} name="Alerta" />
        ) : null}
        {critical != null ? (
          <Line isAnimationActive={false} dataKey={() => critical} stroke="#ef4444" strokeDasharray="4 4" dot={false} name="Critico" />
        ) : null}
        <Area isAnimationActive={false} type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} fill="url(#sensorFill)" name="Lectura" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
