import { ok, withAuth } from "@/lib/api";
import { enviarPush } from "@/lib/push";

/**
 * Manda un aviso de prueba a los aparatos de quien lo pide.
 *
 * Esta ruta no es un adorno de la pantalla: es la unica forma de comprobar el
 * canal completo —servidor, llaves, navegador, permiso del sistema operativo—
 * de una sola vez. Sin ella, "activado" en la pantalla solo significa que se
 * guardo un renglon, y el usuario se entera de que nunca funciono el dia que
 * se le pasa una falla.
 *
 * Nadie prueba el telefono de otro: siempre va al de la sesion.
 */
export async function POST() {
  return withAuth(null, async ({ user }) => {
    const resultado = await enviarPush(user.id, {
      title: "Prueba de MainTrack",
      body: `Si está leyendo esto, ${user.name.split(" ")[0]}, los avisos ya funcionan en este aparato.`,
      link: "/settings?s=avisos",
      tag: "prueba",
    });

    /**
     * Se devuelve el porque, no un "no se pudo".
     *
     * Cada motivo manda a la persona a un lugar distinto: uno lo arregla el
     * administrador, otro el operador de la plataforma, y otro se arregla
     * tocando el boton de activar en este mismo telefono.
     */
    const MOTIVOS: Record<string, string> = {
      SIN_LLAVES: "El servidor todavía no tiene configurados los avisos. Repórtelo a soporte.",
      APAGADO: "Su empresa tiene los avisos apagados. Un administrador puede encenderlos aquí mismo.",
      SIN_DISPOSITIVOS: "Este aparato todavía no está activado. Use el botón de activar.",
    };

    if (resultado.motivo) {
      return ok({ ...resultado, mensaje: MOTIVOS[resultado.motivo] });
    }

    if (resultado.entregados === 0) {
      return ok({
        ...resultado,
        mensaje:
          resultado.dadasDeBaja > 0
            ? "El aparato que estaba registrado ya no existe —se reinstaló o se borró el icono—. Vuelva a activarlo."
            : "No se pudo entregar el aviso. Revise que el teléfono tenga red e inténtelo otra vez.",
      });
    }

    return ok({
      ...resultado,
      mensaje:
        resultado.entregados === 1
          ? "Enviado. Debe aparecer en la pantalla en unos segundos."
          : `Enviado a ${resultado.entregados} aparatos.`,
    });
  });
}
