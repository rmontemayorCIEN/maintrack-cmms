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

export type Decision = "calibrando" | "esperando" | "hablando" | "cortar";

export type OpcionesDetector = {
  /** Cuanto silencio, en ms, se toma como «ya termino». */
  silencioMs: number;
  /** Cada cuanto llegan las muestras. */
  muestraMs: number;
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
      // no arranca.
      if (!hablo) return "esperando";
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
export const SILENCIO_COMANDO_MS = 1800;
export const SILENCIO_DICTADO_MS = 3200;
