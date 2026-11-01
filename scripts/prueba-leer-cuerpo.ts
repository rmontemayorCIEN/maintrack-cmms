/**
 * leerCuerpo: un cuerpo que no es JSON o no pasa el esquema es un 422 con su
 * motivo, nunca un 500 (las rutas del operador hacian `schema.parse` sin
 * atrapar el error).
 *
 *   npx tsx scripts/prueba-leer-cuerpo.ts
 */
import { z } from "../lib/zod";
import { leerCuerpo } from "../lib/api";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${!bien ? ` · ${JSON.stringify(detalle)}` : ""}`);
  if (!bien) fallas++;
}
const pedir = (cuerpo: string) => new Request("http://x/api", { method: "POST", body: cuerpo, headers: { "content-type": "application/json" } });
const esquema = z.object({ accion: z.enum(["PAGAR", "CANCELAR"]) });
const conCambios = z.object({ a: z.string().optional(), b: z.number().optional() }).refine((x) => Object.values(x).some((v) => v !== undefined), "No hay cambios que aplicar");

async function main() {
  const bien = await leerCuerpo(pedir('{"accion":"PAGAR"}'), esquema);
  revisar("un cuerpo válido pasa con sus datos", bien.ok && bien.datos.accion === "PAGAR", bien);
  const noJson = await leerCuerpo(pedir("esto no es json"), esquema);
  revisar("un cuerpo que no es JSON es 422", !noJson.ok && noJson.respuesta.status === 422);
  const malo = await leerCuerpo(pedir('{"accion":"BORRAR"}'), esquema);
  revisar("un valor fuera del esquema es 422, no 500", !malo.ok && malo.respuesta.status === 422);
  const vacio = await leerCuerpo(pedir("{}"), conCambios);
  const texto = !vacio.ok ? await vacio.respuesta.json() : null;
  revisar("un cuerpo vacío donde se piden cambios es 422 y dice por qué", !vacio.ok && texto?.error === "No hay cambios que aplicar", texto);
  console.log(`\n${fallas ? `${fallas} FALLAS` : "todo en verde"}\n`);
  process.exit(fallas ? 1 : 0);
}
main();
