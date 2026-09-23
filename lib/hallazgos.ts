/**
 * Las categorias de un hallazgo del rondin, y como se leen.
 *
 * ── Por que vive aparte de `lib/ia/rondin.ts` ──
 *
 * Porque esto lo necesita la PANTALLA, y aquel importa el almacenamiento, que
 * a su vez importa el cliente de Google Cloud Storage. Tenerlo junto hacia que
 * el navegador intentara compilar `fs`, `zlib` y `node:stream`, y la pagina
 * salia EN BLANCO —sin un solo error a la vista, solo una pantalla vacia—.
 *
 * Es la misma trampa que ya pagaron `lib/motivos-movimiento.ts` y
 * `lib/estados-compra.ts`: aquella se manifesto como «no encuentro tls» y esta
 * como «no encuentro fs». Un archivo que toca la pantalla no importa nada de
 * servidor, y por eso este no importa nada en absoluto.
 */

export const CATEGORIAS_HALLAZGO = ["FUGA", "SEGURIDAD", "ORDEN", "DETERIORO", "OBSTRUCCION", "OTRO"] as const;
export type CategoriaHallazgo = (typeof CATEGORIAS_HALLAZGO)[number];

export const NOMBRE_CATEGORIA: Record<CategoriaHallazgo, string> = {
  FUGA: "Fuga o derrame",
  SEGURIDAD: "Seguridad",
  ORDEN: "Orden y limpieza",
  DETERIORO: "Deterioro",
  OBSTRUCCION: "Obstrucción",
  OTRO: "Otro",
};

/**
 * Que tan firme es lo que dice.
 *
 * «Se ve claro» y no «alto»: quien lo lee esta a punto de decidir si manda a
 * alguien a revisar algo, y lo que necesita saber es si cualquiera que mire la
 * foto lo veria igual.
 */
export const NOMBRE_CERTEZA: Record<string, string> = {
  SEGURO: "Se ve claro",
  PROBABLE: "Probable",
  DUDOSO: "Dudoso",
};
