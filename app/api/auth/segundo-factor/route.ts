import { z } from "../../../../lib/zod";
import { prisma } from "@/lib/db";
import { leerDesafio } from "@/lib/auth";
import { estaFrenado, registrarIntento } from "@/lib/acceso";
import { completarEntrada } from "@/lib/entrada";
import { verificarAlEntrar } from "@/lib/segundo-factor";
import { fail, leerCuerpo, ok } from "@/lib/api";

const schema = z.object({ desafio: z.string().min(20).max(2000), codigo: z.string().trim().min(6).max(20) });

/**
 * El segundo paso de la entrada: la contraseña ya pasó (lo prueba el desafío
 * de cinco minutos), falta el código de la aplicación o uno de respaldo. Los
 * códigos equivocados cuentan en el mismo freno que las contraseñas.
 */
export async function POST(request: Request) {
  const cuerpo = await leerCuerpo(request, schema);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const userId = await leerDesafio(cuerpo.datos.desafio);
  if (!userId) return fail("Pasó demasiado tiempo. Vuelva a escribir su correo y contraseña.", 401);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) return fail("Pasó demasiado tiempo. Vuelva a escribir su correo y contraseña.", 401);

  const freno = await estaFrenado(user.email);
  if (freno.frenado) {
    await registrarIntento({ email: user.email, ip, exito: false, motivo: "BLOQUEADO" });
    return fail(`Demasiados intentos fallidos. Vuelva a intentar en ${freno.minutos} minuto(s).`, 429);
  }

  const tipo = await verificarAlEntrar(user.id, cuerpo.datos.codigo);
  if (!tipo) {
    await registrarIntento({ email: user.email, ip, exito: false, motivo: "SEGUNDO_FACTOR_MAL" });
    return fail("Ese código no coincide.", 401);
  }
  await completarEntrada(user, ip, tipo);
  return ok({ user: { id: user.id, name: user.name, role: user.role } });
}
