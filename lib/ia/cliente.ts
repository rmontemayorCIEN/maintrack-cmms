import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { registrarConsumo } from "./consumo";
import type { ClaveFuncionIA } from "./funciones";
import { MODELO_PREDETERMINADO } from "./precios";

/**
 * Puerta unica hacia el modelo.
 *
 * Todo lo que llame a la IA pasa por aqui, y por eso aqui vive lo que no debe
 * poder olvidarse: la salida siempre es estructurada (nunca texto libre que
 * despues haya que adivinar como pintar), y todo consumo queda registrado,
 * incluso el fallido, porque una llamada que falla tambien se paga.
 */

export class IaNoConfigurada extends Error {
  constructor() {
    super("La función de inteligencia artificial no esta configurada en este servidor.");
  }
}

/**
 * Redacta cualquier cosa con forma de llave antes de registrarla.
 *
 * Los mensajes de error de la capa HTTP pueden traer el valor del encabezado
 * que fallo —es decir, la credencial completa— y de ahi viajan al log, a la
 * base y a la respuesta. Se limpian en el unico lugar por el que pasan todos.
 */
export function sanear(texto: string) {
  return texto
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-«redactada»")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Si hay una llave utilizable.
 *
 * No basta con que la variable exista: un valor mal pegado —con saltos de
 * linea o con el resto del comando dentro— produce un error de encabezado HTTP
 * que expone la credencial en el mensaje. Se valida la forma antes de usarla.
 */
export function iaConfigurada() {
  const llave = process.env.ANTHROPIC_API_KEY?.trim();
  return Boolean(llave && /^sk-ant-[A-Za-z0-9_-]+$/.test(llave));
}

/**
 * Espacio de trabajo de Anthropic contra el que actua la llave.
 *
 * Las llaves ligadas a una identidad no dicen por si solas en que espacio
 * operan, y la API rechaza la peticion sin este encabezado. No es un secreto
 * —es un identificador— asi que viaja como variable de entorno normal. Las
 * llaves creadas dentro de un espacio no lo necesitan: por eso es opcional.
 */
function espacioDeTrabajo() {
  const id = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return id || null;
}

let cliente: Anthropic | null = null;
function obtenerCliente() {
  if (!iaConfigurada()) throw new IaNoConfigurada();
  const espacio = espacioDeTrabajo();
  cliente ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!.trim(),
    ...(espacio ? { defaultHeaders: { "anthropic-workspace-id": espacio } } : {}),
  });
  return cliente;
}

export type ResultadoIa<T> = {
  datos: T;
  modelo: string;
  costoUsd: number;
};

/**
 * Una llamada al modelo con salida validada contra un esquema de Zod.
 *
 * `contexto` es el expediente ya calculado por nosotros. Nunca se le pide al
 * modelo que haga cuentas sobre renglones crudos: los numeros los produce el
 * sistema y el modelo los interpreta. Es lo que hace auditable el resultado.
 */
/**
 * Quita del JSON Schema lo que la API de salida estructurada no admite.
 *
 * En arreglos rechaza `maxItems` por completo y `minItems` distinto de 0 o 1.
 * Un `.min(3).max(12)` de Zod produce ambos, y el servicio responde 400. Lo
 * peor de este error es cuando aparece: no lo ve el compilador, no lo ve el
 * despliegue, y sale cuando un usuario aprieta el boton en produccion.
 *
 * Los limites siguen expresados en la descripcion del campo, que es donde el
 * modelo si los lee y ademas los respeta mejor que como restriccion rigida.
 *
 * OJO: solo se tocan las restricciones de ARREGLO. `maxLength` de cadena si
 * esta soportado y se conserva; quitarlo dejaria que el modelo devolviera
 * textos de cualquier tamaño.
 *
 * Se depura aqui y no en cada esquema a proposito: en un solo lugar, ninguna
 * de las catorce funciones —ni las que se escriban despues— puede caer en esto.
 */
/**
 * Texto de un esquema de IA, con su limite de largo.
 *
 * NO usa `.max()` de Zod, y esa es la decision: el modelo no respeta
 * `maxLength` de forma estricta, y una validacion dura tira la respuesta
 * completa —ya generada y pagada— por veinte caracteres de mas.
 *
 * El limite viaja en la descripcion, que es donde el modelo si lo lee y lo
 * respeta razonablemente, y se recorta al recibir. Un texto un poco largo se
 * acota; nunca se pierde el trabajo entero.
 *
 * Los limites duros van al escribir en la base, no al leer del modelo.
 */
