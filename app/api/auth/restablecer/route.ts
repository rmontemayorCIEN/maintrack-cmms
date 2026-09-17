import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { ErrorDeAcceso, revisarRestablecimiento, usarRestablecimiento } from "@/lib/acceso";

const schema = z.object({
  token: z.string().min(20).max(120),
  password: z.string().min(8).max(200),
});

/**
 * Cambia la contrasena con una liga de un solo uso. Publica a proposito: quien
 * la usa justamente no puede entrar. Lo que la protege es el token, que vence,
 * sirve una vez y no se guarda en claro.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("La contraseña debe tener al menos 8 caracteres", 422);
  try {
    await usarRestablecimiento(parsed.data.token, parsed.data.password);
    return ok({ success: true });
  } catch (e) {
    if (e instanceof ErrorDeAcceso) return fail(e.message, e.codigo);
    throw e;
  }
}

/** Solo dice si la liga sirve y de quien es el nombre, para saludar. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const r = token ? await revisarRestablecimiento(token) : null;
  if (!r) return fail("Esta liga ya no sirve. Pida una nueva a su administrador.", 410);
  return ok(r);
}
