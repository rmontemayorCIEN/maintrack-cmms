// Las descripciones de los campos que llena el modelo. La app arma su esquema
// (zod) con ellas; aquí no hay zod para que el Consultor no dependa de su
// versión. Sin límites dentro del esquema: el límite va en la descripción y
// se valida después en `reglas/guardas.ts`.

import { CLASES } from "./reglas/tema";
import { TIPOS_NOTA } from "./reglas/memoria";

export const CLAVES_CLASE = Object.keys(CLASES) as (keyof typeof CLASES)[];
export const CLAVES_NOTA = Object.keys(TIPOS_NOTA) as (keyof typeof TIPOS_NOTA)[];

export const DESCRIPCION = {
  clase: "La clase de la pregunta.",
  respuesta: "La respuesta para la persona, de 2 a 6 frases o una lista breve. Máximo 2,500 caracteres.",
  enlace: "La ruta de la pantalla del siguiente paso, tal como aparece en el plan o en la ayuda (por ejemplo /ajustes?s=equipo). Vacío si no hace falta.",
  pasoClave: "La clave del paso del plan del que se habló, sin corchetes. Vacío si no fue uno.",
  notasPropuestas: "Lo que conviene recordar de esta cuenta, para que la persona decida si se guarda. A lo mucho 3; vacío casi siempre.",
  notaTipo: "El tipo de nota.",
  notaTexto: "La nota en una frase, máximo 280 caracteres. Sin datos personales de clientes.",
  resumen: "Dónde quedó la conversación, en una o dos frases, para retomarla la próxima vez.",
} as const;
