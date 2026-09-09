/**
 * El croquis de la planta: reglas de la rejilla.
 *
 * Vive aparte de la pantalla porque lo usan tres: la ruta que guarda, el
 * componente que dibuja y el que acomoda por omision. Repartir estas
 * constantes seria garantizar que un dia dejen de coincidir y que una caja se
 * guarde en una posicion que el dibujo no puede pintar.
 */

export const REJILLA = {
  columnas: 12,
  filas: 8,
} as const;

export type CajaCroquis = {
  /** Identificador de lo que ocupa la caja: un area en el croquis de planta,
   *  un equipo en el lienzo de un conjunto. La rejilla no sabe cual es. */
  id: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
};

export type AreaParaCroquis = {
  locationId: string | null;
  area: string;
  planoX: number | null;
  planoY: number | null;
  planoAncho: number;
  planoAlto: number;
};

/** Si TODAS las areas con paro tienen lugar en el croquis. */
export function croquisCompleto(areas: AreaParaCroquis[]): boolean {
  const conId = areas.filter((a) => a.locationId);
  return conId.length > 0 && conId.every((a) => a.planoX !== null && a.planoY !== null);
}

/**
 * Un acomodo de arranque, para que nadie empiece con el lienzo vacio.
 *
 * Un croquis en blanco con un boton de "acomode sus areas" se queda en blanco:
 * mover cajas es facil, inventarlas desde cero da pereza. Se colocan en
 * renglones y de ahi el director las arrastra a donde de verdad estan.
 *
 * Deliberadamente NO se intenta adivinar la planta real a partir de nombres o
 * codigos: acertar a medias es peor que no intentarlo, porque quien lo vea va
 * a creer que el sistema sabe algo que no sabe.
 */
export function acomodoInicial(areas: AreaParaCroquis[]): CajaCroquis[] {
  const conId = areas.filter(
    (a): a is AreaParaCroquis & { locationId: string } => Boolean(a.locationId),
  );
  if (!conId.length) return [];

  /**
   * Las cajas se reparten para LLENAR la rejilla, no en una tira delgada.
   *
   * La primera version las ponia de 3x2 en renglones, y con cuatro areas
   * quedaban en una franja arriba con siete octavos del lienzo vacio. Se veia
   * roto —como si faltara algo por cargar— en vez de verse como un croquis por
   * acomodar. La primera impresion decide si alguien se anima a moverlas.
   */
  const columnas = Math.ceil(Math.sqrt(conId.length));
  const filas = Math.ceil(conId.length / columnas);
  const ancho = Math.max(Math.floor(REJILLA.columnas / columnas), 1);
  const alto = Math.max(Math.floor(REJILLA.filas / filas), 1);

  return conId.map((a, i) => ({
    id: a.locationId,
    x: (i % columnas) * ancho,
    y: Math.floor(i / columnas) * alto,
    ancho,
    alto,
  }));
}

/** Si dos cajas se enciman. Se usa al soltar, para no dejar una encima de otra. */
export function seEncima(a: CajaCroquis, b: CajaCroquis): boolean {
  return (
    a.id !== b.id &&
    a.x < b.x + b.ancho &&
    b.x < a.x + a.ancho &&
    a.y < b.y + b.alto &&
    b.y < a.y + a.alto
  );
}

/** El primer hueco libre para una caja de este tamano, recorriendo la rejilla. */
export function primerHueco(
  cajas: CajaCroquis[],
  caja: CajaCroquis,
): { x: number; y: number } {
  for (let y = 0; y <= REJILLA.filas - caja.alto; y += 1) {
    for (let x = 0; x <= REJILLA.columnas - caja.ancho; x += 1) {
      const intento = { ...caja, x, y };
      if (!cajas.some((c) => seEncima(intento, c))) return { x, y };
    }
  }
  // Sin hueco se deja donde estaba: mover una caja a la fuerza encima de otra
  // confunde mas que dejarla quieta.
  return { x: caja.x, y: caja.y };
}

