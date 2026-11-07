/**
 * Los mensajes de validacion salen en espanol.
 *
 * ── Por que existe ──
 *
 * Un campo sin mensaje propio llegaba a la pantalla con el texto de zod, en
 * ingles. `lib/zod.ts` los pone en espanol, pero la configuracion es global y
 * solo vale si ese modulo se carga: un archivo que importe "zod" directo
 * funciona igual y no se nota nada... hasta que es el unico que valida en esa
 * ruta. Por eso aqui se revisan las dos cosas: que nadie se lo salte y que los
 * mensajes digan lo que deben.
 *
 *   npx tsx scripts/prueba-zod-espanol.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "../lib/zod";

let fallas = 0;
function revisar(que: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${que.padEnd(52)} ${JSON.stringify(real)}`);
}
const mensaje = (esquema: z.ZodType, valor: unknown) => {
  const r = esquema.safeParse(valor);
  return r.success ? null : r.error.issues[0]?.message;
};

console.log("\nNADIE IMPORTA ZOD DIRECTO\n");
const raiz = join(__dirname, "..");
const directos: string[] = [];
function recorrer(dir: string) {
  for (const nombre of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", ".claude"].includes(nombre)) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) recorrer(ruta);
    else if (/\.(ts|tsx)$/.test(nombre) && /from\s+["']zod(\/[^"']*)?["']/.test(readFileSync(ruta, "utf-8"))) {
      directos.push(relative(raiz, ruta));
    }
  }
}
for (const dir of ["app", "lib", "components", "scripts", "prisma"]) recorrer(join(raiz, dir));
revisar("solo lib/zod.ts importa \"zod\"", directos, ["lib/zod.ts"]);

console.log("\nLOS CASOS DE TODOS LOS DIAS\n");
revisar("falta un campo", mensaje(z.object({ a: z.string() }), {}), "Es obligatorio");
revisar("tipo equivocado", mensaje(z.number(), "abc"), "Se esperaba un número");
revisar("texto vacio", mensaje(z.string().min(1), ""), "No puede ir vacío");
revisar("texto corto", mensaje(z.string().min(3), "a"), "Debe tener al menos 3 caracteres");
revisar("texto largo", mensaje(z.string().max(5), "abcdefg"), "No puede pasar de 5 caracteres");
revisar("numero bajo", mensaje(z.number().min(0), -1), "Debe ser mayor o igual a 0");
revisar("numero positivo", mensaje(z.number().positive(), 0), "Debe ser mayor que 0");
revisar("numero alto", mensaje(z.coerce.number().max(90), "123"), "No puede ser mayor a 90");
revisar("lista vacia", mensaje(z.array(z.string()).min(1), []), "Debe tener al menos un elemento");
revisar("correo", mensaje(z.string().email(), "malo"), "No es un correo válido");
revisar("fecha y hora", mensaje(z.string().datetime(), "ayer"), "No es una fecha y hora válida");
revisar("opcion fuera de la lista", mensaje(z.enum(["ALTA", "BAJA"]), "MEDIA"), "Debe ser una de estas opciones: ALTA, BAJA");
revisar("valor fijo", mensaje(z.literal(true), false), "Debe ser true");
revisar("campo de mas en un objeto estricto", mensaje(z.object({}).strict(), { x: 1 }), "Campo no reconocido: x");

console.log("\nEL MENSAJE DEL ESQUEMA SIEMPRE GANA\n");
revisar("mensaje como texto", mensaje(z.string().min(5, "Escriba el asunto"), "a"), "Escriba el asunto");
revisar("mensaje con error:", mensaje(z.literal("RESTAURAR", { error: "Escriba RESTAURAR" }), "x"), "Escriba RESTAURAR");
revisar("refine con su mensaje", mensaje(z.string().refine(() => false, { error: "Tipo invalido" }), "x"), "Tipo invalido");

console.log("\nUN FORMATO SIN TEXTO PROPIO\n");
revisar("se dice de forma general", mensaje(z.string().startsWith("OT-"), "X"), "No tiene el formato esperado");

console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
process.exitCode = fallas ? 1 : 0;