export function textoIa(max: number, descripcion: string) {
  return z
    .string()
    .describe(`${descripcion} Maximo ${max} caracteres.`)
    .transform((t) => t.slice(0, max));
}

export function depurarEsquema(nodo: unknown): unknown {
  if (Array.isArray(nodo)) return nodo.map(depurarEsquema);
  if (!nodo || typeof nodo !== "object") return nodo;

  const objeto = nodo as Record<string, unknown>;
  const esArreglo = objeto.type === "array";

  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(objeto)) {
    if (esArreglo && clave === "maxItems") continue;
    if (esArreglo && clave === "minItems" && typeof valor === "number" && valor > 1) continue;
    salida[clave] = depurarEsquema(valor);
  }
  return salida;
}

export async function analizarConIa<T extends z.ZodType>(params: {
  organizationId: string;
  userId?: string | null;
  funcion: ClaveFuncionIA;
  sistema: string;
  instruccion: string;
  contexto: unknown;
  esquema: T;
  modelo?: string;
  maxTokens?: number;
  esfuerzo?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Imagen a analizar, en base64 y con su tipo. */
  imagen?: { base64: string; tipo: "image/jpeg" | "image/png" | "image/webp" };
}): Promise<ResultadoIa<z.infer<T>>> {
  const modelo = params.modelo ?? MODELO_PREDETERMINADO;
  const client = obtenerCliente();

  // El expediente va delimitado y anunciado como datos. Adentro hay texto que
  // escribieron usuarios —descripciones de fallas, comentarios, solicitudes— y
  // nada de eso puede valer como instruccion para el modelo.
  const mensaje = [
    params.instruccion,
    "",
    "<datos_del_cliente>",
    JSON.stringify(params.contexto, null, 1),
    "</datos_del_cliente>",
  ].join("\n");

  // La API restringe la generacion al esquema, y ademas se valida al recibir:
  // el esquema de Zod es la unica definicion, de ahi sale el JSON Schema.
  const { $schema, ...crudo } = zodToJsonSchema(params.esquema, {
    $refStrategy: "none",
  }) as Record<string, unknown>;
  const esquemaJson = depurarEsquema(crudo) as Record<string, unknown>;

  try {
    const respuesta = await client.messages.create({
      model: modelo,
      max_tokens: params.maxTokens ?? 16000,
      system: params.sistema,
      thinking: { type: "adaptive" },
      output_config: {
        effort: params.esfuerzo ?? "high",
        format: { type: "json_schema", schema: esquemaJson },
      },
      messages: [
        {
          role: "user",
          content: params.imagen
            ? [
                {
                  type: "image" as const,
                  source: { type: "base64" as const, media_type: params.imagen.tipo, data: params.imagen.base64 },
                },
                { type: "text" as const, text: mensaje },
              ]
            : mensaje,
        },
      ],
    });

    const uso = {
      entrada: respuesta.usage.input_tokens,
      salida: respuesta.usage.output_tokens,
      cacheLectura: respuesta.usage.cache_read_input_tokens ?? 0,
      cacheEscritura: respuesta.usage.cache_creation_input_tokens ?? 0,
    };

    if (respuesta.stop_reason === "refusal") {
      await registrarConsumo({ ...params, modelo, uso, ok: false, error: "El modelo declino la solicitud" });
      throw new Error("El modelo no pudo procesar esta solicitud.");
    }

    const texto = respuesta.content
      .filter((bloque): bloque is Anthropic.TextBlock => bloque.type === "text")
      .map((bloque) => bloque.text)
      .join("");

    const validado = params.esquema.safeParse(JSON.parse(texto));
    if (!validado.success) {
      await registrarConsumo({
        ...params, modelo, uso, ok: false,
        error: sanear(`Respuesta fuera de esquema: ${validado.error.issues[0]?.message ?? ""}`).slice(0, 300),
      });
      // El detalle va en el mensaje, no solo en el registro de consumo: sin el
      // hay que abrir la base para saber que campo fallo.
      const problema = validado.error.issues[0];
      const donde = problema?.path?.length ? ` en «${problema.path.join(".")}»` : "";
      throw new Error(
        `La respuesta del modelo no vino en el formato esperado${donde}: ${problema?.message ?? "sin detalle"}.`,
      );
    }

    const costoUsd = await registrarConsumo({ ...params, modelo, uso, ok: true });
    return { datos: validado.data as z.infer<T>, modelo, costoUsd };
  } catch (error) {
    if (error instanceof IaNoConfigurada) throw error;
    // Los errores de transporte no dejan uso que cobrar, pero si quedan en la
    // bitacora: es como se ve que una cuenta esta fallando de forma sistematica.
    // Ningun texto del proveedor sale de aqui sin sanear, ni al registro ni
    // hacia arriba: el mensaje puede contener la credencial.
    const detalle = sanear(
      error instanceof Anthropic.APIError
        ? `${error.status ?? ""} ${error.message}`
        : error instanceof Error
          ? error.message
          : "error desconocido",
    ).slice(0, 300);

    await registrarConsumo({
      ...params, modelo, uso: { entrada: 0, salida: 0 }, ok: false, error: detalle,
    });
    console.error(`IA (${params.funcion}) fallo:`, detalle);
    throw new Error(`No fue posible completar el analisis. ${detalle}`);
  }
}

