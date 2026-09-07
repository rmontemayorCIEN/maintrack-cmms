import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, parseDate, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  criticality: z.enum(["A", "B", "C"]).optional(),
  status: z.enum(["OPERATIONAL", "DEGRADED", "DOWN", "STANDBY", "RETIRED"]).optional(),
  purchaseDate: z.string().nullable().optional(),
  purchaseCost: z.coerce.number().min(0).optional(),
  replacementCost: z.coerce.number().min(0).optional(),
  warrantyExpiry: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("asset:write", async ({ user, orgId }) => {
    const existing = await prisma.asset.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return fail("Activo no encontrado", 404);
    const input = schema.parse(await request.json());
    const data: Record<string, unknown> = { ...input };
    if (input.purchaseDate !== undefined) data.purchaseDate = parseDate(input.purchaseDate);
    if (input.warrantyExpiry !== undefined) data.warrantyExpiry = parseDate(input.warrantyExpiry);
    const asset = await prisma.asset.update({ where: { id }, data });
    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Asset",
      entityId: id,
      action: "UPDATED",
      summary: `${existing.code} actualizado`,
      changes: input,
    });
    return ok({ asset });
  });
}

/**
 * Lo que impide eliminar un activo de verdad.
 *
 * No es integridad referencial: es la historia del equipo. Una orden cerrada,
 * una lectura de medidor o un paro registrado son el respaldo de lo que costo
 * mantenerlo. Borrar el activo se los lleva en cascada, y con ellos el
 * historial que justifica tener el sistema.
 *
 * Un activo capturado por error —un clima duplicado— no tiene nada de esto y
 * se puede ir sin dejar hueco.
 */
const ATADURAS = [
  { campo: "workOrders", singular: "orden de trabajo", plural: "órdenes de trabajo" },
  { campo: "plans", singular: "plan de mantenimiento", plural: "planes de mantenimiento" },
  { campo: "meters", singular: "medidor", plural: "medidores" },
  { campo: "sensors", singular: "sensor", plural: "sensores" },
  { campo: "requests", singular: "solicitud", plural: "solicitudes" },
  { campo: "alerts", singular: "alerta predictiva", plural: "alertas predictivas" },
  { campo: "downtimes", singular: "paro registrado", plural: "paros registrados" },
  { campo: "children", singular: "activo hijo", plural: "activos hijos" },
] as const;

/**
 * Retira o elimina un activo.
 *
 * Son dos operaciones distintas y el dominio necesita las dos. Retirar es para
 * el equipo que salio de operacion: se conserva entero con su historial y sus
 * costos. Eliminar es para el que nunca debio existir, y solo procede si no
 * arrastra nada.
 */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const eliminar = new URL(request.url).searchParams.get("eliminar") === "1";

  return withAuth("asset:write", async ({ user, orgId }) => {
    const existing = await prisma.asset.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true, code: true, name: true,
        _count: {
          select: {
            workOrders: true, plans: true, meters: true, sensors: true,
            requests: true, alerts: true, downtimes: true, children: true,
          },
        },
      },
    });
    if (!existing) return fail("Activo no encontrado", 404);

    if (eliminar) {
      const atado = ATADURAS
        .map(({ campo, singular, plural }) => {
          const n = existing._count[campo];
          return n > 0 ? `${n} ${n === 1 ? singular : plural}` : null;
        })
        .filter(Boolean) as string[];

      if (atado.length) {
        // Se dice exactamente que lo detiene y cual es la salida. Un "no se
        // puede" sin motivo obliga al usuario a adivinar cual de ocho
        // relaciones es la que estorba.
        return fail(
          `No se puede eliminar ${existing.code}: tiene ${atado.join(", ")}. ` +
            `Esa informacion es su historial. Si el equipo salio de operacion, retirelo en vez de eliminarlo.`,
          409,
        );
      }

      // Los adjuntos y las ligas si se van con el: son del activo, no
      // historial de la operacion. El esquema los borra en cascada.
      await prisma.asset.delete({ where: { id } });
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "Asset", entityId: id, action: "DELETED",
        summary: `Activo eliminado: ${existing.code} ${existing.name}`,
      });
      return ok({ success: true, eliminado: true });
    }

    // Baja logica: conserva historial de OT y costos.
    await prisma.asset.update({ where: { id }, data: { active: false, status: "RETIRED" } });
    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Asset",
      entityId: id,
      action: "RETIRED",
      summary: `${existing.code} dado de baja`,
    });
    return ok({ success: true, eliminado: false });
  });
}
