import { z } from "zod";

/**
 * Zod -> JSON Schema, igual para la IA y para el MCP.
 *
 * Se describe la ENTRADA (lo que el modelo escribe), no la salida: `textoIa`
 * recorta con un transform, y la salida de un transform no tiene forma JSON.
 * En modo entrada zod 4 deja los objetos abiertos; la salida estructurada de
 * la API exige `additionalProperties: false`, asi que se cierran aqui. Es lo
 * que zod ya hace al validar: lo que sobra se descarta.
 */
export function aJsonSchema(esquema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(esquema, {
    target: "draft-7",
    io: "input",
    reused: "inline",
    override: ({ jsonSchema }) => {
      if (jsonSchema.type === "object" && jsonSchema.additionalProperties === undefined) {
        jsonSchema.additionalProperties = false;
      }
    },
  }) as Record<string, unknown>;
}
