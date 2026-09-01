import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatCurrency } from "@/lib/utils";
import { vistaGuardada } from "@/lib/vistas";
import { TablaProveedores, type FilaProveedor } from "./tabla-proveedores";
import { ProveedorDialog } from "./proveedor-dialog";

export const metadata = { title: "Proveedores" };
export const dynamic = "force-dynamic";

export default async function ProveedoresPage() {
  const user = await requireUser();
  const orgId = user.organizationId;
  const editable = can(user.role, "settings:write");
  const moneda = user.organization.currency;

  // Las refacciones se traen con existencia y costo para calcular en el
  // servidor lo que le corresponde a cada proveedor. Agregarlo en la consulta
  // obligaria a tres groupBy y a cruzarlos despues; con este volumen sale mas
  // barato y mas claro sumarlo aqui.
  const [proveedores, refacciones, servicios] = await Promise.all([
    prisma.supplier.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, contactName: true, email: true, phone: true,
        address: true, leadTimeDays: true, notes: true,
        _count: { select: { services: true } },
      },
    }),
    prisma.part.findMany({
      where: { organizationId: orgId, active: true, supplierId: { not: null } },
      select: { supplierId: true, quantityOnHand: true, minQuantity: true, unitCost: true },
    }),
    prisma.workOrderService.findMany({
      where: { supplierId: { not: null }, workOrder: { organizationId: orgId } },
      select: { supplierId: true, cost: true, createdAt: true },
    }),
  ]);

  type Acumulado = { refacciones: number; bajoMinimo: number; valor: number; prestados: number; gasto: number; ultimo: Date | null };
  const porProveedor = new Map<string, Acumulado>();
  const acumulado = (id: string) => {
    let a = porProveedor.get(id);
    if (!a) { a = { refacciones: 0, bajoMinimo: 0, valor: 0, prestados: 0, gasto: 0, ultimo: null }; porProveedor.set(id, a); }
    return a;
  };

  for (const r of refacciones) {
    const a = acumulado(r.supplierId!);
    a.refacciones += 1;
    a.valor += r.quantityOnHand * r.unitCost;
    if (r.quantityOnHand <= r.minQuantity) a.bajoMinimo += 1;
  }
  for (const s of servicios) {
    const a = acumulado(s.supplierId!);
    a.prestados += 1;
    a.gasto += s.cost;
    if (!a.ultimo || s.createdAt > a.ultimo) a.ultimo = s.createdAt;
  }

  const filas: FilaProveedor[] = proveedores.map((p) => {
    const a = porProveedor.get(p.id);
    return {
      id: p.id, name: p.name, contactName: p.contactName, email: p.email, phone: p.phone,
      address: p.address, leadTimeDays: p.leadTimeDays, notes: p.notes,
      refacciones: a?.refacciones ?? 0,
      refaccionesBajoMinimo: a?.bajoMinimo ?? 0,
      valorEnPiso: a?.valor ?? 0,
      serviciosCatalogo: p._count.services,
      serviciosPrestados: a?.prestados ?? 0,
      gastoAcumulado: a?.gasto ?? 0,
      ultimoServicio: a?.ultimo?.toISOString() ?? null,
      moneda,
    };
  });

  const porComprar = filas.filter((f) => f.refaccionesBajoMinimo > 0);
  const gastoTotal = filas.reduce((s, f) => s + f.gastoAcumulado, 0);

  return (
    <>
      <PageHeader
        title="Proveedores"
        description="Quien surte las refacciones y quien presta los servicios externos. Con lo que cada uno representa en piso y en gasto."
        actions={editable ? <ProveedorDialog /> : undefined}
      />

      {proveedores.length ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Proveedores" value={String(filas.length)} />
          <Stat
            label="Con refacciones por comprar"
            value={String(porComprar.length)}
            hint={porComprar.length ? porComprar.map((p) => p.name).slice(0, 3).join(", ") : "Ninguno"}
          />
          <Stat label="Gasto en servicios externos" value={formatCurrency(gastoTotal, moneda)} />
        </div>
      ) : null}

      {proveedores.length === 0 ? (
        <EmptyState
          title="Sin proveedores"
          description="Registre a quien le compra refacciones y a quien contrata servicios externos."
        />
      ) : (
        <TablaProveedores proveedores={filas} vistaInicial={vistaGuardada(user.vistasTabla, "proveedores")} editable={editable} />
      )}
    </>
  );
}
