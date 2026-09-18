import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { esImportacionValida } from "@/lib/importacion";
import { ErrorDeImportacion, ejecutarImportacion, formatoDe, validarImportacion } from "@/lib/importacion-motor";

type Params = { params: Promise<{ tipo: string }> };

const cuerpo = z.object({
  // CSV: el texto. Excel: el archivo en base64, que ocupa un tercio más.
  contenido: z.string().min(1).max(11_000_000),
  formato: z.enum(["csv", "xlsx"]).optional(),
  archivoNombre: z.string().trim().max(200).optional().nullable(),
  decisiones: z.object({
    exactos: z.enum(["omitir", "actualizar"]).default("omitir"),
    crearPosibles: z.array(z.number().int().positive()).max(5000).default([]),
  }).optional(),
});

/** Excel o CSV: lo dice el formato, o si no, la extensión del nombre. */
const archivoDe = (input: z.infer<typeof cuerpo>) => ({
  formato: input.formato ?? formatoDe(input.archivoNombre),
  contenido: input.contenido,
  nombre: input.archivoNombre ?? null,
});

/**
 * La lógica vive en lib/importacion-motor.ts, que es lo que ejercitan las
 * pruebas. Aquí solo se valida la forma de lo que llega y se traduce el error.
 */
async function conError(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof ErrorDeImportacion) return fail(e.message, e.codigo);
    throw e;
  }
}

/** Validación y vista previa: dice qué pasaría, sin escribir un solo dato. */
export async function POST(request: Request, { params }: Params) {
  const { tipo } = await params;
  if (!esImportacionValida(tipo)) return fail("Tipo de importación desconocido", 404);
  return withAuth("settings:write", async ({ user, orgId }) => {
    const input = cuerpo.parse(await request.json());
    return conError(() => validarImportacion({
      tipo, archivo: archivoDe(input), organizationId: orgId, userId: user.id, decisiones: input.decisiones,
    }));
  });
}

/** Confirmación: vuelve a validar y guarda todo o nada, como un lote. */
export async function PUT(request: Request, { params }: Params) {
  const { tipo } = await params;
  if (!esImportacionValida(tipo)) return fail("Tipo de importación desconocido", 404);
  return withAuth("settings:write", async ({ user, orgId }) => {
    const input = cuerpo.parse(await request.json());
    return conError(() => ejecutarImportacion({
      tipo, archivo: archivoDe(input), organizationId: orgId, userId: user.id,
      plan: user.organization.plan, decisiones: input.decisiones,
    }));
  });
}
