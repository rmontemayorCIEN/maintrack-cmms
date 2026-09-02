import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { PanelEquivalencias } from "./panel";

export const metadata = { title: "Equivalencias sugeridas" };
export const dynamic = "force-dynamic";

export default async function EquivalenciasPage() {
  const user = await requireUser();

  const [registradas, refacciones] = await Promise.all([
    prisma.equivalenciaRefaccion.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, tipo: true, nota: true, createdAt: true,
        partA: { select: { code: true, name: true, quantityOnHand: true, unit: true } },
        partB: { select: { code: true, name: true, quantityOnHand: true, unit: true } },
      },
    }),
    prisma.part.count({ where: { organizationId: user.organizationId, active: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Equivalencias entre refacciones"
        description="Qué se puede usar en lugar de qué cuando la original no llega a tiempo."
        breadcrumb={
          <Link href="/inventory" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
            <ArrowLeft className="h-3.5 w-3.5" />
            Almacén de refacciones
          </Link>
        }
      />
      <PanelEquivalencias
        registradas={registradas.map((e) => ({
          id: e.id, tipo: e.tipo, nota: e.nota,
          a: e.partA, b: e.partB,
        }))}
        totalRefacciones={refacciones}
        editable={can(user.role, "inventory:write")}
      />
    </>
  );
}
