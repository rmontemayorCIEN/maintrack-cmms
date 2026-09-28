/**
 * Herramientas: lo que las separa de una refaccion, y como se nombra.
 *
 * Vive aparte de `lib/herramientas.ts` por el mismo motivo de siempre: las
 * pantallas son componentes de cliente y solo necesitan estos nombres.
 *
 * ── La distincion que ordena todo el modulo
 *
 * Una refaccion SE CONSUME: sale y no vuelve. Una herramienta SALE Y REGRESA.
 * Parece obvio y es lo que decide la arquitectura:
 *
 * - **Prestar y devolver mueve POSESION, no valor.** No toca el kardex ni el
 *   costo promedio: una devolucion no es una compra, y si pasara por ahi el
 *   costo del almacen se ensuciaria solo. Por eso el prestamo NO cambia la
 *   existencia —`PartStock.quantity` sigue siendo lo que la empresa posee— y
 *   lo que cambia es `enResguardo`, que dice cuanto esta fuera.
 * - **Dar de baja SI mueve valor.** Perdida, robada, rota sin arreglo, fin de
 *   vida: eso es salida real y pasa por `aplicarMovimiento()`, que es el unico
 *   punto de este sistema que toca existencias.
 *
 * Esa separacion es la que hace que el modulo no corrompa lo que ya funciona.
 * Y de paso entrega el numero que de verdad vende esto: lo que se dio de baja
 * por perdida, valuado y agrupado por persona.
 */

// ─────────────────────────────────────────── Que es cada articulo

/**
 * Refaccion o herramienta.
 *
 * Es una NATURALEZA del mismo catalogo, no un padron aparte. Una herramienta
 * se compra igual que una refaccion —requisicion, autorizacion, orden de
 * compra, recepcion, proveedor, costo— y todo eso ya existe y funciona;
 * duplicarlo seria repetir lo caro para no compartir lo barato.
 */
export const NATURALEZAS = {
  REFACCION: {
    nombre: "Refacción",
    plural: "Refacciones",
    descripcion: "Se consume: sale del almacén y no vuelve.",
  },
  HERRAMIENTA: {
    nombre: "Herramienta",
    plural: "Herramientas",
    descripcion: "Sale y regresa. Se presta con responsable y se devuelve.",
  },
} as const;

export type Naturaleza = keyof typeof NATURALEZAS;
export const ORDEN_NATURALEZAS = Object.keys(NATURALEZAS) as Naturaleza[];
export const esNaturaleza = (n: string): n is Naturaleza => n in NATURALEZAS;
export const esHerramienta = (p: { naturaleza?: string | null }) => p.naturaleza === "HERRAMIENTA";

// ─────────────────────────────────────────── Como sale y como vuelve

/** En qué estado sale y en qué estado regresa. Es lo que detecta el mal uso. */
export const ESTADOS_HERRAMIENTA = {
  NUEVA: { nombre: "Nueva", tono: "success" },
  BUENA: { nombre: "Buena", tono: "success" },
  USADA: { nombre: "Usada", tono: "info" },
  PARA_REPARAR: { nombre: "Para reparar", tono: "warning" },
} as const;

export type EstadoHerramienta = keyof typeof ESTADOS_HERRAMIENTA;
export const ORDEN_ESTADOS = Object.keys(ESTADOS_HERRAMIENTA) as EstadoHerramienta[];
export const esEstadoHerramienta = (e: string): e is EstadoHerramienta => e in ESTADOS_HERRAMIENTA;
export const nombreDeEstado = (e: string) =>
  esEstadoHerramienta(e) ? ESTADOS_HERRAMIENTA[e].nombre : e;

/**
 * Cuando una herramienta regresa PEOR de como salió.
 *
 * No es lo mismo que darla de baja —sigue existiendo— pero es el dato del que
 * sale «a Pedro se le maltratan las cosas», y sin compararlo con el estado de
 * salida no se puede afirmar nada.
 */
export const PESO_ESTADO: Record<EstadoHerramienta, number> = {
  NUEVA: 0, BUENA: 1, USADA: 2, PARA_REPARAR: 3,
};

export function regresoPeor(salio: string | null | undefined, volvio: string | null | undefined): boolean {
  if (!salio || !volvio) return false;
  if (!esEstadoHerramienta(salio) || !esEstadoHerramienta(volvio)) return false;
  return PESO_ESTADO[volvio] > PESO_ESTADO[salio];
}

