import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { coberturaPreventiva } from "@/lib/cobertura-planes";
import { PageHeader } from "@/components/ui";
import { PanelCobertura } from "./panel";

export const metadata = { title: "Equipos y sus planes" };
export const dynamic = "force-dynamic";

/**
 * Que equipo tiene que plan, y cuales no tienen ninguno.
 *
 * Se mira desde el lado del EQUIPO. Desde el lado del plan no se puede saber
 * que equipos le tocan —una planta tiene compresores tipo A, B y C en la misma
 * categoria, cada tipo con su plan, y eso solo lo sabe la persona.
 */
export default async function CoberturaPage() {
  const user = await requireUser();

  const [cobertura, activos, planes, categorias, sitios] = await Promise.all([
    coberturaPreventiva(user.organizationId),
    prisma.asset.findMany({
      where: { organizationId: user.organizationId, active: true, status: { not: "RETIRED" } },
      orderBy: [{ code: "asc" }],
      select: {
        id: true, code: true, name: true, criticality: true,
        categoryId: true, siteId: true,
        category: { select: { name: true } },
        site: { select: { name: true } },
        planesAsignados: {
          where: { active: true },
          select: {
            id: true, nextDueDate: true,
            plan: { select: { id: true, name: true, triggerType: true, active: true } },
          },
        },
      },
    }),
    prisma.maintenancePlan.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, maintenanceType: true, triggerType: true,
        intervalDays: true, intervalMeter: true,
        _count: { select: { asignaciones: true } },
      },
    }),
    prisma.assetCategory.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.site.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Equipos y sus planes"
        description="Qué plan tiene cada equipo, y cuáles no tienen ninguno."
        breadcrumb={
          <Link href="/plans" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
            <ArrowLeft className="h-3.5 w-3.5" />
            Planes de mantenimiento
          </Link>
        }
      />
      <PanelCobertura
        resumen={{ total: cobertura.totalActivos, conPlan: cobertura.conPlan, sinPlan: cobertura.sinPlan.length }}
        activos={activos.map((a) => ({
          id: a.id, code: a.code, name: a.name, criticality: a.criticality,
          categoriaId: a.categoryId,
          categoria: a.category?.name ?? "Sin categoría",
          sitioId: a.siteId,
          sitio: a.site?.name ?? null,
          planes: a.planesAsignados.map((p) => ({
            asignacionId: p.id,
            planId: p.plan.id,
            nombre: p.plan.name,
            porMedidor: p.plan.triggerType === "METER",
            proxima: p.nextDueDate?.toISOString() ?? null,
          })),
        }))}
        planes={planes.map((p) => ({
          id: p.id, nombre: p.name,
          tipo: p.maintenanceType,
          porMedidor: p.triggerType === "METER",
          cada: p.triggerType === "METER" ? p.intervalMeter : p.intervalDays,
          equipos: p._count.asignaciones,
        }))}
        categorias={categorias}
        sitios={sitios}
        editable={can(user.role, "plan:write")}
      />
    </>
  );
}
