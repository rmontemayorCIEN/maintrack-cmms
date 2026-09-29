import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada, motivoLegible } from "@/lib/ia/cliente";
import { leerDocumentoDeNorma } from "@/lib/ia/norma-documento";
import { logAudit } from "@/lib/audit";

// Leer un PDF completo tarda mas que cualquier otra funcion del sistema.
export const maxDuration = 300;

/**
 * Los textos se RECORTAN al escribir, no se rechazan.
 *
 * Lo que llega aqui lo propuso el modelo hace un momento y la persona ya lo
 * aprobo en pantalla, renglon por renglon. Tirar la obligacion entera porque
 * la cita salio veinte caracteres larga seria perder trabajo ya revisado y ya
 * pagado.
 */
const recortado = (max: number) => z.string().trim().transform((t) => t.slice(0, max));

const schema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("LEER"), adjuntoId: z.string().min(1) }),
  z.object({
    accion: z.literal("ADOPTAR"),
    normaId: z.string().min(1),
    obligaciones: z.array(z.object({
      titulo: recortado(200).pipe(z.string().min(3)),
      detalle: recortado(800).nullable(),
      tipo: z.enum(["ACTIVIDAD", "DOCUMENTO", "DATO", "RECORRIDO", "CAPACITACION"]),
      cadaMeses: z.number().int().positive().max(600).nullable(),
      cita: recortado(600),
      donde: recortado(120).nullable(),
    })).min(1),
  }),
]);

export async function POST(request: Request) {
  // Mismo permiso que el resto de las rutas de normas: quien administra la
  // norma es quien decide que obligaciones le entran.
  return withAuth("settings:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    if (input.accion === "ADOPTAR") {
      const norma = await prisma.normaAdoptada.findFirst({
        where: { id: input.normaId, organizationId: orgId },
        select: { id: true, clave: true },
      });
      if (!norma) return fail("Esa norma no existe", 404);

      // Los meses del documento se guardan en dias, que es como el sistema
      // cuenta. 30.44 y no 30: con 30, «cada cinco años» quedaba mes y medio
      // corto y la obligacion se vencia antes de tiempo, sola.
      const enDias = (meses: number | null) => (meses === null ? null : Math.round(meses * 30.44));

      const creadas = await prisma.$transaction(
        input.obligaciones.map((o, i) => prisma.obligacionAdoptada.create({
          data: {
            normaId: norma.id,
            clave: `IA-${Date.now().toString(36)}-${i}`,
            titulo: o.titulo,
            detalle: [
              o.detalle,
              // La cita viaja con la obligacion y no se tira: es lo unico que
              // la hace verificable. Quien la revise despues —o un inspector—
              // va al renglon del documento sin leerlo entero.
              `Del documento${o.donde ? ` (${o.donde})` : ""}: «${o.cita}»`,
            ].filter(Boolean).join("\n\n"),
            tipo: o.tipo,
            cadaDias: enDias(o.cadaMeses),
          },
          select: { id: true },
        })),
      );

      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "NormaAdoptada", entityId: norma.id, action: "UPDATE",
        summary: `${creadas.length} obligación(es) agregadas a ${norma.clave} desde un documento leído con IA`,
      });
      return ok({ agregadas: creadas.length });
    }

    if (!iaConfigurada()) return fail("La lectura de documentos con IA no está configurada en este servidor.", 503);
    try {
      const r = await leerDocumentoDeNorma(
        {
          id: orgId,
          plan: user.organization.plan,
          iaComplemento: user.organization.iaComplemento,
          iaExtra: user.organization.iaExtra,
        },
        { adjuntoId: input.adjuntoId, userId: user.id },
      );
      if (!r.ok) return fail(r.motivo, 402);
      return ok({ lectura: r.lectura });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(motivoLegible(error), 502);
    }
  });
}
