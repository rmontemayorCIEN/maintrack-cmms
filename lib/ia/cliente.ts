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
  /**
   * Varias imagenes de una vez, cada una con su etiqueta.
   *
   * La etiqueta va como texto JUSTO ANTES de su imagen, y no es adorno: sin
   * ella el modelo ve un monton de fotos sueltas y no puede decir cual es
   * cual. Con ella puede contestar «en la foto de la parada 3», que es lo
   * unico que hace el hallazgo util para quien lo lee.
   *
   * Cada imagen cuesta del orden de mil seiscientos tokens de entrada, asi
   * que quien llame acota cuantas manda: no es lo mismo doce que doscientas.
   */
  imagenes?: Array<{ base64: string; tipo: "image/jpeg" | "image/png" | "image/webp"; etiqueta: string }>;
  /**
   * Un PDF a leer, en base64.
   *
   * El modelo lo lee entero —texto y diseño— sin que nadie extraiga el texto
   * antes. Eso importa para lo unico que se usa hoy: sacar de una norma lo que
   * exige, CITANDO el renglon. Con el texto plano extraido aparte se pierden
   * los numerales y las tablas, que es justo donde vive la obligacion.
   *
   * Cuesta mucho mas que una imagen: un PDF de treinta paginas son decenas de
   * miles de tokens de entrada. Quien lo use tiene que saberlo.
   */
  documento?: { base64: string; nombre: string };
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
      /**
       * Haiku no admite ni pensamiento adaptativo ni nivel de esfuerzo: la
       * API contesta 400 y la llamada se pierde entera. Los dos rechazos son
       * distintos y aparecen uno tras otro, asi que quien lo descubra por las
       * malas lo va a descubrir dos veces.
       *
       * Se detecta aqui y no en cada funcion a proposito: quien elija Haiku
       * para una tarea barata no tiene por que saber esto, y si dependiera de
       * acordarse, el primer olvido seria una funcion que nunca contesta. Y el
       * fallo se disfraza de otra cosa: quien la llame ve un «no se pudo»
       * normal, no un modelo mal configurado.
       */
      ...(modelo.includes("haiku") ? {} : { thinking: { type: "adaptive" as const } }),
      output_config: {
        // El esfuerzo va solo donde se admite; ver la nota de arriba.
        ...(modelo.includes("haiku") ? {} : { effort: params.esfuerzo ?? "high" }),
        format: { type: "json_schema", schema: esquemaJson },
      },
      messages: [
        {
          role: "user",
          content: params.documento
            ? [
                {
                  type: "document" as const,
                  source: { type: "base64" as const, media_type: "application/pdf" as const, data: params.documento.base64 },
                  title: params.documento.nombre,
                  // SIN `citations`: la API las rechaza cuando se pide salida
                  // estructurada —«Citations cannot be enabled when output
                  // format is set»— y aqui toda respuesta es estructurada. No
                  // se pierde nada: el esquema de quien lo use le exige la
                  // cita textual como campo, que ademas queda guardada.
                },
                { type: "text" as const, text: mensaje },
              ]
            : params.imagenes?.length
            ? [
                // Cada foto anunciada por su etiqueta, y el encargo al final:
                // asi el modelo ya vio todo cuando lee que tiene que hacer.
                ...params.imagenes.flatMap((img) => [
                  { type: "text" as const, text: img.etiqueta },
                  {
                    type: "image" as const,
                    source: { type: "base64" as const, media_type: img.tipo, data: img.base64 },
                  },
                ]),
                { type: "text" as const, text: mensaje },
              ]
            : params.imagen
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

/**
 * El error del proveedor, dicho para una persona.
 *
 * ── Por que existe ──
 *
 * Las rutas de IA devolvian `error.message` tal cual, y eso le ponia enfrente
 * al usuario cosas como:
 *
 *   401 401 {"type":"error","error":{"type":"authentication_error",
 *   "message":"API key is invalid."},"request_id":null}
 *
 * Quien lo ve no puede hacer nada con eso, y peor: parece que el sistema se
 * rompio. Casi siempre es una de cinco cosas, y cada una tiene una salida
 * distinta —esperar, reintentar, o avisarle a soporte—.
 *
 * El detalle crudo NO se pierde: queda en `AiUsage.error`, que es donde este
 * proyecto manda a buscar cuando algo de IA falla
 * (`scripts/ultimo-error-ia.ts`). Aqui solo se decide que leer la persona.
 */
export function motivoLegible(error: unknown): string {
  const crudo = error instanceof Error ? error.message : String(error ?? "");
  const t = crudo.toLowerCase();

  if (/authentication|api key|401|invalid x-api-key/.test(t)) {
    return "La llave del servicio de inteligencia artificial no es válida. Avise a soporte: no es algo que se resuelva reintentando.";
  }
  if (/credit|billing|payment|quota|insufficient/.test(t)) {
    return "La cuenta del servicio de inteligencia artificial no tiene crédito disponible. Avise a soporte.";
  }
  if (/rate.?limit|429|overloaded|529|capacity/.test(t)) {
    return "El servicio de inteligencia artificial está saturado en este momento. Espere un minuto y vuelva a intentar.";
  }
  if (/timeout|timed out|aborted|abort|etimedout/.test(t)) {
    return "La inteligencia artificial tardó demasiado en contestar. Vuelva a intentar; si se repite, pruebe con menos información.";
  }
  if (/enotfound|econnreset|econnrefused|fetch failed|network|socket/.test(t)) {
    return "No se pudo contactar al servicio de inteligencia artificial. Revise la conexión e intente de nuevo.";
  }
  if (/validation|invalid_request|400|schema/.test(t)) {
    return "El servicio de inteligencia artificial rechazó la petición. Avise a soporte; el detalle quedó registrado.";
  }
  // Lo desconocido se dice como desconocido, no se disfraza de otra cosa.
  return "No fue posible completar la consulta a la inteligencia artificial. El detalle quedó registrado; si se repite, avise a soporte.";
}
