import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";

/**
 * Como quiere ver este usuario una de las tablas del sistema.
 *
 * Es preferencia personal, no configuracion de la cuenta: cualquiera que entre
 * acomoda la suya sin tocar la de nadie. Una vista nula borra la preferencia
 * de esa tabla y la devuelve a la de fabrica.
 */
const schema = z.object({
  clave: z.string().trim().min(1).max(40).regex(/^[a-z-]+$/),
  vista: z
    .object({
      columnas: z.array(z.string().max(40)).max(40).optional(),
      grupos: z.array(z.string().max(40)).max(3).optional(),
    })
    .nullable(),
});

export async function PUT(request: Request) {
  return withAuth(null, async ({ user }) => {
    const { clave, vista } = schema.parse(await request.json());

    // Se lee lo guardado y se toca solo la llave de esta tabla: guardar la
    // vista de activos no debe borrar la del almacen.
    let vistas: Record<string, unknown> = {};
    try {
      const previo = JSON.parse(user.vistasTabla || "{}");
      if (previo && typeof previo === "object" && !Array.isArray(previo)) vistas = previo;
    } catch {
      vistas = {};
    }

    if (vista) vistas[clave] = vista;
    else delete vistas[clave];

    // Cota de seguridad: el cuerpo viene del navegador y la columna es texto.
    const serializado = JSON.stringify(vistas);
    if (serializado.length > 8000) return fail("La configuración de vistas es demasiado grande", 413);

    await prisma.user.update({ where: { id: user.id }, data: { vistasTabla: serializado } });
    return ok({ success: true });
  });
}
