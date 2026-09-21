import { prisma } from "@/lib/db";
import { fail, ok, withVista } from "@/lib/api";
import { guionDelDia } from "@/lib/brief";
import { redactarBrief } from "@/lib/ia/brief";

/**
 * El brief del dia, para escucharlo.
 *
 * Se protege con la ruta de indicadores —el criterio que ya define quien ve el
 * panorama de la empresa— en vez de con un permiso nuevo: quien no puede ver
 * los indicadores tampoco tiene por que oir un resumen de ellos.
 *
 * Es de SOLO LECTURA, y eso no es casualidad. Esto se usa manejando: dictar
 * «cierra la orden noventa» a cien por hora, con ruido y sin ver que entendio,
 * es capturar mal un dato que despues nadie puede explicar —y en una orden el
 * cierre arrastra horas, costo y codigo de falla—. Preguntar y escuchar, si;
 * modificar, no.
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

    return ok({
      // El texto tambien se devuelve, no solo se habla: oyendolo no hay forma
      // de verificar nada, y quien quiera contrastar una cifra necesita poder
      // leerla. Es la misma razon por la que los puntos viajan con su enlace.
      texto: brief.texto,
      origen: brief.origen,
      saludo: guion.saludo,
      fecha: guion.fecha,
      tranquilo: guion.tranquilo,
      puntos: guion.puntos.map((p) => ({ clave: p.clave, texto: p.texto, enlace: p.enlace })),
      masPuntos: guion.masPuntos,
    });
  });
}
