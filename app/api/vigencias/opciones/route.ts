import { prisma } from "@/lib/db";
import { ok, withAuth } from "@/lib/api";

/**
 * De que puede colgar una vigencia, en una sola peticion.
 *
 * Cuatro listas —equipos, refacciones, personas y servicios externos— porque
 * el dialogo de alta necesita las cuatro segun el tipo que se elija, y
 * pedirlas por separado eran cuatro viajes para llenar un mismo formulario.
 * Se topan: una planta con diez mil refacciones no necesita bajarlas todas
 * para registrar una garantia, y quien busca una en particular la encuentra
 * por su expediente.
 */
const TOPE = 500;

export async function GET() {
  return withAuth("vigencia:write", async ({ orgId }) => {
    const [activos, refacciones, personas, servicios, proveedores] = await Promise.all([
      prisma.asset.findMany({ where: { organizationId: orgId, active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" }, take: TOPE }),
      prisma.part.findMany({ where: { organizationId: orgId, active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" }, take: TOPE }),
      prisma.user.findMany({ where: { organizationId: orgId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: TOPE }),
      prisma.externalService.findMany({ where: { organizationId: orgId, active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" }, take: TOPE }),
      prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: TOPE }),
    ]);
    return ok({
      opciones: {
        assetId: activos.map((a) => ({ id: a.id, etiqueta: `${a.code} · ${a.name}` })),
        partId: refacciones.map((p) => ({ id: p.id, etiqueta: `${p.code} · ${p.name}` })),
        userId: personas.map((u) => ({ id: u.id, etiqueta: u.name ?? "—" })),
        serviceId: servicios.map((s) => ({ id: s.id, etiqueta: `${s.code} · ${s.name}` })),
      },
      proveedores: proveedores.map((p) => ({ id: p.id, etiqueta: p.name })),
    });
  });
}
