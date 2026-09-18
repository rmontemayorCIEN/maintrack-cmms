import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { reconocerAviso } from "@/lib/avisos/emitir";

type Params = { params: Promise<{ id: string }> };
const schema = z.object({ accion: z.enum(["leer", "no_leida", "reconocer"]) });

/**
 * Una notificación propia: marcar leída o no leída, o «Enterado» (la
 * reconoce y, si su escalamiento se detiene con eso, lo detiene). Una
 * notificación de otra persona o empresa responde 404.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth(null, async ({ user }) => {
    const { accion } = schema.parse(await request.json());
    const n = await prisma.notification.findFirst({ where: { id, userId: user.id }, select: { id: true, organizationId: true } });
    if (!n) return fail("Aviso no encontrado", 404);
    if (accion === "reconocer") {
      await reconocerAviso({ organizationId: n.organizationId, userId: user.id, notificationId: n.id });
      return ok({ ok: true });
    }
    await prisma.notification.update({
      where: { id: n.id },
      data: accion === "leer" ? { read: true, leidaEl: new Date() } : { read: false, leidaEl: null },
    });
    return ok({ ok: true });
  });
}
