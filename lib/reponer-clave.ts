/**
 * Quien puede reponerle la contraseña a quien.
 *
 * Vive aparte de la ruta para que la prueba ejercite ESTA funcion y no una
 * copia suya. Una guarda de seguridad probada contra su propia imitacion no
 * esta probada: el dia que la ruta cambie, la copia sigue en verde.
 */

export type Persona = { id: string; role: string };

export type Veredicto = { puede: true } | { puede: false; motivo: string; codigo: number };

/**
 * El propietario no se toca desde aqui.
 *
 * Si un administrador pudiera reponerle la contraseña, podria dejarlo fuera de
 * su propia empresa y quedarse con la cuenta. El propietario cambia la suya en
 * «Mi cuenta», donde se le exige la anterior.
 *
 * Y nadie se repone la propia por esta via: sin pedir la anterior, cualquiera
 * que tomara una sesion abierta se quedaria con la cuenta para siempre.
 */
export function puedeReponerClave(actor: Persona, objetivo: Persona): Veredicto {
  if (objetivo.role === "OWNER") {
    return {
      puede: false,
      codigo: 403,
      motivo: "No se puede reponer la contraseña del propietario. Él la cambia desde «Mi cuenta».",
    };
  }
  if (objetivo.id === actor.id) {
    return {
      puede: false,
      codigo: 403,
      motivo: "Su propia contraseña se cambia en «Mi cuenta», donde se le pide la anterior.",
    };
  }
  return { puede: true };
}

/** Lo minimo que se le exige a una contraseña repuesta. */
export const LARGO_MINIMO_CLAVE = 8;
