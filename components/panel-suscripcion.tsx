import { Badge, Card, CardHeader, Progress } from "@/components/ui";
import { PLANES, type ClavePlan, planDe, diasDePruebaRestantes, ORDEN_PLANES } from "@/lib/planes";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Consumo = {
  recurso: string;
  etiqueta: string;
  uso: number;
  limite: number;
  ilimitado: boolean;
  porcentaje: number;
  excedido: boolean;
};

/** Estado comercial de la cuenta: que plan tiene, cuanto consume y que sigue. */
export function PanelSuscripcion({
  org,
  consumo,
}: {
  org: { name: string; plan: string; status: string; currency: string; trialEndsAt: Date | null };
  consumo: Consumo[];
}) {
  const plan = planDe(org.plan);
  const dias = diasDePruebaRestantes(org);
  const vencida = dias !== null && dias < 0;
  const porVencer = dias !== null && dias >= 0 && dias <= 7;

  const orden = ORDEN_PLANES;
  const siguiente = orden[orden.indexOf(org.plan as ClavePlan) + 1];

  return (
    <Card>
      <CardHeader
        title="Su plan"
        subtitle={plan.descripcion}
        action={
          <div className="text-right">
            <p className="text-lg font-semibold text-slate-900">{plan.nombre}</p>
            <p className="text-xs text-slate-500">
              {plan.precioMensual === 0
                ? "Sin costo"
                : `${formatCurrency(plan.precioMensual, org.currency)} / mes`}
            </p>
          </div>
        }
      />

      {vencida ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <strong>Su periodo de prueba termino.</strong> Puede seguir consultando su información,
          pero para volver a capturar hay que activar un plan.
        </p>
      ) : porVencer ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>Su prueba termina en {dias} {dias === 1 ? "dia" : "dias"}.</strong>{" "}
          Al vencer, la cuenta pasa a solo lectura hasta activar un plan.
        </p>
      ) : null}

      <div className="grid gap-3">
        {consumo.map((c) => (
          <div key={c.recurso}>
            <div className="flex items-baseline justify-between text-xs">
              <span className="capitalize text-slate-600">{c.etiqueta}</span>
              <span className="tabular-nums text-slate-500">
                {formatNumber(c.uso, 0)}
                {c.ilimitado ? (
                  <span className="text-slate-400"> · sin limite</span>
                ) : (
                  <span className={c.excedido ? "font-semibold text-red-600" : "text-slate-400"}>
                    {" "}/ {formatNumber(c.limite, 0)}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1">
              <Progress
                value={c.ilimitado ? 4 : c.porcentaje}
                tone={c.excedido ? "bad" : c.porcentaje >= 80 ? "warn" : "brand"}
              />
            </div>
            {c.excedido && c.limite === 0 ? (
              <p className="mt-1 text-[0.6875rem] text-slate-500">No incluido en este plan.</p>
            ) : c.excedido ? (
              <p className="mt-1 text-[0.6875rem] text-red-600">Limite alcanzado: no se pueden agregar mas.</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-400">
          Incluye
        </p>
        <ul className="grid gap-1">
          {plan.incluye.map((x) => (
            <li key={x} className="flex gap-1.5 text-xs text-slate-600">
              <span className="text-emerald-600">✓</span> {x}
            </li>
          ))}
        </ul>
      </div>

      {siguiente ? (
        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50/60 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-semibold text-brand-800">
              Siguiente nivel: {PLANES[siguiente].nombre}
            </p>
            <Badge tone="info">
              {formatCurrency(PLANES[siguiente].precioMensual, org.currency)} / mes
            </Badge>
          </div>
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-brand-900/80">
            {PLANES[siguiente].limites.assets === Infinity
              ? "Activos, usuarios y sitios sin límite."
              : `Hasta ${formatNumber(PLANES[siguiente].limites.assets, 0)} activos y ${formatNumber(PLANES[siguiente].limites.users, 0)} usuarios.`}{" "}
            {PLANES[siguiente].incluye[1] ?? ""}
          </p>
          <p className="mt-2 text-[0.6875rem] text-brand-700">
            Para cambiar de plan, contacte a su proveedor del servicio.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
