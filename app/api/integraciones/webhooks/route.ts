import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { crearWebhook, ErrorDeWebhook, vistaDeWebhook } from "@/lib/integraciones/webhooks";

const schema = z.object({ nombre: z.string().trim().min(3).max(80), url: z.string().trim().min(8).max(500), eventos: z.array(z.string()).min(1).max(60) });

export async function GET() {
  return withAuth("settings:write", async ({ orgId }) => {
    const filas = await prisma.webhook.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" } });
    return ok({ webhooks: filas.map(vistaDeWebhook) });
  }, { esLectura: true });
}

/** Alta de webhook. El secreto de firma se devuelve UNA vez, en esta respuesta. */
export async function POST(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    try {
      return ok(await crearWebhook({ organizationId: orgId, userId: user.id, ...input }), 201);
    } catch (e) {
      if (e instanceof ErrorDeWebhook) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
