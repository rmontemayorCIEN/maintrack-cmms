import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Badge, PageHeader, Stat } from "@/components/ui";
import { ESTADOS_CONTEO, exactitud } from "@/lib/conteos";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { CapturaConteo, type RenglonConteo } from "./captura";

export const dynamic = "force-dynamic";

export default async function ConteoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const moneda = user.organization.currency;

  const conteo = await prisma.inventoryCount.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      warehouse: { select: { id: true, name: true } },
      responsable: { select: { name: true } },
      renglones: {
        orderBy: { part: { code: "asc" } },
        include: { part: { select: { code: true, name: true, unit: true, unitCost: true } } },
      },
    },
  });
  if (!conteo) notFound();

  const ubicaciones = new Map(
    (await prisma.partStock.findMany({
      where: { warehouseId: conteo.warehouseId, partId: { in: conteo.renglones.map((r) => r.partId) } },
      select: { partId: true, bin: true },
    })).map((e) => [e.partId, e.bin]),
  );

  const renglones: RenglonConteo[] = conteo.renglones.map((r) => ({
    id: r.id, codigo: r.part.code, nombre: r.part.name, unidad: r.part.unit,
    ubicacion: ubicaciones.get(r.partId) ?? null,
    cantidadSistema: r.cantidadSistema,
    cantidadContada: r.cantidadContada,
    cantidadAlCerrar: r.cantidadAlCerrar,
    nota: r.nota,
  }));

  const ex = exactitud(conteo.renglones);
  const cerrado = conteo.estado === "CERRADO";

  // El dinero que se movio: lo que sobro menos lo que falto, valuado al costo.
  const impacto = cerrado
    ? conteo.renglones.reduce((s, r) => {
        if (r.cantidadContada === null) return s;
        const ref = r.cantidadAlCerrar ?? r.cantidadSistema;
        return s + (r.cantidadContada - ref) * r.part.unitCost;
      }, 0)
    : null;

  return (
    <>
      <PageHeader
        title={`Conteo ${conteo.folio}`}
        description={`${conteo.warehouse.name} · ${conteo.alcance ?? "Todo el almacén"}`}
        breadcrumb={
          <Link href="/inventory/conteos" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Conteos
          </Link>
        }
        actions={
          <Badge tone={conteo.estado === "ABIERTO" ? "warning" : conteo.estado === "CERRADO" ? "success" : "muted"}>
            {ESTADOS_CONTEO[conteo.estado as keyof typeof ESTADOS_CONTEO] ?? conteo.estado}
          </Badge>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Renglones" value={String(renglones.length)} />
        <Stat label="Contados" value={String(ex?.contados ?? 0)} />
        <Stat
          label="Exactitud"
          value={ex ? `${ex.porcentaje}%` : "—"}
          hint={ex ? `${ex.exactos} de ${ex.contados} cuadraron` : "sin capturar"}
          tone={ex ? (ex.porcentaje >= 95 ? "good" : ex.porcentaje >= 85 ? "warn" : "bad") : "default"}
        />
        <Stat
          label={impacto === null ? "Abierto desde" : "Impacto en dinero"}
          value={impacto === null ? formatDateTime(conteo.abiertoEl).slice(0, 10) : formatCurrency(impacto, moneda)}
          hint={impacto === null ? (conteo.responsable?.name ?? "") : impacto < 0 ? "faltante neto" : "sobrante neto"}
        />
      </div>

      <CapturaConteo
        countId={conteo.id}
        estado={conteo.estado}
        renglones={renglones}
        editable={can(user.role, "inventory:write")}
      />
    </>
  );
}
