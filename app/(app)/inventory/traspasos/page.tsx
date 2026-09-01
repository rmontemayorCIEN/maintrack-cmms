import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { TraspasoDialog, type RefaccionOpcion } from "./traspaso-dialog";

export const metadata = { title: "Traspasos entre almacenes" };
export const dynamic = "force-dynamic";

export default async function TraspasosPage() {
  const user = await requireUser();
  const orgId = user.organizationId;
  const editable = can(user.role, "inventory:write");

  const [almacenes, existencias, traspasos] = await Promise.all([
    prisma.warehouse.findMany({
      where: { organizationId: orgId, active: true },
      orderBy: [{ esGeneral: "desc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    // Solo lo que tiene existencia: es lo unico que se puede traspasar, y
    // traer el catalogo completo para filtrarlo en el navegador seria mandar
    // cientos de refacciones en cero que nadie va a elegir.
    prisma.partStock.findMany({
      where: { organizationId: orgId, quantity: { gt: 0 }, part: { active: true } },
      select: {
        warehouseId: true, quantity: true,
        part: { select: { id: true, code: true, name: true, unit: true } },
      },
    }),
    prisma.stockTransfer.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, folio: true, nota: true, createdAt: true,
        origen: { select: { name: true } },
        destino: { select: { name: true } },
        user: { select: { name: true } },
        renglones: { select: { quantity: true, part: { select: { code: true, name: true, unit: true } } } },
      },
    }),
  ]);

  const porRefaccion = new Map<string, RefaccionOpcion>();
  for (const e of existencias) {
    let r = porRefaccion.get(e.part.id);
    if (!r) {
      r = { id: e.part.id, code: e.part.code, name: e.part.name, unit: e.part.unit, porAlmacen: {} };
      porRefaccion.set(e.part.id, r);
    }
    r.porAlmacen[e.warehouseId] = e.quantity;
  }
  const refacciones = [...porRefaccion.values()].sort((a, b) => a.code.localeCompare(b.code, "es"));

  return (
    <>
      <PageHeader
        title="Traspasos entre almacenes"
        description="Mover existencia de un almacén a otro. Cada traspaso deja su salida y su entrada en el kardex de ambos."
        breadcrumb={
          <Link href="/inventory" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Almacén
          </Link>
        }
        actions={editable ? <TraspasoDialog almacenes={almacenes} refacciones={refacciones} /> : undefined}
      />

      {traspasos.length === 0 ? (
        <EmptyState
          title="Sin traspasos"
          description="Cuando mueva refacciones entre almacenes, el historial aparecerá aquí."
        />
      ) : (
        <div className="grid gap-3">
          {traspasos.map((t) => (
            <Card key={t.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-800">{t.folio}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                    {t.origen.name} <ArrowRight className="h-3 w-3 text-slate-400" /> {t.destino.name}
                  </span>
                </div>
                <span className="text-[0.6875rem] text-slate-400">
                  {formatDateTime(t.createdAt)}{t.user?.name ? ` · ${t.user.name}` : ""}
                </span>
              </div>

              <ul className="mt-2 grid gap-0.5">
                {t.renglones.map((r, i) => (
                  <li key={i} className="text-xs text-slate-600">
                    <span className="tabular-nums font-medium text-slate-800">{formatNumber(r.quantity, 2)}</span>
                    {" "}{r.part.unit} · {r.part.code} — {r.part.name}
                  </li>
                ))}
              </ul>

              {t.nota ? <p className="mt-1.5 text-[0.6875rem] text-slate-500">{t.nota}</p> : null}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
