"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Loader2, Lock, Sparkles } from "lucide-react";
import { Badge, Button, Card, CardHeader, Progress } from "@/components/ui";
import { formatCurrency } from "@/lib/utils";

type Funcion = { clave: string; nombre: string; descripcion: string; incluida: boolean; disponible: boolean };

/**
 * La IA vista desde la cuenta del cliente.
 *
 * Se habla de operaciones y nunca de tokens: el cliente compra una bolsa
 * mensual entendible, y el costo real del modelo es asunto nuestro. Tampoco se
 * le muestran dolares, porque su factura va en pesos.
 */
export function PanelIa({
  operacionesUsadas,
  operacionesIncluidas,
  complementoActivo,
  puedeSolicitar,
  solicitudPendiente,
  planDePago,
  moneda,
  complemento,
  funciones,
}: {
  operacionesUsadas: number;
  operacionesIncluidas: number;
  complementoActivo: boolean;
  puedeSolicitar: boolean;
  solicitudPendiente: boolean;
  planDePago: boolean;
  moneda: string;
  complemento: { nombre: string; precioMensual: number; operaciones: number; incluye: readonly string[] };
  funciones: Funcion[];
}) {
  const router = useRouter();
  /**
   * La lista de funciones nace cerrada.
   *
   * Son dieciocho renglones con su descripcion, y en esta pantalla empujaban
   * los planes tan abajo que habia que desplazarse para encontrarlos —el
   * motivo por el que uno entra aqui—. Es material de consulta, no algo que se
   * decida todos los dias: se deja a un clic y la pantalla vuelve a caber.
   */
  const [verFunciones, setVerFunciones] = useState(false);
  const activas = funciones.filter((f) => f.incluida && f.disponible).length;
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const restantes = Math.max(0, operacionesIncluidas - operacionesUsadas);
  const porcentaje = operacionesIncluidas === 0 ? 0 : (operacionesUsadas / operacionesIncluidas) * 100;

  async function solicitar() {
    setOcupado(true);
    setError(null);
    const res = await fetch("/api/plan-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "IA_AVANZADA", nota: "Solicitud del complemento desde Suscripción" }),
    });
    const data = await res.json();
    setOcupado(false);
    if (!res.ok) { setError(data.error ?? "No fue posible enviar la solicitud"); return; }
    setListo(true);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader
        title="Inteligencia artificial"
        subtitle="Analiza su operación y le dice que atender primero, con la evidencia de sus propios datos."
        action={
          complementoActivo ? (
            <Badge tone="success">{complemento.nombre} activo</Badge>
          ) : operacionesIncluidas > 0 ? (
            <Badge tone="info">Incluida en su plan</Badge>
          ) : (
            <Badge tone="muted">No incluida</Badge>
          )
        }
      />

      {operacionesIncluidas > 0 ? (
        <div className="mb-4">
          <div className="mb-1 flex items-baseline justify-between">
            <p className="text-xs text-slate-600">Operaciones de este mes</p>
            <p className="text-xs font-medium tabular-nums text-slate-700">
              {operacionesUsadas} de {operacionesIncluidas}
            </p>
          </div>
          <Progress value={porcentaje} tone={porcentaje >= 90 ? "bad" : porcentaje >= 70 ? "warn" : "good"} />
          <p className="mt-1 text-[0.6875rem] text-slate-500">
            {restantes === 0
              ? "Se agotaron. Se renuevan el dia 1 del próximo mes."
              : `Quedan ${restantes}. Se renuevan el dia 1 del proximo mes.`}
          </p>
        </div>
      ) : null}

      <div className="mb-4">
        <button
          type="button"
          onClick={() => setVerFunciones((v) => !v)}
          aria-expanded={verFunciones}
          className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-2.5 py-2 text-left hover:bg-slate-50"
        >
          <span className="text-xs font-medium text-slate-700">
            {activas} de {funciones.length} funciones activas
          </span>
          <span className="flex items-center gap-1 text-[0.6875rem] text-slate-500">
            {verFunciones ? "Ocultar" : "Ver cuáles"}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${verFunciones ? "rotate-180" : ""}`} />
          </span>
        </button>
      </div>

      {verFunciones ? (
      <ul className="mb-4 grid gap-2">
        {funciones.map((f) => (
          <li key={f.clave} className="flex items-start gap-2">
            <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${
              f.incluida && f.disponible ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
            }`}>
              {f.incluida && f.disponible ? <Check className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
            </span>
            <div className="min-w-0">
              <p className={`text-xs font-medium ${f.incluida && f.disponible ? "text-slate-800" : "text-slate-500"}`}>
                {f.nombre}
                {!f.disponible ? <span className="ml-1.5 text-[0.625rem] font-normal text-slate-400">proximamente</span> : null}
              </p>
              <p className="text-[0.6875rem] leading-relaxed text-slate-500">{f.descripcion}</p>
            </div>
          </li>
        ))}
      </ul>
      ) : null}

      {complementoActivo ? (
        <Link
          href="/diagnostico"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline"
        >
          Ver el diagnostico <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-900">
                <Sparkles className="h-4 w-4" /> {complemento.nombre}
              </p>
              <p className="mt-0.5 text-xs text-brand-800/80">
                {complemento.operaciones} operaciones al mes y todas las funciones, sobre su plan actual.
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold text-brand-900">
              {formatCurrency(complemento.precioMensual, moneda)}<span className="text-xs font-normal"> / mes</span>
            </p>
          </div>

          <ul className="mt-2 grid gap-0.5">
            {complemento.incluye.map((linea) => (
              <li key={linea} className="flex items-start gap-1.5 text-[0.6875rem] text-brand-900/80">
                <Check className="mt-0.5 h-3 w-3 shrink-0" /> {linea}
              </li>
            ))}
          </ul>

          {!planDePago ? (
            <p className="mt-2.5 text-[0.6875rem] text-brand-900/70">
              Se contrata sobre un plan de pago. Suba de plan primero y después active el complemento.
            </p>
          ) : solicitudPendiente || listo ? (
            <p className="mt-2.5 text-[0.6875rem] font-medium text-brand-900">
              Solicitud enviada. Su proveedor la activara al confirmar el cobro.
            </p>
          ) : puedeSolicitar ? (
            <Button size="sm" className="mt-2.5" onClick={solicitar} disabled={ocupado}>
              {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Solicitar {complemento.nombre}
            </Button>
          ) : (
            <p className="mt-2.5 text-[0.6875rem] text-brand-900/70">
              Pida a quien administra la cuenta que lo solicite.
            </p>
          )}
          {error ? <p className="mt-1.5 text-[0.6875rem] text-red-600">{error}</p> : null}
        </div>
      )}
    </Card>
  );
}
