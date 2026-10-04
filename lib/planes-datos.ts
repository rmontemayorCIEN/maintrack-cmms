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
  const [activos, medidores, tecnicos, especialidades, refacciones, servicios, herramientas, herramientasActivo, cajas] = await Promise.all([
    prisma.asset.findMany({ where: { organizationId, active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.meter.findMany({ where: { organizationId }, select: { id: true, name: true, unit: true, assetId: true, currentValue: true } }),
    prisma.user.findMany({ where: { organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.specialty.findMany({ where: { organizationId }, select: { id: true, code: true, name: true, hourlyRate: true }, orderBy: { code: "asc" } }),
    prisma.part.findMany({ where: { organizationId, active: true }, select: { id: true, code: true, name: true, unit: true, unitCost: true }, orderBy: { code: "asc" } }),
    prisma.externalService.findMany({ where: { organizationId, active: true }, select: { id: true, code: true, name: true, unit: true, unitCost: true }, orderBy: { code: "asc" } }),
    // Las tres formas en que una herramienta existe: generica del almacen,
    // cara y serializada como activo, o una caja que sale completa.
    prisma.part.findMany({ where: { organizationId, active: true, naturaleza: "HERRAMIENTA" }, select: { id: true, code: true, name: true, unit: true }, orderBy: { code: "asc" } }),
    prisma.asset.findMany({ where: { organizationId, active: true, sePresta: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.kitDeHerramientas.findMany({ where: { organizationId, activo: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  return {
    activos, medidores, tecnicos,
    opcEspecialidades: especialidades.map((e) => ({ id: e.id, etiqueta: `${e.code} — ${e.name}`, costo: e.hourlyRate, unidad: "h" })),
    opcRefacciones: refacciones.map((r) => ({ id: r.id, etiqueta: `${r.code} — ${r.name}`, costo: r.unitCost, unidad: r.unit })),
    opcServicios: servicios.map((s) => ({ id: s.id, etiqueta: `${s.code} — ${s.name}`, costo: s.unitCost, unidad: s.unit })),
    // Las herramientas no se consumen: no llevan costo, por eso va en cero.
    opcHerramientas: herramientas.map((h) => ({ id: h.id, etiqueta: `${h.code} — ${h.name}`, costo: 0, unidad: h.unit })),
    opcHerramientasActivo: herramientasActivo.map((a) => ({ id: a.id, etiqueta: `${a.code} — ${a.name}`, costo: 0 })),
    opcCajas: cajas.map((k) => ({ id: k.id, etiqueta: `${k.code} — ${k.name}`, costo: 0 })),
  };
}
