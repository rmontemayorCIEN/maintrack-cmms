"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Loader2, Sparkles, X } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

type Limites = { assets: number; users: number; sites: number; sensors: number; storageGb: number };
export type FichaPlan = {
  clave: string;
  nombre: string;
  precioMensual: number;
  descripcion: string;
  limites: Limites;
  incluye: string[];
};
type Solicitud = { id: string; planSolicitado: string; createdAt: string } | null;

const ORDEN = ["FREE", "STARTER", "PROFESSIONAL", "ENTERPRISE"];
const inf = (n: number) => (n === null || !Number.isFinite(n) ? "Sin limite" : formatNumber(n, 0));

/**
 * Fichas de los niveles de suscripcion.
 *
 * El cambio no se aplica solo: el cobro es manual, asi que el cliente solicita
 * y el operador de la plataforma activa cuando el pago esta acordado. Decirlo
 * de frente en el boton evita que alguien espere un cambio inmediato.
 */
export function FichasPlanes({
  planes,
  planActual,
  puedeSolicitar,
  solicitudPendiente,
  moneda,
}: {
  planes: FichaPlan[];
  planActual: string;
  puedeSolicitar: boolean;
  solicitudPendiente: Solicitud;
  moneda: string;
}) {
  const router = useRouter();
  const [eligiendo, setEligiendo] = useState<FichaPlan | null>(null);
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const iActual = ORDEN.indexOf(planActual);

  async function solicitar() {
    if (!eligiendo) return;
    setOcupado(true); setError(null);
    const res = await fetch("/api/plan-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: eligiendo.clave, nota: nota || null }),
    });
    const data = await res.json();
    setOcupado(false);
    if (!res.ok) { setError(data.error ?? "No fue posible enviar la solicitud"); return; }
    setEligiendo(null); setNota("");
    router.refresh();
  }

  async function cancelar() {
    if (!solicitudPendiente) return;
    setOcupado(true);
    await fetch(`/api/plan-requests/${solicitudPendiente.id}`, { method: "DELETE" });
    setOcupado(false);
    router.refresh();
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Niveles de suscripcion</h3>
          <p className="text-xs text-slate-500">Precios mensuales en {moneda}, sin IVA.</p>
        </div>
      </div>

      {solicitudPendiente ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <Sparkles className="h-4 w-4 shrink-0 text-amber-700" />
          <p className="min-w-0 flex-1 text-xs text-amber-900">
            Tiene una solicitud en curso para el plan{" "}
            <strong>{planes.find((p) => p.clave === solicitudPendiente.planSolicitado)?.nombre}</strong>.
            Su proveedor la revisara y activara el cambio.
          </p>
          {puedeSolicitar ? (
            <button
              type="button" onClick={cancelar} disabled={ocupado}
              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[0.6875rem] font-medium text-amber-900 hover:bg-amber-100"
            >
              Cancelar solicitud
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {planes.map((p) => {
          const actual = p.clave === planActual;
          const i = ORDEN.indexOf(p.clave);
          const sube = i > iActual;
          const recomendado = p.clave === "PROFESSIONAL" && !actual;

          return (
            <Card
              key={p.clave}
              className={cn(
                "relative flex flex-col",
                actual && "border-brand-400 ring-1 ring-brand-200",
                recomendado && !actual && "border-slate-300",
              )}
            >
              {actual ? (
                <span className="absolute -top-2 left-4">
                  <Badge tone="info">Su plan actual</Badge>
                </span>
              ) : recomendado ? (
                <span className="absolute -top-2 left-4">
                  <Badge tone="success">Mas contratado</Badge>
                </span>
              ) : null}

              <div className="mb-3">
                <p className="text-base font-semibold text-slate-900">{p.nombre}</p>
                <p className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-900">
                  {p.precioMensual === 0 ? "Sin costo" : formatCurrency(p.precioMensual, moneda)}
                  {p.precioMensual > 0 ? (
                    <span className="ml-1 text-xs font-normal text-slate-500">/ mes</span>
                  ) : null}
                </p>
                <p className="mt-1.5 min-h-8 text-xs leading-snug text-slate-500">{p.descripcion}</p>
              </div>

              <dl className="mb-3 grid gap-1 border-y border-slate-100 py-2.5 text-xs">
                <Limite etiqueta="Activos" valor={inf(p.limites.assets)} />
                <Limite etiqueta="Usuarios" valor={inf(p.limites.users)} />
                <Limite etiqueta="Sitios" valor={inf(p.limites.sites)} />
                <Limite
                  etiqueta="Monitoreo predictivo"
                  valor={p.limites.sensors === 0 ? "No incluido" : `${inf(p.limites.sensors)} sensores`}
                  apagado={p.limites.sensors === 0}
                />
                <Limite etiqueta="Archivos" valor={p.limites.storageGb === Infinity ? "Sin limite" : `${p.limites.storageGb} GB`} />
              </dl>

              <ul className="mb-4 grid flex-1 gap-1.5">
                {p.incluye.map((x) => (
                  <li key={x} className="flex gap-1.5 text-xs leading-snug text-slate-600">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                    {x}
                  </li>
                ))}
              </ul>

              {actual ? (
                <Button variant="secondary" size="sm" disabled className="w-full">
                  Plan contratado
                </Button>
              ) : !puedeSolicitar ? (
                <p className="text-center text-[0.6875rem] text-slate-400">
                  Solo el propietario puede cambiar de plan
                </p>
              ) : solicitudPendiente ? (
                <Button variant="secondary" size="sm" disabled className="w-full">
                  Solicitud en curso
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={sube ? "primary" : "secondary"}
                  className="w-full"
                  onClick={() => { setEligiendo(p); setError(null); }}
                >
                  {sube ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                  {sube ? "Subir a este plan" : "Bajar a este plan"}
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      {eligiendo ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Solicitar el plan {eligiendo.nombre}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {eligiendo.precioMensual === 0
                    ? "Sin costo mensual."
                    : `${formatCurrency(eligiendo.precioMensual, moneda)} al mes.`}{" "}
                  El cambio lo activa su proveedor una vez acordado el pago; no es automatico.
                </p>
              </div>
              <button type="button" onClick={() => setEligiendo(null)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            {ORDEN.indexOf(eligiendo.clave) < iActual ? (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <strong>Va a bajar de plan.</strong> Si hoy supera los limites del plan{" "}{eligiendo.nombre}, no perdera informacion, pero no podra agregar mas hasta
                quedar dentro del tope.
              </p>
            ) : null}

            <label className="label">Nota para su proveedor (opcional)</label>
            <textarea
              className="field min-h-20"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej. Vamos a dar de alta la segunda planta el próximo mes."
            />

            {error ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEligiendo(null)}>Cancelar</Button>
              <Button onClick={solicitar} disabled={ocupado}>
                {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Enviar solicitud
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Limite({ etiqueta, valor, apagado }: { etiqueta: string; valor: string; apagado?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-slate-500">{etiqueta}</dt>
      <dd className={cn("tabular-nums", apagado ? "text-slate-400" : "font-medium text-slate-800")}>
        {valor}
      </dd>
    </div>
  );
}
