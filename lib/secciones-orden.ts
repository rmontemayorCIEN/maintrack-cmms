/**
 * Que secciones de la orden nacen desplegadas, segun en que va el trabajo.
 *
 * ── Por que ──
 *
 * La ficha de la orden tiene nueve secciones y todas nacian abiertas siempre.
 * En el telefono eso es una columna que hay que recorrer entera para encontrar
 * lo que se esta buscando, y es la pantalla donde un tecnico vive su turno.
 *
 * No todas sirven al mismo tiempo: quien va a empezar necesita las actividades
 * y el procedimiento; quien esta a media reparacion, las horas y el material;
 * quien cierra, el resultado. Lo que no toca en ese momento sigue ahi, a un
 * toque, pero recogido.
 *
 * ── La regla que manda sobre todas ──
 *
 * Una seccion con algo pendiente SIEMPRE nace abierta, sin importar el estado.
 * Esconder lo que falta para cerrar seria justo el defecto que este proyecto
 * ya pago caro: lo que deberia verse y no se ve.
 *
 * ── Lo que esto NO decide ──
 *
 * Que secciones existen ni si tienen contenido: eso lo resuelve la pantalla.
 * Aqui solo se decide si nacen abiertas. Quien las abra o cierre a mano manda
 * sobre esto.
 */

export type ClaveSeccion =
  | "actividades" | "seguridad" | "tiempo" | "materiales"
  | "lecturas" | "evidencias" | "bitacora" | "resultado";

/** Lo que se mira en cada momento del trabajo. Lo demas queda recogido. */
const POR_ESTADO: Record<string, ClaveSeccion[]> = {
  /*
   * Mientras la orden esta VIVA, la bitacora y las lecturas se quedan
   * abiertas.
   *
   * Se probo al reves —recogerlas hasta que hicieran falta— y la prueba de
   * interfaz lo tumbo en cuatro flujos del tecnico: pedir apoyo, la nota sin
   * enviar y el horometro viven ahi, y un campo detras de un plegado es un
   * campo que estorba. Uno hasta mando una lectura vacia. Son las secciones
   * donde el tecnico CAPTURA durante su turno, no secciones de consulta.
   */
  // Todavia no empieza: que hay que hacer y como hacerlo con seguridad.
  DRAFT: ["actividades", "seguridad", "lecturas", "bitacora"],
  OPEN: ["actividades", "seguridad", "lecturas", "bitacora"],
  ASSIGNED: ["actividades", "seguridad", "lecturas", "bitacora"],
  // A media reparacion: lo que se va haciendo, el tiempo y el material.
  // La seguridad SI se recoge: ya se leyo antes de empezar.
  IN_PROGRESS: ["actividades", "tiempo", "materiales", "lecturas", "evidencias", "bitacora"],
  // Detenida: lo primero es POR QUE se detuvo, y eso vive en la bitacora.
  ON_HOLD: ["actividades", "bitacora"],
  // Terminada y por validar: que se hizo y con que se respalda.
  COMPLETED: ["resultado", "actividades", "evidencias"],
  // Cerrada: se consulta el resultado; lo demas es historia.
  CLOSED: ["resultado"],
  CANCELLED: ["resultado"],
};

export function naceAbierta(
  seccion: ClaveSeccion,
  estadoDeLaOrden: string,
  tienePendiente = false,
): boolean {
  if (tienePendiente) return true;
  // Un estado que no conozcamos abre todo: es preferible de mas que esconder
  // algo por no tener su renglon en la tabla.
  const abiertas = POR_ESTADO[estadoDeLaOrden];
  return abiertas ? abiertas.includes(seccion) : true;
}
