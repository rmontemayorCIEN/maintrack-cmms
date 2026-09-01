import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { PageHeader, EmptyState } from "@/components/ui";
import { NewWorkOrderForm } from "./form";

export const metadata = { title: "Nueva orden de trabajo" };
export const dynamic = "force-dynamic";

export default async function NewWorkOrderPage() {
  const user = await requireUser();
  if (!can(user.role, "workorder:write")) {
    return (
      <>
        <PageHeader title="Nueva orden de trabajo" />
        <EmptyState
          title="Sin permisos"
          description="Su rol no permite crear ordenes de trabajo. Puede levantar una solicitud de servicio."
        />
      </>
    );
  }

  const [assets, technicians, teams] = await Promise.all([
    prisma.asset.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: { id: true, code: true, name: true, criticality: true },
      orderBy: { code: "asc" },
    }),
    prisma.user.findMany({
      where: { organizationId: user.organizationId, active: true, role: { in: ["ADMIN", "SUPERVISOR", "TECHNICIAN", "OWNER"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.team.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Nueva orden de trabajo"
        description="Registre un trabajo correctivo, preventivo, predictivo o de mejora."
        breadcrumb="Operacion / Ordenes de trabajo"
      />
      <NewWorkOrderForm
        assets={assets}
        technicians={technicians}
        teams={teams}
        puedeGestionarCatalogos={can(user.role, "settings:write")}
      />
    </>
  );
}
