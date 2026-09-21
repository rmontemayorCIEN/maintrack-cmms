import { prisma } from "@/lib/db";
import { fail, withVista } from "@/lib/api";
import { guionDelDia } from "@/lib/brief";
import { redactarBrief } from "@/lib/ia/brief";
import { sintetizar } from "@/lib/voz";

/**
 * El parte del dia, en audio.
 *
 * Devuelve el MP3 directo en vez de una liga firmada: son cien kilobytes y se
 * oyen una vez, asi que un redondeo mas por el almacen no compra nada y si
 * agrega una forma de fallar.
 *
 * Cuando no se puede sintetizar contesta 204 —sin contenido— en lugar de un
 * error: la pantalla lo entiende como «use la voz del aparato» y la persona
 * igual escucha su parte. Que se caiga la voz bonita no puede dejar a nadie
 * sin su informacion.
 */
export async function GET() {
  return withVista("/indicadores", async ({ user, orgId }) => {
    const completo = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true, name: true, role: true, organizationId: true,
        organization: { select: { id: true, timezone: true, currency: true, plan: true, iaComplemento: true, iaExtra: true, status: true } },
      },
    });
    if (!completo || completo.organizationId !== orgId) return fail("No encontrado", 404);

    const guion = await guionDelDia(completo);
    const brief = await redactarBrief(completo.organization as never, guion, { userId: user.id });
    const voz = await sintetizar(orgId, brief.texto);

    if (!voz) {
      return new Response(null, {
        status: 204,
        headers: { "X-Brief-Texto": encodeURIComponent(brief.texto) },
      });
    }

    return new Response(new Uint8Array(voz.audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(voz.audio.length),
        // El texto viaja en la cabecera para que la pantalla lo enseñe sin
        // pedir el parte dos veces: escuchando no hay forma de comprobar una
        // cifra, y quien quiera contrastarla necesita poder leerla.
        "X-Brief-Texto": encodeURIComponent(brief.texto),
        "X-Brief-Origen": voz.origen,
        // Privado y corto: es informacion de la empresa y cambia sola.
        "Cache-Control": "private, max-age=300",
      },
    });
  });
}
