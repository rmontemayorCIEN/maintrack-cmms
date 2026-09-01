import Link from "next/link";
import { FileText, Printer } from "lucide-react";
import { Badge, Card, EmptyState, Stat } from "@/components/ui";
import { nombrePeriodo } from "@/lib/cobranza";
import { formatCurrency, formatDate } from "@/lib/utils";

type Cargo = {
  id: string; folio: string; periodo: string; concepto: string;
  importe: number; moneda: string; status: string;
  emitidaEl: Date; venceEl: Date; pagadaEl: Date | null;
  formaPago: string | null; referenciaPago: string | null;
};

const ESTADO: Record<string, { texto: string; tono: "success" | "warning" | "danger" | "muted" }> = {
  PAID: { texto: "Pagado", tono: "success" },
  PENDING: { texto: "Pendiente", tono: "warning" },
  CANCELLED: { texto: "Cancelado", tono: "muted" },
};

/** Estado de cuenta del cliente: que debe, de que periodo y desde cuando. */
export function EstadoDeCuenta({
  cargos, saldo, vencido, pendientes, vencidos, moneda,
}: {
  cargos: Cargo[]; saldo: number; vencido: number;
  pendientes: number; vencidos: number; moneda: string;
}) {
  const hoy = new Date();

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Saldo pendiente"
          value={formatCurrency(saldo, moneda)}
          hint={pendientes === 1 ? "1 cargo por pagar" : `${pendientes} cargos por pagar`}
          tone={saldo > 0 ? "warn" : "good"}
        />
        <Stat
          label="Vencido"
          value={formatCurrency(vencido, moneda)}
          hint={vencidos ? `${vencidos} fuera de fecha` : "Nada fuera de fecha"}
          tone={vencido > 0 ? "bad" : "good"}
        />
        <Stat label="Cargos emitidos" value={cargos.length} hint="Historial completo" />
      </div>

      {cargos.length === 0 ? (
        <EmptyState
          title="Sin cargos emitidos"
          description="Aqui apareceran los cargos mensuales del servicio conforme se emitan."
        />
      ) : (
        <Card padded={false}>
          <div className="px-5 py-4">
            <h3 className="text-sm font-semibold text-slate-900">Cargos del servicio</h3>
            <p className="text-xs text-slate-500">
              Estas notas de cobro no son comprobantes fiscales. El CFDI se emite por separado.
            </p>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Folio</th><th>Periodo</th><th>Concepto</th>
                  <th>Emitida</th><th>Vence</th>
                  <th className="text-right">Importe</th><th>Estado</th><th />
                </tr>
              </thead>
              <tbody>
                {cargos.map((c) => {
                  const e = ESTADO[c.status] ?? ESTADO.CANCELLED;
                  const atrasado = c.status === "PENDING" && c.venceEl < hoy;
                  return (
                    <tr key={c.id}>
                      <td className="font-medium text-slate-700">{c.folio}</td>
                      <td className="text-xs text-slate-600">{nombrePeriodo(c.periodo)}</td>
                      <td className="max-w-72 truncate text-xs text-slate-600">{c.concepto}</td>
                      <td className="text-xs text-slate-500">{formatDate(c.emitidaEl)}</td>
                      <td className={`text-xs ${atrasado ? "font-medium text-red-600" : "text-slate-500"}`}>
                        {formatDate(c.venceEl)}
                      </td>
                      <td className="text-right tabular-nums text-sm font-medium text-slate-800">
                        {formatCurrency(c.importe, c.moneda)}
                      </td>
                      <td>
                        <Badge tone={atrasado ? "danger" : e.tono}>
                          {atrasado ? "Vencido" : e.texto}
                        </Badge>
                        {c.status === "PAID" && c.pagadaEl ? (
                          <p className="mt-0.5 text-[0.625rem] text-slate-400">{formatDate(c.pagadaEl)}</p>
                        ) : null}
                      </td>
                      <td className="text-right">
                        <Link
                          href={`/billing/${c.id}/print`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] text-slate-600 hover:bg-slate-50"
                          title="Ver e imprimir o guardar como PDF"
                        >
                          <Printer className="h-3 w-3" /> PDF
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex gap-3">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div>
            <p className="text-sm font-medium text-slate-800">Sobre su comprobante fiscal</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Las notas de cobro de esta pantalla sirven para control del servicio y se pueden
              guardar como PDF desde el boton de impresion. El CFDI, que es el documento valido
              para efectos fiscales, lo emite su proveedor por separado.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
