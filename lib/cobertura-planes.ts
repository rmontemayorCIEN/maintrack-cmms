/**
 * Que equipos de un tipo quedaron sin su plan.
 *
 * El riesgo que resuelve: se define el plan de compresores, se aplica a los
 * cuatro que hay, y seis meses despues entra el quinto. Nadie se acuerda de
 * agregarlo y ese equipo se queda sin preventivo —una falla que no avisa hasta
 * que el equipo se para.
 *
 * Deliberadamente NO se asigna solo. Aplicar un plan es comprometer trabajo con
 * una fecha, y eso lo decide una persona. Lo que si hace el sistema es no
 * dejar que pase inadvertido.
 */
import { prisma } from "./db";

export type Descubierto = {
  planId: string;
  planNombre: string;
  categoriaId: string;
  categoriaNombre: string;
  /** Equipos de ese tipo que NO tienen el plan aplicado. */
  equipos: { id: string; code: string; name: string; criticality: string }[];
};

export async function equiposSinSuPlan(organizationId: string): Promise<Descubierto[]> {
  const planes = await prisma.maintenancePlan.findMany({
    where: { organizationId, active: true, categoryId: { not: null } },
    select: {
      id: true, name: true, categoryId: true,
      category: { select: { id: true, name: true } },
      asignaciones: { select: { assetId: true } },
    },
  });
  if (!planes.length) return [];

  const categorias = [...new Set(planes.map((p) => p.categoryId!))];
  const activos = await prisma.asset.findMany({
    where: { organizationId, active: true, categoryId: { in: categorias } },
    select: { id: true, code: true, name: true, criticality: true, categoryId: true },
    orderBy: { code: "asc" },
  });

  return planes
    .map((p) => {
      const yaTiene = new Set(p.asignaciones.map((a) => a.assetId));
      const equipos = activos.filter((a) => a.categoryId === p.categoryId && !yaTiene.has(a.id));
      return {
        planId: p.id,
        planNombre: p.name,
        categoriaId: p.categoryId!,
        categoriaNombre: p.category?.name ?? "—",
        equipos: equipos.map(({ categoryId: _, ...resto }) => resto),
      };
    })
    .filter((d) => d.equipos.length > 0);
}

/** Los equipos de un tipo que todavia no tienen este plan. */
export async function candidatosDelTipo(organizationId: string, planId: string) {
  const plan = await prisma.maintenancePlan.findFirst({
    where: { id: planId, organizationId },
    select: {
      categoryId: true,
      category: { select: { name: true } },
      asignaciones: { select: { assetId: true } },
    },
  });
  if (!plan?.categoryId) return { categoria: null, equipos: [] };

  const yaTiene = new Set(plan.asignaciones.map((a) => a.assetId));
  const activos = await prisma.asset.findMany({
    where: { organizationId, active: true, categoryId: plan.categoryId },
    select: { id: true, code: true, name: true, criticality: true },
    orderBy: { code: "asc" },
  });
  return {
    categoria: plan.category?.name ?? null,
    equipos: activos.filter((a) => !yaTiene.has(a.id)),
  };
}
