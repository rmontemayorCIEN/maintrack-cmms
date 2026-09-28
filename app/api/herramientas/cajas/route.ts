import { fail, ok, withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { prestarKit } from "@/lib/herramientas";

/** Arma una caja, o la presta. */
export async function POST(req: Request) {
  return withAuth("inventory:write", async ({ orgId, user }) => {
    const cuerpo = (await req.json().catch(() => null)) as
      | {
          accion?: "armar" | "prestar";
          code?: string; name?: string; notas?: string;
          piezas?: Array<{ partId?: string; assetId?: string; cantidad?: number }>;
          kitId?: string; personaId?: string; warehouseId?: string; estadoSalida?: string; proposito?: string;
        }
      | null;
    if (!cuerpo) return fail("No llegó nada");

    if (cuerpo.accion === "prestar") {
      if (!cuerpo.kitId || !cuerpo.personaId) return fail("Falta qué caja y para quién");
      const r = await prestarKit({
        organizationId: orgId, kitId: cuerpo.kitId, personaId: cuerpo.personaId,
        entregadoPorId: user.id, warehouseId: cuerpo.warehouseId,
        estadoSalida: cuerpo.estadoSalida, proposito: cuerpo.proposito,
      });
      return r.ok ? ok(r.dato, 201) : fail(r.motivo, r.codigo ?? 409);
    }

    const code = cuerpo.code?.trim().toUpperCase();
    const name = cuerpo.name?.trim();
    if (!code || !name) return fail("La caja necesita clave y nombre");
    if (!cuerpo.piezas?.length) return fail("Una caja sin piezas no sirve de nada: agregue al menos una");

    const repetida = await prisma.kitDeHerramientas.findFirst({ where: { organizationId: orgId, code }, select: { id: true } });
    if (repetida) return fail(`Ya tiene una caja con la clave «${code}»`, 409);

    /*
     * Cada pieza tiene que ser DE ESTA EMPRESA y apuntar a exactamente una
     * cosa. Los ids llegan del navegador: sin esto se podria armar una caja
     * con la herramienta de otra cuenta.
     */
    for (const p of cuerpo.piezas) {
      if (Boolean(p.partId) === Boolean(p.assetId)) return fail("Cada pieza es del almacén o una unidad, no las dos");
      const existe = p.partId
        ? await prisma.part.findFirst({ where: { id: p.partId, organizationId: orgId, naturaleza: "HERRAMIENTA" }, select: { id: true } })
        : await prisma.asset.findFirst({ where: { id: p.assetId!, organizationId: orgId, sePresta: true }, select: { id: true } });
      if (!existe) return fail("Una de las piezas no es una herramienta de esta empresa", 422);
    }

    const caja = await prisma.kitDeHerramientas.create({
      data: {
        organizationId: orgId, code, name, notas: cuerpo.notas?.trim() || null,
        piezas: {
          create: cuerpo.piezas.map((p) => ({
            partId: p.partId ?? null, assetId: p.assetId ?? null, cantidad: p.cantidad ?? 1,
          })),
        },
      },
      select: { id: true, code: true },
    });

    await logAudit({
      organizationId: orgId, userId: user.id, action: "CREATE",
      entity: "KitDeHerramientas", entityId: caja.id,
      summary: `Armó la caja ${caja.code} con ${cuerpo.piezas.length} piezas`,
    });
    return ok({ caja }, 201);
  });
}