// ─────────────────────────────────────────── Por qué se pierde

/**
 * Por qué una herramienta deja de existir.
 *
 * `culpaDeQuienLaTenia` es lo que separa un accidente del desgaste normal, y
 * es deliberado que no se calcule solo: el reporte de pérdidas por persona
 * pierde todo su valor si mete ahí el fin de vida útil de una herramienta que
 * duró ocho años.
 */
export const MOTIVOS_BAJA = {
  PERDIDA: { nombre: "Se perdió", culpaDeQuienLaTenia: true },
  ROBADA: { nombre: "Se la robaron", culpaDeQuienLaTenia: false },
  DANADA: { nombre: "Se dañó y no tiene arreglo", culpaDeQuienLaTenia: true },
  FIN_DE_VIDA: { nombre: "Terminó su vida útil", culpaDeQuienLaTenia: false },
  OBSOLETA: { nombre: "Ya no se usa", culpaDeQuienLaTenia: false },
} as const;

export type MotivoBaja = keyof typeof MOTIVOS_BAJA;
export const ORDEN_MOTIVOS_BAJA = Object.keys(MOTIVOS_BAJA) as MotivoBaja[];
export const esMotivoBaja = (m: string): m is MotivoBaja => m in MOTIVOS_BAJA;
export const nombreDeMotivoBaja = (m: string) => (esMotivoBaja(m) ? MOTIVOS_BAJA[m].nombre : m);
export const seLeAtribuye = (m: string) => (esMotivoBaja(m) ? MOTIVOS_BAJA[m].culpaDeQuienLaTenia : false);

// ─────────────────────────────────────────── Quién registra la salida

/**
 * Cómo entrega este almacén.
 *
 * Los dos escenarios que existen en la práctica NO son dos flujos distintos:
 * el dato que se guarda es el mismo —qué salió, quién la tiene, cuándo, en qué
 * estado—. Lo único que cambia es quién teclea y si hay una segunda firma. Por
 * eso es un parámetro del almacén y no dos construcciones.
 *
 * Va por ALMACÉN y no por empresa porque la misma planta suele tener los dos:
 * el almacén general con ventanilla, y el carrito de dados junto al torno
 * donde nadie va a pedir permiso para tomar uno.
 */
export const MODOS_ENTREGA = {
  MOSTRADOR: {
    nombre: "Con almacenista",
    descripcion: "El almacenista registra la salida y a quién se la entregó. Quedan los dos en el registro.",
  },
  AUTOSERVICIO: {
    nombre: "Autoservicio",
    descripcion: "Quien la toma registra su propia salida, escaneando. Más ágil, y por eso necesita el aviso de lo no devuelto.",
  },
} as const;

export type ModoEntrega = keyof typeof MODOS_ENTREGA;
export const modoDeAlmacen = (w: { autoservicio?: boolean | null }): ModoEntrega =>
  w.autoservicio ? "AUTOSERVICIO" : "MOSTRADOR";

/**
 * A los cuántos días se avisa de algo que no ha vuelto.
 *
 * El problema real del autoservicio no es registrar la salida —esa sale bien,
 * porque la persona quiere la herramienta— sino la devolución que nadie
 * confirma: el sistema cree que Pedro trae el calibrador desde hace ocho meses
 * y en realidad lo devolvió en marzo.
 */
export const DIAS_PARA_AVISAR = 15;

// ─────────────────────────────────────────── Cuentas

/**
 * Cuánto hay disponible para prestar.
 *
 * `quantity` es lo que la empresa POSEE y no baja al prestar; `enResguardo` es
 * lo que está fuera. Lo disponible es la resta. Si esto diera negativo habría
 * un descuadre, así que se corta en cero y quien lo llame decide si avisar.
 */
export function disponible(quantity: number, enResguardo: number): number {
  return Math.max(0, (quantity ?? 0) - (enResguardo ?? 0));
}

/** Días que lleva fuera algo que no ha vuelto. */
export function diasFuera(entregadoEl: Date | string, ahora: Date = new Date()): number {
  const d = typeof entregadoEl === "string" ? new Date(entregadoEl) : entregadoEl;
  return Math.floor((ahora.getTime() - d.getTime()) / 86_400_000);
}

export const llevaDemasiadoFuera = (entregadoEl: Date | string, ahora?: Date) =>
  diasFuera(entregadoEl, ahora) >= DIAS_PARA_AVISAR;
