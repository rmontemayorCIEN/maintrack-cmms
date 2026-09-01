/**
 * Prueba del depurador de esquemas de IA.
 *
 * Este error no lo detecta el compilador ni el despliegue: aparece cuando un
 * usuario aprieta el boton en produccion. Por eso se prueba aqui, y contra
 * TODAS las restricciones que Zod puede producir, no solo contra la que fallo.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { depurarEsquema, textoIa } from "../lib/ia/cliente";

let fallas = 0;
function revisar(e: string, real: unknown, esp: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esp);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(56)} ${JSON.stringify(real)}`);
}

const armar = (e: z.ZodType) => {
  const { $schema, ...crudo } = zodToJsonSchema(e, { $refStrategy: "none" }) as Record<string, unknown>;
  return JSON.stringify(depurarEsquema(crudo));
};
const tiene = (json: string, clave: string) => new RegExp(`"${clave}"`).test(json);

console.log("\nLO QUE HAY QUE QUITAR\n");
const conLimites = armar(z.object({
  a: z.array(z.string()).min(3).max(12),
  b: z.array(z.object({ x: z.string() })).max(6),
  c: z.array(z.string()).min(5),
}));
revisar("se quita maxItems de arreglos", tiene(conLimites, "maxItems"), false);
revisar("se quita minItems mayor que 1", /"minItems":([2-9]|[0-9]{2,})/.test(conLimites), false);

console.log("\nLO QUE HAY QUE CONSERVAR\n");
const conservables = armar(z.object({
  texto: z.string().min(2).max(200),
  lista: z.array(z.string()).min(1),
  numero: z.number().min(0).max(100),
  opcion: z.enum(["A", "B"]),
  anidado: z.array(z.object({ dentro: z.array(z.string()).max(3), etiqueta: z.string().max(50) })),
}));
revisar("maxLength de cadena se conserva", tiene(conservables, "maxLength"), true);
revisar("minLength de cadena se conserva", tiene(conservables, "minLength"), true);
revisar("minimum y maximum de numero se conservan", tiene(conservables, "maximum"), true);
revisar("minItems de 1 se conserva", /"minItems":1/.test(conservables), true);
revisar("enum se conserva", tiene(conservables, "enum"), true);

console.log("\nTAMBIEN EN ARREGLOS ANIDADOS\n");
revisar("el maxItems de adentro tambien se fue", tiene(conservables, "maxItems"), false);
revisar("pero el maxLength de adentro sigue", tiene(conservables, "maxLength"), true);

console.log("\nNO ROMPE LA ESTRUCTURA\n");
const original = z.object({ pasos: z.array(z.object({ titulo: z.string(), tipo: z.enum(["A", "B"]) })).max(9) });
const salida = JSON.parse(armar(original));
revisar("las propiedades siguen ahi", Object.keys(salida.properties ?? {}), ["pasos"]);
revisar("el tipo del arreglo se conserva", salida.properties?.pasos?.type, "array");
revisar("los campos de cada elemento siguen",
  Object.keys(salida.properties?.pasos?.items?.properties ?? {}), ["titulo", "tipo"]);
revisar("required se conserva", Array.isArray(salida.required), true);

console.log("\nEL RECORTE SUAVE (textoIa)\n");
const conTexto = armar(z.object({ t: textoIa(180, "Una accion.") }));
revisar("textoIa no emite maxLength", tiene(conTexto, "maxLength"), false);
revisar("el limite viaja en la descripcion", /Maximo 180 caracteres/.test(conTexto), true);
revisar("recorta al recibir",
  z.object({ t: textoIa(20, "x") }).parse({ t: "y".repeat(99) }).t.length, 20);
revisar("deja pasar lo que si cabe",
  z.object({ t: textoIa(20, "x") }).parse({ t: "corto" }).t, "corto");

console.log("\nNINGUN ESQUEMA DE IA USA .max() EN CADENAS\n");
// El modelo no respeta maxLength de forma estricta: la API lo acepta sin
// error y la respuesta —ya generada y pagada— muere despues, al validar.
// Por eso los limites de texto van con textoIa, nunca con .max().
const dir = join(__dirname, "..", "lib", "ia");
const sospechoso = /z\s*\.\s*string\s*\(\s*\)[^;,\n]*?\.max\s*\(/;
const culpables = readdirSync(dir)
  .filter((f) => f.endsWith(".ts"))
  .filter((f) => sospechoso.test(readFileSync(join(dir, f), "utf-8")));
revisar("ningun lib/ia/*.ts usa z.string().max()", culpables, []);

console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
process.exitCode = fallas ? 1 : 0;
