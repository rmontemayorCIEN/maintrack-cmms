/**
 * Como se escribe un folio, en un solo lugar.
 *
 * `OT-000011`: prefijo, guion y seis digitos. Lo usan quien los genera
 * (`lib/numbering.ts`) y quien los reconstruye a partir de lo que alguien dijo
 * —«llevame a la orden once» tiene que llegar a OT-000011, no buscar «11» y
 * encontrar la 11, la 110 y la 1100—.
 *
 * Sin dependencias: lo necesita tambien la navegacion por voz, que no puede
 * arrastrar prisma al navegador.
 */

export const DIGITOS_DE_FOLIO = 6;

/** El folio completo a partir del consecutivo. */
export function armarFolio(prefijo: string, consecutivo: number): string {
  return `${prefijo}-${String(consecutivo).padStart(DIGITOS_DE_FOLIO, "0")}`;
}

/**
 * Como nombra la gente cada serie, hablando.
 *
 * De aqui sale que «la orden de trabajo once» busque OT-000011. Las formas
 * largas van primero: «orden de compra» tiene que ganarle a «orden», o toda
 * compra se buscaria entre las ordenes de trabajo.
 */
export const SERIES_HABLADAS: Array<{ dicho: string[]; prefijo: string }> = [
  { dicho: ["orden de compra", "oc"], prefijo: "OC" },
  { dicho: ["orden de trabajo", "orden", "ot"], prefijo: "OT" },
  { dicho: ["solicitud", "reporte", "ss"], prefijo: "SS" },
  { dicho: ["requisicion", "vale", "rm"], prefijo: "RM" },
  { dicho: ["traspaso", "tr"], prefijo: "TR" },
  { dicho: ["recepcion", "re"], prefijo: "RE" },
  { dicho: ["conteo", "ci"], prefijo: "CI" },
];

/**
 * Los numeros dichos con letra.
 *
 * «La orden once» y «la bomba tres» son la misma necesidad en dos pantallas
 * distintas —el folio y el rondin—, asi que el mapa vive una sola vez. Llega
 * hasta el veinte: de ahi para arriba la transcripcion ya entrega cifras.
 */
export const NUMEROS_DICHOS: Record<string, string> = {
  uno: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5",
  seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10",
  once: "11", doce: "12", trece: "13", catorce: "14", quince: "15",
  dieciseis: "16", diecisiete: "17", dieciocho: "18", diecinueve: "19", veinte: "20",
};
