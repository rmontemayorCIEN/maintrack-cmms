import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, withAuth } from "@/lib/api";
import { VOCES } from "@/lib/voz";
import { LARGOS_DE_RESPUESTA } from "@/lib/respuestas-voz";

const CLAVES_DE_VOZ = VOCES.map((v) => v.id) as unknown as [string, ...string[]];
const LARGOS = LARGOS_DE_RESPUESTA.map((l) => l.clave) as unknown as [string, ...string[]];

/**
 * Preferencias de como se ve —y como se oye— el sistema.
 *
 * La escala, la densidad y la voz del parte se guardan en el usuario; el color
 * y el logo en la organizacion, y esos si piden permiso de configuracion.
 * Nadie deberia poder cambiarle el tamaño de letra a otro, ni un tecnico
 * cambiar la identidad visual de la empresa.
 */
const personal = z.object({
  escalaUi: z.enum(["NORMAL", "GRANDE", "MAYOR"]).optional(),
  densidadUi: z.enum(["COMPACTA", "COMODA", "AMPLIA"]).optional(),
  /**
   * Con que voz oye el parte del dia. Tambien es personal: al director le
   * puede gustar una y a su jefe de mantenimiento otra. Se valida contra el
   * catalogo para no guardar una voz que Google no conoce —eso daria un
   * silencio sin explicacion a la hora de escuchar—.
   */
  vozBrief: z.enum(CLAVES_DE_VOZ).nullable().optional(),
  /**
   * Que tan larga es la respuesta HABLADA. Personal por la misma razon que la
   * voz: quien va manejando quiere el numero y ya, y quien revisa sentado
   * quiere el contexto. Ver `lib/respuestas-voz.ts`.
   */
  respuestaVoz: z.enum(LARGOS).nullable().optional(),
});

const empresa = z.object({
  colorAcento: z.enum(["AZUL", "INDIGO", "TEAL", "VERDE", "AMBAR", "GRAFITO"]).optional(),
  logoUrl: z.string().trim().max(500).nullable().optional(),
});

export async function PATCH(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const cuerpo = await request.json();
    const mias = personal.parse(cuerpo);

    if (Object.keys(mias).length) {
      await prisma.user.update({ where: { id: user.id }, data: mias });
    }

    const deLaEmpresa = empresa.parse(cuerpo);
    if (Object.keys(deLaEmpresa).length) {
      const { can } = await import("@/lib/rbac");
      if (!can(user.role, "settings:write")) {
        return ok({ error: "Solo quien administra la cuenta puede cambiar el logo y el color" }, 403);
      }
      await prisma.organization.update({ where: { id: orgId }, data: deLaEmpresa });
    }

    return ok({ success: true });
  });
}
