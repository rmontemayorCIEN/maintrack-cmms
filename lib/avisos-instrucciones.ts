/**
 * Como instalar MainTrack y activar los avisos, paso a paso y por aparato.
 *
 * Vive fuera del componente por dos razones: se prueba sin navegador, y el
 * mismo texto lo va a necesitar la ayuda con IA cuando alguien pregunte "por
 * que no me llegan los avisos".
 *
 * Los pasos dicen DONDE esta el boton, no solo como se llama. "Toque
 * Compartir" no le sirve a quien nunca lo ha usado; "el cuadro con la flecha
 * hacia arriba, abajo al centro" si.
 */

export type ClavePlataforma = "IOS" | "ANDROID" | "ESCRITORIO";

export type Instructivo = {
  titulo: string;
  /** Por que hay que hacer esto. Sin el motivo, los pasos se sienten arbitrarios. */
  porque: string;
  pasos: string[];
  /** Lo que suele salir mal en este aparato. */
  advertencias?: string[];
  /** Como recuperar el permiso cuando el sistema ya lo tiene bloqueado. */
  bloqueado: string[];
};

export const INSTRUCTIVOS: Record<ClavePlataforma, Instructivo> = {
  IOS: {
    titulo: "iPhone y iPad",
    porque:
      "En iPhone los avisos SOLO llegan si MainTrack está agregado a la pantalla de inicio. No es un paso opcional: Safari no entrega avisos a una pestaña normal. Es una regla de Apple, no del sistema.",
    pasos: [
      "Abra MainTrack en Safari. En iPhone tiene que ser Safari: desde Chrome o Firefox no se puede agregar.",
      "Toque el botón Compartir: el cuadrito con una flecha hacia arriba, en la barra de abajo, al centro.",
      "Deslice el menú hacia abajo hasta encontrar «Agregar a inicio» (Add to Home Screen).",
      "Toque «Agregar», arriba a la derecha.",
      "Salga de Safari. En la pantalla de inicio ya está el icono azul de MainTrack.",
      "Abra MainTrack DESDE ESE ICONO, no desde Safari.",
      "Entre a Configuración → Avisos y toque «Activar en este aparato».",
      "iOS pregunta si permite las notificaciones: toque «Permitir».",
    ],
    advertencias: [
      "Se necesita iOS 16.4 o más nuevo. En Ajustes → General → Información aparece la versión.",
      "Si borra el icono de la pantalla de inicio, se pierde la activación y hay que repetir todo.",
      "Abrir MainTrack desde Safari con el icono ya instalado no manda los avisos ahí: son dos cosas separadas para el teléfono.",
    ],
    bloqueado: [
      "Abra Ajustes del iPhone (el engrane gris).",
      "Baje hasta encontrar MainTrack en la lista de aplicaciones y tóquelo.",
      "Entre a «Notificaciones» y encienda «Permitir notificaciones».",
      "Vuelva a MainTrack y toque «Activar en este aparato» otra vez.",
    ],
  },

  ANDROID: {
    titulo: "Android",
    porque:
      "En Android los avisos funcionan aunque no instale nada, pero conviene instalarlo: se abre más rápido, sin la barra de direcciones, y el aviso llega con el icono de MainTrack en vez del de Chrome.",
    pasos: [
      "Abra MainTrack en Chrome.",
      "Toque los tres puntos de arriba a la derecha.",
      "Elija «Instalar aplicación» o «Agregar a pantalla principal», según la versión.",
      "Confirme con «Instalar».",
      "Abra MainTrack desde el icono nuevo.",
      "Entre a Configuración → Avisos y toque «Activar en este aparato».",
      "Android pregunta si permite las notificaciones: toque «Permitir».",
    ],
    advertencias: [
      "Si el teléfono tiene ahorro de batería agresivo —Xiaomi, Huawei, Samsung en modo de ahorro— puede retrasar los avisos. Conviene sacar a MainTrack de la optimización de batería.",
      "No use el modo incógnito: ahí no se guarda la activación.",
    ],
    bloqueado: [
      "Abra Ajustes del teléfono.",
      "Entre a «Aplicaciones» y busque MainTrack (o Chrome, si no lo instaló).",
      "Entre a «Notificaciones» y actívelas.",
      "Vuelva a MainTrack y toque «Activar en este aparato» otra vez.",
    ],
  },

  ESCRITORIO: {
    titulo: "Computadora",
    porque:
      "En la computadora los avisos llegan sin instalar nada, siempre que el navegador esté abierto —aunque MainTrack esté en otra pestaña o minimizado.",
    pasos: [
      "Toque «Activar en este aparato».",
      "El navegador pregunta arriba si permite las notificaciones: elija «Permitir».",
      "Listo. Puede mandarse un aviso de prueba para comprobarlo.",
    ],
    advertencias: [
      "Si cierra el navegador por completo, los avisos no llegan hasta que lo vuelva a abrir. Para no depender de eso, active también su teléfono.",
      "No funciona en ventanas de incógnito.",
    ],
    bloqueado: [
      "Toque el candado (o el icono de ajustes) a la izquierda de la dirección, arriba.",
      "Busque «Notificaciones» y cámbielo a «Permitir».",
      "Recargue la página y toque «Activar en este aparato» otra vez.",
    ],
  },
};

/** El aparato desde el que se está viendo, a partir del identificador del navegador. */
export function plataformaDe(userAgent: string, puntosTactiles = 0): ClavePlataforma {
  // El iPad moderno se anuncia como Mac. La unica senal que lo delata es que
  // acepta varios dedos a la vez: ninguna Mac lo hace.
  if (/iPad|iPhone|iPod/i.test(userAgent)) return "IOS";
  if (/Macintosh/i.test(userAgent) && puntosTactiles > 1) return "IOS";
  if (/Android/i.test(userAgent)) return "ANDROID";
  return "ESCRITORIO";
}
