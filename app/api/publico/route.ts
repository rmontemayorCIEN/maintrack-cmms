import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { ErrorDePortal, levantarSolicitud, recordarReportante, recuperarSeguimiento } from "@/lib/portal";

export const maxDuration = 60;

/**
 * Endpoint publico del portal de reportes.
 *
 * NO usa withAuth: es la unica ruta del sistema que escribe sin sesion. Por eso
 * no recibe ningun identificador de organizacion —lo determina el token del
 * punto de reporte— y todo lo demas se valida contra ese token.
 */
const schema = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("REPORTAR"),
    punto: z.string().trim().min(10).max(64),
    titulo: z.string().trim().min(5).max(140),
    descripcion: z.string().trim().max(1000).optional().nullable(),
    nombre: z.string().trim().min(3).max(120),
    celular: z.string().trim().min(7).max(24),
    correo: z.union([z.string().trim().email(), z.literal("")]).optional().nullable(),
    foto: z
      .object({
        base64: z.string().min(100).max(7_000_000),
        tipo: z.enum(["image/jpeg", "image/png", "image/webp"]),
      })
      .optional()
      .nullable(),
  }),
  z.object({
    accion: z.literal("RECUPERAR"),
    folio: z.string().trim().min(3).max(30),
    celular: z.string().trim().min(7).max(24),
  }),
]);

export async function POST(request: Request) {
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return fail("Faltan datos o vienen incompletos. Revise el nombre, el celular y la descripción.", 422);
  }

  try {
    if (input.accion === "RECUPERAR") {
      const tok = await recuperarSeguimiento(input.folio, input.celular);
      // La misma respuesta exista o no: un folio equivocado no debe revelar
      // cuales folios si existen.
      if (!tok) return fail("No encontramos una solicitud con ese folio y ese celular.", 404);
      // El folio correcto ya probo que es su solicitud: de ahi en adelante el
      // dispositivo lo recuerda y no vuelve a teclear nada.
      await recordarReportante(input.celular);
      return ok({ seguimiento: tok });
    }

    // Quien acaba de reportar tampoco tiene por que volver a identificarse.
    const reportado = await levantarSolicitud({
      tokenPunto: input.punto,
      titulo: input.titulo,
      descripcion: input.descripcion,
      nombre: input.nombre,
      celular: input.celular,
      correo: input.correo,
      foto: input.foto ?? null,
      // El origen lo pone Cloud Run en la cabecera; no se confia en nada que
      // mande el navegador, que podria decir lo que quiera.
      origen: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
    await recordarReportante(input.celular);
    return ok(reportado, 201);
  } catch (error) {
    if (error instanceof ErrorDePortal) return fail(error.message, 422);
    console.error("[portal]", error instanceof Error ? error.message : error);
    return fail("No fue posible enviar el reporte. Intente de nuevo en un momento.", 500);
  }
}
