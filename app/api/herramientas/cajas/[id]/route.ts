import { fail, ok, withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { devolverKit } from "@/lib/herramientas";

/** Devuelve una caja, o la apaga. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("inventory:write", async ({ orgId, user }) => {
    const cuerpo = (await req.json().catch(() => null)) as
      | { accion?: "devolver" | "apagar"; grupo?: string; devueltos?: string[]; estadoRegreso?: string; activo?: boolean }
      | null;
    if (!cuerpo) return fail("No llegó nada que hacer");

    if (cuerpo.accion === "devolver") {
      if (!cuerpo.grupo) return fail("Falta decir qué salida se devuelve");
      const r = await devolverKit({
        organizationId: orgId, grupo: cuerpo.grupo,
        devueltos: cuerpo.devueltos, recibidoPorId: user.id, estadoRegreso: cuerpo.estadoRegreso,
      });
      return r.ok ? ok(r.dato) : fail(r.motivo, r.codigo ?? 409);
    }

    const caja = await prisma.kitDeHerramientas.findFirst({ where: { id, organizationId: orgId }, select: { id: true, code: true } });
    if (!caja) return fail("Esa caja no existe", 404);

    // Se apaga, no se borra: lo que ya salió en ella sigue siendo historia.
    await prisma.kitDeHerramientas.update({ where: { id: caja.id }, data: { activo: cuerpo.activo ?? false } });
    await logAudit({
      organizationId: orgId, userId: user.id, action: cuerpo.activo ? "UPDATE" : "DELETE",
      entity: "KitDeHerramientas", entityId: caja.id,
      summary: `${cuerpo.activo ? "Reactivó" : "Apagó"} la caja ${caja.code}`,
    });
    return ok({ actualizada: true });
  });
}
