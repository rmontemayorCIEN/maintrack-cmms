import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { periodoDe } from "@/lib/cobranza";
import { PageHeader, Stat } from "@/components/ui";
import { formatCurrency } from "@/lib/utils";
import { PanelCobranza } from "./panel";

export const metadata = { title: "Cobranza" };
export const dynamic = "force-dynamic";

export default async function CobranzaPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const user = await requireUser();
  if (!user.isSuperAdmin) redirect("/dashboard");
  const params = await searchParams;

  const cargos = await prisma.invoice.findMany({
    where: params.estado && params.estado !== "TODOS" ? { status: params.estado } : {},
    include: { organization: { select: { name: true } } },
    orderBy: [{ periodo: "desc" }, { folio: "asc" }],
    take: 300,
  });

  const todos = await prisma.invoice.findMany({
    select: { importe: true, status: true, venceEl: true },
  });
  const hoy = new Date();
  const pendientes = todos.filter((c) => c.status === "PENDING");
  const cobrado = todos.filter((c) => c.status === "PAID").reduce((s, c) => s + c.importe, 0);
  const porCobrar = pendientes.reduce((s, c) => s + c.importe, 0);
  const vencido = pendientes.filter((c) => c.venceEl < hoy).reduce((s, c) => s + c.importe, 0);

  const empresas = await prisma.organization.count({ where: { status: { in: ["ACTIVE", "TRIAL"] } } });

  return (
    <>
      <PageHeader
        title="Cobranza"
        breadcrumb={
          <Link href="/clients" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Empresas cliente
          </Link>
        }
        description="Emita los cargos del mes y registre los pagos conforme los reciba. Los cargos son notas de cobro, no comprobantes fiscales."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Por cobrar" value={formatCurrency(porCobrar, "MXN")} hint={`${pendientes.length} cargos pendientes`} tone={porCobrar > 0 ? "warn" : "good"} />
        <Stat label="Vencido" value={formatCurrency(vencido, "MXN")} tone={vencido > 0 ? "bad" : "good"} hint="Fuera de fecha limite" />
        <Stat label="Cobrado histórico" value={formatCurrency(cobrado, "MXN")} />
        <Stat label="Empresas activas" value={empresas} hint="Sujetas a cargo mensual" />
      </div>

      <PanelCobranza
        periodoActual={periodoDe(new Date())}
        filtro={params.estado ?? "TODOS"}
        cargos={cargos.map((c) => ({
          id: c.id, folio: c.folio, empresa: c.organization.name,
          periodo: c.periodo, plan: c.plan, importe: c.importe, moneda: c.moneda,
          status: c.status,
          emitidaEl: c.emitidaEl.toISOString(),
          venceEl: c.venceEl.toISOString(),
          pagadaEl: c.pagadaEl?.toISOString() ?? null,
          formaPago: c.formaPago, referenciaPago: c.referenciaPago,
        }))}
      />
    </>
  );
}
