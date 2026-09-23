import { fail, ok, withAuth } from "@/lib/api";
import { escuchar, MAXIMO_SEGUNDOS_DICTADO, USD_POR_SEGUNDO } from "@/lib/escucha";
import { puedeUsarIa, registrarEscucha } from "@/lib/ia/consumo";

/**
 * El cierre de la orden, dictado.
 *
 * ── Por que es una ruta aparte de la del chat ──
 *
 * `/api/ia/voz/escuchar` transcribe igual, pero esta amarrada al chat con
 * voz: exige Enterprise, gasta el tope de la voz y vive bajo la vista de
 * consulta. Reusarla habria dejado al tecnico de Professional sin dictar
 * —justo a quien esto sirve— y habria hecho que dictar un cierre le quitara
 * al director un parte del dia. Lo comun de verdad es `escuchar()`, y eso si
 * se reusa; lo que cambia es quien puede, de que bolsa sale y cuanto dura.
 *
 * ── El permiso ──
 *
 * `workorder:execute` es el del tecnico, que es quien cierra. Pedir un
 * permiso de administracion dejaria fuera al unico que sabe lo que paso, que
 * es el error que ya se evito en la ruta de codificacion con IA.
 *
 * Y no es solo para que se vea el boton: sin candado aqui, una cuenta de solo
 * lectura podria vaciarle la bolsa a su empresa desde la consola del
 * navegador. La transcripcion no escribe nada, pero cuesta.
 *
 * ── Por que solo transcribe ──
 *
 * Devuelve palabras y nada mas. No cierra la orden, no codifica y no guarda:
 * el texto vuelve a la pantalla, la persona lo lee y lo corrige, y el cierre
 * pasa por la ruta de siempre con sus mismas validaciones. Un atajo que
 * escribiera directo seria una segunda puerta a la orden de trabajo, con sus
 * propias reglas y sus propios defectos.
 */

/**
 * Un minuto de audio comprimido no llega a medio mega; cuatro dejan margen
 * para el MP4 de Safari, que pesa mas que el WebM de Chrome.
 *
 * El tope existe porque esto recibe un archivo. Sin el, alguien podria subir
 * una hora de grabacion y cobrarsela a su empresa —el cupo cuenta dictados,
 * no minutos, asi que un solo envio enorme se saltaria el racionamiento—.
 */
const MAXIMO_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const org = {
      id: orgId,
      plan: user.organization.plan,
      iaComplemento: user.organization.iaComplemento,
      iaExtra: user.organization.iaExtra,
    };

    const veredicto = await puedeUsarIa(org, "DICTADO");
    // 402 y no 403: no es que no tenga permiso, es que se acabo el cupo. La
    // pantalla enseña el motivo tal cual, que ya viene redactado y dice con
    // que puede seguir trabajando.
    if (!veredicto.permitido) return fail(veredicto.motivo, 402);

    const crudo = await request.arrayBuffer();
    if (!crudo.byteLength) return fail("No llegó el audio", 422);
    if (crudo.byteLength > MAXIMO_BYTES) {
      return fail(`La grabación es muy larga. Máximo ${MAXIMO_SEGUNDOS_DICTADO} segundos.`, 413);
    }

    /**
     * Modelo largo, y la razon es un defecto medido, no una preferencia.
     *
     * Con el modelo corto, el mismo audio de cuarenta y nueve segundos entro
     * completo una vez y a la mitad otra —facturando 19 de 49 segundos—, sin
     * dar error ninguna de las dos. Un cierre cortado que se lee bien es
     * exactamente el defecto que nadie encuentra: el tecnico no se acuerda
     * palabra por palabra de lo que dicto, da por bueno lo que ve, y la orden
     * queda con la mitad de lo que paso.
     */
    const oido = await escuchar(Buffer.from(crudo), "largo");

    // Nulo es que la llamada no se pudo hacer. No se facturo nada, asi que no
    // se registra gasto: seria inventarlo.
    if (!oido) {
      return fail("No se pudo transcribir en este momento. Escriba el cierre a mano.", 502);
    }

    const entendio = oido.texto.trim().length > 0;

    /**
     * Se registra aunque no se haya entendido, porque igual se cobro.
     *
     * Y se registra con `ok: false` en ese caso: cuesta, pero no se le
     * descuenta un dictado al cliente. Cobrarle el ruido de su planta seria
     * cobrarle por nada.
     *
     * Sin esperar a que termine: el texto ya esta listo y hacer que el tecnico
     * espere a que se guarde la contabilidad seria ponerle el costo a quien no
     * le toca. Si falla, `registrarDictado` lo reporta y no lanza.
     */
    const segundos = oido.segundosFacturados;
    void registrarEscucha({
      organizationId: orgId,
      funcion: "DICTADO",
      userId: user.id,
      // Cuando Google no reporta la duracion se guarda cero y se ve como tal
      // en la consola. Es preferible a repartir un promedio inventado sobre
      // el que despues alguien tome una decision.
      segundos: segundos ?? 0,
      costoUsd: (segundos ?? 0) * USD_POR_SEGUNDO,
      ok: entendio,
    });

    // Que no se entienda NO es una falla del sistema: es lo que pasa con una
    // banda corriendo al lado. Se contesta 200 con el hueco y la pantalla lo
    // dice como lo diria una persona.
    return ok({ texto: oido.texto, confianza: oido.confianza });
  });
}
