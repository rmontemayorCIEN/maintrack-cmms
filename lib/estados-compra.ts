/**
 * Como se llama cada estado de una requisicion de compra, para la pantalla.
 *
 * Vive aparte de lib/compras.ts a proposito. Las listas y las fichas son
 * componentes de cliente y solo necesitan estos nombres; si los toman del
 * modulo con la logica de negocio, el empaquetador arrastra tambien prisma y
 * el envio de avisos al paquete del navegador, y la compilacion se cae con un
 * "no encuentro tls" que no dice nada de la causa real.
 *
 * Es el mismo criterio de lib/tipos-solicitud.ts y lib/origenes-actividad.ts:
 * lo que se pinta va en su propio archivo, sin dependencias de servidor.
 */
export const ESTADOS_COMPRA = {
  SOLICITADA: "Solicitada",
  AUTORIZADA: "Autorizada",
  RECHAZADA: "Rechazada",
  EN_COMPRA: "En compra",
  RECIBIDA_PARCIAL: "Recibida en parte",
  RECIBIDA: "Recibida",
  CERRADA: "Cerrada",
  CANCELADA: "Cancelada",
} as const;

export type EstadoCompra = keyof typeof ESTADOS_COMPRA;
