import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { nombrePeriodo } from "@/lib/cobranza";
import { planDe } from "@/lib/planes";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PrintButton } from "@/app/(app)/work-orders/[id]/print/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nota de cobro" };

/**
 * Documento imprimible del cargo. El cliente lo guarda como PDF desde el
 * dialogo de impresion del navegador.
 *
 * Se declara de forma prominente que NO es un comprobante fiscal: confundirlo
 * con un CFDI le causaria un problema contable al cliente.
 */
export default async function NotaDeCobro({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const cargo = await prisma.invoice.findFirst({
    where: {
      id,
      // Un cliente solo ve las suyas; el operador de plataforma, cualquiera.
      ...(user.isSuperAdmin ? {} : { organizationId: user.organizationId }),
    },
    include: { organization: { select: { name: true, slug: true, industry: true } } },
  });
  if (!cargo) notFound();

  const plan = planDe(cargo.plan);
  const estado =
    cargo.status === "PAID" ? "PAGADO" : cargo.status === "CANCELLED" ? "CANCELADO" : "PENDIENTE DE PAGO";

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-slate-900 print:p-0">
      <PrintButton />

      <header className="mb-8 flex items-start justify-between border-b-2 border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold">NOTA DE COBRO</h1>
          <p className="mt-1 text-sm">MainTrack CMMS</p>
          <p className="text-xs text-slate-500">Servicio de gestion de mantenimiento</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums">{cargo.folio}</p>
          <p className="text-xs">Emitida {formatDate(cargo.emitidaEl)}</p>
          <p className={`mt-1 inline-block border px-2 py-0.5 text-[0.625rem] font-bold ${
            cargo.status === "PAID" ? "border-emerald-700 text-emerald-700"
              : cargo.status === "CANCELLED" ? "border-slate-400 text-slate-400"
              : "border-amber-700 text-amber-700"
          }`}>
            {estado}
          </p>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="text-[0.625rem] font-bold uppercase tracking-wide text-slate-500">Cliente</p>
          <p className="font-medium">{cargo.organization.name}</p>
          {cargo.organization.industry ? (
            <p className="text-xs text-slate-600">{cargo.organization.industry}</p>
          ) : null}
          <p className="text-xs text-slate-500">{cargo.organization.slug}</p>
        </div>
        <div>
          <p className="text-[0.625rem] font-bold uppercase tracking-wide text-slate-500">Periodo</p>
          <p className="font-medium">{nombrePeriodo(cargo.periodo)}</p>
          <p className="mt-2 text-[0.625rem] font-bold uppercase tracking-wide text-slate-500">
            Fecha limite de pago
          </p>
          <p>{formatDate(cargo.venceEl)}</p>
        </div>
      </section>

      <table className="mb-6 w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border border-slate-300 bg-slate-100 p-2 text-left">Concepto</th>
            <th className="border border-slate-300 bg-slate-100 p-2 text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-slate-300 p-2">
              <p className="font-medium">{cargo.concepto}</p>
              <p className="mt-1 text-xs text-slate-600">
                Plan {plan.nombre} · hasta {plan.limites.assets === Infinity ? "activos ilimitados" : `${plan.limites.assets} activos`}
                {plan.limites.users === Infinity ? " y usuarios ilimitados" : ` y ${plan.limites.users} usuarios`}
              </p>
            </td>
            <td className="border border-slate-300 p-2 text-right tabular-nums">
              {formatCurrency(cargo.importe, cargo.moneda)}
            </td>
          </tr>
          <tr>
            <td className="border border-slate-300 p-2 text-right font-bold">Total</td>
            <td className="border-2 border-slate-800 p-2 text-right text-lg font-bold tabular-nums">
              {formatCurrency(cargo.importe, cargo.moneda)}
            </td>
          </tr>
        </tbody>
      </table>

      {cargo.status === "PAID" ? (
        <section className="mb-6 border border-emerald-700 bg-emerald-50 p-3 text-sm">
          <p className="font-bold text-emerald-900">Pagado el {formatDate(cargo.pagadaEl)}</p>
          {cargo.formaPago ? <p className="text-xs text-emerald-800">Forma de pago: {cargo.formaPago}</p> : null}
          {cargo.referenciaPago ? <p className="text-xs text-emerald-800">Referencia: {cargo.referenciaPago}</p> : null}
        </section>
      ) : null}

      {cargo.nota ? (
        <section className="mb-6 text-sm">
          <p className="text-[0.625rem] font-bold uppercase tracking-wide text-slate-500">Nota</p>
          <p>{cargo.nota}</p>
        </section>
      ) : null}

      <section className="mt-8 border-2 border-slate-800 p-3">
        <p className="text-xs font-bold uppercase">Este documento no es un comprobante fiscal</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-700">
          Es una nota de cobro para control interno del servicio. El comprobante fiscal digital
          (CFDI) correspondiente se emite por separado y es el unico valido para efectos fiscales
          y de deducibilidad.
        </p>
      </section>

      <footer className="mt-6 border-t border-slate-300 pt-2 text-[0.625rem] text-slate-500">
        Generado desde MainTrack CMMS · {formatDate(new Date())}
      </footer>
    </div>
  );
}
