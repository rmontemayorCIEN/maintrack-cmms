/**
 * Saber cuando alguien termino de hablar.
 *
 * ── Por que no basta un umbral fijo ──
 *
 * Esto se usa en una planta. El «silencio» junto a un compresor de tornillo
 * tiene mas energia que la voz de alguien en una oficina, asi que un numero
 * fijo o corta a media frase o no corta nunca, segun donde se este parado.
 *
 * Por eso lo primero que hace es ESCUCHAR EL LUGAR: las primeras muestras son
 * el ruido de fondo, y el umbral se pone por encima de eso. El mismo comando
 * dicho en la nave y en la oficina se corta igual de bien.
 *
 * ── Por que espera a que alguien hable ──
 *
 * Si armara el corte desde el primer instante, cortaria a los dos segundos de
 * abrir el microfono a quien tarda en arrancar —que es lo normal: uno toca el
 * boton y despues piensa que va a decir—. Primero tiene que oir voz; solo
 * entonces empieza a contar el silencio.
 *
 * ── Sin dependencias, a proposito ──
 *
 * Lo usa el navegador, y ademas se puede probar sin microfono: se le dan
 * niveles a mano y se comprueba cuando decide cortar. La parte que mide el
 * audio de verdad vive en el componente; la decision, aqui.
 */

export type Decision = "calibrando" | "esperando" | "hablando" | "cortar" | "abandonar";

export type OpcionesDetector = {
  /** Cuanto silencio, en ms, se toma como «ya termino». */
  silencioMs: number;
  /** Cada cuanto llegan las muestras. */
  muestraMs: number;
  /**
   * Cuanto se espera a que alguien EMPIECE a hablar antes de darse por vencido.
   *
   * No es lo mismo que `silencioMs`, que es la pausa que cierra una frase ya
   * empezada. Esto es el caso de nadie: se abrio el microfono y no hablo
   * nadie —se distrajo, lo dejo en la mesa, se fue—.
   *
   * Sin esto, el microfono se queda abierto hasta el tope de un minuto y
   * despues sube ese minuto de silencio a transcribir, que se cobra por
   * segundo. Con manos libres eso pasa CADA vez que alguien deja la
   * conversacion abierta, no una vez.
   */
  esperaMaximaMs?: number;
  /**
   * Cuantas muestras se dedican a oir el lugar antes de decidir nada.
   *
   * Medio segundo alcanza para el ruido de fondo y no se siente. Si alguien
   * empieza a hablar dentro de ese medio segundo, el ruido medido sale alto y
   * el umbral tambien: por eso hay un tope, mas abajo.
   */
  muestrasDeCalibracion?: number;
};

/**
 * Cuanto por encima del ruido de fondo tiene que estar la voz.
 *
 * La voz a treinta centimetros del telefono esta muy por encima del ruido
 * ambiente incluso en una nave. Dos y medio deja margen sin volverse sordo.
 */
const SOBRE_EL_RUIDO = 2.5;

/**
 * Piso y techo del umbral.
 *
 * El piso evita que en una grabacion perfectamente muda el umbral quede en
 * cero y cualquier chasquido cuente como voz. El techo evita lo contrario: que
 * alguien empiece a hablar durante la calibracion, el ruido medido salga por
 * las nubes y despues no se oiga nada por encima de el.
 */
const UMBRAL_MINIMO = 0.012;
const UMBRAL_MAXIMO = 0.12;

export function crearDetectorDeSilencio(opciones: OpcionesDetector) {
  const calibracion = opciones.muestrasDeCalibracion ?? 5;
  const paraCortar = Math.max(1, Math.round(opciones.silencioMs / opciones.muestraMs));
  const paraRendirse = opciones.esperaMaximaMs
    ? calibracion + Math.max(1, Math.round(opciones.esperaMaximaMs / opciones.muestraMs))
    : Infinity;

  let muestras = 0;
  let sumaRuido = 0;
  let umbral = UMBRAL_MINIMO;
  let hablo = false;
  let callado = 0;

  return {
    /** El nivel de esta muestra (0 a 1). Devuelve que hacer. */
    alNivel(nivel: number): Decision {
      muestras++;
      if (muestras <= calibracion) {
        sumaRuido += nivel;
        if (muestras === calibracion) {
          const ruido = sumaRuido / calibracion;
          umbral = Math.min(UMBRAL_MAXIMO, Math.max(UMBRAL_MINIMO, ruido * SOBRE_EL_RUIDO));
        }
        return "calibrando";
      }

      if (nivel > umbral) {
        hablo = true;
        callado = 0;
        return "hablando";
      }

      // Silencio. Solo cuenta si ya hubo voz: si no, es alguien que todavia
      // no arranca —o nadie, y entonces hay que cerrar en vez de grabar el
      // cuarto vacio hasta el tope.
      if (!hablo) return muestras >= paraRendirse ? "abandonar" : "esperando";
      callado++;
      return callado >= paraCortar ? "cortar" : "hablando";
    },

    /** Para poder enseñar en pantalla por que se comporta como se comporta. */
    get estado() {
      return { umbral, hablo, muestras };
    },
  };
}

/**
 * Cuanto silencio se espera segun lo que se este haciendo.
 *
 * Un comando es una frase corta y quien lo dice quiere que pase algo ya. Un
 * cierre de orden se dicta a pausas —uno se acuerda de la refaccion a media
 * frase— y cortarle a los dos segundos seria pelearse con quien esta
 * trabajando. Por eso no es el mismo numero.
 */
/**
 * Un segundo ochenta se probo y corta demasiado pronto.
 *
 * Rafael: «se corta rapido, no me alcanza para formular lo que quiero». Y
 * tiene sentido: al hablarle a una maquina uno arranca, duda a media frase y
 * corrige —«cuanto llevo gastado en… en refacciones este año»—. Esperar tres
 * segundos no se siente lento cuando ya no hay que tocar nada para seguir;
 * cortar a media pregunta obliga a repetirla entera, que es mucho peor.
 */
export const SILENCIO_COMANDO_MS = 3000;
export const SILENCIO_DICTADO_MS = 3500;

/**
 * Cuanto se espera a que alguien empiece, antes de cerrar solo.
 *
 * Doce segundos es de sobra para tocar el boton, pensar y arrancar. Pasados
 * esos, o no hay nadie o no se le oye, y las dos cosas se atienden igual:
 * cerrar sin mandar nada. Se noto con manos libres, donde el microfono se
 * reabre solo: quien deja la conversacion abierta y se va generaba un minuto
 * de silencio subido a transcribir cada vez.
 */
export const ESPERA_MAXIMA_MS = 12_000;
