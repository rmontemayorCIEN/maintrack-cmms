import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatCurrency } from "@/lib/utils";
import { planDeCompras } from "@/lib/planificador-compras";
import { TablaPlan } from "./tabla-plan";

export const metadata = { title: "Qué hay que comprar" };
export const dynamic = "force-dynamic";

export default async function PlanificadorPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const { dias: diasParam } = await searchParams;
  const user = await requireUser();
  const orgId = user.organizationId;
  const moneda = user.organization.currency;

  // Horizontes cerrados: un campo libre invita a pedir 3 años y a esperar
  // media hora por una proyección que nadie va a usar.
  const dias = [30, 90, 180].includes(Number(diasParam)) ? Number(diasParam) : 90;

  const [plan, almacenes, refacciones, proveedores] = await Promise.all([
    planDeCompras(orgId, { dias }),
    prisma.warehouse.findMany({
      where: { organizationId: orgId, active: true },
      orderBy: [{ esGeneral: "desc" }, { code: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.part.findMany({
      where: { organizationId: orgId, active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, unit: true, unitCost: true },
    }),
    prisma.supplier.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const tarde = plan.sugerencias.filter((s) => s.urgencia === "TARDE").length;
  const hoy = plan.sugerencias.filter((s) => s.urgencia === "HOY").length;

  return (
    <>
      <PageHeader
        title="Qué hay que comprar"
        description="Lo que se va a acabar antes de que alcance a llegar, cruzando lo que piden los preventivos, lo que se ha consumido de verdad y lo que tarda cada proveedor."
        breadcrumb={
          <Link href="/compras" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3.5 w-3.5" /> Compras
          </Link>
        }
      />

      <nav className="mb-4 flex flex-wrap items-center gap-2 text-sm" aria-label="Horizonte">
        <span className="text-slate-600">Mirando</span>
        {[30, 90, 180].map((d) => (
          <Link
            key={d}
            href={`/compras/planificador?dias=${d}`}
            aria-current={d === dias ? "page" : undefined}
            className={`inline-flex min-h-9 items-center rounded-lg border px-3 ${
              d === dias
                ? "border-brand-600 bg-brand-50 font-medium text-brand-700"
                : "border-slate-300 text-slate-700 hover:border-slate-400"
            }`}
          >
            {d} días
          </Link>
        ))}
      </nav>

      {plan.sugerencias.length ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Ya va tarde"
            value={String(tarde)}
            tone={tarde ? "bad" : "good"}
            hint={tarde ? "No alcanza a llegar aunque se pida hoy" : "Nada fuera de tiempo"}
          />
          <Stat label="Pida hoy" value={String(hoy)} tone={hoy ? "warn" : "good"} />
          {/*
            Esta es la cifra que de verdad cambia con el horizonte. Sin ella,
            el total lo dominan las reposiciones de minimo —que no dependen de
            los dias— y el selector parecia no hacer nada.
          */}
          <Stat
            label="Se acaban en una fecha"
            value={String(plan.conFecha)}
            hint={`${formatCurrency(plan.costoConFecha, moneda)} · el resto es reponer mínimos`}
          />
          <Stat
            label="Costo de lo propuesto"
            value={formatCurrency(plan.costoTotal, moneda)}
            hint={`${plan.sugerencias.length} refacciones`}
          />
        </div>
      ) : null}

      {/*
        La cobertura va ARRIBA de la tabla y no como nota al pie: si los planes
        no tienen refacciones cargadas, la lista sale corta y parece que no hay
        nada que comprar. Es el mismo criterio del consumo proyectado.
      */}
      {plan.cobertura.planesSinRefacciones.length ? (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            <strong>
              {plan.cobertura.planesSinRefacciones.length} de {plan.cobertura.planes} planes
            </strong>{" "}
            no tienen ninguna refacción cargada, así que lo que consumen no entra en esta
            lista: {plan.cobertura.planesSinRefacciones.slice(0, 4).join(", ")}
            {plan.cobertura.planesSinRefacciones.length > 4 ? "…" : ""}. Puede ser correcto
            —revisar y medir no consume nada— pero conviene comprobarlo antes de confiar en
            las cifras.
          </p>
        </Card>
      ) : null}

      {plan.sugerencias.length === 0 ? (
        <EmptyState
          title="Nada que pedir por ahora"
          description={`Con lo que hay en almacén y lo que ya viene en camino alcanza para los próximos ${dias} días, según los preventivos programados y el consumo de los últimos ${plan.diasDeHistoria} días.`}
        />
      ) : (
        <TablaPlan
          sugerencias={plan.sugerencias}
          moneda={moneda}
          dias={plan.dias}
          diasDeHistoria={plan.diasDeHistoria}
          almacenes={almacenes}
          refacciones={refacciones.map((r) => ({ id: r.id, code: r.code, name: r.name, unit: r.unit, costo: r.unitCost }))}
          proveedores={proveedores}
          puedePedir={can(user.role, "purchase:request")}
        />
      )}
    </>
  );
}
