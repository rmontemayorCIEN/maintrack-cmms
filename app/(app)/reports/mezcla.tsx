import Link from "next/link";
import { Card, CardHeader } from "@/components/ui";
import { MAINTENANCE_TYPE_BAR, MAINTENANCE_TYPE_LABELS } from "@/lib/constants";
import { EJES_DE_MEZCLA, UNIDADES_DE_MEZCLA, type EjeDeMezcla, type GrupoDeMezcla, type UnidadDeMezcla } from "@/lib/indicadores";
import { formatCurrency, formatNumber } from "@/lib/utils";

/**
 * Preventivo contra correctivo contra predictivo, cortado por donde se pida.
 *
 * ── Por que se elige el EJE y no «que contra que» ──
 *
 * Un selector generico de confrontacion suena flexible y termina sin usarse:
 * hay que armar el reporte cada vez, y nadie recuerda que combinacion servia.
 * Aqui hay cuatro ejes y tres unidades, que son las preguntas que la gente
 * hace de verdad: en que familia de equipo se va el correctivo, en que area,
 * a cargo de quien, y medido en ordenes, horas o dinero.
 *
 * ── La barra dice la mezcla; la tabla, el numero ──
 *
 * La barra es proporcional, no absoluta: lo que se lee de un golpe es si un
 * grupo es mayormente preventivo o mayormente correctivo. El tamaño real va
 * en la tabla, donde se puede comparar sin calcular a ojo.
 */
export function MezclaDeMantenimiento({
  filas, tipos, total, eje, unidad, days, moneda,
}: {
  filas: GrupoDeMezcla[];
  tipos: string[];
  total: { ordenes: number; horas: number; costo: number };
  eje: EjeDeMezcla;
  unidad: UnidadDeMezcla;
  days: number;
  moneda: string;
}) {
  const valor = (c: { ordenes: number; horas: number; costo: number } | undefined) =>
    !c ? 0 : unidad === "ordenes" ? c.ordenes : unidad === "horas" ? c.horas : c.costo;
  const escribir = (n: number) =>
    unidad === "costo" ? formatCurrency(n, moneda) : unidad === "horas" ? `${formatNumber(n, 1)} h` : String(n);

  const liga = (p: { eje?: EjeDeMezcla; unidad?: UnidadDeMezcla }) =>
    `/reports?days=${days}&eje=${p.eje ?? eje}&mide=${p.unidad ?? unidad}#mezcla`;

  if (!filas.length) {
    return (
      <Card className="mt-4" id="mezcla">
        <CardHeader title="Preventivo, correctivo y predictivo" subtitle="Sin órdenes terminadas en el periodo." />
      </Card>
    );
  }

  return (
    <Card className="mt-4" id="mezcla">
      <CardHeader
        title="Preventivo, correctivo y predictivo"
        subtitle={
          "En qué se está yendo el mantenimiento. Solo órdenes terminadas del periodo; las de apoyo no entran —consumen "
          + "horas pero no son trabajo sobre la salud de una máquina, y contarlas diría que los equipos fallan más de lo que fallan."
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-slate-500">Agrupar por</span>
          {(Object.keys(EJES_DE_MEZCLA) as EjeDeMezcla[]).map((k) => (
            <Link
              key={k} href={liga({ eje: k })}
              className={`rounded-lg border px-2 py-1 ${eje === k ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              {EJES_DE_MEZCLA[k]}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-slate-500">Medido en</span>
          {(Object.keys(UNIDADES_DE_MEZCLA) as UnidadDeMezcla[]).map((k) => (
            <Link
              key={k} href={liga({ unidad: k })}
              className={`rounded-lg border px-2 py-1 ${unidad === k ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              {UNIDADES_DE_MEZCLA[k]}
            </Link>
          ))}
        </div>
      </div>

      {/* La leyenda, una vez: los mismos colores que traen las órdenes. */}
      <ul className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-slate-600">
        {tipos.map((t) => (
          <li key={t} className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${MAINTENANCE_TYPE_BAR[t] ?? "bg-slate-300"}`} aria-hidden />
            {MAINTENANCE_TYPE_LABELS[t] ?? t}
          </li>
        ))}
      </ul>

      <ul className="grid gap-2">
        {filas.map((f) => {
          const tot = valor(f.total);
          return (
            <li key={f.id ?? "sin"} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className={f.id ? "font-medium text-slate-800" : "text-slate-500"}>{f.nombre}</span>
                <span className="tabular-nums text-slate-600">{escribir(tot)}</span>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" role="img"
                aria-label={tipos.map((t) => `${MAINTENANCE_TYPE_LABELS[t] ?? t}: ${escribir(valor(f.porTipo[t]))}`).join(", ")}>
                {tipos.map((t) => {
                  const v = valor(f.porTipo[t]);
                  if (!v || !tot) return null;
                  return <span key={t} className={MAINTENANCE_TYPE_BAR[t] ?? "bg-slate-300"} style={{ width: `${(v / tot) * 100}%` }} />;
                })}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{EJES_DE_MEZCLA[eje]}</th>
              {tipos.map((t) => <th key={t} className="num">{MAINTENANCE_TYPE_LABELS[t] ?? t}</th>)}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id ?? "sin"} className={f.id ? undefined : "text-slate-500"}>
                <td>{f.nombre}</td>
                {tipos.map((t) => (
                  <td key={t} className="num">{f.porTipo[t] ? escribir(valor(f.porTipo[t])) : "—"}</td>
                ))}
                <td className="num font-semibold">{escribir(valor(f.total))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 font-semibold">
              <td>Total</td>
              {tipos.map((t) => {
                const suma = filas.reduce((a, f) => a + valor(f.porTipo[t]), 0);
                return <td key={t} className="num">{escribir(suma)}</td>;
              })}
              <td className="num">{escribir(valor(total))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {filas.some((f) => !f.id) ? (
        <p className="mt-2 text-xs text-slate-500">
          «Sin asignar» son las órdenes que no tienen ese dato capturado. Salen aparte para que la suma cuadre con el
          total del periodo; repartirlas entre los demás daría un número preciso y falso.
        </p>
      ) : null}
    </Card>
  );
}
