/**
 * Que termino del glosario tiene una cifra de la propia empresa, y cual no.
 *
 * ── Por que este archivo existe ──
 *
 * «MTBF: tiempo medio entre fallas» lo dice cualquier diccionario. Lo que
 * ningun diccionario puede decir es «el suyo va en 2,284 horas». Esto es lo
 * que conecta las dos cosas.
 *
 * ── Y por que la segunda lista pesa tanto como la primera ──
 *
 * De los 82 terminos del glosario solo 7 tienen hoy una cifra calculada. Los
 * que NO la tienen son, casualmente, los mas vistosos: OEE, confiabilidad,
 * wrench time. Si al abrirlos quedara un hueco, la funcion se sentiria rota
 * justo donde mas se mira; y si se enseñara una cifra parecida —la
 * disponibilidad haciendola pasar por OEE— seria peor: un numero preciso y
 * falso, que es el unico error del que este proyecto no se recupera.
 *
 * Asi que se dice que no se calcula Y que haria falta para calcularlo. Eso no
 * es una disculpa: es informacion util, porque le dice al cliente que tendria
 * que capturar si lo quiere.
 *
 * ── Sin dependencias, a proposito ──
 *
 * Lo lee la pantalla del glosario, que corre en el navegador.
 */

/**
 * Termino del glosario → clave del indicador que lo calcula
 * (`lib/indicadores.ts`).
 *
 * La llave es el termino TAL CUAL esta escrito en `lib/glosario.ts`. Si
 * alguien lo renombra ahi, esto deja de encontrarlo: por eso hay una prueba
 * que recorre las dos listas y falla cuando una clave se queda huerfana.
 */
export const CIFRA_DE_TERMINO: Record<string, string> = {
  "MTBF": "mtbf",
  "MTTR": "mttr",
  "Disponibilidad": "disponibilidad",
  "Cumplimiento PM": "cumplimientoPreventivo",
  "Backlog": "backlog",
  "Tiempo de respuesta": "tiempoRespuesta",
  "Trabajo planificado": "trabajoPlanificado",
};

/**
 * Terminos que se ven como indicador pero que el sistema NO calcula, y por
 * que.
 *
 * Se dice en la tarjeta, sin que nadie pregunte. Callarlo dejaria a alguien
 * buscando en Reportes un numero que no esta.
 */
export const SIN_CIFRA: Record<string, string> = {
  "OEE":
    "Necesita datos de producción —piezas por hora contra la velocidad nominal, y piezas buenas contra producidas— que un sistema de mantenimiento no captura. De sus tres factores, aquí solo vive la disponibilidad.",
  "Confiabilidad":
    "Es una probabilidad a lo largo del tiempo, no un promedio: pide un modelo de distribución de fallas por equipo. El sistema tiene el MTBF, que es su pariente cercano y sí se calcula.",
  "Wrench time":
    "Pide separar, dentro de las horas del técnico, las que pasó con las manos en el equipo de las de traslado, espera y búsqueda de refacciones. El sistema registra horas totales por orden, no ese desglose. Medirlo se hace con muestreo en piso.",
  "MTTF":
    "Es para componentes que se reemplazan en vez de repararse, así que pide seguir la vida de cada pieza puesta. El sistema sigue las órdenes del equipo, no el ciclo de vida de cada refacción instalada.",
  "Adherencia al programa":
    "Compara lo que estaba programado PARA LA SEMANA contra lo que se ejecutó, y eso pide congelar un programa semanal. El sistema mide cumplimiento contra la fecha compromiso de cada orden, que es parecido pero no lo mismo.",
};

/** Lo que se necesita para enseñar la cifra de un termino en su tarjeta. */
export type CifraDeTermino = {
  /** Como se llama el indicador en Reportes, para que se pueda ir a buscarlo. */
  nombre: string;
  valor: number | null;
  unidad: string;
  /** El calculo con los numeros de la empresa. Es lo que hace creible la cifra. */
  calculo: string;
  /** Cuando no hay valor, por que. Viene del propio calculo, no se inventa. */
  sinValor: string | null;
};
