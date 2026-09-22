/**
 * Repartir cosas en una barra de cuadros, sin que lo malo desaparezca.
 *
 * Nacio en la franja de planta y aqui esta suelto porque el almacen necesita
 * exactamente lo mismo: una barra por renglon, un cuadro por cosa mientras
 * quepan, y un reparto proporcional cuando no caben.
 *
 * Lo que hace este archivo que un reparto normal no hace: con doscientos
 * equipos y uno fuera de servicio, el reparto exacto le toca 0.1 de cuadro y
 * el equipo parado se borra de la barra. Un tablero que esconde justo lo unico
 * que hay que atender es peor que no tener tablero. Asi que todo grupo con al
 * menos una cosa se lleva al menos un cuadro, y el sobrante se le quita al
 * grupo tranquilo —el unico que puede perder cuadros sin mentir—.
 */

/** Cuantos cuadros tiene una barra, como maximo. */
export const SEGMENTOS = 20;

/**
 * La barra como lista de cuadros, en el orden en que se dan las partes.
 *
 * `sobranteDe` es el grupo al que se le quitan los cuadros que sobren al
 * redondear: el que representa «esto esta bien».
 */
export function repartirEnCuadros<C extends string>(
  partes: Array<[C, number]>,
  total: number,
  sobranteDe: C,
  segmentos = SEGMENTOS,
): C[] {
  if (total <= segmentos) {
    return partes.flatMap(([clave, n]) => Array.from({ length: Math.max(0, n) }, () => clave));
  }

  const cuadros = partes.map(([clave, n]): [C, number] => [
    clave, n <= 0 ? 0 : Math.max(1, Math.round((n / total) * segmentos)),
  ]);

  let sobran = cuadros.reduce((s, [, n]) => s + n, 0) - segmentos;
  const tranquilo = cuadros.find(([c]) => c === sobranteDe);
  if (tranquilo && sobran > 0) {
    const quitar = Math.min(sobran, Math.max(tranquilo[1] - 1, 0));
    tranquilo[1] -= quitar;
    sobran -= quitar;
  }
  return cuadros.flatMap(([clave, n]) => Array.from({ length: n }, () => clave));
}
