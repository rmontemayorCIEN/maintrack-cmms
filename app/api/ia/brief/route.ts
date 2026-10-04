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
 *
 * ── El usuario se toma de `withAuth`, NO se vuelve a consultar ──
 *
 * La primera version releia el usuario de la base y comparaba su empresa
 * contra `orgId`. Con una sesion normal coincide siempre, asi que paso todas
 * las pruebas; pero cuando el operador entra a una empresa cliente —la demo,
 * por ejemplo—, `withAuth` ya le cambio la empresa por la del cliente y la de
 * la base sigue siendo la suya. La comparacion fallaba y el boton contestaba
 * «No encontrado». El usuario que entrega `withAuth` ya trae la suplantacion
 * resuelta: volver a leerlo de la base es deshacerla.
 */
export async function GET() {
  return withVista("/indicadores", async ({ user, orgId }) => {
    if (!user.organization || user.organizationId !== orgId) return fail("No encontrado", 404);

    const guion = await guionDelDia({
      id: user.id, name: user.name, role: user.role,
      organizationId: orgId,
      organization: user.organization,
    });
    const brief = await redactarBrief(user.organization as never, guion, { userId: user.id });

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
