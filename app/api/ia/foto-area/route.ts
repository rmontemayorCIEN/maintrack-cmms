import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada } from "@/lib/ia/cliente";
import { reconocerArea } from "@/lib/ia/foto-area";
import { clasificar, construirRuta, guardarArchivo } from "@/lib/almacenamiento";

export const maxDuration = 180;

const schema = z.object({
  base64: z.string().min(100).max(7_000_000),
  tipo: z.enum(["image/jpeg", "image/png", "image/webp"]),
  zona: z.string().trim().max(120).optional().nullable(),
});

/** Reconoce equipos en la foto de un area, para el levantamiento. */
export async function POST(request: Request) {
  return withAuth("asset:write", async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("La función de inteligencia artificial no esta configurada en este servidor.", 503);
    }
    const input = schema.parse(await request.json());

    try {
      const r = await reconocerArea(
        { id: orgId, plan: user.organization.plan, iaComplemento: user.organization.iaComplemento, iaExtra: user.organization.iaExtra },
        {
          base64: input.base64, tipo: input.tipo, zona: input.zona,
          userId: user.id, operador: user.isSuperAdmin,
          org: user.organization,
        },
      );
      if (!r.ok) return fail(r.motivo, 402);

      // La foto se conserva como evidencia del levantamiento.
      //
      // Antes se analizaba y se tiraba: quedaban activos dados de alta sin
      // nada que respaldara por que existen. Lo que sostiene un levantamiento
      // frente a un cliente o un auditor no es la lista, es la foto de donde
      // salio.
      //
      // Nace sin dueño porque el borrador todavia no existe —el usuario apenas
      // esta subiendo fotos— y se enlaza cuando se crea. Si nunca se crea, la
      // foto queda huerfana y la recoge la limpieza.
      let fotoId: string | null = null;
      try {
        const datos = Buffer.from(input.base64, "base64");
        const ruta = construirRuta(orgId, "levantamientos", `area.${input.tipo.split("/")[1] ?? "jpg"}`);
        await guardarArchivo(ruta, datos, input.tipo);

        const reconocidos = r.lectura.equipos.map((e) => `${e.cantidad}× ${e.nombre} (${e.confianza})`);
        const adjunto = await prisma.attachment.create({
          data: {
            organizationId: orgId,
            uploadedById: user.id,
            name: `${input.zona?.trim() || r.lectura.descripcionDeLoQueVe || "Area"}.${input.tipo.split("/")[1] ?? "jpg"}`.slice(0, 120),
            storagePath: ruta,
            mimeType: input.tipo,
            kind: clasificar(input.tipo),
            size: datos.length,
            note: [
              r.lectura.descripcionDeLoQueVe,
              reconocidos.length ? `Reconocido: ${reconocidos.join("; ")}` : null,
              r.lectura.util ? null : `Foto no utilizable: ${r.lectura.problema}`,
            ].filter(Boolean).join(" · ").slice(0, 900),
          },
          select: { id: true },
        });
        fotoId = adjunto.id;
      } catch {
        // Si el almacen falla, el reconocimiento ya sirvio y no se pierde: se
        // devuelve sin evidencia en vez de tumbar el paso completo.
        fotoId = null;
      }

      return ok({ lectura: r.lectura, fotoId });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(error instanceof Error ? error.message : "No fue posible analizar la foto", 502);
    }
  });
}
