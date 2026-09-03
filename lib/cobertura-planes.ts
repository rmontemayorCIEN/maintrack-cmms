/**
 * Que equipos no tienen ningun plan de mantenimiento.
 *
 * La pregunta esta puesta al reves a proposito, y esa es toda la idea.
 *
 * Preguntar «a este plan que equipos le faltan» no se puede contestar sin
 * equivocarse: una planta tiene compresores tipo A, B y C, todos en la
 * categoria «Compresores», y cada tipo lleva su plan. Ningun plan puede saber
 * cuales compresores le tocan —eso lo sabe la persona.
 *
 * Preguntar «este equipo esta en algun plan» si tiene respuesta exacta, y es
 * la que importa: un equipo sin preventivo es una falla que no avisa hasta que
 * el equipo se para. Funciona igual con tres subtipos que con treinta.
 */
import { prisma } from "./db";

export type EquipoSinPlan = {
  id: string;
  code: string;
  name: string;
  criticality: string;
  categoriaId: string | null;
  categoriaNombre: string;
  sitio: string | null;
  /** Cuando se dio de alta: los recien llegados son los que suelen olvidarse. */
  creadoEl: Date;
};

export type CoberturaPreventiva = {
  totalActivos: number;
  conPlan: number;
  sinPlan: EquipoSinPlan[];
  /** Agrupado por categoria: ahi se ve el patron —«ninguna banda tiene plan». */
  porCategoria: { categoria: string; total: number; sinPlan: number }[];
};

export async function coberturaPreventiva(
  organizationId: string,
  opciones?: { soloCriticos?: boolean },
): Promise<CoberturaPreventiva> {
  const activos = await prisma.asset.findMany({
    where: {
      organizationId,
      active: true,
      // Un equipo retirado no necesita preventivo.
      status: { not: "RETIRED" },
      ...(opciones?.soloCriticos ? { criticality: "A" } : {}),
    },
    select: {
      id: true, code: true, name: true, criticality: true, createdAt: true,
      categoryId: true,
      category: { select: { name: true } },
      site: { select: { name: true } },
      // Basta saber si tiene AL MENOS UNA asignacion activa.
      _count: { select: { planesAsignados: { where: { active: true } } } },
    },
    orderBy: [{ criticality: "asc" }, { code: "asc" }],
  });

  const sinPlan = activos
    .filter((a) => a._count.planesAsignados === 0)
    .map((a) => ({
      id: a.id, code: a.code, name: a.name, criticality: a.criticality,
      categoriaId: a.categoryId,
      categoriaNombre: a.category?.name ?? "Sin categoría",
      sitio: a.site?.name ?? null,
      creadoEl: a.createdAt,
    }));

  const porCategoria = new Map<string, { total: number; sinPlan: number }>();
  for (const a of activos) {
    const clave = a.category?.name ?? "Sin categoría";
    const actual = porCategoria.get(clave) ?? { total: 0, sinPlan: 0 };
    actual.total += 1;
    if (a._count.planesAsignados === 0) actual.sinPlan += 1;
    porCategoria.set(clave, actual);
  }

  return {
    totalActivos: activos.length,
    conPlan: activos.length - sinPlan.length,
    sinPlan,
    porCategoria: [...porCategoria.entries()]
      .map(([categoria, v]) => ({ categoria, ...v }))
      .filter((c) => c.sinPlan > 0)
      .sort((a, b) => b.sinPlan - a.sinPlan),
  };
}

/**
 * Los planes de un equipo. Para la pantalla de asociacion, donde se mira desde
 * el lado del equipo y no del plan.
 */
export async function planesDelEquipo(organizationId: string, assetId: string) {
  return prisma.planAsset.findMany({
    where: { organizationId, assetId },
    orderBy: { nextDueDate: "asc" },
    select: {
      id: true, nextDueDate: true, active: true,
      plan: {
        select: {
          id: true, name: true, maintenanceType: true, triggerType: true,
          intervalDays: true, intervalMeter: true, active: true,
        },
      },
    },
  });
}
