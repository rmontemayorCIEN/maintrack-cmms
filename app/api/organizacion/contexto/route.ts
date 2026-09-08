import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { LARGO_MAXIMO, PREGUNTAS } from "@/lib/contexto-negocio";

const texto = z.string().trim().max(LARGO_MAXIMO).nullable().optional();

const schema = z.object(
  Object.fromEntries(PREGUNTAS.map((p) => [p.clave, texto])) as Record<
    (typeof PREGUNTAS)[number]["clave"],
    typeof texto
  >,
);

/**
 * Guarda lo que la empresa cuenta de si misma.
 *
 * El esquema se arma de la lista de preguntas y no se escribe a mano: agregar
 * una sexta pregunta manana no debe obligar a acordarse de este archivo. Ese
 * olvido no romperia nada —la pregunta simplemente no se guardaria— y es
 * justo la clase de fallo que nadie nota.
 */
export async function PATCH(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    const datos = Object.fromEntries(
      PREGUNTAS.map((p) => [p.clave, (input[p.clave] ?? "")?.trim() || null]),
    );
    const algoContestado = Object.values(datos).some(Boolean);

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        ...datos,
        // La fecha sirve para marcar el contexto como viejo al ano. Si se
        // vacio todo, se borra: un contexto en blanco con fecha reciente
        // diria que alguien lo reviso, y no hay nada que revisar.
        contextoAt: algoContestado ? new Date() : null,
      },
    });

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Organization",
      entityId: orgId,
      action: "UPDATED",
      // Se registra CUANTAS se contestaron, no su contenido: la bitacora la
      // leen todos los administradores y esto puede traer datos del negocio.
      summary: `Contexto del negocio actualizado (${Object.values(datos).filter(Boolean).length} de ${PREGUNTAS.length} preguntas)`,
    });

    return ok({ guardado: true });
  });
}
