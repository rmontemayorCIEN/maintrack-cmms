import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth, withVista } from "@/lib/api";
import { veTodasLasSolicitudes } from "@/lib/pantallas";
import { enFila, hace } from "@/lib/repeticion";
import { nextRequestNumber } from "@/lib/numbering";
import { avisarSolicitudNueva } from "@/lib/avisos/detectores";

const schema = z.object({
  title: z.string().min(3),
  description: z.string().optional().nullable(),
  assetId: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  // Las preguntas del formulario sencillo: dónde, si impide trabajar, si hay
  // riesgo y cómo contactar. Todo opcional: la API sigue aceptando lo de antes.
  donde: z.string().trim().max(200).optional().nullable(),
  impideTrabajar: z.boolean().optional(),
  riesgo: z.enum(["NINGUNO", "ALTO"]).optional(),
  riesgoMotivo: z.string().trim().max(300).optional().nullable(),
  contacto: z.string().trim().max(80).optional().nullable(),
});

export async function GET() {
  return withVista("/requests", async ({ orgId, user }) => {
    // El solicitante y el técnico ven las que levantaron; quien revisa, todas.
    const requests = await prisma.workRequest.findMany({
      where: { organizationId: orgId, ...(veTodasLasSolicitudes(user.role) ? {} : { requestedById: user.id }) },
      include: {
        asset: { select: { code: true, name: true } },
        requestedBy: { select: { name: true, color: true } },
        workOrder: { select: { id: true, number: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return ok({ requests });
  });
}

export async function POST(request: Request) {
  return withAuth("request:create", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const asset = input.assetId
      ? await prisma.asset.findFirst({ where: { id: input.assetId, organizationId: orgId } })
      : null;

    // Un doble toque no levanta dos reportes (lib/repeticion.ts).
    return enFila(`solicitud:${user.id}:${input.title.trim().toLowerCase()}`, async () => {
    const repetida = await prisma.workRequest.findFirst({
      where: { organizationId: orgId, requestedById: user.id, title: input.title, createdAt: { gte: hace() } },
      select: { number: true },
    });
    if (repetida) return fail(`Ese reporte ya se envió hace un momento (${repetida.number}). No se levantó otro.`, 409);

    const number = await nextRequestNumber(orgId);
    const workRequest = await prisma.workRequest.create({
      data: {
        organizationId: orgId,
        number,
        title: input.title,
        // Dónde y si impide trabajar van en el texto, con palabras: es lo que
        // lee quien revisa, y no piden columnas nuevas.
        description: [
          input.description?.trim() || null,
          input.donde ? `Dónde: ${input.donde}` : null,
          input.impideTrabajar === undefined ? null : `Impide trabajar: ${input.impideTrabajar ? "sí" : "no"}`,
        ].filter(Boolean).join("\n") || null,
        riesgo: input.riesgo ?? "NINGUNO",
        riesgoMotivo: input.riesgo === "ALTO" ? input.riesgoMotivo || "Quien reporta indicó que hay riesgo" : null,
        reporterCelular: input.contacto || null,
        assetId: asset?.id ?? null,
        siteId: asset?.siteId ?? null,
        locationId: input.locationId ?? asset?.locationId ?? null,
        priority: input.priority,
        requestedById: user.id,
      },
    });

    // A quien revisa solicitudes, empezando por supervisión (no a todo rol alto).
    await avisarSolicitudNueva(orgId, workRequest, { cuerpo: input.title });

    return ok({ request: workRequest }, 201);
    });
  });
}
