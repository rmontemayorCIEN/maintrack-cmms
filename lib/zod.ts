import { z } from "zod";

/**
 * Zod, con sus mensajes en espanol. Todo el proyecto lo importa de aqui.
 *
 * Un campo sin mensaje propio llegaba a la pantalla con el texto de zod, en
 * ingles: «Invalid option: expected one of...». El espanol que trae zod sirve
 * de base, pero se lee traducido («Inválido dirección de correo
 * electrónico», «>=2 caracteres»), asi que los casos de todos los dias llevan
 * texto propio y el resto cae en el de zod.
 *
 * La configuracion es global y vale desde que este modulo se carga. Por eso
 * nadie importa "zod" directo: `scripts/prueba-zod-espanol.ts` lo detiene.
 * Un mensaje escrito en el esquema (`.min(2, "...")`, `{ error: "..." }`)
 * siempre gana sobre estos.
 */

const TIPOS: Record<string, string> = {
  string: "texto",
  number: "un número",
  int: "un número entero",
  bigint: "un número entero",
  boolean: "sí o no",
  date: "una fecha",
  array: "una lista",
  object: "un objeto",
};

const FORMATOS: Record<string, string> = {
  email: "No es un correo válido",
  url: "No es una dirección web válida",
  datetime: "No es una fecha y hora válida",
  date: "No es una fecha válida",
  time: "No es una hora válida",
  uuid: "No es un identificador válido",
};

const lista = (valores: readonly unknown[]) => valores.map((v) => String(v)).join(", ");

export function mensajeEnEspanol(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined) return "Es obligatorio";
      return `Se esperaba ${TIPOS[issue.expected] ?? issue.expected}`;
    case "too_small": {
      const n = Number(issue.minimum);
      if (issue.origin === "string") return n <= 1 ? "No puede ir vacío" : `Debe tener al menos ${n} caracteres`;
      if (issue.origin === "array" || issue.origin === "set") return n === 1 ? "Debe tener al menos un elemento" : `Debe tener al menos ${n} elementos`;
      if (issue.origin === "number" || issue.origin === "bigint") return issue.inclusive ? `Debe ser mayor o igual a ${n}` : `Debe ser mayor que ${n}`;
      return undefined;
    }
    case "too_big": {
      const n = Number(issue.maximum);
      if (issue.origin === "string") return `No puede pasar de ${n} caracteres`;
      if (issue.origin === "array" || issue.origin === "set") return `No puede tener más de ${n} elementos`;
      if (issue.origin === "number" || issue.origin === "bigint") return issue.inclusive ? `No puede ser mayor a ${n}` : `Debe ser menor que ${n}`;
      return undefined;
    }
    case "invalid_format":
      return FORMATOS[issue.format] ?? "No tiene el formato esperado";
    case "invalid_value":
      return issue.values.length === 1 ? `Debe ser ${lista(issue.values)}` : `Debe ser una de estas opciones: ${lista(issue.values)}`;
    case "unrecognized_keys":
      return `${issue.keys.length === 1 ? "Campo no reconocido" : "Campos no reconocidos"}: ${issue.keys.join(", ")}`;
    case "not_multiple_of":
      return `Debe ser múltiplo de ${issue.divisor}`;
    case "invalid_union":
      return "No tiene el formato esperado";
    case "custom":
      return "No es válido";
    default:
      return undefined;
  }
}

z.config(z.locales.es());
z.config({ customError: mensajeEnEspanol });

export { z };
