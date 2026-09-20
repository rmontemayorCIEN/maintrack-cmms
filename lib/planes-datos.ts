import { prisma } from "./db";

/**
 * Los catálogos que alimentan el alta y la edición de un plan: equipos,
 * medidores, responsables, especialidades, refacciones y servicios.
 *
 * Viven aquí porque los piden dos pantallas —la lista de planes y el
 * expediente de un plan— y son la misma consulta. Repetirla era garantizar
 * que un día una muestre equipos inactivos y la otra no.
 */
export async function catalogosDePlanes(organizationId: string) {
  const [activos, medidores, tecnicos, especialidades, refacciones, servicios] = await Promise.all([
    prisma.asset.findMany({ where: { organizationId, active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.meter.findMany({ where: { organizationId }, select: { id: true, name: true, unit: true, assetId: true, currentValue: true } }),
    prisma.user.findMany({ where: { organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.specialty.findMany({ where: { organizationId }, select: { id: true, code: true, name: true, hourlyRate: true }, orderBy: { code: "asc" } }),
    prisma.part.findMany({ where: { organizationId, active: true }, select: { id: true, code: true, name: true, unit: true, unitCost: true }, orderBy: { code: "asc" } }),
    prisma.externalService.findMany({ where: { organizationId, active: true }, select: { id: true, code: true, name: true, unit: true, unitCost: true }, orderBy: { code: "asc" } }),
  ]);
  return {
    activos, medidores, tecnicos,
    opcEspecialidades: especialidades.map((e) => ({ id: e.id, etiqueta: `${e.code} — ${e.name}`, costo: e.hourlyRate, unidad: "h" })),
    opcRefacciones: refacciones.map((r) => ({ id: r.id, etiqueta: `${r.code} — ${r.name}`, costo: r.unitCost, unidad: r.unit })),
    opcServicios: servicios.map((s) => ({ id: s.id, etiqueta: `${s.code} — ${s.name}`, costo: s.unitCost, unidad: s.unit })),
  };
}
