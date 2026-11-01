import { z } from "@/lib/zod";
import { fail, leerCuerpo, ok, withAuth } from "@/lib/api";
import { CLAVES_NOTA } from "@/consultor/esquema";
import { apagarNotaDe, arrancarDe, guardarNotaDe, preguntarDe, restaurarNotaDe, saltarEntrevistaDe } from "@/lib/consultor/consultor";
import { quienDe } from "@/lib/consultor/quien";

export const dynamic = "force-dynamic";

/**
 * Lo que se hace desde la pantalla del Consultor: preguntar, notas y la
 * entrevista. La empresa y el rol salen de la sesion; el cuerpo se valida aqui
 * y otra vez en `lib/consultor/consultor.ts`, que es lo que llama la prueba.
 */
const Id = z.string().min(1).max(40);
const Cuerpo = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("preguntar"), texto: z.string().max(4000), ruta: z.string().max(120).nullable() }),
  z.object({ accion: z.literal("nota"), tipo: z.enum(CLAVES_NOTA as [string, ...string[]]), texto: z.string().max(4000) }),
  z.object({ accion: z.literal("apagarNota"), id: Id }),
  z.object({ accion: z.literal("restaurarNota"), id: Id }),
  z.object({ accion: z.literal("arrancar"), respuestas: z.record(z.string().max(20), z.string().max(600)) }),
  z.object({ accion: z.literal("saltar") }),
]);

export async function POST(request: Request) {
  return withAuth("consultor:use", async ({ user }) => {
    const leido = await leerCuerpo(request, Cuerpo);
    if (!leido.ok) return leido.respuesta;
    const c = leido.datos;
    const q = quienDe(user);
    const ahora = new Date();
    const r =
      c.accion === "preguntar" ? await preguntarDe(q, c.texto, c.ruta, { ahora })
        : c.accion === "nota" ? await guardarNotaDe(q, c.tipo, c.texto)
          : c.accion === "apagarNota" ? await apagarNotaDe(q, c.id)
            : c.accion === "restaurarNota" ? await restaurarNotaDe(q, c.id)
              : c.accion === "arrancar" ? await arrancarDe(q, c.respuestas, ahora)
                : await saltarEntrevistaDe(q, ahora);
    return r.ok ? ok(r) : fail(r.error, 422);
  });
}