/**
 * Conversacion con herramientas.
 *
 * A diferencia de `analizarConIa`, aqui el modelo decide que consultar y en
 * que orden: hace una pregunta a los datos, ve el resultado y decide si le
 * falta algo. Por eso hay un tope de vueltas —una pregunta mal planteada no
 * puede convertirse en un gasto abierto— y por eso el consumo se acumula de
 * todas las vueltas y se registra una sola vez al final.
 */
export async function conversarConIa(params: {
  organizationId: string;
  userId?: string | null;
  funcion: ClaveFuncionIA;
  sistema: string;
  pregunta: string;
  herramientas: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  ejecutar: (nombre: string, entrada: Record<string, unknown>) => Promise<unknown>;
  modelo?: string;
  maxVueltas?: number;
  esfuerzo?: "low" | "medium" | "high" | "xhigh" | "max";
}): Promise<{ respuesta: string; consultas: Array<{ herramienta: string; entrada: Record<string, unknown> }>; costoUsd: number }> {
  const modelo = params.modelo ?? MODELO_PREDETERMINADO;
  const client = obtenerCliente();
  const maxVueltas = params.maxVueltas ?? 6;

  const mensajes: Anthropic.MessageParam[] = [
    { role: "user", content: `<pregunta_del_usuario>\n${params.pregunta}\n</pregunta_del_usuario>` },
  ];
  const consultas: Array<{ herramienta: string; entrada: Record<string, unknown> }> = [];
  const uso = { entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0 };
  let respuesta = "";

  try {
    for (let vuelta = 0; vuelta < maxVueltas; vuelta++) {
      const r = await client.messages.create({
        model: modelo,
        max_tokens: 8000,
        system: params.sistema,
        thinking: { type: "adaptive" },
        output_config: { effort: params.esfuerzo ?? "medium" },
        tools: params.herramientas as never,
        messages: mensajes,
      });

      uso.entrada += r.usage.input_tokens;
      uso.salida += r.usage.output_tokens;
      uso.cacheLectura += r.usage.cache_read_input_tokens ?? 0;
      uso.cacheEscritura += r.usage.cache_creation_input_tokens ?? 0;

      if (r.stop_reason === "refusal") {
        await registrarConsumo({ ...params, modelo, uso, ok: false, error: "El modelo declino la solicitud" });
        throw new Error("El modelo no pudo procesar esta consulta.");
      }

      respuesta = r.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      if (r.stop_reason !== "tool_use") break;

      const llamadas = r.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      mensajes.push({ role: "assistant", content: r.content });

      const resultados = await Promise.all(
        llamadas.map(async (l) => {
          const entrada = (l.input ?? {}) as Record<string, unknown>;
          consultas.push({ herramienta: l.name, entrada });
          try {
            const datos = await params.ejecutar(l.name, entrada);
            return { type: "tool_result" as const, tool_use_id: l.id, content: JSON.stringify(datos) };
          } catch (error) {
            return {
              type: "tool_result" as const,
              tool_use_id: l.id,
              is_error: true,
              content: sanear(error instanceof Error ? error.message : "error al consultar"),
            };
          }
        }),
      );
      mensajes.push({ role: "user", content: resultados });
    }

    const costoUsd = await registrarConsumo({ ...params, modelo, uso, ok: true });
    return { respuesta, consultas, costoUsd };
  } catch (error) {
    const detalle = sanear(
      error instanceof Anthropic.APIError
        ? `${error.status ?? ""} ${error.message}`
        : error instanceof Error
          ? error.message
          : "error desconocido",
    ).slice(0, 300);
    await registrarConsumo({ ...params, modelo, uso, ok: false, error: detalle });
    console.error(`IA (${params.funcion}) fallo:`, detalle);
    throw new Error(`No fue posible responder la consulta. ${detalle}`);
  }
}