/**
 * Que pasa cuando se suelta una caja: nunca quedan dos encimadas.
 *
 * Vive aqui y no dentro del componente porque es la regla, no el dibujo, y
 * porque dentro del componente no se puede probar: las dos primeras versiones
 * de esta funcion se veian bien y no hacian nada. La primera mandaba la caja
 * al primer hueco libre, y con la rejilla llena no hay hueco, asi que
 * regresaba EXACTAMENTE a donde estaba —el director arrastra su nave sobre el
 * almacen, suelta, y la pantalla se queda igual, como si el arrastre no
 * sirviera—. La segunda intentaba el intercambio pero dejaba la arrastrada
 * donde cayo, y un aterrizaje corrido un renglon hacia que las dos siguieran
 * encimadas y el intercambio se rechazara justo cuando se pidio mas claro.
 *
 * Soltar un area sobre otra quiere decir "van cambiadas": cada una toma el
 * lugar de la otra. El hueco libre queda de respaldo para cuando no cabe.
 *
 * Y casi siempre se encima con DOS, no con una. Con la rejilla llena de cajas
 * del mismo tamano, cualquier caida corrida toca a dos vecinas: al soltar el
 * torno un poco a la izquierda, pisa la grua y la torre al mismo tiempo. La
 * primera version exigia que fuera exactamente una y con dos se rendia al
 * hueco libre —que resulta ser el lugar de donde salio—, asi que la caja
 * regresaba sola y de nuevo parecia que arrastrar no servia. Se cambia con la
 * que MAS se pise, que es a la que se le estaba apuntando.
 */
export function resolverSoltada(
  cajas: CajaCroquis[],
  id: string,
  salioDe: { x: number; y: number } | null,
): CajaCroquis[] {
  const yo = cajas.find((c) => c.id === id);
  if (!yo) return cajas;
  const otras = cajas.filter((c) => c.id !== id);
  const encimadas = otras.filter((o) => seEncima(yo, o));
  if (!encimadas.length) return cajas;

  if (salioDe && encimadas.length) {
    // A la que mas se pisa es a la que se le apuntaba. Con empate gana la
    // primera, que da un resultado estable en vez de uno que cambia solo.
    const otra = encimadas.reduce((mejor, c) =>
      areaComun(yo, c) > areaComun(yo, mejor) ? c : mejor,
    );
    const mia = { ...yo, x: otra.x, y: otra.y };
    const suya = { ...otra, x: salioDe.x, y: salioDe.y };
    const terceras = cajas.filter(
      (c) => c.id !== id && c.id !== otra.id,
    );
    const cabe =
      dentro(mia) &&
      dentro(suya) &&
      !seEncima(mia, suya) &&
      !terceras.some((t) => seEncima(mia, t) || seEncima(suya, t));
    if (cabe) {
      return cajas.map((c) =>
        c.id === id ? mia : c.id === otra.id ? suya : c,
      );
    }
  }

  const { x, y } = primerHueco(otras, yo);
  return cajas.map((c) => (c.id === id ? { ...c, x, y } : c));
}

/** Si una caja cabe completa dentro de la rejilla. */
function dentro(c: CajaCroquis): boolean {
  return c.x + c.ancho <= REJILLA.columnas && c.y + c.alto <= REJILLA.filas;
}

/**
 * Hasta donde puede crecer una caja sin encimarse: se topa con la vecina.
 *
 * Sin este tope, estirar un area sobre la de al lado la deja crecida encima y
 * al soltar se corre sola al primer hueco libre —la caja brinca a otra parte
 * de la planta sin que nadie lo haya pedido—. Toparse es lo que ya hace toda
 * ventana que se arrastra, y no hay que explicarlo.
 *
 * Se limita primero el ancho y con ese ancho ya resuelto se limita el alto;
 * como todas las cajas son rectangulos de la misma rejilla, con eso basta.
 */
export function tamanoQueCabe(
  cajas: CajaCroquis[],
  caja: CajaCroquis,
): { ancho: number; alto: number } {
  const otras = cajas.filter((c) => c.id !== caja.id);
  const pedido = {
    ancho: Math.min(Math.max(caja.ancho, 1), REJILLA.columnas - caja.x),
    alto: Math.min(Math.max(caja.alto, 1), REJILLA.filas - caja.y),
  };

  let ancho = pedido.ancho;
  for (const o of otras) {
    const seCruzanEnY = caja.y < o.y + o.alto && o.y < caja.y + pedido.alto;
    if (seCruzanEnY && o.x >= caja.x) ancho = Math.min(ancho, o.x - caja.x);
  }
  ancho = Math.max(ancho, 1);

  let alto = pedido.alto;
  for (const o of otras) {
    const seCruzanEnX = caja.x < o.x + o.ancho && o.x < caja.x + ancho;
    if (seCruzanEnX && o.y >= caja.y) alto = Math.min(alto, o.y - caja.y);
  }
  return { ancho, alto: Math.max(alto, 1) };
}

/** Cuantas celdas comparten dos cajas. Cero si no se tocan. */
function areaComun(a: CajaCroquis, b: CajaCroquis): number {
  const ancho = Math.min(a.x + a.ancho, b.x + b.ancho) - Math.max(a.x, b.x);
  const alto = Math.min(a.y + a.alto, b.y + b.alto) - Math.max(a.y, b.y);
  return ancho > 0 && alto > 0 ? ancho * alto : 0;
}
