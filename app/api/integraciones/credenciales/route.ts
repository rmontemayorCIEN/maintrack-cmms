import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { crearCredencial, ErrorDeCredencial } from "@/lib/integraciones/credenciales";
import { leerJson } from "@/lib/avisos/config";

const schema = z.object({
  nombre: z.string().trim().min(3).max(80),
  alcances: z.array(z.string()).min(1).max(20),
  expiraDias: z.number().int().min(1).max(730).nullable().optional(),
});

/** Credenciales de la empresa de la sesión. Nunca devuelve el secreto: solo su prefijo. */
export async function GET() {
  return withAuth("settings:write", async ({ orgId }) => {
    const filas = await prisma.credencialApi.findMany({
      where: { organizationId: orgId }, orderBy: { createdAt: "desc" },
      select: { id: true, nombre: true, prefijo: true, alcances: true, estado: true, expiraEl: true, ultimoUsoEl: true, usos: true, createdAt: true, revocadaEl: true },
    });
    const ahora = Date.now();
    return ok({
      credenciales: filas.map((c) => ({
        ...c, alcances: leerJson<string[]>(c.alcances, []), mascara: `mt_${c.prefijo}_…`,
        estado: c.estado === "ACTIVA" && c.expiraEl && c.expiraEl.getTime() < ahora ? "VENCIDA" : c.estado,
      })),
    });
  }, { esLectura: true });
}

/** Crea una credencial. El secreto se devuelve UNA vez, en esta respuesta. */
export async function POST(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    try {
      const r = await crearCredencial({ organizationId: orgId, userId: user.id, ...input });
      return ok(r, 201);
    } catch (e) {
      if (e instanceof ErrorDeCredencial) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
